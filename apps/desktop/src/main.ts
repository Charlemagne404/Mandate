import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import staticPlugin from '@fastify/static';
import { canonicalHash, openWorldStore } from '@mandate/persistence';
import { geographyValidatorByVersion, loadScenario } from '@mandate/scenarios';
import { branding } from '@mandate/schemas';
import { buildServer } from '../../server/src/app.js';
import { createAlphaServices } from '../../server/src/alpha.js';
import {
  desktopDirectories,
  readConfiguration,
  writeConfiguration,
} from './configuration.js';

app.setName(branding.name);
const dataPath = process.env.MANDATE_USER_DATA
  ? resolve(process.env.MANDATE_USER_DATA)
  : join(app.getPath('appData'), branding.name);
mkdirSync(dataPath, { recursive: true });
app.setPath('userData', dataPath);
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
let window: BrowserWindow | undefined;
let service: ReturnType<typeof buildServer> | undefined;
let origin = '';
let closing = false;
let shutdownComplete = false;
let cancelTurns = () => {};

app.on('second-instance', () => {
  window?.show();
  window?.focus();
});
app.on('before-quit', (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (closing) return;
  closing = true;
  cancelTurns();
  void service
    ?.close()
    .catch((error: unknown) => console.error(error))
    .finally(() => {
      shutdownComplete = true;
      app.quit();
    });
  if (!service) {
    shutdownComplete = true;
    app.quit();
  }
});
app.on('window-all-closed', () => app.quit());

async function launch() {
  await app.whenReady();
  if (!ownsInstance) return;
  const userData = app.getPath('userData');
  const directories = desktopDirectories(userData);
  const log = (message: string) =>
    appendFileSync(
      join(directories.logs, 'desktop.log'),
      `${new Date().toISOString()} ${message}\n`,
    );
  const resources = app.isPackaged
    ? join(app.getAppPath(), 'resources')
    : resolve(app.getAppPath(), '../..');
  const configuration = readConfiguration(userData);
  for (const name of [
    'global-alpha.json',
    'northern-sandbox.json',
    'nordic-strategy.json',
  ]) {
    const target = join(directories.scenarios, name);
    if (!existsSync(target))
      copyFileSync(join(resources, 'data/scenarios', name), target);
  }
  const geography = readFileSync(
    join(resources, 'data/geography/world-global.geojson'),
    'utf8',
  );
  const geographyByVersion = {
    'natural-earth-110m-v1': readFileSync(
      join(resources, 'data/geography/world.geojson'),
      'utf8',
    ),
    'natural-earth-50m-v1': geography,
  };
  const regionSets = Object.fromEntries(
    Object.entries(geographyByVersion).map(([version, content]) => [
      version,
      new Set<string>(
        (JSON.parse(content) as { features: { id: string }[] }).features.map(
          (feature) => feature.id,
        ),
      ),
    ]),
  );
  const store = openWorldStore({
    filename: join(directories.saves, 'world.sqlite'),
    migrationsDirectory: join(resources, 'packages/persistence/migrations'),
    validateGeography: geographyValidatorByVersion(regionSets),
  });
  const alpha = createAlphaServices(store, {
    directory: directories.services,
    scenariosDirectory: directories.scenarios,
  });
  cancelTurns = alpha.cancel;
  try {
    store.initialize(
      loadScenario(join(resources, 'data/scenarios/global-alpha.json')),
    );
    service = buildServer({
      store,
      geography,
      geographyByVersion,
      geographicReference: readFileSync(
        join(resources, 'data/geography/global-metadata.json'),
        'utf8',
      ),
      allowedOrigins: [],
      allowSameOrigin: true,
      services: alpha,
    });
    service.addHook('onClose', () => store.close());
    service.addHook('onSend', async (_, reply) => {
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'",
      );
    });
    const web = app.isPackaged
      ? join(resources, 'web')
      : join(resources, 'apps/web/dist');
    if (!existsSync(join(web, 'index.html')))
      throw new Error(
        'Renderer is missing. Run desktop:build before starting Mandate.',
      );
    await service.register(staticPlugin, { root: web });
    origin = await service.listen({ host: '127.0.0.1', port: 0 });
    window = new BrowserWindow({
      width: configuration.width,
      height: configuration.height,
      minWidth: 1000,
      minHeight: 700,
      title: branding.name,
      show: !process.env.MANDATE_DESKTOP_SMOKE,
      backgroundColor: '#101719',
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
        allowRunningInsecureContent: false,
      },
    });
    window.webContents.session.setPermissionRequestHandler((_, __, callback) =>
      callback(false),
    );
    window.webContents.session.setPermissionCheckHandler(() => false);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== origin) event.preventDefault();
    });
    window.webContents.on('will-attach-webview', (event) =>
      event.preventDefault(),
    );
    window.webContents.session.webRequest.onBeforeRequest(
      (details, callback) => {
        const url = new URL(details.url);
        callback({
          cancel:
            !['data:', 'blob:'].includes(url.protocol) && url.origin !== origin,
        });
      },
    );
    const authorize = (event: IpcMainInvokeEvent) => {
      if (
        event.sender !== window?.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        new URL(event.senderFrame.url).origin !== origin
      )
        throw new Error('Untrusted IPC sender');
    };
    ipcMain.handle('mandate:open-folder', async (event, kind: unknown) => {
      authorize(event);
      if (
        kind !== 'saves' &&
        kind !== 'scenarios' &&
        kind !== 'exports' &&
        kind !== 'logs'
      )
        throw new Error('Unknown folder');
      const error = await shell.openPath(directories[kind]);
      if (error) throw new Error(error);
    });
    ipcMain.handle('mandate:start-ollama', async (event) => {
      authorize(event);
      const paths = [
        '/Applications/Ollama.app',
        join(app.getPath('home'), 'Applications/Ollama.app'),
      ];
      const path = paths.find(existsSync);
      if (!path)
        throw new Error(
          'Ollama is not installed. Install it from ollama.com, then return to AI setup.',
        );
      const error = await shell.openPath(path);
      if (error) throw new Error(error);
    });
    ipcMain.handle('mandate:configuration', (event) => {
      authorize(event);
      return { version: 1, nativeDialogs: true };
    });
    ipcMain.handle('mandate:import-save', async (event) => {
      authorize(event);
      alpha.unlocked();
      const current = store.load();
      const expectedHash = canonicalHash(current);
      const selected = await dialog.showOpenDialog(window!, {
        title: 'Import Mandate save',
        defaultPath: directories.saves,
        properties: ['openFile'],
        filters: [{ name: 'Mandate save', extensions: ['json'] }],
      });
      if (selected.canceled || !selected.filePaths[0]) return null;
      if (statSync(selected.filePaths[0]).size > 32 * 1024 * 1024)
        throw new Error('Save exceeds 32 MiB limit');
      const save: unknown = JSON.parse(
        readFileSync(selected.filePaths[0], 'utf8'),
      );
      alpha.unlocked();
      alpha.archive.checkpoint(store, 'Before native save import', 'named');
      const world = store.import(save, current.revision, expectedHash);
      return { world, hash: canonicalHash(world) };
    });
    ipcMain.handle('mandate:export-save', async (event) => {
      authorize(event);
      const selected = await dialog.showSaveDialog(window!, {
        title: 'Export Mandate save',
        defaultPath: join(
          directories.exports,
          `mandate-${store.load().date}.json`,
        ),
        filters: [{ name: 'Mandate save', extensions: ['json'] }],
      });
      if (selected.canceled || !selected.filePath) return null;
      const snapshot = store.export();
      writeFileSync(
        selected.filePath,
        JSON.stringify(snapshot, null, 2) + '\n',
        { mode: 0o600 },
      );
      return { exported: true };
    });
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === 'darwin'
          ? [
              {
                label: branding.name,
                submenu: [
                  { role: 'about' as const },
                  { role: 'quit' as const },
                ],
              },
            ]
          : []),
        {
          label: 'File',
          submenu: [
            {
              label: 'Open Save Folder',
              click: () => {
                void shell.openPath(directories.saves);
              },
            },
            {
              label: 'Open Scenario Folder',
              click: () => {
                void shell.openPath(directories.scenarios);
              },
            },
            { role: 'close' },
          ],
        },
        {
          label: 'Edit',
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' },
          ],
        },
        {
          label: 'View',
          submenu: [
            { role: 'reload' },
            { role: 'toggleDevTools' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { role: 'togglefullscreen' },
          ],
        },
      ]),
    );
    window.on('close', () => {
      if (!window) return;
      const bounds = window.getNormalBounds();
      writeConfiguration(userData, {
        version: 1,
        width: bounds.width,
        height: bounds.height,
        maximized: window.isMaximized(),
      });
    });
    if (configuration.maximized) window.maximize();
    await window.loadURL(origin);
    log(
      `Started Electron ${process.versions.electron}; Node ${process.versions.node}; SQLite persistence active`,
    );
  } catch (error) {
    if (!service) store.close();
    throw error;
  }
}
void launch().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  try {
    const directories = desktopDirectories(app.getPath('userData'));
    appendFileSync(
      join(directories.logs, 'desktop.log'),
      `${new Date().toISOString()} STARTUP FAILURE ${message}\n`,
    );
  } catch {
    /* A missing/unwritable user-data directory is itself a startup failure. */
  }
  if (!process.env.MANDATE_DESKTOP_SMOKE)
    dialog.showErrorBox(
      `${branding.name} could not start`,
      `${error instanceof Error ? error.message : String(error)}\n\nYour saved world has not been reset. Details are in the desktop log.`,
    );
  app.quit();
});
