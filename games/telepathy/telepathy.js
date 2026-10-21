const ICON_A = '<svg class="icon-a" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
const ICON_B = '<svg class="icon-b" viewBox="0 0 24 24"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>';

let peer = null;
let conn = null;
let isHost = false;
let connDataBound = false;  // 防止 bindConnData 重复绑定 data 监听器
let connGuardBound = false; // 防止 armConnGuard 重复绑定 close/error 监听器
let connTimeout = null;     // 加入房间 15 秒握手超时定时器
let gameMode = 'hard';
let currentMode = 'hardcore';
let gameState = 'LOBBY'; // LOBBY, SET_SECRET, SETTING_SECRET, WAIT_OPPONENT, COIN_TOSS, MY_TURN, OPP_TURN, PVE_TURN, PLAYING, GAMEOVER
let mySecret = [];
let oppSecret = [];
let secretCode = [];
let myGuesses = [];
let oppGuesses = [];
let currentGuess = [];
let currentInput = currentGuess;
let attemptsLeft = 20;
let isPVE = false;
let pendingReset = false;
let mySecretCode = [];
let myReady = false;
let oppReady = false;
const MAX_PVE_ATTEMPTS = 20;

const peerOptions = {
    debug: 2,
    config: {
        'iceServers': [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun.qq.com:3478' },
            { urls: 'stun:stun.miwifi.com:3478' }
        ]
    }
};

function $(id) { return document.getElementById(id); }
function updateTopStatus(text) {
    // 状态文本与状态点颜色联动 (绿=就绪/回合/开始，琥珀=等待/连接中)
    document.querySelectorAll('.status-text').forEach(function(el) { el.innerText = text; });
    const active = text.indexOf('就绪') !== -1 || text.indexOf('回合') !== -1 || text.indexOf('开始') !== -1;
    document.querySelectorAll('.status-dot').forEach(function(el) {
        el.style.backgroundColor = active ? '#10b981' : '#f59e0b';
        el.style.boxShadow = active ? '0 0 8px #10b981' : '0 0 8px #f59e0b';
    });
}
function switchToGameUI() {
    try {
        console.log('[telepathy] switchToGameUI start');
        const lobby = document.getElementById('lobby-container');
        if (!lobby) { alert('缺节点:lobby-container'); return; }
        const gameCont = document.getElementById('game-container');
        if (!gameCont) { alert('缺节点:game-container'); return; }
        const track = document.getElementById('dual-track');
        if (!track) { alert('缺节点:dual-track'); return; }
        const prompt = document.getElementById('pvp-setup-prompt');
        if (!prompt) { alert('缺节点:pvp-setup-prompt'); return; }
        lobby.style.display = 'none';
        gameCont.style.display = 'flex';
        track.style.display = 'none';
        prompt.style.display = 'block';
        // 只有首次从 LOBBY 进入时才重置状态，避免重复调用清空正在输入的数字
        if (gameState === 'LOBBY') {
            currentGuess = [];
            syncInputAlias();
            renderInput();
            refreshKeyStates();
            gameState = 'SETTING_SECRET';
        }
        console.log('[telepathy] switchToGameUI done');
    } catch (err) {
        alert('UI切换失败，请检查控制台: ' + err.message);
        console.error(err);
    }
}
function armConnGuard() {
    if (!conn) return;
    if (connGuardBound) return;
    connGuardBound = true;
    conn.on('close', function() {
        alert('对方已断开连接，返回大厅。');
        exitGame();
    });
    conn.on('error', function(err) {
        console.log('[telepathy] conn error', err);
        alert('连接异常，返回大厅。');
        exitGame();
    });
}
function showLobby() {
    if ($('lobby-container')) $('lobby-container').style.display = 'flex';
    if ($('game-container')) $('game-container').style.display = 'none';
}
function showGame() {
    if ($('lobby-container')) $('lobby-container').style.display = 'none';
    if ($('game-container')) $('game-container').style.display = 'flex';
}
function closeNetworkModal() { const m = $('network-modal'); if (m) m.style.display = 'none'; }
function openRules() { const m = $('rulesModal'); if (m) m.style.display = 'flex'; }
function syncInputAlias() { currentInput = currentGuess; }
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return code;
}
function createRoom() {
    document.getElementById('connection-menu').style.display = 'none';
    document.getElementById('connection-waiting').style.display = 'block';
    document.getElementById('my-room-code').innerText = '....';
    updateTopStatus('连接服务器中...');

    const code = generateRoomCode();
    try { if (peer) peer.destroy(); } catch (e) {}
    peer = new Peer('irene-pbox-' + code, peerOptions);

    // 只有当信令服务器确认分配了该 ID，才显示房间码
    peer.on('open', function(id) {
        document.getElementById('my-room-code').innerText = code;
        console.log('[telepathy] room ready, shortCode =', code);
        updateTopStatus('等待宝宝加入');
    });

    peer.on('error', function(err) {
        console.error('[telepathy] host peer error:', err);
        if (gameState === 'LOBBY') {
            showAppMessage('建房失败', '无法连接到信号服务器，请检查网络后重试。', '#ef4444');
            quitMatch();
        }
    });

    peer.on('connection', function(connection) {
        conn = connection;
        isHost = true;
        connDataBound = false;
        connGuardBound = false;
        console.log('[telepathy] host data connection established');
        armConnGuard();
        bindConnData();
        conn.on('open', function() {
            console.log('[telepathy] host data channel open');
            switchToGameUI();
            const sel = $('mode-select');
            gameMode = sel ? sel.value : 'hard';
            currentMode = (gameMode === 'easy') ? 'casual' : 'hardcore';
            conn.send({ type: 'MODE', data: gameMode });
            enterSecretSetting();
        });
    });
}
function cleanupJoin() {
    try { if (conn) { conn.close(); conn = null; } } catch (e) {}
    try { if (peer) { peer.destroy(); peer = null; } } catch (e) {}
    connDataBound = false;
    connGuardBound = false;
    gameState = 'LOBBY';
    updateTopStatus('请建立连接');
}

function joinRoom() {
    const input = $('join-code-input');
    const code = input ? input.value.toUpperCase().trim() : '';
    if (!code) return;
    if (typeof Peer === 'undefined') { showAppMessage('无法联机', '网络库未加载，请检查网络后重试。', '#ef4444'); return; }
    try { if (peer) peer.destroy(); } catch (e) {}
    peer = new Peer(peerOptions);
    peer.on('open', function() {
        conn = peer.connect('irene-pbox-' + code, { reliable: true });
        connDataBound = false;
        connGuardBound = false;
        isHost = false;

        // 在 open 之前先绑定错误与关闭处理器，捕获握手阶段断开
        conn.on('error', function(err) {
            console.error('[telepathy] conn error:', err);
            showAppMessage('连接失败', '未能连接到房间 ' + code + '，请确认房间码和对方在线状态。', '#ef4444');
            cleanupJoin();
        });
        conn.on('close', function() {
            if (gameState === 'LOBBY') cleanupJoin();
        });

        // 15秒握手超时（局域网打洞容许更慢）
        connTimeout = setTimeout(function() {
            if (conn && conn.readyState !== 'open') {
                console.log('[telepathy] join timeout');
                showAppMessage('连接超时', '房间 ' + code + ' 连接超时，请稍后重试。', '#ef4444');
                cleanupJoin();
            }
        }, 15000);

        conn.on('open', function() {
            // 拆弹：连接成功后清除定时超时
            if (connTimeout) {
                clearTimeout(connTimeout);
                connTimeout = null;
            }
            console.log('[telepathy] guest data connection open');
            armConnGuard();
            switchToGameUI();
            bindConnData();
        });

        updateTopStatus('正在连接房间 ' + code + ' ...');
    });
    peer.on('error', function(err) {
        console.error('[telepathy] peer error:', err);
        showAppMessage('连接失败', '未能连接到房间 ' + code + '，请确认房间码。', '#ef4444');
    });
}
function bindConnData() {
    if (!conn) return;
    if (connDataBound) return;
    connDataBound = true;
    conn.on('data', function(payload) {
        if (!payload || !payload.type) return;
        if (payload.type === 'MODE') {
            gameMode = payload.data;
            currentMode = (gameMode === 'easy') ? 'casual' : 'hardcore';
            enterSecretSetting();
        } else if (payload.type === 'READY') {
            oppReady = true;
            oppSecret = payload.secret ? payload.secret.slice() : [];
            secretCode = oppSecret.slice();
            checkPvpStart();
        } else if (payload.type === 'SECRET') {
            oppSecret = payload.data.slice();
            secretCode = oppSecret.slice();
            checkGameStart();
        } else if (payload.type === 'GUESS') {
            oppGuesses.push(payload.data);
            renderOppGuesses();
        } else if (payload.type === 'WIN') {
            gameState = 'GAMEOVER';
            showAppMessage('破译失败', '对方率先破译了你的底牌！', '#ef4444');
        } else if (payload.type === 'COIN') {
            playCoinToss(payload.data.isHostFirst);
        } else if (payload.type === 'TURN_PASS') {
            gameState = 'MY_TURN';
            const kb = document.querySelector('.keyboard');
            if (kb) kb.classList.remove('locked');
            updateTopStatus('你的回合');
            if (navigator.vibrate) navigator.vibrate(100);
        }
    });
}
function enterSecretSetting() {
    isPVE = false;
    myReady = false;
    oppReady = false;
    mySecretCode = [];
    mySecret = [];
    oppSecret = [];
    secretCode = [];
    myGuesses = [];
    oppGuesses = [];
    const prompt = $('pvp-setup-prompt');
    if (prompt) prompt.innerText = '请在下方输入你的 4 位灵犀密码，然后点击确认';
    if ($('my-guesses')) $('my-guesses').innerHTML = '';
    if ($('her-guesses')) $('her-guesses').innerHTML = '';
    updateTopStatus('联机设密 | 请输入你的 4 位底牌');
}
function checkPvpStart() {
    if (gameState === 'SETTING_SECRET' && myReady && oppReady) {
        gameState = 'COIN_TOSS';
        const prompt = $('pvp-setup-prompt');
        if (prompt) prompt.style.display = 'none';
        const track = $('dual-track');
        if (track) track.style.display = 'flex';
        currentGuess.length = 0;
        syncInputAlias();
        renderInput();
        updateTopStatus('抛硬币 | 争夺先手...');
        if (isHost) {
            const hostGoesFirst = Math.random() > 0.5;
            if (conn) conn.send({ type: 'COIN', data: { isHostFirst: hostGoesFirst } });
            playCoinToss(hostGoesFirst);
        }
    }
}
function checkGameStart() {
    if (gameState === 'WAIT_OPPONENT' && oppSecret.length === 4) {
        gameState = 'COIN_TOSS';
        if (isHost) {
            const hostGoesFirst = Math.random() > 0.5;
            if (conn) conn.send({ type: 'COIN', data: { isHostFirst: hostGoesFirst } });
            playCoinToss(hostGoesFirst);
        }
    }
}
function genSecretHardcore() {
    const pool = ['0','1','2','3','4','5','6','7','8','9'];
    const out = [];
    for (let i = 0; i < 4; i++) {
        const idx = Math.floor(Math.random() * pool.length);
        out.push(pool[idx]);
        pool.splice(idx, 1);
    }
    return out;
}
function genSecretCasual() {
    const pool = ['0','1','2','3','4','5','6','7','8','9'];
    const out = [];
    for (let i = 0; i < 4; i++) out.push(pool[Math.floor(Math.random() * pool.length)]);
    return out;
}
function startOfflinePVE() {
    closeNetworkModal();
    const sel = $('mode-select');
    const raw = sel ? sel.value : 'hard';
    if (raw === 'easy') { gameMode = 'easy'; currentMode = 'casual'; }
    else { gameMode = 'hard'; currentMode = 'hardcore'; }
    isPVE = true;
    secretCode = (currentMode === 'casual') ? genSecretCasual() : genSecretHardcore();
    oppSecret = secretCode.slice();
    mySecret = [];
    attemptsLeft = MAX_PVE_ATTEMPTS;
    pendingReset = false;
    gameState = 'PVE_TURN';
    const kbPve = document.querySelector('.keyboard');
    if (kbPve) kbPve.classList.remove('locked');
    currentGuess.length = 0;
    syncInputAlias();
    myGuesses = []; oppGuesses = [];
    if ($('my-guesses')) $('my-guesses').innerHTML = '';
    if ($('her-guesses')) $('her-guesses').innerHTML = '<div style="text-align:center; color:var(--text-note); font-size:12px; margin-top:20px;">当前为单机 PVE 练习模式</div>';
    showGame();
    updateTopStatus('单机演练 | 模式: ' + (currentMode === 'casual' ? '轻松' : '硬核'));
    renderAttempts();
    renderInput();
    if (typeof playSound === 'function') playSound('bubble');
}
function resetRound() {
    currentGuess.length = 0;
    syncInputAlias();
    pendingReset = false;
    attemptsLeft = MAX_PVE_ATTEMPTS;
    myGuesses = [];
    if ($('my-guesses')) $('my-guesses').innerHTML = '';
    if (isPVE) {
        secretCode = (currentMode === 'casual') ? genSecretCasual() : genSecretHardcore();
        oppSecret = secretCode.slice();
        gameState = 'PVE_TURN';
        const kbReset = document.querySelector('.keyboard');
        if (kbReset) kbReset.classList.remove('locked');
        updateTopStatus('单机演练 | 模式: ' + (currentMode === 'casual' ? '轻松' : '硬核') + ' | 新一局已开始');
    } else {
        gameState = 'LOBBY';
        showLobby();
        updateTopStatus('请建立连接');
    }
    renderAttempts();
    renderInput();
}
function exitGame(force) {
    if (!force) {
        const ok = confirm('确定要退出当前对局吗？进度将会丢失。');
        if (!ok) return;
    }
    if (conn) { try { conn.close(); } catch (e) {} conn = null; }
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
    connDataBound = false;
    connGuardBound = false;
    gameState = 'LOBBY';
    isPVE = false;
    pendingReset = false;
    currentGuess.length = 0;
    syncInputAlias();
    myGuesses = []; oppGuesses = []; mySecret = []; oppSecret = []; secretCode = [];
    if ($('my-guesses')) $('my-guesses').innerHTML = '';
    if ($('her-guesses')) $('her-guesses').innerHTML = '';
    showLobby();
    renderAttempts();
    renderInput();
    updateTopStatus('请建立连接');
}
function initGame() {
    gameState = 'LOBBY';
    isPVE = false;
    pendingReset = false;
    mySecret = []; oppSecret = []; secretCode = []; myGuesses = []; oppGuesses = [];
    currentGuess.length = 0;
    syncInputAlias();
    attemptsLeft = MAX_PVE_ATTEMPTS;
    const menu = $('connection-menu');
    const waiting = $('connection-waiting');
    if (menu) menu.style.display = 'block';
    if (waiting) waiting.style.display = 'none';
    if ($('my-guesses')) $('my-guesses').innerHTML = '';
    if ($('her-guesses')) $('her-guesses').innerHTML = '';
    showLobby();
    renderAttempts();
    renderInput();
    updateTopStatus('请建立连接');
}
function evaluateGuess(guessArr, secretArr) {
    let a = 0;
    const secretLeft = [];
    const guessLeft = [];
    for (let i = 0; i < 4; i++) {
        if (guessArr[i] === secretArr[i]) a++;
        else { secretLeft.push(secretArr[i]); guessLeft.push(guessArr[i]); }
    }
    let b = 0;
    const counts = {};
    secretLeft.forEach(function(d) { counts[d] = (counts[d] || 0) + 1; });
    guessLeft.forEach(function(d) { if (counts[d] > 0) { b++; counts[d]--; } });
    if (currentMode === 'casual' || gameMode === 'easy') b = 0;
    return { a: a, b: b };
}

function renderAttempts() {
    const label = $('attempts-label');
    if (label) label.textContent = '剩余 ' + attemptsLeft + ' 次';
}
function renderInput() {
    const slots = document.querySelectorAll('.digit-slot');
    slots.forEach(function(slot, index) {
        if (index < currentGuess.length) {
            slot.textContent = (gameState === 'SET_SECRET') ? '*' : currentGuess[index];
            slot.classList.add('filled');
        } else {
            slot.textContent = '';
            slot.classList.remove('filled');
        }
    });
    refreshKeyStates();
    refreshConfirm();
}
function refreshKeyStates() {
    const keys = document.querySelectorAll('.key[data-num]');
    keys.forEach(function(key) {
        const num = key.getAttribute('data-num');
        key.classList.remove('key-disabled');
        if (currentMode === 'hardcore' && currentGuess.indexOf(num) !== -1) key.classList.add('key-disabled');
    });
}
function refreshConfirm() {
    // action-row 已移除(与键盘 del 键重复)，保留空实现以兼容调用点
}
function handleDigit(num) {
    if (gameState === 'LOBBY' || gameState === 'GAMEOVER') return;
    if (currentGuess.length >= 4) return;
    if (currentMode === 'hardcore' && currentGuess.indexOf(num) !== -1) return;
    currentGuess.push(num);
    syncInputAlias();
    if (typeof playSound === 'function') playSound('tap');
    renderInput();
}
function withdraw() {
    if (currentGuess.length > 0) currentGuess.pop();
    syncInputAlias();
    renderInput();
}
function renderMyGuesses() {
    const container = $('my-guesses');
    if (!container) return;
    container.innerHTML = '';
    myGuesses.forEach(function(g) {
        let svgs = '';
        for (let i = 0; i < g.a; i++) svgs += ICON_A;
        for (let i = 0; i < g.b; i++) svgs += ICON_B;
        const label = g.a + 'A' + g.b + 'B';
        container.insertAdjacentHTML('afterbegin', '<div class="guess-item"><span class="nums">' + g.guess.join(' ') + '</span><span class="result">' + svgs + '<span style="font-size:11px;color:var(--text-note);margin-left:4px;">' + label + '</span></span></div>');
    });
}
function renderOppGuesses() {
    const container = $('her-guesses');
    if (!container) return;
    container.innerHTML = '';
    oppGuesses.forEach(function(g) {
        let svgs = '';
        for (let i = 0; i < g.a; i++) svgs += ICON_A;
        for (let i = 0; i < g.b; i++) svgs += ICON_B;
        const label = g.a + 'A' + g.b + 'B';
        container.insertAdjacentHTML('afterbegin', '<div class="guess-item"><span class="nums">' + g.guess.join(' ') + '</span><span class="result">' + svgs + '<span style="font-size:11px;color:var(--text-note);margin-left:4px;">' + label + '</span></span></div>');
    });
}
function submitGuess() {
    if (currentGuess.length !== 4 || gameState === 'LOBBY' || gameState === 'GAMEOVER') return;
    if (typeof playSound === 'function') playSound('bubble');
    if (gameState === 'SETTING_SECRET') {
        mySecretCode = currentGuess.slice();
        mySecret = mySecretCode.slice();
        myReady = true;
        currentGuess.length = 0;
        syncInputAlias();
        renderInput();
        const prompt = $('pvp-setup-prompt');
        if (prompt) prompt.innerText = '等待对方就绪...';
        updateTopStatus('底牌已锁定 | 等待对方就绪...');
        if (conn) conn.send({ type: 'READY', secret: mySecretCode });
        checkPvpStart();
        return;
    }
    if (gameState === 'SET_SECRET') {
        mySecret = currentGuess.slice();
        currentGuess.length = 0;
        syncInputAlias();
        renderInput();
        gameState = 'WAIT_OPPONENT';
        updateTopStatus('底牌已锁定 | 等待对方设密...');
        if (conn) conn.send({ type: 'SECRET', data: mySecret });
        checkGameStart();
        return;
    }
    if (gameState === 'GAMEOVER' || gameState === 'LOBBY') return;
    if (gameState !== 'PVE_TURN' && gameState !== 'MY_TURN') return;
    const target = (oppSecret.length === 4) ? oppSecret : secretCode;
    const res = evaluateGuess(currentGuess, target);
    const guessData = { guess: currentGuess.slice(), a: res.a, b: res.b };
    myGuesses.push(guessData);
    renderMyGuesses();
    if (conn && gameState === 'MY_TURN') conn.send({ type: 'GUESS', data: guessData });
    currentGuess.length = 0;
    syncInputAlias();

    // 胜利判定 (4A)
    if (res.a === 4) {
        gameState = 'GAMEOVER';
        if (conn) conn.send({ type: 'WIN' });
        if (typeof triggerConfetti === 'function') triggerConfetti();
        renderInput();
        if (isPVE) {
            pendingReset = true;
            const used = MAX_PVE_ATTEMPTS - attemptsLeft;
            setTimeout(function() {
                showAppMessage('破译成功', '正确底牌就是 ' + target.join('') + '，共用 ' + used + ' 次。点击关闭开始下一局。', '#10b981');
                bindPveEndReset();
            }, 500);
        } else {
            setTimeout(function() { showAppMessage('破译成功！', '你太厉害了！正确底牌就是 ' + target.join('') + '。', '#10b981'); }, 500);
        }
        return;
    }

    // PVE: 20 次机会倒数 (绝不锁键盘、不交接回合，可无限连猜到次数耗尽)
    if (gameState === 'PVE_TURN') {
        attemptsLeft--;
        renderAttempts();
        if (attemptsLeft <= 0) {
            gameState = 'GAMEOVER';
            pendingReset = true;
            renderInput();
            setTimeout(function() {
                showAppMessage('破译失败', '20 次机会已用尽，正确底牌是 ' + target.join('') + '。点击关闭开始下一局。', '#ef4444');
                bindPveEndReset();
            }, 500);
            return;
        }
        renderInput();
        return;
    }

    // 回合移交 (仅联机 PVP：自己猜完 → 锁键盘 → 交棒对方)
    if (gameState === 'MY_TURN') {
        gameState = 'OPP_TURN';
        const kb = document.querySelector('.keyboard');
        if (kb) kb.classList.add('locked');
        renderInput();
        updateTopStatus('对方回合，请等待');
        if (conn) conn.send({ type: 'TURN_PASS' });
        if (navigator.vibrate) navigator.vibrate(40);
    }
}
function bindPveEndReset() {
    const btn = $('msgCloseBtn');
    if (!btn || btn.dataset.pveBound === '1') return;
    btn.dataset.pveBound = '1';
    btn.addEventListener('click', function handler() {
        btn.dataset.pveBound = '';
        btn.removeEventListener('click', handler);
        if (pendingReset && isPVE) resetRound();
    });
}

const keys = document.querySelectorAll('.key');
let longPressTimer;
keys.forEach(function(key) {
    key.addEventListener('contextmenu', function(e) { e.preventDefault(); });
    key.addEventListener('pointerdown', function(e) {
        if (gameState === 'LOBBY' || gameState === 'GAMEOVER') return;
        try { key.setPointerCapture(e.pointerId); } catch (err) {}
        let isLongPress = false;
        longPressTimer = setTimeout(function() {
            isLongPress = true;
            if (!key.classList.contains('action-key')) {
                key.classList.toggle('draft-dimmed');
                if (navigator.vibrate) navigator.vibrate(50);
            }
        }, 400);
        key.onpointerup = function() {
            clearTimeout(longPressTimer);
            key.onpointerup = null;
            if (isLongPress) return;
            if (key.classList.contains('submit-key')) { submitGuess(); return; }
            if (key.classList.contains('del-key')) { withdraw(); return; }
            if (key.classList.contains('draft-dimmed')) return;
            if (gameState !== 'PVE_TURN' && gameState !== 'MY_TURN' && gameState !== 'SETTING_SECRET' && gameState !== 'SET_SECRET') return;
            const num = key.getAttribute('data-num') || key.innerText.trim();
            handleDigit(num);
        };
    });
});
window.addEventListener('DOMContentLoaded', initGame);
window.openRules = openRules;
window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.startOfflinePVE = startOfflinePVE;
window.closeNetworkModal = closeNetworkModal;
window.submitGuess = submitGuess;
window.exitGame = exitGame;
window.quitMatch = quitMatch;
window.withdraw = withdraw;
window.handleDigit = handleDigit;
function bindTelepathyButtons() {
    const lobbyBack = $('lobby-back-btn');
    if (lobbyBack) lobbyBack.addEventListener('click', function() { window.location.href = '../../index.html'; });
    const rulesBtn = $('rules-btn');
    if (rulesBtn) rulesBtn.addEventListener('click', openRules);
    const rulesGame = $('rules-btn-game');
    if (rulesGame) rulesGame.addEventListener('click', openRules);
    const createBtn = $('create-room-btn');
    if (createBtn) createBtn.addEventListener('click', createRoom);
    const joinBtn = $('join-room-btn');
    if (joinBtn) joinBtn.addEventListener('click', joinRoom);
    const offlineBtn = $('offline-btn');
    if (offlineBtn) offlineBtn.addEventListener('click', startOfflinePVE);
    const exitBtn = $('exit-btn');
    if (exitBtn) exitBtn.addEventListener('click', exitGame);
    const quitBtns = [$('quit-btn-lobby'), $('quit-btn-game')];
    quitBtns.forEach(function(btn) { if (btn) btn.addEventListener('click', quitMatch); });
    const rulesCloseBtn = $('rules-close-btn');
    if (rulesCloseBtn) rulesCloseBtn.addEventListener('click', function() { closeModal('rulesModal'); });
    const themeBtn = $('theme-btn');
    if (themeBtn) themeBtn.addEventListener('click', function() { if (typeof toggleTheme === 'function') toggleTheme(); });
    const themeGame = $('theme-btn-game');
    if (themeGame) themeGame.addEventListener('click', function() { if (typeof toggleTheme === 'function') toggleTheme(); });
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindTelepathyButtons);
} else {
    bindTelepathyButtons();
}

// 3D 抛硬币：定先手 (handrix 正面 / abb 反面)
function playCoinToss(isHostFirst) {
    try {
        const modal = $('coin-modal');
        const coin = $('flip-coin');
        const resultText = $('coin-result-text');
        if (!modal || !coin || !resultText) return;
        modal.style.display = 'flex';
        resultText.style.opacity = '0';
        // 硬币正面=hostIndex0(handrix) 背面=1(abb)；多转几圈增强仪式感
        const targetRotation = isHostFirst ? 1800 : 1980;
        coin.style.transition = 'transform 3s cubic-bezier(0.2, 0.8, 0.2, 1)';
        coin.style.transform = 'rotateY(' + targetRotation + 'deg)';
        if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
        const myTurnFirst = isHost ? isHostFirst : !isHostFirst;
        setTimeout(function() {
            resultText.innerText = myTurnFirst ? '你获得了先手！' : '对方获得了先手！';
            resultText.style.color = myTurnFirst ? '#10b981' : '#f59e0b';
            resultText.style.opacity = '1';
            if (navigator.vibrate) navigator.vibrate(80);
            setTimeout(function() {
                modal.style.display = 'none';
                gameState = myTurnFirst ? 'MY_TURN' : 'OPP_TURN';
                const kb = document.querySelector('.keyboard');
                if (kb) kb.classList.toggle('locked', !myTurnFirst);
                updateTopStatus(myTurnFirst ? '你的回合' : '对方回合，请等待');
            }, 2000);
        }, 3000);
    } catch (e) {
        console.error('[telepathy] playCoinToss error', e);
    }
}

// 局部退出：断开网络并重置回联机大厅 (全局返回=顶部 header 的 href 大厅链接)
function quitMatch() {
    const inMatch = (gameState !== 'LOBBY' && gameState !== 'GAMEOVER');
    if (inMatch) {
        if (!confirm('确定要退出当前对局吗？进度将会丢失。')) return;
    }
    // 清理网络连接
    if (conn) { try { conn.close(); } catch (e) {} conn = null; }
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
    isHost = false;

    // 强制重置状态与数据
    gameState = 'LOBBY';
    isPVE = false;
    pendingReset = false;
    myReady = false;
    oppReady = false;
    mySecret = []; oppSecret = []; secretCode = [];
    mySecretCode = [];
    myGuesses = []; oppGuesses = [];
    currentGuess.length = 0;
    syncInputAlias();

    // 重置 UI
    if ($('my-guesses')) $('my-guesses').innerHTML = '';
    if ($('her-guesses')) $('her-guesses').innerHTML = '';
    const kb = document.querySelector('.keyboard');
    if (kb) kb.classList.remove('locked');
    renderAttempts();
    renderInput();

    // 回到联机大厅并复位联机面板
    showLobby();
    const menu = $('connection-menu');
    if (menu) menu.style.display = 'block';
    const waiting = $('connection-waiting');
    if (waiting) waiting.style.display = 'none';
    const codeDisplay = $('my-room-code-display');
    if (codeDisplay) codeDisplay.style.display = 'none';
    const codeSpan = $('my-room-code');
    if (codeSpan) codeSpan.innerText = '生成中...';
    const createBtn = $('create-room-btn');
    if (createBtn) createBtn.disabled = false;
    updateTopStatus('请建立连接');
}

