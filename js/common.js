// ======== localStorage 读写封装 ========
function storageGet(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (raw == null) return fallback;
        try {
            return JSON.parse(raw);
        } catch (e) {
            return raw;
        }
    } catch (e) {
        return fallback;
    }
}

function storageSet(key, value) {
    if (typeof value === 'string') {
        localStorage.setItem(key, value);
        return;
    }
    localStorage.setItem(key, JSON.stringify(value));
}

// ======== 皮肤引擎初始化 ========
let currentSkin = storageGet('ireSudokuSkin', 'default');
if (typeof currentSkin !== 'string') currentSkin = 'default';
document.body.setAttribute('data-skin', currentSkin);

function changeSkin(skin) {
    currentSkin = skin; document.body.setAttribute('data-skin', skin); storageSet('ireSudokuSkin', skin); kickThemeRepaint();
}

function showAppMessage(title, body, color, iconSvg) {
    let overlay = document.getElementById('messageModal');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'messageModal';
        overlay.innerHTML = `
            <div class="modal-content" style="text-align: center;">
                <h2 id="msgTitle">提示</h2>
                <p id="msgBody" style="font-size: 15px; line-height: 1.5; margin: 20px 0; font-weight: 500;"></p>
                <button class="close-btn" id="msgCloseBtn" onclick="closeModal('messageModal')">知道啦！</button>
            </div>`;
        document.body.appendChild(overlay);
    }
    const msgTitle = document.getElementById('msgTitle');
    const msgBody = document.getElementById('msgBody');
    const closeBtn = document.getElementById('msgCloseBtn');
    if (msgTitle) {
        msgTitle.innerText = "";
        if (iconSvg) { const w = document.createElement("span"); w.className = "msg-icon"; w.innerHTML = iconSvg; msgTitle.appendChild(w); }
        msgTitle.appendChild(document.createTextNode(title));
        msgTitle.style.color = color || '';
    }
    if (msgBody) msgBody.innerText = body;
    if (closeBtn && color) closeBtn.style.background = color;
    overlay.style.display = 'flex';
}

// ======== 主题系统 (黑夜为全局默认, 状态持久化 ireTheme) ========
let currentTheme = storageGet('ireTheme', 'dark');
if (currentTheme !== 'light' && currentTheme !== 'dark') currentTheme = 'dark';
if (currentTheme === 'dark') document.body.setAttribute('data-theme', 'dark');
else document.body.removeAttribute('data-theme');

// Lucide 图标: 灯泡 (黑夜模式显示, 点击开灯) / 月亮 (白天模式显示, 点击关灯)
const ICON_BULB = '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1.3.5 2.6 1.5 3.5.7.8 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>';
const ICON_MOON = '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>';

function applyThemeUI() {
    const dark = document.body.getAttribute('data-theme') === 'dark';
    const themeIcon = document.getElementById('theme-icon');
    const themeText = document.getElementById('theme-text');
    if (themeIcon) themeIcon.innerHTML = dark ? ICON_BULB : ICON_MOON;
    if (themeText) themeText.innerText = dark ? '开灯' : '关灯';
}

// iOS fix: theme toggle repaints huge background layers; Safari may keep stale tiles
// (a black bar at the bottom until navigation). Force one repaint of those layers.
function kickThemeRepaint() {
    document.body.classList.add("theme-kick");
    resizeCanvas(); // force canvas layers to rebuild (clears stale black tiles on iOS)
    requestAnimationFrame(() => {
        window.scrollBy(0, 1);
        requestAnimationFrame(() => window.scrollBy(0, -1));
        requestAnimationFrame(() => document.body.classList.remove("theme-kick"));
    });
}
function toggleTheme() {
    const body = document.body;
    if (body.getAttribute('data-theme') === 'dark') {
        body.removeAttribute('data-theme');
        storageSet('ireTheme', 'light'); kickThemeRepaint();
        applyThemeUI();
    } else {
        body.setAttribute('data-theme', 'dark');
        storageSet('ireTheme', 'dark'); kickThemeRepaint();
        applyThemeUI();
        showAppMessage('护眼模式', '是不是很晚了还在玩呀，早点休息噢宝宝，别玩太晚～', '#6366f1');
    }
}

// ======== 皮肤弹窗 (大厅/数独共用) ========
function openSkinModal() {
    const m = document.getElementById('skinModal');
    if (m) m.style.display = 'flex';
}

// 启动时同步主题按钮 UI (图标 + 文案)
applyThemeUI();

function closeModal(id) { document.getElementById(id).style.display = 'none'; }

// ======== 原生音效引擎 (无多余点击音效) ========
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx;
function initAudio() { if (!audioCtx) { audioCtx = new AudioContext(); if (audioCtx.state === 'suspended') audioCtx.resume(); } }

function playSound(type) {
    initAudio(); if (!audioCtx) return;
    const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;

    if (type === 'bubble') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(300, now); osc.frequency.exponentialRampToValueAtTime(900, now + 0.08);
        gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(0.5, now + 0.01); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
        osc.start(now); osc.stop(now + 0.1);
    } else if (type === 'win') {
        const freqs = [523.25, 659.25, 783.99, 1046.50, 1318.51];
        freqs.forEach((freq, i) => {
            const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
            o.connect(g); g.connect(audioCtx.destination); o.type = 'sine'; o.frequency.value = freq;
            g.gain.setValueAtTime(0, now + i*0.08); g.gain.linearRampToValueAtTime(0.2, now + i*0.08 + 0.02);
            g.gain.exponentialRampToValueAtTime(0.01, now + i*0.08 + 0.6);
            o.start(now + i*0.08); o.stop(now + i*0.08 + 0.7);
        });
    }
}
document.body.addEventListener('touchstart', initAudio, {once:true}); document.body.addEventListener('click', initAudio, {once:true});

// ======== Canvas 引擎 (零发热宇宙星空 + 双向飞鸟爱心彩蛋) ========
const fxCanvas = document.getElementById('canvas-fx');
const fxCtx = fxCanvas ? fxCanvas.getContext('2d') : null;
const confCanvas = document.getElementById('canvas-confetti');
const confCtx = confCanvas ? confCanvas.getContext('2d') : null;
let bgParticles = []; let confParticles = []; let reqFx, reqConf;

let magpieTriggered = false; let magpies = []; let hearts = []; let magpiePhase = 0;

function resizeCanvas() {
    if (!fxCanvas || !confCanvas) return;
    // iOS fix: pin CSS size to the bitmap. 100vh is the LARGE viewport on iOS, so the
    // canvas element used to extend past its own bitmap, leaving an unpainted bottom
    // band that iOS renders as a black bar after compositing churn (theme toggle).
    const w = document.documentElement.clientWidth;
    const h = document.documentElement.clientHeight;
    [fxCanvas, confCanvas].forEach(function (cv) {
        cv.width = w; cv.height = h;
        cv.style.width = w + "px";
        cv.style.height = h + "px";
    });
}
window.addEventListener('resize', resizeCanvas); resizeCanvas();

function startEventBg() {
    if (!fxCanvas || !fxCtx) return;
    bgParticles = [];
    for(let i=0; i<60; i++) {
        bgParticles.push({
            x: Math.random() * fxCanvas.width, y: Math.random() * fxCanvas.height,
            radius: Math.random() * 1.5, alpha: Math.random(), speedAlpha: (Math.random() - 0.5) * 0.02, isShooting: false
        });
    }
    if(reqFx) cancelAnimationFrame(reqFx);
    function render() {
        fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);

        if(Math.random() < 0.01) {
            bgParticles.push({
                x: Math.random() * fxCanvas.width, y: 0,
                len: Math.random() * 50 + 50, speed: Math.random() * 10 + 10,
                angle: Math.PI / 4, isShooting: true, alpha: 1
            });
        }

        for (let i = bgParticles.length - 1; i >= 0; i--) {
            let p = bgParticles[i];
            if (p.isShooting) {
                p.x -= p.speed * Math.cos(p.angle); p.y += p.speed * Math.sin(p.angle); p.alpha -= 0.02;
                fxCtx.beginPath(); fxCtx.moveTo(p.x, p.y); fxCtx.lineTo(p.x + p.len * Math.cos(p.angle), p.y - p.len * Math.sin(p.angle));
                fxCtx.strokeStyle = `rgba(255, 255, 255, ${p.alpha})`; fxCtx.lineWidth = 1.5; fxCtx.stroke();
                if (p.alpha <= 0) bgParticles.splice(i, 1);
            } else {
                p.alpha += p.speedAlpha; if(p.alpha <= 0.1 || p.alpha >= 0.8) p.speedAlpha *= -1;
                fxCtx.beginPath(); fxCtx.arc(p.x, p.y, p.radius, 0, Math.PI*2);
                fxCtx.fillStyle = `rgba(255, 255, 255, ${p.alpha})`; fxCtx.fill();
            }
        }
        reqFx = requestAnimationFrame(render);
    }
    render();
}

function stopEventBg() {
    if(reqFx) cancelAnimationFrame(reqFx);
    if (fxCtx && fxCanvas) fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
    magpieTriggered = false;
}

function drawHeart(ctx, x, y, size, alpha, hue) {
    ctx.save(); ctx.translate(x, y); ctx.scale(size, size);
    ctx.fillStyle = `hsla(${hue}, 100%, 60%, ${alpha})`;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-1, -1, -2, 1, 0, 2); ctx.bezierCurveTo(2, 1, 1, -1, 0, 0); ctx.fill();
    ctx.restore();
}

function triggerMagpies() {
    if (!confCanvas || !confCtx) return;
    playSound('win');
    magpies = [
        { x: -50, y: confCanvas.height/3, color: '0, 229, 255', tx: confCanvas.width/2, ty: confCanvas.height/2, trail: [] },
        { x: confCanvas.width + 50, y: confCanvas.height/3, color: '255, 0, 127', tx: confCanvas.width/2, ty: confCanvas.height/2, trail: [] }
    ];
    hearts = []; magpiePhase = 0;
    if (!reqConf) renderConf();
}

function renderConf() {
    if (!confCanvas || !confCtx) return;
    confCtx.clearRect(0, 0, confCanvas.width, confCanvas.height);
    let active = false;

    if (confParticles.length > 0) {
        confParticles.forEach(p => {
            p.x += p.vx; p.y += p.vy; p.vy += 0.4; p.rot += p.rotSpeed;
            if(p.y < confCanvas.height + 20) {
                active = true; confCtx.save(); confCtx.translate(p.x, p.y); confCtx.rotate(p.rot * Math.PI / 180);
                confCtx.fillStyle = p.color; confCtx.fillRect(-p.size/2, -p.size/2, p.size, p.size); confCtx.restore();
            }
        });
        if (confParticles.every(p => p.y >= confCanvas.height + 20)) confParticles = [];
    }

    if (magpies.length > 0 || hearts.length > 0) {
        active = true;
        if (magpiePhase === 0) {
            let reached = 0;
            magpies.forEach(b => {
                let dx = b.tx - b.x; let dy = b.ty - b.y;
                b.x += dx * 0.08; b.y += dy * 0.08;
                if (Math.abs(dx) < 3 && Math.abs(dy) < 3) reached++;

                b.trail.push({x: b.x, y: b.y});
                if (b.trail.length > 15) b.trail.shift();

                b.trail.forEach((pt, i) => {
                    let ratio = i / b.trail.length;
                    confCtx.beginPath(); confCtx.arc(pt.x, pt.y, 14 * ratio, 0, Math.PI*2);
                    confCtx.fillStyle = `rgba(${b.color}, ${ratio * 0.6})`; confCtx.fill();
                });

                confCtx.shadowBlur = 25; confCtx.shadowColor = `rgb(${b.color})`;
                confCtx.fillStyle = '#ffffff';
                confCtx.beginPath(); confCtx.arc(b.x, b.y, 10, 0, Math.PI*2); confCtx.fill();
                confCtx.shadowBlur = 0;
            });

            if (reached === 2) {
                magpiePhase = 1; magpies = [];
                for(let i=0; i<80; i++) {
                    hearts.push({
                        x: confCanvas.width/2, y: confCanvas.height/2,
                        vx: (Math.random()-0.5)*35, vy: (Math.random()-0.5)*35 - 5,
                        alpha: 1, size: Math.random() * 12 + 6, hue: Math.random() * 40 + 320
                    });
                }
            }
        } else if (magpiePhase === 1) {
            hearts.forEach(h => {
                h.x += h.vx; h.y += h.vy; h.vy += 0.8; h.alpha -= 0.015;
                if (h.alpha > 0) drawHeart(confCtx, h.x, h.y, h.size, h.alpha, h.hue);
            });
            if (hearts.every(h => h.alpha <= 0)) { hearts = []; magpieTriggered = false; }
        }
    }

    if(active) reqConf = requestAnimationFrame(renderConf); else reqConf = null;
}

function triggerConfetti() {
    if (!confCanvas) return;
    playSound('win'); confParticles = [];
    for(let i=0; i<120; i++) {
        let isLeft = Math.random() < 0.5;
        confParticles.push({
            x: isLeft ? 0 : confCanvas.width, y: confCanvas.height,
            vx: (Math.random() * 12 + 4) * (isLeft ? 1 : -1), vy: -(Math.random() * 18 + 10),
            color: `hsl(${Math.random()*360}, 90%, 65%)`, size: Math.random() * 8 + 6,
            rot: Math.random() * 360, rotSpeed: (Math.random() - 0.5) * 15
        });
    }
    if(!reqConf) renderConf();
}
