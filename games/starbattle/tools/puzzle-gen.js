/**
 * 星战谜题验证器 (一次性工具, 不参与前端运行)
 *
 * 用法:
 *   node puzzle-gen.js verify   # 从 ../bank.js 读取题库并全量验证
 *
 * 验证项 (全 PASS 才算题库合格):
 *   1. 区域连通 + 区域数 = 棋盘边长
 *   2. 唯一解: 回溯计数器数解, 必须恰好为 1 (判定公平的底线)
 *   3. 纯逻辑可解: 约束传播求解器 (禁猜测) 必须推完棋盘
 *   4. 声明解合法 + 与唯一解匹配
 *
 * 注: 出题请用 pool-gen.js (多线程并行 + hash 去重 + 断点续跑)
 */
const fs = require('fs');
const path = require('path');

// 以下 COUNTS / 生成函数仅为历史保留 (本文件当前只用于 verify)
const COUNTS = { 7: 5, 8: 5, 9: 5 };

function rnd(n) { return Math.floor(Math.random() * n); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ======== 随机连通区域分割 (BFS 生长, 保证连通; 失败返回 null) ========
function genRegions(N) {
    const grid = Array.from({ length: N }, () => Array(N).fill(-1));
    const cells = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cells.push([r, c]);
    shuffle(cells).slice(0, N).forEach(([r, c], i) => { grid[r][c] = i; });
    let remaining = N * N - N;
    while (remaining > 0) {
        let grew = false;
        for (const i of shuffle([...Array(N).keys()])) {
            const opts = [];
            for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (grid[r][c] === i) {
                for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nr = r + dr, nc = c + dc;
                    if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) opts.push([nr, nc]);
                }
            }
            if (opts.length) { const [r, c] = opts[rnd(opts.length)]; grid[r][c] = i; remaining--; grew = true; }
            if (remaining === 0) break;
        }
        if (!grew) return null;
    }
    return grid;
}

// ======== 随机生成一个满足规则的完整解 (随机化回溯) ========
function randomSolution(grid, N) {
    const colUsed = Array(N).fill(false), regUsed = {}, placed = [];
    function bt(r) {
        if (r === N) return true;
        const cols = shuffle([...Array(N).keys()]);
        for (const c of cols) {
            if (colUsed[c]) continue;
            const g = grid[r][c];
            if (regUsed[g]) continue;
            if (placed.some(([pr, pc]) => Math.abs(pr - r) <= 1 && Math.abs(pc - c) <= 1)) continue;
            colUsed[c] = true; regUsed[g] = true; placed.push([r, c]);
            if (bt(r + 1)) return true;
            placed.pop(); colUsed[c] = false; regUsed[g] = false;
        }
        return false;
    }
    return bt(0) ? placed.map(e => e.join(',')) : null;
}

// ======== 解计数器 (回溯, 上限截断) ========
function countSolutions(grid, N, limit = 2) {
    let n = 0;
    const colUsed = Array(N).fill(false), regUsed = {}, placed = [];
    (function bt(r) {
        if (n >= limit) return;
        if (r === N) { n++; return; }
        for (let c = 0; c < N; c++) {
            if (colUsed[c]) continue;
            const g = grid[r][c];
            if (regUsed[g]) continue;
            if (placed.some(([pr, pc]) => Math.abs(pr - r) <= 1 && Math.abs(pc - c) <= 1)) continue;
            colUsed[c] = true; regUsed[g] = true; placed.push([r, c]);
            bt(r + 1);
            placed.pop(); colUsed[c] = false; regUsed[g] = false;
            if (n >= limit) return;
        }
    })(0);
    return n;
}

// ======== 人类逻辑求解器 (约束传播, 禁止猜测) ========
function logicSolvable(grid, N) {
    const g = Array.from({ length: N }, () => Array(N).fill(0)); // 0未知 1星 -1空
    const rc = {};
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) (rc[grid[r][c]] = rc[grid[r][c]] || []).push([r, c]);
    let changed = true;
    while (changed) {
        changed = false;
        // 星星排斥
        for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (g[r][c] === 1) {
            for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
                const x = r + a, y = c + b;
                if (x >= 0 && x < N && y >= 0 && y < N && !g[x][y]) { g[x][y] = -1; changed = true; }
            }
            for (let i = 0; i < N; i++) {
                if (!g[r][i]) { g[r][i] = -1; changed = true; }
                if (!g[i][c]) { g[i][c] = -1; changed = true; }
            }
            for (const [rr, cc] of rc[grid[r][c]]) if (!g[rr][cc]) { g[rr][cc] = -1; changed = true; }
        }
        // 行/列/区域计数
        const groups = [];
        for (let i = 0; i < N; i++) {
            groups.push([['r', i], Array.from({ length: N }, (_, q) => [i, q])]);
            groups.push([['c', i], Array.from({ length: N }, (_, q) => [q, i])]);
        }
        for (const id in rc) groups.push([['g', id], rc[id]]);
        for (const [gi, cs] of groups) {
            const s = cs.filter(e => g[e[0]][e[1]] === 1).length;
            const u = cs.filter(e => g[e[0]][e[1]] === 0);
            if (s === 1) { for (const e of u) if (!g[e[0]][e[1]]) { g[e[0]][e[1]] = -1; changed = true; } }
            else if (s === 0 && u.length === 1) { g[u[0][0]][u[0][1]] = 1; changed = true; }
            else if (s === 0 && u.length === 0) return false;
        }
        // 行列-区域互锁 (双向 locked candidates)
        for (const [gi, cs] of groups) {
            const u = cs.filter(e => g[e[0]][e[1]] === 0);
            if (!u.length) continue;
            if (gi[0] === 'r' || gi[0] === 'c') {
                const regs = new Set(u.map(e => grid[e[0]][e[1]]));
                if (regs.size === 1) {
                    const R = [...regs][0];
                    for (const e of rc[R]) if (!cs.some(z => z[0] === e[0] && z[1] === e[1]) && !g[e[0]][e[1]]) { g[e[0]][e[1]] = -1; changed = true; }
                }
            } else {
                const rs = new Set(u.map(e => e[0])), ct = new Set(u.map(e => e[1]));
                if (rs.size === 1) {
                    const r = u[0][0];
                    for (let c = 0; c < N; c++) if (grid[r][c] != gi[1] && !g[r][c]) { g[r][c] = -1; changed = true; }
                }
                if (ct.size === 1) {
                    const c = u[0][1];
                    for (let r = 0; r < N; r++) if (grid[r][c] != gi[1] && !g[r][c]) { g[r][c] = -1; changed = true; }
                }
            }
        }
    }
    return g.flat().every(v => v !== 0) && g.flat().filter(v => v === 1).length === N;
}

// ======== 生成一道合格题 (唯一解 + 纯逻辑可解) ========
function genPuzzle(N, maxAttempts = 150000) {
    for (let i = 0; i < maxAttempts; i++) {
        const grid = genRegions(N);
        if (!grid) continue;
        const sol = randomSolution(grid, N);
        if (!sol) continue;
        if (countSolutions(grid, N, 2) !== 1) continue;
        if (!logicSolvable(grid, N)) continue;
        return { regions: grid.map(row => row.join('')), solution: sol };
    }
    throw new Error(`生成失败: ${N}x${N} 超过最大尝试次数`);
}

// ======== verify 模式: 从 bank.js 提取 PUZZLE_BANK + EVENT_BANK 反向验证 (含跨池去重) ========
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
function verify() {
    let src;
    const bankPath = path.join(__dirname, '..', 'bank.js');
    if (fs.existsSync(bankPath)) {
        src = fs.readFileSync(bankPath, 'utf8');
    } else {
        src = fs.readFileSync(path.join(__dirname, '..', 'star.js'), 'utf8');
    }
    // 汇总所有池 (EVENT_BANK 的 event_moon 键为 9x9)
    const pools = [];
    for (const decl of ['PUZZLE_BANK', 'EVENT_BANK']) {
        const bank = extractBlock(src, decl);
        if (!bank) { if (decl === 'PUZZLE_BANK') throw new Error('未找到 PUZZLE_BANK'); continue; }
        for (const sizeKey of Object.keys(bank)) {
            const N = sizeKey === 'event_moon' ? 9 : +sizeKey;
            pools.push({ sizeKey, N, arr: bank[sizeKey] });
        }
    }
    let allOk = true;
    // 跨池去重检查: 任何两道题 (含跨池) 布局相同即 FAIL
    const seenHash = new Map();
    for (const p of pools) for (const pz of p.arr) {
        const h = pz.regions.join('|');
        if (seenHash.has(h)) { allOk = false; console.log('跨池/池内重复布局: ' + h + ' (先出现于 ' + seenHash.get(h) + ')'); }
        else seenHash.set(h, p.sizeKey);
    }
    for (const p of pools) {
        const N = p.N;
        p.arr.forEach((pz, idx) => {
            const grid = pz.regions.map(s => [...s].map(Number));
            const sol = pz.solution.map(s => s.split(',').map(Number));
            const ids = new Set(grid.flat());
            const rc = {};
            for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) (rc[grid[r][c]] = rc[grid[r][c]] || []).push([r, c]);
            // 区域连通
            let conn = ids.size === N;
            for (const id in rc) {
                const set = new Set(rc[id].map(e => e.join()));
                const seen = new Set([rc[id][0].join()]); const q = [rc[id][0]];
                while (q.length) {
                    const [r, c] = q.pop();
                    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        const k = `${r + dr},${c + dc}`;
                        if (set.has(k) && !seen.has(k)) { seen.add(k); q.push([r + dr, c + dc]); }
                    }
                }
                if (seen.size !== rc[id].length) conn = false;
            }
            const nSol = countSolutions(grid, N, 2);
            const logic = logicSolvable(grid, N);
            const solSet = new Set(pz.solution);
            const solLegal = sol.length === N
                && new Set(sol.map(e => e[0])).size === N
                && new Set(sol.map(e => e[1])).size === N
                && new Set(sol.map(e => grid[e[0]][e[1]])).size === N
                && (() => { for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) if (Math.abs(sol[i][0] - sol[j][0]) <= 1 && Math.abs(sol[i][1] - sol[j][1]) <= 1) return false; return true; })();
            const solMatch = pz.solution.length === N && pz.solution.every(s => solSet.has(s));
            const ok = conn && nSol === 1 && logic && solLegal && solMatch;
            if (!ok) allOk = false;
            console.log(`${N}x${N} 第${idx + 1}题: 连通=${conn ? 'OK' : 'FAIL'} 唯一解=${nSol === 1 ? 'OK' : 'FAIL(' + nSol + ')'} 逻辑可解=${logic ? 'OK' : 'FAIL'} 声明解合法=${solLegal ? 'OK' : 'FAIL'} 声明解匹配=${solMatch ? 'OK' : 'FAIL'}`);
        });
    }
    console.log(allOk ? 'VERIFY-ALL-PASS' : 'VERIFY-FAILED');
    process.exitCode = allOk ? 0 : 1;
}

// ======== 主入口 ========
if (process.argv[2] === 'verify') {
    verify();
} else {
    const bank = {};
    for (const sizeKey of Object.keys(COUNTS)) {
        const N = +sizeKey;
        bank[sizeKey] = [];
        for (let i = 0; i < COUNTS[sizeKey]; i++) {
            const pz = genPuzzle(N);
            bank[sizeKey].push(pz);
            console.error(`[gen] ${N}x${N} 第${i + 1}题完成 (唯一解+逻辑可解)`);
        }
    }
    console.log(JSON.stringify(bank, null, 4));
}

// ======== 均衡区域分割 (每个区域恰好 N 格, 约束更强, 唯一解通过率更高) ========
function genRegionsBalanced(N) {
    for (let attempt = 0; attempt < 50; attempt++) {
        const grid = Array.from({ length: N }, () => Array(N).fill(-1));
        const cells = [];
        for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cells.push([r, c]);
        shuffle(cells).slice(0, N).forEach(([r, c], i) => { grid[r][c] = i; });
        const sizes = Array(N).fill(1);
        let remaining = N * N - N;
        let progress = true;
        while (remaining > 0 && progress) {
            progress = false;
            const order = shuffle([...Array(N).keys()]).sort((a, b) => sizes[a] - sizes[b]);
            for (const i of order) {
                if (sizes[i] >= N) continue;
                const opts = [];
                for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (grid[r][c] === i) {
                    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        const nr = r + dr, nc = c + dc;
                        if (nr >= 0 && nr < N && nc >= 0 && nc < N && grid[nr][nc] === -1) opts.push([nr, nc]);
                    }
                }
                if (opts.length) {
                    const [r, c] = opts[rnd(opts.length)];
                    grid[r][c] = i; sizes[i]++; remaining--; progress = true;
                }
            }
        }
        if (remaining === 0) return grid;
    }
    return null;
}
