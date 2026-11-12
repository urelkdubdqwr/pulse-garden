// renderer.js — Pulse Garden renderer entry (bundled by esbuild).
//
//   Live camera → SmartSpectra SDK (on-device) → decoded metrics →
//     · pulse    → the orb's heartbeat + expanding rings
//     · breathing → the pacer ring you follow (garden "breathes" with you)
//     · expression → palette + bloom
//     · calm score → how many flowers open
//
// API key is read at runtime from window.__PG_CONFIG__.apiKey (see
// config.example.js). With no key — or with `#mock` in the URL — the app runs
// a clearly-labelled SIMULATION so the UX can be explored without hardware.
'use strict';

const {
    SmartSpectraSDK, ProcessingStatus, ValidationCode,
    breathingMetrics, cardioMetrics, faceMetrics,
} = require('@smartspectra/node-sdk/renderer');
const { decodeMetrics } = require('@smartspectra/node-sdk/messages');
const L = require('./garden-logic');

const API_KEY = (window.__PG_CONFIG__ && window.__PG_CONFIG__.apiKey) || '';
const MOCK = /mock/.test(location.hash) || !API_KEY;

const $ = (id) => document.getElementById(id);
const els = {
    consent: $('consent'), consentBtn: $('btn-consent'), telemetry: $('consent-telemetry'),
    canvas: $('garden'), preview: $('preview'),
    status: $('status-badge'), validation: $('validation'),
    errBanner: $('error-banner'), errCode: $('error-code'), errMsg: $('error-message'),
    hudPulse: $('hud-pulse'), hudBreath: $('hud-breath'), hudMood: $('hud-mood'), hudCalm: $('hud-calm'),
    btnStart: $('btn-start'), btnStop: $('btn-stop'), btnReset: $('btn-reset'),
};

const STATUS_NAMES = Object.fromEntries(Object.entries(ProcessingStatus).map(([k, v]) => [v, k.replace(/^k/, '')]));
const VALIDATION_NAMES = Object.fromEntries(Object.entries(ValidationCode).map(([k, v]) => [v, k.replace(/^k/, '')]));

// ---- live signal state -----------------------------------------------------
const sig = {
    pulse: null, breath: null, expression: 'neutral', exprConf: 0,
    calm: 0, calmTarget: 0, beat: 0, rings: [], mock: MOCK,
};

// ---- canvas ----------------------------------------------------------------
const ctx = els.canvas.getContext('2d');
let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);
function resize() {
    const r = els.canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    els.canvas.width = W * DPR; els.canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize);

// drift spores
const spores = Array.from({ length: 70 }, () => ({
    x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.8,
    vy: 0.006 + Math.random() * 0.02, ph: Math.random() * Math.PI * 2,
}));

function draw(tMs) {
    const t = tMs / 1000;
    const pal = L.paletteFor(sig.expression);
    // ease calm toward target
    sig.calm += (sig.calmTarget - sig.calm) * 0.02;
    const calm = sig.calm;

    // background
    const g = ctx.createRadialGradient(W / 2, H * 0.52, 40, W / 2, H * 0.52, Math.max(W, H) * 0.7);
    g.addColorStop(0, 'rgba(12,20,38,1)');
    g.addColorStop(1, 'rgba(5,8,16,1)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // spores — brighter as calm rises
    ctx.save();
    for (const s of spores) {
        s.y -= s.vy / 60;
        if (s.y < -0.02) { s.y = 1.02; s.x = Math.random(); }
        const a = 0.06 + 0.5 * (calm / 100) * (0.5 + 0.5 * Math.sin(t * 1.5 + s.ph));
        ctx.globalAlpha = a;
        ctx.fillStyle = pal.aura;
        ctx.beginPath();
        ctx.arc(s.x * W, s.y * H, s.r * (0.7 + calm / 160), 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();

    const cx = W / 2, cy = H * 0.52;
    const baseR = 62 + calm * 0.35;

    // breathing pacer ring — expands/contracts with (or toward) your breath
    const breathRate = sig.breath && sig.breath > 0 ? sig.breath : (sig.mock ? 12 : null);
    const period = breathRate ? 60 / breathRate : 6;
    const phase = (t % period) / period;
    const pacerR = baseR + 34 + 26 * Math.sin(phase * Math.PI * 2 - Math.PI / 2);
    ctx.beginPath();
    ctx.arc(cx, cy, pacerR, 0, Math.PI * 2);
    ctx.strokeStyle = pal.aura; ctx.globalAlpha = 0.35; ctx.lineWidth = 2; ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(160,180,220,.55)'; ctx.font = '12px ui-sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('breathe with the ring', cx, cy - pacerR - 12);

    // heartbeat rings
    for (const r of sig.rings) {
        ctx.beginPath();
        ctx.arc(cx, cy, r.r, 0, Math.PI * 2);
        ctx.strokeStyle = pal.petal;
        ctx.globalAlpha = Math.max(0, r.life) * 0.5;
        ctx.lineWidth = 2;
        ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // orb (heartbeat flash)
    const flash = sig.beat;
    const orbR = baseR * (1 + 0.10 * flash);
    const og = ctx.createRadialGradient(cx, cy, orbR * 0.2, cx, cy, orbR * 1.7);
    og.addColorStop(0, pal.petal);
    og.addColorStop(0.45, pal.aura);
    og.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.85 * pal.glow;
    ctx.fillStyle = og;
    ctx.beginPath(); ctx.arc(cx, cy, orbR * 1.7, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#04070d';
    ctx.beginPath(); ctx.arc(cx, cy, orbR, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = pal.petal; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(cx, cy, orbR, 0, Math.PI * 2); ctx.stroke();

    // petals — one per unit of bloom
    const bloom = L.bloomFor(calm);
    for (let i = 0; i < bloom; i++) {
        const ang = (i / 8) * Math.PI * 2 + t * 0.18;
        const pr = orbR + 16 + 8 * Math.sin(t * 1.2 + i);
        const px = cx + Math.cos(ang) * pr, py = cy + Math.sin(ang) * pr;
        ctx.save(); ctx.translate(px, py); ctx.rotate(ang + Math.PI / 2);
        ctx.fillStyle = pal.petal; ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.ellipse(0, 0, 6, 13, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }
    ctx.globalAlpha = 1;

    requestAnimationFrame(draw);
}

// trigger a heartbeat (called from the beat scheduler or mock)
function pulseBeat() {
    sig.beat = 1;
    sig.rings.push({ r: 70, life: 1 });
}

// animate decays + ring growth on a fixed 30fps timer, independent of rAF
setInterval(() => {
    sig.beat *= 0.72;
    for (const r of sig.rings) { r.r += 3.4; r.life -= 0.04; }
    sig.rings = sig.rings.filter((r) => r.life > 0);
}, 33);

// ---- metric handling -------------------------------------------------------
function tsToNumber(ts) {
    if (ts == null) return 0;
    if (typeof ts === 'number') return ts;
    if (typeof ts === 'bigint') return Number(ts);
    if (typeof ts.toNumber === 'function') return ts.toNumber();
    return Number(ts);
}
const lastVal = (arr) => (arr && arr.length ? arr[arr.length - 1].value : null);

function handleMetrics(m) {
    const br = lastVal(m.breathing && m.breathing.rate);
    const pr = lastVal(m.cardio && m.cardio.pulseRate);
    if (br != null) sig.breath = br;
    if (pr != null) sig.pulse = pr;

    const expr = m.face && m.face.expression && m.face.expression[0];
    if (expr && Array.isArray(expr.scores) && expr.scores.length) {
        const dom = L.dominantExpression(expr.scores);
        sig.expression = dom.name; sig.exprConf = dom.confidence;
    }
    sig.calmTarget = L.calmScore({ breath: sig.breath, pulse: sig.pulse });
    paintHud();
}

function paintHud() {
    els.hudPulse.textContent = sig.pulse != null ? sig.pulse.toFixed(0) : '—';
    els.hudBreath.textContent = sig.breath != null ? sig.breath.toFixed(0) : '—';
    els.hudMood.textContent = sig.expression;
    els.hudCalm.textContent = Math.round(sig.calm);
}

// ---- beat scheduler (pulse-driven) -----------------------------------------
let beatAccum = 0, lastTs = performance.now();
setInterval(() => {
    const now = performance.now();
    const dt = (now - lastTs) / 1000; lastTs = now;
    const bpm = sig.pulse && sig.pulse > 0 ? sig.pulse : (sig.mock ? 64 : null);
    if (!bpm) return;
    beatAccum += dt;
    const interval = 60 / bpm;
    if (beatAccum >= interval) { beatAccum = 0; pulseBeat(); }
}, 33);

// ---- mock mode -------------------------------------------------------------
function startMock() {
    console.log('[pulse-garden] MOCK mode (no API key) — values are simulated.');
    els.status.textContent = 'simulated'; els.status.className = 'status running';
    els.validation.textContent = 'Simulation — add an API key in config.js for live signals';
    els.validation.className = 'hint warn';
    const moods = ['happy', 'neutral', 'surprise', 'neutral', 'sad'];
    let i = 0;
    setInterval(() => {
        sig.breath = 14 - Math.min(8, sig.calm / 12) + (Math.random() - 0.5);
        sig.pulse = 72 - Math.min(12, sig.calm / 8) + (Math.random() - 0.5) * 2;
        sig.expression = moods[(i++) % moods.length];
        sig.calmTarget = L.calmScore({ breath: sig.breath, pulse: sig.pulse });
        paintHud();
    }, 500);
}

// ---- SDK -------------------------------------------------------------------
let sdk = null;

function buildSdk() {
    sdk = new SmartSpectraSDK({
        apiKey: API_KEY,
        requestedMetrics: [...breathingMetrics, ...cardioMetrics, ...faceMetrics],
        enableAccumulatedOutput: false,
        enableTelemetry: !!(els.telemetry && els.telemetry.checked),
    });

    sdk.on('processingStatus', (status) => {
        const label = STATUS_NAMES[status] || `status(${status})`;
        els.status.textContent = label;
        els.status.className = 'status ' + (status === ProcessingStatus.kRunning ? 'running'
            : status === ProcessingStatus.kError ? 'error' : '');
        if (status === ProcessingStatus.kStarting || status === ProcessingStatus.kRunning) {
            els.btnStart.disabled = true; els.btnStop.disabled = false; els.btnReset.disabled = true;
        } else if (status === ProcessingStatus.kStopping) {
            els.btnStart.disabled = true; els.btnStop.disabled = true; els.btnReset.disabled = true;
        } else if (status === ProcessingStatus.kError) {
            els.btnStart.disabled = true; els.btnStop.disabled = true; els.btnReset.disabled = false;
        } else {
            els.btnStart.disabled = false; els.btnStop.disabled = true; els.btnReset.disabled = false;
        }
    });

    sdk.on('validationStatus', (code, ts, hint) => {
        els.validation.textContent = `${VALIDATION_NAMES[code] || 'code(' + code + ')'}${hint ? ' — ' + hint : ''}`;
        els.validation.className = 'hint ' + (code === ValidationCode.kOk ? 'ok'
            : (hint ? 'warn' : 'err'));
    });

    sdk.on('metrics', (buf) => {
        try { handleMetrics(decodeMetrics(buf)); } catch (e) { console.error('decode failed', e); }
    });

    sdk.on('error', (code, message, retryable) => {
        console.error('[pulse-garden]', code, message, 'retryable=', retryable);
        els.errBanner.hidden = false; els.errCode.textContent = code; els.errMsg.textContent = message;
    });

    sdk.on('streamAvailable', (stream) => {
        els.preview.srcObject = stream;
        els.preview.play().catch(() => {});
    });
}

async function start() {
    els.errBanner.hidden = true;
    if (sig.mock) { els.btnStart.disabled = true; els.btnStop.disabled = false; els.btnReset.disabled = false; startMock(); return; }
    try { if (!sdk) buildSdk(); await sdk.start(); }
    catch (err) {
        els.errBanner.hidden = false; els.errCode.textContent = err.code ?? 'JS'; els.errMsg.textContent = err.message;
        els.btnStart.disabled = false;
    }
}
async function stop() {
    els.btnStop.disabled = true;
    if (sdk) { try { await sdk.stop(); } catch (e) { console.error(e); } try { sdk.destroy(); } catch {} sdk = null; }
    els.preview.srcObject = null;
    els.btnStart.disabled = false;
}
async function reset() {
    els.btnReset.disabled = true;
    if (sdk) { try { await sdk.reset(); } catch (e) { console.error(e); } }
    els.preview.srcObject = null;
    els.errBanner.hidden = true;
    Object.assign(sig, { pulse: null, breath: null, calm: 0, calmTarget: 0, rings: [] });
    paintHud();
    els.btnStart.disabled = false;
}

els.consentBtn.addEventListener('click', () => { els.consent.hidden = true; });
els.btnStart.addEventListener('click', start);
els.btnStop.addEventListener('click', stop);
els.btnReset.addEventListener('click', reset);
window.addEventListener('beforeunload', () => { if (sdk) { try { sdk.destroy(); } catch {} } });

resize();
requestAnimationFrame(draw);
paintHud();
if (sig.mock) {
    els.validation.textContent = 'Simulation available — press Start';
    els.preview.style.display = 'none';
}
console.log('[pulse-garden] renderer ready · mock =', sig.mock);
