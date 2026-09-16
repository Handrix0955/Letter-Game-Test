// 出题 worker (由 pool-gen.js 派生, 勿单独运行)
// workerData: { size, count, guard, fastPath }
const { parentPort, workerData } = require('worker_threads');
const G = require(workerData.fastPath);

const N = workerData.size;
const want = workerData.count;
const out = [];
const cap = new Array(N);
let guard = workerData.guard;

while (out.length < want && guard-- > 0) {
    const grid = G.genRegions(N);
    if (!grid) continue;
    if (G.countSolutions(grid, N, 2, cap) !== 1) continue;
    if (!G.logicSolvable(grid, N)) continue;
    const regions = [];
    for (let r = 0; r < N; r++) regions.push(Array.from(grid[r]).join(''));
    const solution = [];
    for (let r = 0; r < N; r++) solution.push(r + ',' + cap[r]);
    out.push({ regions: regions, solution: solution });
}

parentPort.postMessage({ puzzles: out, attempts: workerData.guard - guard });