/**
 * 星战谜题 - 题库驱动版 + 计时器
 */

// ======== 核心状态变量 ========
let size = 8;
let maxHp = 3;
let currentHp = 3;
let currentTarget = 'irene';
let foundCount = 0;
let isGameOver = false;

// ======== 中秋限时活动「玉兔寻觅」 (隔离开发, 不影响普通模式) ========
const MOON_EVENT_END = '2026-10-08T23:59:59+08:00';
let isMoonEvent = false;

let currentPuzzle = null;
let timerInterval = null;
let startTime = 0;
let elapsedSeconds = 0;

// ======== 战绩系统 (仅记录通关, 口径与字母数独一致) ========
let defaultStarStats = {
    '7': { best: null, avg: 0, count: 0, name: '7x7 简单' },
    '8': { best: null, avg: 0, count: 0, name: '8x8 中等' },
    '9': { best: null, avg: 0, count: 0, name: '9x9 困难' },
    'event_total': { best: null, avg: 0, count: 0, name: '活动模式总榜' },
    'event_moon': { best: null, avg: 0, count: 0, name: '玉兔爽局' }
};
let starStats = storageGet('ireStarStats', defaultStarStats) || defaultStarStats;
if (typeof starStats !== 'object' || starStats === null) starStats = defaultStarStats;
// 旧存档兼容: 补挂活动档与总榜 (不碰已有普通档数据)
if (!starStats['event_moon']) starStats['event_moon'] = { best: null, avg: 0, count: 0, name: '玉兔爽局' };
if (!starStats['event_total']) starStats['event_total'] = { best: null, avg: 0, count: 0, name: '活动模式总榜' };

function formatTime(sec) {
    if (sec === null || sec === Infinity) return '--:--';
    let m = Math.floor(sec / 60).toString().padStart(2, '0');
    let s = Math.round(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

// 活动模式战绩记在 event_moon 键, 与普通档完全隔离
function statsKey() { return isMoonEvent ? 'event_moon' : String(size); }

function saveStarStats() {
    let s = starStats[statsKey()];
    if (!s) return;
    s.count++;
    s.avg = ((s.avg * (s.count - 1)) + elapsedSeconds) / s.count;
    if (s.best === null || elapsedSeconds < s.best) s.best = elapsedSeconds;
    // 活动模式通关同时累积"活动总榜" (口径与数独的 event_total 一致)
    if (isMoonEvent && starStats['event_total']) {
        let t = starStats['event_total'];
        t.count++;
        t.avg = ((t.avg * (t.count - 1)) + elapsedSeconds) / t.count;
        if (t.best === null || elapsedSeconds < t.best) t.best = elapsedSeconds;
    }
    storageSet('ireStarStats', starStats);
}

function openStats() {
    let html = `<tr><th>难度</th><th>最佳记录</th><th>平均耗时</th><th>通关局数</th><th>题库进度</th></tr>`;
    ['7', '8', '9', 'event_total', 'event_moon'].forEach(k => {
        let s = starStats[k];
        if (!s) return;
        // 过期且从未玩过的活动分榜不再展示 (总榜始终保留); 口径与数独一致
        if (k === 'event_moon' && !document.getElementById('event-moon-option') && s.count === 0) return;
        // 进度按当前池过滤统计 (活动池切换后, 旧共用池的已玩 hash 自动排除; 普通池无影响)
        const isEvtRow = k === 'event_moon';
        let progCell = '—';
        if (k !== 'event_total') { // 总榜不绑题库, 其余行才计算进度
            const pool = isEvtRow
                ? ((typeof EVENT_BANK !== 'undefined' && EVENT_BANK.event_moon && EVENT_BANK.event_moon.length) ? EVENT_BANK.event_moon : PUZZLE_BANK['9'])
                : PUZZLE_BANK[k];
            const hashSet = new Set(pool.map(puzzleHash));
            const progCnt = (starProgress.played[k] || []).filter(h => hashSet.has(h)).length;
            progCell = `${progCnt}/${pool.length}`;
        }
        html += `<tr>
            <td><b>${s.name}</b></td>
            <td style="color: var(--stat-best-color); font-weight:bold;">${formatTime(s.best)}</td>
            <td>${s.count === 0 ? '--:--' : formatTime(s.avg)}</td>
            <td>${s.count}</td>
            <td>${progCell}</td>
        </tr>`;
    });
    document.getElementById('statsTable').innerHTML = html;
    document.getElementById('statsModal').style.display = 'flex';
}

// ======== 防重复抽题 (已玩集合; 注入新题后玩家自动无缝继续) ========
let defaultStarProgress = { ver: 2, played: { '7': [], '8': [], '9': [], 'event_moon': [] }, cycles: { '7': 0, '8': 0, '9': 0, 'event_moon': 0 } };
let starProgress = storageGet('ireStarProgress', defaultStarProgress) || defaultStarProgress;
// ver 2: 进度语义修正为"通关才计入" (旧版本开局即计入, 已污染数据自动重置一次)
if (typeof starProgress !== 'object' || !starProgress.played || starProgress.ver !== 2) starProgress = JSON.parse(JSON.stringify(defaultStarProgress));
['7', '8', '9', 'event_moon'].forEach(k => {
    if (!Array.isArray(starProgress.played[k])) starProgress.played[k] = [];
    if (typeof starProgress.cycles[k] !== 'number') starProgress.cycles[k] = 0;
});

function puzzleHash(pz) { return pz.regions.join('|'); }

let currentPuzzleHash = ''; // 当前局题目的布局 hash (通关时才计入已玩集合)

function drawPuzzle(sizeKey, bankArr) {
    const playedSet = new Set(starProgress.played[sizeKey]);
    let unplayed = [];
    bankArr.forEach((pz, idx) => { if (!playedSet.has(puzzleHash(pz))) unplayed.push(idx); });
    if (unplayed.length === 0) {
        // 本难度整轮通关: 记录轮次, 重置已玩集合, 开启新一轮随机题序
        starProgress.cycles[sizeKey]++;
        starProgress.played[sizeKey] = [];
        storageSet('ireStarProgress', starProgress);
        setTimeout(() => {
            const roundLabel = sizeKey === 'event_moon' ? '9x9 玉兔寻觅' : `${sizeKey}x${sizeKey}`;
            showAppMessage('题库大满贯！', `你已通关 ${roundLabel} 的全部 ${bankArr.length} 道题！题库已重新随机，继续挑战更快纪录吧！`, '#8b5cf6', ICON_TROPHY);
        }, 400);
        unplayed = bankArr.map((_, idx) => idx);
    }
    const pick = unplayed[Math.floor(Math.random() * unplayed.length)];
    currentPuzzleHash = puzzleHash(bankArr[pick]); // 仅暂存当前局, 通关时才真正计入进度
    return bankArr[pick];
}

const ICON_HEART_CRACK = '<svg class="icon" viewBox="0 0 24 24"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="m12 13-1-1 2-2-3-3 2-2"/></svg>';

// ======== SVG 图标 (替代 emoji) ========
const ICON_TROPHY = '<svg class="icon" viewBox="0 0 24 24"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>';

// ======== 初始化逻辑 ========

function startNewGame() {
    const diff = document.getElementById('diff-select').value;

    // 活动过期管理: 过期即摘除选项; 若正玩着活动档, 切回普通 8x8 重开
    if (new Date() > new Date(MOON_EVENT_END)) {
        const opt = document.getElementById('event-moon-option');
        if (opt) opt.remove();
        if (diff === 'event_moon') {
            document.getElementById('diff-select').value = '8';
            return startNewGame();
        }
    }

    // 活动分支: 9x9 / 3 命 / 独立进度与战绩; 普通模式逻辑零改动
    isMoonEvent = diff === 'event_moon';
    document.body.classList.toggle('theme-moon', isMoonEvent);

    size = isMoonEvent ? 9 : parseInt(diff);
    // 7x7给2命，8x8/9x9给3命
    maxHp = isMoonEvent ? 3 : (size === 7 ? 2 : 3);
    currentHp = maxHp;
    foundCount = 0;
    isGameOver = false;

    // 从题库抽题 (已玩集合防重复, 不重复玩完一轮后自动开新一轮)
    // 活动模式: 题目取自活动专属池 EVENT_BANK (与普通池零重叠), 进度记在独立的 event_moon 键
    const progKey = isMoonEvent ? 'event_moon' : String(size);
    // 兜底: 若 bank.js 旧版本尚无 EVENT_BANK, 活动档自动退回共用 9x9 池
    const eventPool = (typeof EVENT_BANK !== 'undefined' && EVENT_BANK.event_moon && EVENT_BANK.event_moon.length)
        ? EVENT_BANK.event_moon : PUZZLE_BANK['9'];
    currentPuzzle = drawPuzzle(progKey, isMoonEvent ? eventPool : PUZZLE_BANK[String(size)]);

    renderHp();
    buildBoard();

    // 启动计时器
    clearInterval(timerInterval);
    elapsedSeconds = 0;
    updateTimerUI();
    startTime = Date.now();
    timerInterval = setInterval(() => {
        if (isGameOver) return;
        elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
        updateTimerUI();
    }, 1000);
}

function buildBoard() {
    const boardEl = document.getElementById('star-board');
    // minmax(0, 1fr): 防止 Safari 用 min-content 撑破轨道, 导致棋盘被拉成矩形
    boardEl.style.gridTemplateColumns = `repeat(${size}, minmax(0, 1fr))`;
    boardEl.style.gridTemplateRows = `repeat(${size}, minmax(0, 1fr))`;
    boardEl.style.gridAutoRows = 'minmax(0, 1fr)';
    boardEl.innerHTML = ''; 

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.r = r;
            cell.dataset.c = c;

            // 分配颜色属性 (交由 CSS 控制)
            const rId = parseInt(currentPuzzle.regions[r][c]);
            cell.dataset.cid = rId % 9; // cid = Color ID (0~8)

            // 绘制 Bento 边界
            if (r === 0 || currentPuzzle.regions[r - 1][c] != rId) cell.classList.add('b-top');
            if (r === size - 1 || currentPuzzle.regions[r + 1][c] != rId) cell.classList.add('b-bottom');
            if (c === 0 || currentPuzzle.regions[r][c - 1] != rId) cell.classList.add('b-left');
            if (c === size - 1 || currentPuzzle.regions[r][c + 1] != rId) cell.classList.add('b-right');

            boardEl.appendChild(cell);
        }
    }
    lockBoardSquare();
}

// ======== 状态渲染逻辑 ========

function renderHp() {
    const hpContainer = document.getElementById('hp-container');
    hpContainer.innerHTML = '';
    for (let i = 0; i < maxHp; i++) {
        let svg;
        if (isMoonEvent) {
            // 月相 HP: 满月 = 剩余血量, 残月 = 已失去
            svg = i >= currentHp
                ? `<svg class="heart-icon icon lost" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="transparent" stroke="#fde047" stroke-width="2" opacity="0.4"/></svg>`
                : `<svg class="heart-icon icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#fde047"/></svg>`;
        } else {
            svg = `<svg class="heart-icon icon ${i >= currentHp ? 'lost' : ''}" viewBox="0 0 24 24"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`;
        }
        hpContainer.insertAdjacentHTML('beforeend', svg);
    }
}

function toggleTarget() {
    currentTarget = currentTarget === 'irene' ? 'handrix' : 'irene';
    document.getElementById('target-text').innerText = currentTarget === 'irene' ? '找 Irene' : '找 Handrix';
}

function updateTimerUI() {
    const m = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
    const s = String(elapsedSeconds % 60).padStart(2, '0');
    document.getElementById('timer').innerHTML = `<svg class="icon inline-icon" style="width:14px;height:14px;" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${m}:${s}`;
}

// ======== 手势交互引擎 (极速响应) ========

const boardEl = document.getElementById('star-board');
let lastTapTime = 0;
let lastTapCell = null;
let isDragging = false;
let startX = 0, startY = 0;
let hasMoved = false;
let dragErase = false; // 本次滑动是"擦除"模式 (起点是已画叉的格子)

boardEl.addEventListener('pointerdown', (e) => {
    if (isGameOver) return;
    isDragging = true;
    hasMoved = false;
    startX = e.clientX;
    startY = e.clientY;
    // 滑动模式在按下瞬间定调: 起点若已是叉, 整段滑动为擦除; 否则为画叉
    const originCell = e.target && e.target.closest ? e.target.closest('.cell') : null;
    dragErase = !!(originCell && originCell.classList.contains('marked'));
    e.target.setPointerCapture(e.pointerId);
});

boardEl.addEventListener('pointermove', (e) => {
    if (!isDragging || isGameOver) return;
    if (!hasMoved && Math.hypot(e.clientX - startX, e.clientY - startY) > 10) {
        hasMoved = true;
        lastTapTime = 0; // 一旦拖动, 清除双击计时, 避免"点-拖-点"被误判为双击
    }
    if (hasMoved) {
        let el = document.elementFromPoint(e.clientX, e.clientY);
        let cell = el ? el.closest('.cell') : null;
        if (cell && !cell.dataset.locked) {
            if (dragErase) cell.classList.remove('marked');
            else cell.classList.add('marked');
        }
    }
});

boardEl.addEventListener('pointercancel', () => { isDragging = false; });

// 移动端保险: 个别 iOS/Safari 版本解析"flex 子项 + aspect-ratio"时会算错高度,
// 导致棋盘非正方形(行高 != 列宽) -> 格子被拉长或露出底板黑缝。
// 这里用实测宽度锁定高度(border-box 下正好等于宽度), 保证棋盘恒为正方形。
function lockBoardSquare() {
    const rect = boardEl.getBoundingClientRect();
    if (rect.width <= 0) return;
    if (Math.abs(rect.height - rect.width) > 0.5) boardEl.style.height = rect.width + 'px';
}
window.addEventListener('resize', lockBoardSquare);
window.addEventListener('orientationchange', () => setTimeout(lockBoardSquare, 250));

boardEl.addEventListener('pointerup', (e) => {
    isDragging = false;
    let cell = e.target.closest('.cell');
    if (!cell || isGameOver) return;

    if (!hasMoved) {
        let now = Date.now();
        if (now - lastTapTime < 250 && lastTapCell === cell) {
            lastTapTime = 0; 
            handleDoubleTap(cell);
        } else {
            lastTapTime = now;
            lastTapCell = cell;
            if (!cell.dataset.locked) cell.classList.toggle('marked');
        }
    }
});

// ======== 核心判定系统 ========

function handleDoubleTap(cell) {
    if (cell.dataset.locked) return;

    let r = cell.dataset.r;
    let c = cell.dataset.c;
    let posKey = `${r},${c}`;

    cell.classList.remove('marked');
    cell.dataset.locked = 'true';

    // 查字典：判断当前点击的坐标是否在题库的 solution 数组中
    if (currentPuzzle.solution.includes(posKey)) {
        // 判定正确！
        const img = document.createElement('img');
        img.src = `../../assets/${currentTarget}.png`;
        img.className = 'cell-avatar';
        cell.appendChild(img);

        // 中秋活动: 兔耳 + 自动排除 Buff (同行/同列/对角邻域自动打上月饼叉, 严格数字比对)
        if (isMoonEvent) {
            let ears = document.createElement('div'); ears.className = 'bunny-ears'; cell.appendChild(ears);
            let targetR = parseInt(r, 10);
            let targetC = parseInt(c, 10);
            document.querySelectorAll('.cell').forEach(el => {
                let curR = parseInt(el.dataset.r, 10);
                let curC = parseInt(el.dataset.c, 10);
                let isSameRow = (curR === targetR);
                let isSameCol = (curC === targetC);
                let isAdjacent = (Math.abs(curR - targetR) <= 1 && Math.abs(curC - targetC) <= 1);
                if (isSameRow || isSameCol || isAdjacent) {
                    if (!el.dataset.locked && !el.classList.contains('error-lock')) {
                        el.classList.add('marked');
                    }
                }
            });
        }

        if (typeof playSound === 'function') playSound('bubble');
        
        foundCount++;
        checkWinCondition();
    } else {
        // 判定错误！
        cell.classList.add('error-lock');
        currentHp--;
        renderHp();
        
        if (navigator.vibrate) navigator.vibrate(100); 
        
        if (currentHp <= 0) {
            isGameOver = true;
            clearInterval(timerInterval);
            setTimeout(() => {
                showAppMessage('寻觅失败', '血量耗尽啦！请abb宝宝重整旗鼓，再次出发！', '#ef4444', ICON_HEART_CRACK);
            }, 300);
        }
    }
}

function checkWinCondition() {
    if (foundCount === size) {
        elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
        isGameOver = true;
        clearInterval(timerInterval); // 无论什么模式必须停表
        saveStarStats(); // 通关战绩落盘 (仅记录胜利)
        // 通关才计入题库进度 (活动档记入 event_moon 键, 与普通档隔离)
        const progKey = statsKey();
        if (currentPuzzleHash && !starProgress.played[progKey].includes(currentPuzzleHash)) {
            starProgress.played[progKey].push(currentPuzzleHash);
            storageSet('ireStarProgress', starProgress);
            currentPuzzleHash = '';
        }
        if (isMoonEvent) {
            if (typeof triggerLanterns === 'function') triggerLanterns(); // 通关孔明灯
        } else if (typeof triggerConfetti === 'function') triggerConfetti();
        setTimeout(() => {
            showAppMessage('完美寻觅！', `恭喜abb宝宝精准找出了所有的 ${currentTarget === 'irene' ? 'Irene' : 'Handrix'}！\n用时: ${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(elapsedSeconds % 60).padStart(2, '0')}`, '#10b981', ICON_TROPHY);
        }, 500);
    }
}

function openRules() { document.getElementById('rulesModal').style.display = 'flex'; }

window.addEventListener('DOMContentLoaded', startNewGame);

// ======== 中秋活动: 通关孔明灯 (DOM 灯体 + CSS 动画, 自下而上摇曳飘升) ========
function triggerLanterns() {
    if (typeof playSound === 'function') playSound('win');
    const n = 22;
    for (let i = 0; i < n; i++) {
        const l = document.createElement('div');
        l.className = 'sky-lantern';
        const size = 18 + Math.random() * 22; // 灯体大小
        l.style.width = size + 'px';
        l.style.height = size * 1.3 + 'px';
        l.style.left = (5 + Math.random() * 90) + 'vw';
        l.style.setProperty('--sway', (Math.random() * 30 - 15) + 'px');
        l.style.setProperty('--delay', (Math.random() * 4) + 's');
        l.style.setProperty('--dur', (8 + Math.random() * 6) + 's');
        document.body.appendChild(l);
        setTimeout(() => l.remove(), 14000);
    }
}