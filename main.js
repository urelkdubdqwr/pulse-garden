// main.js — Pulse Garden main process.
// Wires the renderer-side SmartSpectra SDK to the main-process SDK over IPC,
// and grants a camera-only media permission to the bundled local page.
'use strict';

const path = require('path');
const { app, BrowserWindow, session } = require('electron');

// Packaged build: the native runtime closure ships at resources/smartspectra/
// (a .so/.dll/.dylib cannot be dlopen'd from inside app.asar). Point the
// resolver at the unpacked copy BEFORE the binding is required.
if (app.isPackaged && !process.env.SMARTSPECTRA_CAPI_PATH) {
    const LIB = {
        darwin: 'libsmartspectra_capi.dylib',
        win32: 'smartspectra_capi.dll',
        linux: 'libsmartspectra_capi.so',
    }[process.platform];
    if (LIB) {
        process.env.SMARTSPECTRA_CAPI_PATH = path.join(process.resourcesPath, 'smartspectra', LIB);
    }
}

const { bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main');

function createWindow() {
    const win = new BrowserWindow({
        width: 1180,
        height: 780,
        backgroundColor: '#050810',
        title: 'Pulse Garden',
        webPreferences: {
            preload: require.resolve('@smartspectra/node-sdk/preload'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
        },
    });

    bindSmartSpectraIpc(win);

    // A wellness companion renders only its own bundled page.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());

    win.loadFile(path.join(__dirname, 'index.html'));

    // Dev/CI hook: PG_SHOT=/path.png launches, dismisses consent, starts the
    // (simulated) session, captures the window and exits. Handy for headless
    // smoke tests and screenshots.
    if (process.env.PG_SHOT) {
        win.webContents.once('did-finish-load', () => {
            win.webContents.executeJavaScript(
                "document.getElementById('btn-consent').click(); document.getElementById('btn-start').click(); 1;"
            ).catch(() => {});
            setTimeout(async () => {
                const img = await win.webContents.capturePage();
                require('fs').writeFileSync(process.env.PG_SHOT, img.toPNG());
                console.log('[pulse-garden] screenshot ->', process.env.PG_SHOT);
                app.quit();
            }, 5000);
        });
    }
}

app.whenReady().then(() => {
    // Grant camera (video only) to the bundled file:// page. Deny everything
    // else so a copied app can never auto-grant a broader permission.
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
        const url = (details && details.requestingUrl) || (wc && wc.getURL()) || '';
        const mediaTypes = (details && details.mediaTypes) || [];
        const cameraOnly = mediaTypes.length === 1 && mediaTypes[0] === 'video';
        callback(permission === 'media' && cameraOnly && url.startsWith('file://'));
    });

    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
