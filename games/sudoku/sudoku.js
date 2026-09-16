function openSkinModal() { document.getElementById('skinModal').style.display = 'flex'; }

// ======== 数据安全急救与无损合并逻辑 ========
let defaultStats = {
    '35': { best: null, avg: 0, count: 0, name: '简单模式' },
    '45': { best: null, avg: 0, count: 0, name: '中等模式' },
    '55': { best: null, avg: 0, count: 0, name: '困难模式' },
    'event_total': { best: null, avg: 0, count: 0, name: '活动模式总榜' },
    'event_qixi': { best: null, avg: 0, count: 0, name: '七夕特别活动' }
};

let localStats = storageGet('ireSudokuStats', defaultStats) || defaultStats;
if (typeof localStats !== 'object' || localStats === null) localStats = defaultStats;
if (!localStats['event_total']) localStats['event_total'] = defaultStats['event_total'];
if (!localStats['event_qixi']) localStats['event_qixi'] = defaultStats['event_qixi'];

// 无损继承端午数据
if (localStats['event'] && localStats['event'].count > 0 && localStats['event_total'].count === 0) {
    localStats['event_total'].count = localStats['event'].count;
    localStats['event_total'].avg = localStats['event'].avg;
    localStats['event_total'].best = localStats['event'].best;
}

['35', '45', '55', 'event_total', 'event_qixi'].forEach(k => {
    let s = localStats[k];
    if (s) {
        s.name = defaultStats[k].name;
        if (s.best === null || s.best === 0 || s.best === Infinity) s.best = s.count > 0 ? s.avg : null;
    }
});
storageSet('ireSudokuStats', localStats);

// ======== 游戏核心逻辑 ========
const LETTERS = ['h', 'a', 'n', 'l', 'u', 'v', 'i', 'r', 'e'];
let board = Array(9).fill().map(() => Array(9).fill(0));
let solution = Array(9).fill().map(() => Array(9).fill(0));
let userGrid = Array(9).fill().map(() => Array(9).fill(''));
let notesGrid = Array(9).fill().map(() => Array(9).fill().map(()=>[]));
let isFixed = Array(9).fill().map(() => Array(9).fill(false));

let selectedRow = -1; let selectedCol = -1; let noteMode = false;
let historyStack = []; const MAX_HISTORY = 15;
let timerInterval = null; let timeElapsed = 0; let gameActive = false;
let eventHints = {}; let hintsLeft = 3;
let luvCells = [];

// 七夕在8月底过期
function checkEventExpiry() {
    let now = new Date(); let expireDate = new Date('2026-08-30T00:00:00+08:00');
    if (now > expireDate) {
        let eventOpt = document.getElementById('event-option');
        if (eventOpt) eventOpt.remove();
        if (document.getElementById('diff-select').value === 'event_qixi') document.getElementById('diff-select').value = '45';
    }
}

window.onload = () => { checkEventExpiry(); startNewGame(); };

function shuffleArray(array) {
    let arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function generateQixiSolution() {
    let shapes = [
        { type: 'diagonal', han: [[0,0],[1,1],[2,2]], luv: [[3,3],[4,4],[5,5]], ire: [[6,6],[7,7],[8,8]] },
        { type: 'diagonal', han: [[8,0],[7,1],[6,2]], luv: [[5,3],[4,4],[3,5]], ire: [[2,6],[1,7],[0,8]] },
        { type: 'bridge', han: [[4,0],[4,1],[4,2]], luv: [[4,3],[4,4],[4,5]], ire: [[4,6],[4,7],[4,8]] },
        { type: 'heart', han: [[1,3],[2,2],[3,3]], luv: [[2,4],[4,4],[5,4]], ire: [[1,5],[2,6],[3,5]] }
    ];

    let pattern = shapes[Math.floor(Math.random() * shapes.length)];

    for(let i=0; i<100; i++) {
        for(let r=0; r<9; r++) solution[r].fill(0);
        ['han', 'luv', 'ire'].forEach(g => {
            let chars = g.split('').sort(() => Math.random() - 0.5);
            for (let j = 0; j < 3; j++) {
                let pt = pattern[g][j];
                solution[pt[0]][pt[1]] = chars[j];
            }
        });
        if (solveSudoku(solution)) return pattern;
    }
    return null;
}

function startNewGame() {
    let diffKey = document.getElementById('diff-select').value;
    let blanks = diffKey.startsWith('event_') ? 55 : parseInt(diffKey);
    eventHints = {}; let forcedBlanks = [];
    luvCells = []; magpieTriggered = false;
    hintsLeft = 3; document.getElementById('hint-text').innerText = `提示(3)`;

    if (diffKey === 'event_qixi') {
        document.body.classList.add('theme-event');
        document.getElementById('main-title').innerText = "星河鹊桥局：han luv ire";
        startEventBg();

        let shapes = generateQixiSolution();
        if (shapes) {
            shapes.han.forEach(p => { forcedBlanks.push(p); eventHints[`${p[0]}-${p[1]}`] = 'han'; });
            shapes.luv.forEach(p => { forcedBlanks.push(p); eventHints[`${p[0]}-${p[1]}`] = 'luv'; luvCells.push(p); });
            shapes.ire.forEach(p => { forcedBlanks.push(p); eventHints[`${p[0]}-${p[1]}`] = 'ire'; });
        } else generateSolution();
    } else {
        document.body.classList.remove('theme-event');
        document.getElementById('main-title').innerText = "爱意九宫格：han luv ire";
        stopEventBg(); generateSolution();
    }

    createPuzzle(blanks, forcedBlanks);
    selectedRow = -1; selectedCol = -1; historyStack = [];
    renderBoard();
    gameActive = true; clearInterval(timerInterval); timeElapsed = 0; updateTimerDisplay();
    timerInterval = setInterval(() => { timeElapsed++; updateTimerDisplay(); }, 1000);
}

function updateTimerDisplay() {
    let m = Math.floor(timeElapsed / 60).toString().padStart(2, '0');
    let s = (timeElapsed % 60).toString().padStart(2, '0');
    document.getElementById('timer').innerHTML = `<svg class="icon" style="vertical-align: text-bottom; width: 16px; height: 16px;" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${m}:${s}`;
}

function saveState() {
    if (historyStack.length >= MAX_HISTORY) historyStack.shift();
    historyStack.push({ user: JSON.parse(JSON.stringify(userGrid)), notes: JSON.parse(JSON.stringify(notesGrid)) });
}

function undo() {
    if (historyStack.length === 0 || !gameActive) return;
    let lastState = historyStack.pop();
    userGrid = lastState.user; notesGrid = lastState.notes;
    renderBoard();
}

function generateSolution() { for (let i = 0; i < 9; i++) solution[i].fill(0); solveSudoku(solution); }
function solveSudoku(grid) {
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            if (grid[r][c] === 0) {
                let shuffled = shuffleArray(LETTERS);
                for (let letter of shuffled) {
                    if (isValid(grid, r, c, letter)) { grid[r][c] = letter; if (solveSudoku(grid)) return true; grid[r][c] = 0; }
                }
                return false;
            }
        }
    }
    return true;
}
function isValid(grid, row, col, letter) {
    for (let i = 0; i < 9; i++) if (grid[row][i] === letter || grid[i][col] === letter) return false;
    let sr = Math.floor(row / 3) * 3, sc = Math.floor(col / 3) * 3;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (grid[sr + i][sc + j] === letter) return false;
    return true;
}
function countSolutions(grid, limit = 2) {
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            if (grid[r][c] === 0) {
                let count = 0;
                for (let letter of LETTERS) {
                    if (isValid(grid, r, c, letter)) { grid[r][c] = letter; count += countSolutions(grid, limit); grid[r][c] = 0; if (count >= limit) return count; }
                }
                return count;
            }
        }
    }
    return 1;
}

function createPuzzle(blanks, forcedBlanks = []) {
    for(let r=0; r<9; r++) {
        for(let c=0; c<9; c++) { board[r][c] = solution[r][c]; userGrid[r][c] = ''; notesGrid[r][c] = []; isFixed[r][c] = true; }
    }
    let removed = 0;
    for(let p of forcedBlanks) { if(board[p[0]][p[1]] !== 0) { board[p[0]][p[1]] = 0; isFixed[p[0]][p[1]] = false; removed++; } }
    let positions = [];
    for (let i = 0; i < 81; i++) positions.push([Math.floor(i/9), i%9]);
    positions.sort(() => Math.random() - 0.5);

    for (let pos of positions) {
        if (removed >= blanks) break;
        let r = pos[0], c = pos[1]; let backup = board[r][c];
        if(backup !== 0) { board[r][c] = 0; if (countSolutions(board) !== 1) board[r][c] = backup; else { isFixed[r][c] = false; removed++; } }
    }
}

function renderBoard() {
    const boardDiv = document.getElementById('board'); boardDiv.innerHTML = '';
    let currentVal = '';
    if(selectedRow !== -1 && selectedCol !== -1) currentVal = isFixed[selectedRow][selectedCol] ? board[selectedRow][selectedCol] : userGrid[selectedRow][selectedCol];

    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            let cellDiv = document.createElement('div');
            cellDiv.className = 'cell'; cellDiv.id = `cell-${r}-${c}`;
            cellDiv.onclick = () => { if(gameActive) selectCell(r, c); };

            let hintGroup = eventHints[`${r}-${c}`];
            if (hintGroup) cellDiv.classList.add(`hint-${hintGroup}`);

            if (isFixed[r][c]) {
                cellDiv.classList.add('fixed'); cellDiv.innerText = board[r][c];
            } else if (userGrid[r][c] !== '') {
                cellDiv.classList.add('user'); cellDiv.innerText = userGrid[r][c];
            } else if (notesGrid[r][c].length > 0) {
                let noteHTML = `<div class="notes-grid">`;
                for(let k=0; k<4; k++) noteHTML += `<div class="note-item">${notesGrid[r][c][k] || ''}</div>`;
                noteHTML += `</div>`; cellDiv.innerHTML = noteHTML;
            }

            if (hintGroup && cellDiv.innerText === '') cellDiv.innerHTML += `<div class="hint-watermark">${hintGroup}</div>`;

            if (r === selectedRow && c === selectedCol) cellDiv.classList.add('selected');
            else if (selectedRow !== -1 && (r === selectedRow || c === selectedCol || (Math.floor(r/3) === Math.floor(selectedRow/3) && Math.floor(c/3) === Math.floor(selectedCol/3)))) {
                cellDiv.classList.add('related');
            }

            if (currentVal !== '' && cellDiv.innerText === currentVal && cellDiv.children.length === 0) cellDiv.classList.add('same');
            boardDiv.appendChild(cellDiv);
        }
    }
}

function selectCell(r, c) { selectedRow = r; selectedCol = c; renderBoard(); }

function toggleNoteMode() {
    noteMode = !noteMode; let btn = document.getElementById('note-btn');
    if(noteMode) { btn.classList.add('active-note'); }
    else { btn.classList.remove('active-note'); }
}

function checkMagpieAnimation() {
    if (document.getElementById('diff-select').value !== 'event_qixi' || magpieTriggered || luvCells.length === 0) return;
    let allCorrect = luvCells.every(p => {
        let r = p[0], c = p[1];
        let val = isFixed[r][c] ? board[r][c] : userGrid[r][c];
        return val === solution[r][c];
    });
    if (allCorrect) {
        magpieTriggered = true;
        triggerMagpies();
    }
}

function useHint() {
    if (!gameActive) return;
    if (hintsLeft <= 0) { showMessage("提示", "3次提示机会已经用完啦宝宝～靠你自己咯！", "#f59e0b"); return; }
    if (selectedRow === -1 || selectedCol === -1) { showMessage("提示", "请先点击选中一个你想要提示的空白格子哦！", "#3b82f6"); return; }
    if (isFixed[selectedRow][selectedCol]) { showMessage("提示", "这个已经是题目啦，不需要提示！", "#f59e0b"); return; }
    let correctChar = solution[selectedRow][selectedCol];
    if (userGrid[selectedRow][selectedCol] === correctChar) { showMessage("提示", "你已经凭实力填对啦，不需要浪费提示！", "#10b981"); return; }

    playSound('bubble');
    saveState(); userGrid[selectedRow][selectedCol] = correctChar; autoCleanNotes(selectedRow, selectedCol, correctChar);
    hintsLeft--; document.getElementById('hint-text').innerText = `提示(${hintsLeft})`; renderBoard();
    setTimeout(() => { document.getElementById(`cell-${selectedRow}-${selectedCol}`).classList.add('just-placed'); }, 50);

    checkMagpieAnimation();
}

function inputLetter(l) {
    if (!gameActive || selectedRow === -1 || selectedCol === -1 || isFixed[selectedRow][selectedCol]) return;
    playSound('bubble');
    saveState(); let r = selectedRow, c = selectedCol;
    if (noteMode) {
        if (userGrid[r][c] !== '') userGrid[r][c] = '';
        let idx = notesGrid[r][c].indexOf(l);
        if (idx === -1) { if (notesGrid[r][c].length < 4) notesGrid[r][c].push(l); }
        else notesGrid[r][c].splice(idx, 1);
    } else {
        userGrid[r][c] = l; autoCleanNotes(r, c, l);
    }
    renderBoard();
    if(!noteMode) setTimeout(() => { document.getElementById(`cell-${r}-${c}`).classList.add('just-placed'); }, 50);

    if(!noteMode) checkMagpieAnimation();
}

function autoCleanNotes(row, col, letter) {
    for (let i = 0; i < 9; i++) { removeNote(row, i, letter); removeNote(i, col, letter); }
    let sr = Math.floor(row / 3) * 3, sc = Math.floor(col / 3) * 3;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) removeNote(sr + i, sc + j, letter);
}

function removeNote(r, c, letter) {
    if(!isFixed[r][c] && userGrid[r][c] === '') {
        let idx = notesGrid[r][c].indexOf(letter);
        if(idx !== -1) notesGrid[r][c].splice(idx, 1);
    }
}

function formatTime(sec) {
    if (sec === null || sec === Infinity) return "--:--";
    let m = Math.floor(sec / 60).toString().padStart(2, '0');
    let s = Math.round(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function checkWin() {
    if(!gameActive) return;
    let hasEmpty = false, hasError = false;
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            let val = isFixed[r][c] ? board[r][c] : userGrid[r][c];
            if (val === '') hasEmpty = true;
            else if (val !== solution[r][c]) hasError = true;
        }
    }

    if (hasEmpty) { showMessage("提示", "还有空格或者笔记未确认哦，请abb宝儿先填完！", "#f59e0b"); return; }
    if (hasError) { showMessage("错误", "好像有些地方填错了，仔细检查一下abb宝儿～", "#ef4444"); return; }

    gameActive = false; clearInterval(timerInterval);
    let diffKey = document.getElementById('diff-select').value;
    let s = localStats[diffKey];

    s.count++; s.avg = ((s.avg * (s.count - 1)) + timeElapsed) / s.count;
    let isNewRecord = (s.best === null) || (timeElapsed < s.best);
    if (isNewRecord) s.best = timeElapsed;

    if (diffKey.startsWith('event_') && localStats['event_total']) {
        let t = localStats['event_total'];
        t.count++;
        t.avg = ((t.avg * (t.count - 1)) + timeElapsed) / t.count;
        if (t.best === null || timeElapsed < t.best) t.best = timeElapsed;
    }

    storageSet('ireSudokuStats', localStats);
    triggerConfetti();

    let msg = `太棒了Abbbbbbbb！恭喜你完成了 Irene 专属数独！\n\n本局用时: ${formatTime(timeElapsed)}`;
    if(isNewRecord && s.count > 1) msg += "\n打破了该难度的最佳记录！";

    showMessage("过关", msg, "#10b981");
}

function showMessage(title, body, color) {
    showAppMessage(title, body, color);
}

function openStats() {
    let html = `<tr><th>难度</th><th>最佳记录</th><th>平均耗时</th><th>通关局数</th></tr>`;
    ['35', '45', '55', 'event_total', 'event_qixi'].forEach(k => {
        let s = localStats[k];
        if (!s) return;
        if (k.startsWith('event_') && k !== 'event_total' && !document.getElementById('event-option') && s.count === 0) return;

        html += `<tr>
            <td><b>${s.name}</b></td>
            <td style="color: var(--stat-best-color); font-weight:bold;">${formatTime(s.best)}</td>
            <td>${s.count === 0 ? '--:--' : formatTime(s.avg)}</td>
            <td>${s.count}</td>
        </tr>`;
    });
    document.getElementById('statsTable').innerHTML = html;
    document.getElementById('statsModal').style.display = 'flex';
}

function openRules() {
    let isEvent = document.getElementById('diff-select').value === 'event_qixi';
    document.getElementById('rule-event-title').style.display = isEvent ? 'block' : 'none';
    document.getElementById('rule-event-body').style.display = isEvent ? 'block' : 'none';
    document.getElementById('rulesModal').style.display = 'flex';
}
