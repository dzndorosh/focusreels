/**
 * FocusReels — main process.
 *
 * Wiring only: broker -> registry -> overlay. All the decision logic lives in
 * src/core, which knows nothing about Electron and is covered by the tests.
 */

import { app, ipcMain, screen, session } from 'electron';
import { mkdirSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { YoutubeWindow } from './youtubeWindow.js';
import { OVERLAY_CHANNELS } from './overlayIpc.js';
import { EventBroker } from '../broker/server.js';
import { mediaDir } from '../broker/paths.js';
import { TurnRegistry, type RegistryConfig } from '../core/turnRegistry.js';
import { BUILTIN_SOURCES, sanitizeEvent, type SourceId } from '../core/events.js';
import { SourceRegistry } from '../core/sourceRegistry.js';
import { IdeWatcher } from './ideWatcher.js';
import { playlist } from './mediaLibrary.js';
import { OverlayWindow, type OverlayStatus } from './overlayWindow.js';
import { SettingsStore } from './settings.js';
import { TrayController } from './tray.js';
import { CatalogProvider } from '../youtube/catalogProvider.js';
import { PlayerCoordinator } from './playerCoordinator.js';
import { FEED_CHANNELS, parseBrokenVideoId, parseFeedback } from './feedIpc.js';

// Development/E2E runs must never touch the user's normal Application Support.
// Keep this before SettingsStore is constructed, since it determines all paths.
if (process.env.NODE_ENV !== 'production' && process.env.FOCUSREELS_E2E_USER_DATA) {
  const e2ePath = process.env.FOCUSREELS_E2E_USER_DATA;
  if (e2ePath.startsWith('/') && !e2ePath.includes('..')) app.setPath('userData', e2ePath);
}

// A menu-bar utility: no dock icon, and activating it never steals focus.
app.dock?.hide();
app.setActivationPolicy?.('accessory');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const settings = new SettingsStore();
const overlay = new OverlayWindow(settings.get());
const youtube = new YoutubeWindow(settings.get(), (placement) => {
  // The window is the authority on where it is; settings.json only remembers.
  settings.update({ placement });
});
const catalogProvider = new CatalogProvider();
const players = new PlayerCoordinator(
  { local: overlay, youtube },
  settings.get().player,
);
let e2eServer: ReturnType<typeof createServer> | null = null;
let e2eHoldOpen = false;

const registryConfig = (): RegistryConfig => {
  const s = settings.get();
  return { showDelayMs: s.showDelayMs, watchdogMs: s.watchdogMs, hideMode: s.hideMode };
};

const sourceRegistry = new SourceRegistry({
  getPolicies: () => settings.get().sources,
  onRegister: (source, policy) => {
    // First contact from a tool we have never seen: remember it so the user can
    // find it in the menu even when it is not currently running.
    settings.update({ sources: { ...settings.get().sources, [source]: policy } });
    console.log(`[focusreels] new source ${source} (${policy.confidence})`);
  },
});

function currentStatus(): OverlayStatus | null {
  const active = registry.list().filter((t) => t.state === 'active');
  if (active.length === 0) return null;
  const oldest = active.reduce((a, b) =>
    (a.startedAt ?? 0) <= (b.startedAt ?? 0) ? a : b,
  );
  return {
    source: oldest.source,
    startedAt: oldest.startedAt ?? Date.now(),
    parallel: active.length,
  };
}

const registry = new TurnRegistry({
  getConfig: registryConfig,
  admitSource: (event) => sourceRegistry.admit(event),
  onSourceBlocked: (source, reason) => {
    console.log(`[focusreels] blocked ${source} (${reason})`);
    tray.refresh();
  },
  onVisibilityChange: (visible) => {
    console.log(`[focusreels] overlay ${visible ? 'show' : 'hide'}`);
    if (visible) {
      const status = currentStatus();
      players.sync(true, status);
    } else {
      if (e2eHoldOpen) return;
      players.sync(false, null);
    }
    tray.refresh();
  },
  onTurnChange: () => {
    players.updateStatus(currentStatus());
    tray.refresh();
  },
});

/**
 * The MVP's simulation buttons drive the *real* pipeline — a sanitized event
 * into the registry, exactly as an IDE hook would — so what they exercise is
 * what ships, not a shortcut around it.
 */
const DEV_TURN_ID = 'dev-simulated';

function simulate(event: 'turn_started' | 'turn_ended'): void {
  registry.dispatch(
    sanitizeEvent({
      source: 'demo',
      turn_id: DEV_TURN_ID,
      event,
      outcome: event === 'turn_ended' ? 'completed' : undefined,
      timestamp: Date.now(),
    }),
  );
}

const tray = new TrayController({
  settings,
  activeTurns: () => registry.list().filter((t) => t.state === 'active').length,
  feedStatus: () => ({ demoMode: false, reason: null, queued: 0 }),
  sources: () => sourceRegistry.list(),
  capRejected: () => sourceRegistry.capRejected,
  onSimulateStart: () => simulate('turn_started'),
  onSimulateStop: () => simulate('turn_ended'),
  onNextVideo: () => {},
  onRefreshFeed: () => youtube.command('refresh'),
  onForgetThirdPartySources: () => {
    // Self-heals a cap lockout: drop every non-built-in entry so a legitimate
    // adapter re-registers on its next event, and clear the stale warning.
    const builtins = new Set<string>(BUILTIN_SOURCES);
    const kept = Object.fromEntries(
      Object.entries(settings.get().sources).filter(([id]) => builtins.has(id)),
    );
    settings.update({ sources: kept });
    sourceRegistry.clearCapRejected();
  },
  onQuit: () => app.quit(),
});

const broker = new EventBroker({
  onEvent: (event) => registry.dispatch(event),
  onRejected: (reason) => {
    // Reason only — never the offending line, which is exactly the thing that
    // might contain content we promised not to touch.
    console.warn('[broker] dropped an event:', reason);
  },
});

const ideWatcher = new IdeWatcher(
  () => registry.list().map((t) => t.source as SourceId),
  (source) => registry.cancelSource(source, 'ide_closed'),
);

/**
 * Guards the cleanup, not the quit. It must be set *inside* before-quit — an
 * earlier flag (say, in the tray's Quit item) would make the handler skip the
 * very cleanup it exists for, leaving the socket file behind.
 */
let cleanedUp = false;

async function shutdown(): Promise<void> {
  if (cleanedUp) return;
  cleanedUp = true;
  registry.cancelAll('ide_closed');
  overlay.destroy();
  youtube.destroy();
  ideWatcher.stop();
  tray.destroy();
  await broker.stop();
  e2eServer?.close();
}

settings.onChange((s) => {
  overlay.applySettings(s);
  youtube.applySettings(s);
  players.switchTo(s.player, registry.visible, currentStatus());
});

ipcMain.handle('focusreels:playlist', () => playlist());

ipcMain.on('focusreels:pointer-grab', (_event, grab: unknown) => {
  overlay.setPointerGrab(Boolean(grab));
});

// ── the feed. Everything the YouTube window can ask for. ──────────────────

ipcMain.on(FEED_CHANNELS.close, () => youtube.hide());
ipcMain.handle(FEED_CHANNELS.next, () => catalogProvider.next());
ipcMain.handle(FEED_CHANNELS.previous, () => catalogProvider.previous());
ipcMain.handle(FEED_CHANNELS.peek, () => catalogProvider.peek());
ipcMain.handle(FEED_CHANNELS.refresh, () => catalogProvider.refresh());
ipcMain.handle(FEED_CHANNELS.status, () => catalogProvider.status);
ipcMain.on(FEED_CHANNELS.feedback, (_event, value: unknown) => {
  const feedback = parseFeedback(value);
  if (feedback) catalogProvider.setFeedback(feedback);
});
ipcMain.on(FEED_CHANNELS.playbackError, (_event, value: unknown) => {
  const videoId = parseBrokenVideoId(value);
  if (videoId) catalogProvider.markBroken(videoId);
});

// ── window control. The renderer asks; main decides. ──────────────────────

ipcMain.on(OVERLAY_CHANNELS.collapse, () => youtube.collapse());
ipcMain.on(OVERLAY_CHANNELS.expand, () => youtube.expand());
ipcMain.on(OVERLAY_CHANNELS.close, () => youtube.hide());
ipcMain.handle(OVERLAY_CHANNELS.getState, () => youtube.state);
ipcMain.on(OVERLAY_CHANNELS.reducedMotion, (_event, value: unknown) => {
  youtube.setReducedMotion(Boolean(value));
});

ipcMain.on(OVERLAY_CHANNELS.morphReady, () => youtube.onMorphReady());
ipcMain.on(OVERLAY_CHANNELS.morphDone, () => youtube.onMorphDone());
ipcMain.on(OVERLAY_CHANNELS.labCommand, (_event, command: unknown) => {
  if (typeof command === 'string') youtube.labCommand(command);
});

// A gesture: main sets the stage and picks the corner; the renderer owns every
// frame in between, so there is no per-frame IPC and no per-frame window move.
ipcMain.on(OVERLAY_CHANNELS.dragStart, () => youtube.beginDrag());
ipcMain.on(OVERLAY_CHANNELS.dragEnd, (_event, payload: unknown) => {
  const p = (typeof payload === 'object' && payload !== null ? payload : {}) as {
    surface?: Partial<Record<'x' | 'y' | 'width' | 'height', unknown>>;
    velocity?: Partial<Record<'x' | 'y', unknown>>;
  };
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;

  const x = num(p.surface?.x);
  const y = num(p.surface?.y);
  const width = num(p.surface?.width);
  const height = num(p.surface?.height);
  const vx = num(p.velocity?.x);
  const vy = num(p.velocity?.y);
  if (x === null || y === null || width === null || height === null) return;
  if (vx === null || vy === null) return;

  youtube.resolveSnap({ x, y, width, height }, { x: vx, y: vy });
});
ipcMain.on(OVERLAY_CHANNELS.stageDone, () => youtube.onStageDone());
ipcMain.on(OVERLAY_CHANNELS.transitionComplete, () => youtube.onTransitionComplete());
ipcMain.on(OVERLAY_CHANNELS.dragMove, (_event, interactive: unknown) => {
  // Now only a hint about whether the stage should be reachable by the mouse.
  youtube.setStageInteractive(Boolean(interactive));
});
ipcMain.on(FEED_CHANNELS.muted, (_event, value: unknown) => {
  settings.update({ muted: Boolean(value) });
});

ipcMain.on('focusreels:audio', (_event, payload: unknown) => {
  const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<
    string,
    unknown
  >;
  const patch: { muted?: boolean; volume?: number } = {};
  if (typeof p.muted === 'boolean') patch.muted = p.muted;
  if (typeof p.volume === 'number' && Number.isFinite(p.volume)) patch.volume = p.volume;
  if (Object.keys(patch).length === 0) return;

  // Written straight to settings.json so the choice survives a restart. This
  // does not re-push 'settings' at the player — it already has these values,
  // and echoing them back would fight the slider the user is dragging.
  settings.update(patch);
});

app.whenReady().then(async () => {
  if (process.env.NODE_ENV === 'production' || !process.env.FOCUSREELS_E2E) {
    void catalogProvider.refreshRemote(process.env.FOCUSREELS_REMOTE_CATALOG_URL);
  }
  if (process.env.NODE_ENV !== 'production' && process.env.FOCUSREELS_E2E) {
    const socketPath = join(app.getPath('userData'), 'feed-e2e.sock');
    try { if (existsSync(socketPath)) unlinkSync(socketPath); } catch { /* stale test socket */ }
    e2eServer = createServer((socket) => {
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk.toString();
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); newline = buffer.indexOf('\n');
          try {
            const command = JSON.parse(line) as { action?: string };
            if (command.action === 'next') { youtube.command('next'); socket.end(); }
            else if (command.action === 'previous') { youtube.command('previous'); socket.end(); }
            else if (command.action === 'show') { youtube.show({ source: 'demo', startedAt: Date.now(), parallel: 1 }); socket.end(); }
            else if (command.action === 'hide') { e2eHoldOpen = false; youtube.hide(); socket.end(); }
            else if (command.action === 'hold-open') { e2eHoldOpen = Boolean((command as any).enabled); socket.end(); }
            else if (command.action === 'status') { socket.write(JSON.stringify({ status: catalogProvider.status }) + '\n'); socket.end(); }
            else if (command.action === 'feedback' && typeof (command as any).videoId === 'string') {
              catalogProvider.setFeedback({ videoId: (command as any).videoId, category: 'other', impressions: Number((command as any).impressions ?? 0), completedViews: Number((command as any).completedViews ?? 0), quickSkips: Number((command as any).quickSkips ?? 0), lastViewedAt: new Date().toISOString() });
              socket.write(JSON.stringify({ ok: true }) + '\n'); socket.end();
            }
            else if (command.action === 'trace') {
              const p = join(app.getPath('userData'), 'feed-trace.jsonl');
              socket.write(JSON.stringify({ trace: existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).slice(-20) : [] }) + '\n');
            }
          } catch { /* malformed development command */ }
        }
      });
    });
    e2eServer.listen(socketPath);
    console.log(`[focusreels] e2e driver listening ${socketPath}`);
  }
  // The IFrame Player API is loaded from our local renderer page. YouTube
  // requires desktop embeds to provide an identifying Referer in that case
  // (Error 153); this is our application identity, not a user credential.
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (details.url.startsWith('https://www.youtube.com/') || details.url.startsWith('https://www.youtube-nocookie.com/')) {
      details.requestHeaders.Referer = 'https://focusreels.app/';
    }
    callback({ requestHeaders: details.requestHeaders });
  });
  mkdirSync(mediaDir(), { recursive: true });
  settings.save(); // materialise the file on first run so it is editable

  try {
    await broker.start();
    console.log(`[focusreels] listening on ${broker.address}`);
  } catch (err) {
    console.error('[focusreels]', (err as Error).message);
    app.quit();
    return;
  }

  tray.start();
  ideWatcher.start();

  // A monitor coming or going can strand the window at coordinates that no
  // longer exist, so re-resolve the placement whenever the layout changes.
  // (Three calls rather than a loop: the typings overload each event name.)
  const reconcile = () => youtube.reconcileDisplays();
  screen.on('display-removed', reconcile);
  screen.on('display-added', reconcile);
  screen.on('display-metrics-changed', reconcile);

  const fs = catalogProvider.status;
  if (process.env.FOCUSREELS_DEBUG_FEED) console.log(`[feed] catalog loaded provider=${fs.provider} source=${fs.catalogSource} total=${fs.totalVideos ?? 0}`);
});

app.on('window-all-closed', () => {
  // The overlay closing is normal; the app lives in the menu bar.
});

app.on('before-quit', (event) => {
  if (cleanedUp) return; // the second pass, after cleanup finished
  event.preventDefault();
  void shutdown().then(() => app.quit());
});

// Ctrl+C from the terminal does not raise before-quit, so clean up here too.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void shutdown().then(() => app.exit(0));
  });
}
