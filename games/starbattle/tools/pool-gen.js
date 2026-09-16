// 题库池生成器 v2: 多线程并行出题 + 断点续跑 + 布局hash去重
// 用法: node pool-gen.js [线程数]
//   - 自动读取 ../bank.js 现有题量, 只补差额
//   - 每题双验证: 唯一解(可信位掩码计数器) + 禁猜测纯逻辑可解
//   - 每轮结束立即落盘, 随时 Ctrl+C 可断点续跑
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');

const starDir = path.join(__dirname, '..');
const bankPath = path.join(starDir, 'bank.js');
const fastPath = path.join(__dirname, 'fast-gen.js');
const workerPath = path.join(__dirname, '_worker.js');
const TARGETS = JSON.parse(process.env.POOL_TARGETS || '{"7":200,"8":200,"9":200}'); // 可用 POOL_TARGETS 覆盖 (冒烟测试用)
// 各尺寸全量尝试次数上限 (实测单题均值 × 4 余量, 仅作 worker 死循环保护)
const GUARD_PER = { '7': 16000, '8': 44000, '9': 180000 };

const WORKERS = Math.max(1, +(process.argv[2] || (os.cpus().length - 1)));

function log(s) { console.error('[pool] ' + s); }
function hashOf(pz) { return pz.regions.join('|'); }
function counts(bank) { return Object.keys(TARGETS).map(k => k + 'x' + k + ':' + bank[k].length + '/' + TARGETS[k]).join('  '); }

function loadBank() {
    if (!fs.existsSync(bankPath)) return { '7': [], '8': [], '9': [] };
    const s = fs.readFileSync(bankPath, 'utf8');
    const start = s.indexOf('{');
    let depth = 0, end = -1;
    for (let i = start; i < s.length; i++) {
        if (s[i] === '{') depth++;
        else if (s[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    const bank = JSON.parse(s.slice(start, end));
    for (const k of Object.keys(TARGETS)) if (!bank[k]) bank[k] = [];
    return bank;
}

function saveBank(bank) {
    const header = '// 自动生成题库 (tools/pool-gen.js 产出, 勿手改)\n'
        + '// 注入新题: 直接往对应数组追加合格题目即可, 玩家进度按布局hash记录, 会自动无缝继续玩新题\n'
        + '// 每题格式: regions = N 行字符串(每字符为区域编号 0..N-1), solution = ["行,列", ...]\n';
    const body = Object.keys(bank).map(k =>
        '  ' + JSON.stringify(k) + ': [\n'
        + bank[k].map(pz => '    ' + JSON.stringify(pz)).join(',\n')
        + '\n  ]'
    ).join(',\n');
    const tmp = bankPath + '.tmp';
    fs.writeFileSync(tmp, header + 'const PUZZLE_BANK = {\n' + body + '\n};\n');
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
                    out[idx] = { size: job.size, puzzles: m.puzzles };
                    log('  批次#' + idx + ' ' + job.size + 'x' + job.size + ' -> +' + m.puzzles.length
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
    const bank = loadBank();
    const seen = new Set();
    for (const k of Object.keys(TARGETS)) for (const pz of bank[k]) seen.add(hashOf(pz));
    log('起始 ' + counts(bank) + ' | 线程 ' + WORKERS + ' | 去重基准 ' + seen.size + ' 道');
    const t0 = Date.now();

    let round = 0;
    while (Object.keys(TARGETS).some(k => bank[k].length < TARGETS[k])) {
        round++;
        const jobs = [];
        // 先派发大尺寸 (9x9 最慢, 让它最早开始)
        for (const k of Object.keys(TARGETS).slice().sort((a, b) => +b - +a)) {
            const need = TARGETS[k] - bank[k].length;
            if (need <= 0) continue;
            const chunk = Math.max(1, Math.ceil(need / WORKERS));
            for (let i = 0; i < WORKERS && i * chunk < need; i++) {
                jobs.push({ size: +k, count: Math.min(chunk, need - i * chunk) });
            }
        }
        log('第 ' + round + ' 轮: 派发 ' + jobs.length + ' 批次 (' + jobs.reduce((a, j) => a + j.count, 0) + ' 道)');
        const results = await runPool(jobs, WORKERS);
        let added = 0;
        for (const r of results) {
            if (!r) continue;
            const key = String(r.size);
            for (const pz of r.puzzles) {
                if (bank[key].length >= TARGETS[key]) break;
                const h = hashOf(pz);
                if (seen.has(h)) continue;
                seen.add(h);
                bank[key].push(pz);
                added++;
            }
        }
        saveBank(bank);
        log('第 ' + round + ' 轮结束 +' + added + ' | ' + counts(bank) + ' | 累计 ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
    }
    saveBank(bank);
    log('全部完成 ' + counts(bank) + ' | 总耗时 ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
    log('bank.js 体积 ' + (fs.statSync(bankPath).size / 1024).toFixed(0) + ' KB');
}

main().catch(e => { console.error('[pool] 失败: ' + e.message); process.exit(1); });