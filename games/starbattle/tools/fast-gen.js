function rnd(n) { return Math.floor(Math.random() * n); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } }
// ======== 区域分割 v2 (frontier 生长, 随机挑区域 -> 天然大小差异) ========
function genRegionsFast(N) {
  const TOTAL = N * N;
  for (let attempt = 0; attempt < 30; attempt++) {
    const grid = [];
    for (let r = 0; r < N; r++) grid.push(new Int8Array(N).fill(-1));
    const cells = [];
    for (let v = 0; v < TOTAL; v++) cells.push(v);
    shuffle(cells);
    const fronts = [];
    for (let i = 0; i < N; i++) fronts.push([]);
    const growNbrs = (i, r, c) => {
      if (r > 0 && grid[r - 1][c] === -1) fronts[i].push((r - 1) * N + c);
      if (r < N - 1 && grid[r + 1][c] === -1) fronts[i].push((r + 1) * N + c);
      if (c > 0 && grid[r][c - 1] === -1) fronts[i].push(r * N + (c - 1));
      if (c < N - 1 && grid[r][c + 1] === -1) fronts[i].push(r * N + (c + 1));
    };
    for (let i = 0; i < N; i++) { const v = cells[i]; const r = (v / N) | 0, c = v % N; grid[r][c] = i; growNbrs(i, r, c); }
    let remaining = TOTAL - N;
    let stuck = false;
    while (remaining > 0) {
      const act = [];
      for (let i = 0; i < N; i++) if (fronts[i].length) act.push(i);
      if (!act.length) { stuck = true; break; }
      const i = act[(Math.random() * act.length) | 0];
      const fl = fronts[i];
      const idx = (Math.random() * fl.length) | 0;
      const v = fl[idx];
      fl[idx] = fl[fl.length - 1]; fl.pop();
      const r = (v / N) | 0, c = v % N;
      if (grid[r][c] !== -1) continue;
      grid[r][c] = i; remaining--;
      growNbrs(i, r, c);
    }
    if (!stuck && remaining === 0) return grid;
  }
  return null;
}
// ======== 解计数器 v2 (位掩码: 列占 bit0..N-1, 区域占 bitN..2N-1, 位空间分离) ========
// 修复两个致命 bug:
//   1. 旧版把区域约束施加在"列可用掩码"上 -> 区域约束形同虚设 (同一区域可放多颗星)
//   2. 旧版列/区域共用位空间 -> 用掉列 i 就误判区域 i 已用, 大量漏解
function countSolutionsFast(grid, N, limit, capture) {
  if (limit === undefined) limit = 2;
  const FULL = (1 << N) - 1;
  const regBit = [];
  for (let r = 0; r < N; r++) { const row = []; for (let c = 0; c < N; c++) row.push(1 << (N + grid[r][c])); regBit.push(row); }
  const sol = new Array(N);
  let n = 0;
  const bt = (r, colUsed, regUsed, prevC) => {
    if (r === N) {
      n++;
      if (capture && n === 1) for (let i = 0; i < N; i++) capture[i] = sol[i];
      return;
    }
    let forb = 0;
    if (prevC >= 0) {
      const lo = Math.max(0, prevC - 1), hi = Math.min(N - 1, prevC + 1);
      forb = ((1 << (hi + 1)) - 1) ^ ((1 << lo) - 1);
    }
    let avail = FULL & ~(colUsed | forb);
    while (avail) {
      const bit = avail & -avail;
      avail -= bit;
      const c = 31 - Math.clz32(bit);
      const rb = regBit[r][c];
      if (regUsed & rb) continue;
      sol[r] = c;
      bt(r + 1, colUsed | bit, regUsed | rb, c);
      if (n >= limit) return;
    }
  };
  bt(0, 0, 0, -1);
  return n;
}
function logicSolvable(grid, N) {
  const g = Array.from({ length: N }, () => Array(N).fill(0));
  const rc = {};
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) (rc[grid[r][c]] = rc[grid[r][c]] || []).push([r, c]);
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (g[r][c] === 1) {
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const x = r + a, y = c + b;
        if (x >= 0 && x < N && y >= 0 && y < N && !g[x][y]) { g[x][y] = -1; changed = true; }
      }
      for (let i = 0; i < N; i++) {
        if (!g[r][i]) { g[r][i] = -1; changed = true; }
        if (!g[i][c]) { g[i][c] = -1; changed = true; }
      }
      for (const e of rc[grid[r][c]]) if (!g[e[0]][e[1]]) { g[e[0]][e[1]] = -1; changed = true; }
    }
    const groups = [];
    for (let i = 0; i < N; i++) {
      groups.push([['r', i], Array.from({ length: N }, (_, q) => [i, q])]);
      groups.push([['c', i], Array.from({ length: N }, (_, q) => [q, i])]);
    }
    for (const id in rc) groups.push([['g', id], rc[id]]);
    for (const [gi, cs] of groups) {
      const st = cs.filter(e => g[e[0]][e[1]] === 1).length;
      const u = cs.filter(e => g[e[0]][e[1]] === 0);
      if (st === 1) { for (const e of u) if (!g[e[0]][e[1]]) { g[e[0]][e[1]] = -1; changed = true; } }
      else if (st === 0 && u.length === 1) { g[u[0][0]][u[0][1]] = 1; changed = true; }
      else if (st === 0 && u.length === 0) return false;
    }
    for (const [gi, cs] of groups) {
      const u = cs.filter(e => g[e[0]][e[1]] === 0);
      if (!u.length) continue;
      if (gi[0] === 'r' || gi[0] === 'c') {
        const rs = new Set(u.map(e => grid[e[0]][e[1]]));
        if (rs.size === 1) {
          const R = [...rs][0];
          for (const e of rc[R]) if (!cs.some(z => z[0] === e[0] && z[1] === e[1]) && !g[e[0]][e[1]]) { g[e[0]][e[1]] = -1; changed = true; }
        }
      } else {
        const rs = new Set(u.map(e => e[0])), ct = new Set(u.map(e => e[1]));
        if (rs.size === 1) { const r = u[0][0]; for (let c = 0; c < N; c++) if (grid[r][c] != gi[1] && !g[r][c]) { g[r][c] = -1; changed = true; } }
        if (ct.size === 1) { const c = u[0][1]; for (let r = 0; r < N; r++) if (grid[r][c] != gi[1] && !g[r][c]) { g[r][c] = -1; changed = true; } }
      }
    }
  }
  return g.flat().every(v => v !== 0) && g.flat().filter(v => v === 1).length === N;
}
function genPuzzleFast(N, maxAttempts) {
  if (maxAttempts === undefined) maxAttempts = 500000;
  const cap = new Array(N);
  for (let i = 0; i < maxAttempts; i++) {
    const grid = genRegionsFast(N);
    if (!grid) continue;
    if (countSolutionsFast(grid, N, 2, cap) !== 1) continue;
    const sol = [];
    for (let r = 0; r < N; r++) sol.push(r + "," + cap[r]);
    if (!logicSolvable(grid, N)) continue;
    const regions = [];
    for (let r = 0; r < N; r++) regions.push(Array.from(grid[r]).join(""));
    return { regions: regions, solution: sol };
  }
  throw new Error("gen fail " + N + "x" + N);
}
module.exports = { genRegions: genRegionsFast, countSolutions: countSolutionsFast, logicSolvable: logicSolvable, genPuzzle: genPuzzleFast };
