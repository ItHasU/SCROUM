/** Processus principal de l'application de bureau SCROUM. */
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { existsSync } from 'node:fs';
import { basename, delimiter, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ProjectError, resolveProject } from '@scroum/build';
import { startEditorServer, type EditorServer } from '@scroum/editor-server';
import { startPlayerServer, type PlayerServer } from './player-server';
import { clearRecent, loadRecent, pushRecent } from './recent';

const here = dirname(fileURLToPath(import.meta.url));
/** Fronts pré-construits et docs : `resources/` une fois empaqueté, `dist/` en développement. */
const assets = app.isPackaged ? process.resourcesPath : here;
const staticDirs = { web: join(assets, 'web'), player: join(assets, 'player') };
const REPO_URL = 'https://github.com/ItHasU/SCROUM';

process.env.SCROUM_FORMAT_DOC ??= join(assets, 'FORMAT.md');
// Lancée depuis le Finder / un lanceur, l'application n'hérite pas du PATH du shell : on y ajoute les emplacements usuels de `claude`.
if (process.platform !== 'win32') {
  const extra = [join(homedir(), '.local/bin'), join(homedir(), '.claude/local'), '/opt/homebrew/bin', '/usr/local/bin'];
  process.env.PATH = [...(process.env.PATH ?? '').split(delimiter), ...extra].filter(Boolean).join(delimiter);
}

let home: BrowserWindow | null = null;
const recentFile = (): string => join(app.getPath('userData'), 'recent.json');

function harden(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
}

function showHome(): void {
  if (home && !home.isDestroyed()) return void home.focus();
  home = new BrowserWindow({
    width: 760,
    height: 620,
    title: 'SCROUM',
    backgroundColor: '#15171c',
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  harden(home);
  void home.loadFile(join(here, 'home.html'));
  home.on('closed', () => (home = null));
}

/** Fenêtre adossée à un serveur local, arrêté à la fermeture. */
function openServed(title: string, url: string, stop: () => Promise<void>): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title,
    backgroundColor: '#15171c',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  harden(win);
  win.webContents.on('page-title-updated', (e) => e.preventDefault());
  win.on('closed', () => void stop());
  void win.loadURL(url);
  return win;
}

async function pick(opts: Electron.OpenDialogOptions): Promise<string | null> {
  const parent = BrowserWindow.getFocusedWindow() ?? home ?? undefined;
  const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
}

export async function openRepo(path?: string): Promise<{ error?: string }> {
  const dir = path ?? (await pick({ title: 'Ouvrir un dépôt de jeu', properties: ['openDirectory', 'createDirectory'] }));
  if (!dir) return {};
  let server: EditorServer;
  try {
    const project = resolveProject(dir);
    server = await startEditorServer({ project, port: 0, host: '127.0.0.1', staticDirs });
  } catch (e) {
    const error = e instanceof ProjectError ? e.message : `Impossible de démarrer l'éditeur : ${(e as Error).message}`;
    return { error };
  }
  await pushRecent(recentFile(), { kind: 'repo', path: dir, name: basename(dir) });
  openServed(`SCROUM — ${basename(dir)}`, server.url, () => server.close());
  home?.close();
  rebuildMenu();
  return {};
}

export async function openZip(path?: string): Promise<{ error?: string }> {
  const file = path ?? (await pick({ title: 'Jouer un jeu SCROUM', properties: ['openFile'], filters: [{ name: 'Jeu SCROUM', extensions: ['zip'] }] }));
  if (!file) return {};
  if (!existsSync(file)) return { error: `Fichier introuvable : ${file}` };
  let server: PlayerServer;
  try {
    server = await startPlayerServer(staticDirs.player, file);
  } catch (e) {
    return { error: `Impossible de démarrer le player : ${(e as Error).message}` };
  }
  await pushRecent(recentFile(), { kind: 'zip', path: file, name: basename(file) });
  openServed(`SCROUM — ${basename(file)}`, server.url, () => server.close());
  home?.close();
  rebuildMenu();
  return {};
}

function rebuildMenu(): void {
  void loadRecent(recentFile()).then((recent) => {
    const mac = process.platform === 'darwin';
    const fail = (r: { error?: string }): void => void (r.error && dialog.showErrorBox('SCROUM', r.error));
    const template: MenuItemConstructorOptions[] = [
      ...(mac ? [{ role: 'appMenu' as const }] : []),
      {
        label: 'Fichier',
        submenu: [
          { label: 'Accueil', accelerator: 'CmdOrCtrl+Shift+H', click: showHome },
          { label: 'Ouvrir un dépôt de jeu…', accelerator: 'CmdOrCtrl+O', click: () => void openRepo().then(fail) },
          { label: 'Jouer un fichier .scroum.zip…', accelerator: 'CmdOrCtrl+Shift+O', click: () => void openZip().then(fail) },
          {
            label: 'Projets récents',
            enabled: recent.length > 0,
            submenu: recent.map((e) => ({ label: `${e.kind === 'zip' ? '▶' : '✎'} ${e.name}`, toolTip: e.path, click: () => void (e.kind === 'zip' ? openZip(e.path) : openRepo(e.path)).then(fail) })),
          },
          { type: 'separator' },
          { role: 'close', label: 'Fermer la fenêtre' },
          ...(mac ? [] : [{ role: 'quit' as const, label: 'Quitter' }]),
        ],
      },
      {
        label: 'Édition',
        submenu: [{ role: 'undo', label: 'Annuler' }, { role: 'redo', label: 'Rétablir' }, { type: 'separator' }, { role: 'cut', label: 'Couper' }, { role: 'copy', label: 'Copier' }, { role: 'paste', label: 'Coller' }, { role: 'selectAll', label: 'Tout sélectionner' }],
      },
      {
        label: 'Affichage',
        submenu: [
          { role: 'reload', label: 'Recharger' },
          { role: 'forceReload', label: 'Forcer le rechargement' },
          { role: 'toggleDevTools', label: 'Outils de développement' },
          { type: 'separator' },
          { role: 'resetZoom', label: 'Zoom par défaut' },
          { role: 'zoomIn', label: 'Zoom avant' },
          { role: 'zoomOut', label: 'Zoom arrière' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: 'Plein écran' },
        ],
      },
      {
        label: 'Aide',
        submenu: [
          { label: 'Documentation', click: () => void shell.openExternal(`${REPO_URL}#readme`) },
          { label: 'Format de contenu', click: () => void shell.openExternal(`${REPO_URL}/blob/main/docs/FORMAT.md`) },
          { label: 'Signaler un problème', click: () => void shell.openExternal(`${REPO_URL}/issues`) },
          { type: 'separator' },
          { label: `SCROUM ${app.getVersion()}`, enabled: false },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  });
}

ipcMain.handle('open-repo', (_e, path?: string) => openRepo(path));
ipcMain.handle('open-zip', (_e, path?: string) => openZip(path));
ipcMain.handle('recent', () => loadRecent(recentFile()));
ipcMain.handle('clear-recent', async () => {
  await clearRecent(recentFile());
  rebuildMenu();
});
ipcMain.handle('version', () => app.getVersion());

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', showHome);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) showHome();
});

void app.whenReady().then(async () => {
  rebuildMenu();
  // Ouverture directe (tests, lanceurs) : SCROUM_DESKTOP_OPEN=<dépôt> ou SCROUM_DESKTOP_PLAY=<zip>.
  const direct = process.env.SCROUM_DESKTOP_OPEN;
  const zip = process.env.SCROUM_DESKTOP_PLAY;
  if (direct) {
    const r = await openRepo(direct);
    if (r.error) console.error(r.error);
  } else if (zip) {
    const r = await openZip(zip);
    if (r.error) console.error(r.error);
  }
  if (BrowserWindow.getAllWindows().length === 0) showHome();
});
