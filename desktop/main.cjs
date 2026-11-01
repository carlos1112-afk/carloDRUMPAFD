/* ------------------------------------------------------------------
 * PADFORGE – Desktop-GUI (Electron)
 *
 * Lädt die gebaute Web-App über ein eigenes, sicheres Protokoll
 * (padforge://app) in einem nativen Fenster. Dadurch ist die Seite ein
 * "secure context" – Web MIDI funktioniert ohne Umweg über den Browser.
 *
 * Start (installiert):  electron /usr/share/padforge
 * Start (Entwicklung):  npx electron .
 * ------------------------------------------------------------------ */

const { app, BrowserWindow, Menu, dialog, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SCHEME = 'padforge';
const ORIGIN = `${SCHEME}://app`;

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
  ['.wasm', 'application/wasm'],
  ['.webmanifest', 'application/manifest+json'],
]);

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('class', 'padforge');
app.setName('PADFORGE');

let distRoot = '';

function resolveDist() {
  const candidates = [
    path.join(__dirname, 'dist'), // installiert: main.cjs liegt neben dist/
    path.join(__dirname, '..', 'dist'), // Entwicklung: desktop/main.cjs -> ../dist
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'index.html'))) ?? candidates[candidates.length - 1];
}

/** Dateien ausliefern – mit korrekten MIME-Types, SPA-Fallback und Pfadschutz. */
async function handleRequest(request) {
  let pathname = '/';
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname || '/');
  } catch {
    pathname = '/';
  }
  if (pathname === '/' || pathname === '') pathname = '/index.html';

  const target = path.normalize(path.join(distRoot, pathname));
  const relative = path.relative(distRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return new Response('Forbidden', { status: 403 });
  }

  let file = target;
  try {
    const stat = await fs.promises.stat(file);
    if (stat.isDirectory()) file = path.join(distRoot, 'index.html');
  } catch {
    file = path.join(distRoot, 'index.html');
  }

  try {
    const data = await fs.promises.readFile(file);
    const ext = path.extname(file).toLowerCase();
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': MIME.get(ext) ?? 'application/octet-stream',
        'Cache-Control': file.endsWith('index.html')
          ? 'no-store'
          : 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new Response('Not Found', { status: 404 });
  }
}

/** Web MIDI (und SysEx) im Fenster erlauben – sonst nichts. */
function grantMidiPermissions() {
  const ses = session.defaultSession;
  const allowed = (permission) => permission === 'midi' || permission === 'midiSysex';
  ses.setPermissionRequestHandler((_webContents, permission, callback) => callback(allowed(permission)));
  ses.setPermissionCheckHandler((_webContents, permission) => allowed(permission));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#07080b',
    title: 'PADFORGE',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  void win.loadURL(`${ORIGIN}/`);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    }
  });

  return win;
}

function buildMenu() {
  const template = [
    {
      label: 'PADFORGE',
      submenu: [
        { role: 'reload', label: 'Neu laden' },
        { type: 'separator' },
        {
          label: 'Über PADFORGE',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'PADFORGE',
              message: 'PADFORGE',
              detail:
                `Virtuelles 16-Pad-DJ-DrumPad\nVersion ${app.getVersion()}\n\n` +
                'Web MIDI: Pioneer DDJ-FLX4 / DDJ-FLX400\n' +
                'Audio: System- oder DDJ-FLX4-Soundkarte',
              buttons: ['OK'],
            });
          },
        },
        { type: 'separator' },
        { role: 'quit', label: 'Beenden' },
      ],
    },
    {
      label: 'Ansicht',
      submenu: [
        { role: 'togglefullscreen', label: 'Vollbild' },
        { role: 'resetZoom', label: 'Zoom zurücksetzen' },
        { role: 'zoomIn', label: 'Vergrößern' },
        { role: 'zoomOut', label: 'Verkleinern' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  distRoot = resolveDist();
  if (!fs.existsSync(path.join(distRoot, 'index.html'))) {
    dialog.showErrorBox(
      'PADFORGE',
      'Die Anwendung wurde nicht gefunden.\n\nBitte PADFORGE neu installieren oder vor dem Start `npm run build` ausführen.',
    );
    app.quit();
    return;
  }

  protocol.handle(SCHEME, handleRequest);
  grantMidiPermissions();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
