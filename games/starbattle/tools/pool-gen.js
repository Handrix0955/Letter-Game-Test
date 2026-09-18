// 题库池生成器 v3: 多线程并行出题 + 断点续跑 + 全局布局hash去重 + 活动专属池
// 用法: node pool-gen.js [线程数]
//   普通池写入 bank.js 的 PUZZLE_BANK (7/8/9); 活动池写入 EVENT_BANK (event_moon, 全 9x9)
//   可用环境变量覆盖: POOL_TARGETS 与 EVENT_TARGETS (JSON)
//   每题双验证: 唯一解(可信位掩码计数器) + 禁猜测纯逻辑可解; 每轮结束立即落盘, 可随时 Ctrl+C
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');

const starDir = path.join(__dirname, '..');
const bankPath = path.join(starDir, 'bank.js');
const fastPath = path.join(__dirname, 'fast-gen.js');
const workerPath = path.join(__dirname, '_worker.js');
const TARGETS = JSON.parse(process.env.POOL_TARGETS || '{"7":200,"8":200,"9":200}');
const EVENT_TARGETS = JSON.parse(process.env.EVENT_TARGETS || '{"event_moon":300}');
const EVENT_SIZE = 9; // 活动池题目全部为 9x9
// 各尺寸全量尝试次数上限 (实测单题均值 x 4 余量, 仅作 worker 死循环保护)
const GUARD_PER = { '7': 16000, '8': 44000, '9': 180000 };
const WORKERS = Math.max(1, +(process.argv[2] || (os.cpus().length - 1)));

function log(s) { console.error('[pool] ' + s); }
function hashOf(pz) { return pz.regions.join('|'); }
function poolSize(key) { return key in EVENT_TARGETS ? EVENT_SIZE : +key; }
function allKeys() { return [...Object.keys(TARGETS), ...Object.keys(EVENT_TARGETS)]; }
function counts(normal, event) {
    return allKeys().map(k => {
        const isEvt = k in EVENT_TARGETS;
        const arr = isEvt ? event[k] : normal[k];
        const t = isEvt ? EVENT_TARGETS[k] : TARGETS[k];
        return k + ':' + arr.length + '/' + t;
    }).join('  ');
}

function extractBlock(src, decl) {
    const start = src.indexOf('const ' + decl + ' = {');
    if (start < 0) return null;
    let depth = 0, end = -1;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    return JSON.parse(src.slice(src.indexOf('{', start), end));
}

function loadBanks() {
    const normal = {}, event = {};
    if (fs.existsSync(bankPath)) {
        const src = fs.readFileSync(bankPath, 'utf8');
        const pb = extractBlock(src, 'PUZZLE_BANK');
        if (pb) Object.assign(normal, pb);
        const eb = extractBlock(src, 'EVENT_BANK');
        if (eb) Object.assign(event, eb);
    }
    for (const k of Object.keys(TARGETS)) if (!normal[k]) normal[k] = [];
    for (const k of Object.keys(EVENT_TARGETS)) if (!event[k]) event[k] = [];
    return { normal, event };
}

function saveBanks(normal, event) {
    const header = '// 自动生成题库 (tools/pool-gen.js 产出, 勿手改)\n'
        + '// PUZZLE_BANK = 普通三档; EVENT_BANK = 活动专属池 (event_moon, 全 9x9, 与普通池零重叠)\n'
        + '// 注入新题: 直接往对应数组追加合格题目即可, 玩家进度按布局hash记录, 会自动无缝继续玩新题\n'
        + '// 每题格式: regions = N 行字符串(每字符为区域编号 0..N-1), solution = ["行,列", ...]\n';
    const body = (bank) => Object.keys(bank).map(k =>
        '  ' + JSON.stringify(k) + ': [\n'
        + bank[k].map(pz => '    ' + JSON.stringify(pz)).join(',\n')
        + '\n  ]'
    ).join(',\n');
    const tmp = bankPath + '.tmp';
    fs.writeFileSync(tmp, header
        + 'const PUZZLE_BANK = {\n' + body(normal) + '\n};\n'
        + 'const EVENT_BANK = {\n' + body(event) + '\n};\n');
    fs.renameSync(tmp, bankPath);
}

function runPool(jobs, concurrency) {
    return new Promise((resolve, reject) => {
        const out = new Array(jobs.length);
        let next = 0, running = 0, finished = 0, failed = false, launched = 0;
        const pump = () => {
            while (running < concurrency && next < jobs.length) {
                const idx = next++;
                const job = jobs[idx];
                running++;
                const w = new Worker(workerPath, {
                    workerData: {
                        size: job.size,
                        count: job.count,
                        guard: job.count * GUARD_PER[String(job.size)],
                        fastPath: fastPath
                    }
                });
                w.on('message', m => {
                    out[idx] = { key: job.key, size: job.size, puzzles: m.puzzles };
                    log('  批次#' + idx + ' ' + job.key + ' -> +' + m.puzzles.length
                        + '/' + job.count + ' (尝试 ' + m.attempts + ')');
                });
                w.on('error', err => { failed = true; reject(err); });
                w.on('exit', code => {
                    running--; finished++;
                    if (code !== 0 && !failed) { failed = true; reject(new Error('worker 异常退出 code=' + code)); return; }
                    if (launched === jobs.length && finished === jobs.length && !failed) { resolve(out); return; }
                    pump();
                });
                launched++;
            }
        };
        pump();
    });
}

async function main() {
    const { normal, event } = loadBanks();
    const seen = new Set(); // 全局去重: 普通池 + 活动池 互不重叠
    for (const k of Object.keys(TARGETS)) for (const pz of normal[k]) seen.add(hashOf(pz));
    for (const k of Object.keys(EVENT_TARGETS)) for (const pz of event[k]) seen.add(hashOf(pz));
    log('起始 ' + counts(normal, event) + ' | 线程 ' + WORKERS + ' | 去重基准 ' + seen.size + ' 道');
    const t0 = Date.now();
    const needOf = (k) => (k in EVENT_TARGETS ? EVENT_TARGETS[k] - event[k].length : TARGETS[k] - normal[k].length);
    let round = 0;
    while (allKeys().some(k => needOf(k) > 0)) {
        round++;
        const jobs = [];
        // 先派发大尺寸 (9x9 最慢, 让它最早开始)
        for (const k of allKeys().sort((a, b) => poolSize(b) - poolSize(a))) {
            const need = needOf(k);
            if (need <= 0) continue;
            const size = poolSize(k);
            const chunk = Math.max(1, Math.ceil(need / WORKERS));
            for (let i = 0; i < WORKERS && i * chunk < need; i++) {
                jobs.push({ key: k, size, count: Math.min(chunk, need - i * chunk) });
            }
        }
        log('第 ' + round + ' 轮: 派发 ' + jobs.length + ' 批次 (' + jobs.reduce((a, j) => a + j.count, 0) + ' 道)');
        const results = await runPool(jobs, WORKERS);
        let added = 0;
        for (const r of results) {
            if (!r) continue;
            const isEvt = r.key in EVENT_TARGETS;
            const arr = isEvt ? event[r.key] : normal[r.key];
            const target = isEvt ? EVENT_TARGETS[r.key] : TARGETS[r.key];
            for (const pz of r.puzzles) {
                if (arr.length >= target) break;
                const h = hashOf(pz);
                if (seen.has(h)) continue;
                seen.add(h);
                arr.push(pz);
                added++;
            }
        }
        saveBanks(normal, event);
        log('第 ' + round + ' 轮结束 +' + added + ' | ' + counts(normal, event) + ' | 累计 ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
    }
    saveBanks(normal, event);
    log('全部完成 ' + counts(normal, event) + ' | 总耗时 ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
    log('bank.js 体积 ' + (fs.statSync(bankPath).size / 1024).toFixed(0) + ' KB');
}

main().catch(e => { console.error('[pool] 失败: ' + e.message); process.exit(1); });