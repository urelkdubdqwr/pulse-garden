// auth_test.cjs — verify the Presage API key authenticates, WITHOUT a camera.
// Headless custom-input path: start() + synthetic frames. Never prints the key.
'use strict';
const fs = require('fs');
const path = require('path');

const txt = fs.readFileSync(path.join(__dirname, 'config.js'), 'utf8');
const m = txt.match(/apiKey\s*:\s*['"]([^'"]+)['"]/);
if (!m || m[1].includes('YOUR_API_KEY')) { console.error('no real key in config.js'); process.exit(2); }

const {
    SmartSpectraSDK, breathingMetrics, cardioMetrics, faceMetrics,
    FrameTransform, PixelFormat, ProcessingStatus,
} = require('@smartspectra/node-sdk');

const STATUS = Object.fromEntries(Object.entries(ProcessingStatus).map(([k, v]) => [v, k]));
let running = false, authError = null, otherErr = null;

const sdk = new SmartSpectraSDK({ apiKey: m[1], requestedMetrics: [...breathingMetrics, ...cardioMetrics, ...faceMetrics], enableTelemetry: false });
sdk.on('processingStatus', (s) => { console.log('status:', STATUS[s] || s); if (s === ProcessingStatus.kRunning) running = true; });
sdk.on('error', (code, msg, retryable) => {
    console.log('error:', code, '|', msg, '| retryable=', retryable);
    if (/auth/i.test(String(code)) || /auth/i.test(msg)) authError = code + ': ' + msg; else otherErr = code;
});

(async () => {
    try {
        sdk.useCustomInput(FrameTransform.kNone);
        await sdk.start();
        console.log('start() returned OK');
    } catch (e) {
        console.log('start() threw:', e.code || '', e.message);
        if (/auth/i.test(String(e.code || '') + e.message)) authError = e.message;
    }
    const W = 320, H = 240, rgb = Buffer.alloc(W * H * 3);
    const t0 = process.hrtime.bigint();
    const timer = setInterval(() => {
        const ts = Number((process.hrtime.bigint() - t0) / 1000n);
        try { sdk.sendFrame(rgb, W, H, W * 3, PixelFormat.kRGB, ts); } catch (e) { /* ignore */ }
    }, 33);
    setTimeout(async () => {
        clearInterval(timer);
        try { await sdk.stopAsync ? await sdk.stopAsync() : await sdk.stop(); } catch {}
        try { sdk.destroy(); } catch {}
        console.log('---');
        if (authError) console.log('RESULT: KEY REJECTED —', authError);
        else if (running) console.log('RESULT: KEY OK — session reached Running (auth accepted)');
        else console.log('RESULT: INCONCLUSIVE — no Running, no auth error', otherErr ? '(other err ' + otherErr + ')' : '');
        process.exit(0);
    }, 9000);
})();
