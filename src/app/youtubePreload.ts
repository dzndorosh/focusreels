import { contextBridge, ipcRenderer } from 'electron';
import {
  OVERLAY_CHANNELS,
  type BoundsCommitted,
  type DragDelta,
  type OverlayState,
} from './overlayIpc.js';
import {
  MORPH_SPRING,
  REST_PIXELS,
  REST_PROGRESS,
  SNAP_SPRING,
  calculateDragVelocity,
  isAtRest,
  stepSpring,
  type DragSample,
  type SpringConfig,
  type SpringState,
  type Velocity,
} from './spring.js';
import { FEED_CHANNELS } from './feedIpc.js';

/**
 * The renderer's entire view of the main process.
 *
 * It can ask for the next video and change its own state — it cannot reach the
 * API key, the network, or the filesystem. Everything it receives is a finished
 * `FeedVideo`, built in main.
 */
contextBridge.exposeInMainWorld('feed', {
  next: () => ipcRenderer.invoke(FEED_CHANNELS.next),
  peek: () => ipcRenderer.invoke(FEED_CHANNELS.peek),
  previous: () => ipcRenderer.invoke(FEED_CHANNELS.previous),
  refresh: () => ipcRenderer.invoke(FEED_CHANNELS.refresh),
  status: () => ipcRenderer.invoke(FEED_CHANNELS.status),
  close: () => ipcRenderer.send(FEED_CHANNELS.close),
  setMuted: (muted: boolean) => ipcRenderer.send(FEED_CHANNELS.muted, Boolean(muted)),
  reportFeedback: (feedback: unknown) => ipcRenderer.send(FEED_CHANNELS.feedback, feedback),
  reportPlaybackError: (value: unknown) => ipcRenderer.send(FEED_CHANNELS.playbackError, value),
  onShow: (fn: (s: unknown) => void) => ipcRenderer.on('show', (_e, s) => fn(s)),
  onHide: (fn: () => void) => ipcRenderer.on('hide', () => fn()),
  onStatus: (fn: (s: unknown) => void) => ipcRenderer.on('status', (_e, s) => fn(s)),
  onSettings: (fn: (s: unknown) => void) => ipcRenderer.on('settings', (_e, s) => fn(s)),
  onCommand: (fn: (c: string) => void) => ipcRenderer.on('command', (_e, c) => fn(String(c))),
});

/**
 * Window control. The renderer asks; the main process decides and moves the
 * window — nothing here hands out a BrowserWindow or anything that wraps one.
 */
/**
 * The same spring the main process uses, handed to the page rather than copied
 * into it — one implementation, one set of tests, no chance of the two drifting
 * apart. These are plain in-process calls, not IPC.
 */
contextBridge.exposeInMainWorld('spring', {
  MORPH: MORPH_SPRING as SpringConfig,
  SNAP: SNAP_SPRING as SpringConfig,
  step: (state: SpringState, target: number, config: SpringConfig, dt: number): SpringState =>
    stepSpring(state, target, config, dt),
  /** for the 0…1 morph progress */
  atRest: (state: SpringState, target: number): boolean =>
    isAtRest(state, target, REST_PROGRESS),
  /** for pixel-space motion: half a pixel and 5 px/s */
  atRestPx: (state: SpringState, target: number): boolean =>
    isAtRest(state, target, REST_PIXELS),
  velocity: (samples: DragSample[]): Velocity => calculateDragVelocity(samples),
});

contextBridge.exposeInMainWorld('overlay', {
  collapse: (): void => ipcRenderer.send(OVERLAY_CHANNELS.collapse),
  expand: (): void => ipcRenderer.send(OVERLAY_CHANNELS.expand),
  close: (): void => ipcRenderer.send(OVERLAY_CHANNELS.close),
  getState: (): Promise<OverlayState> => ipcRenderer.invoke(OVERLAY_CHANNELS.getState),
  onStateChanged: (fn: (state: OverlayState) => void): void => {
    ipcRenderer.on(OVERLAY_CHANNELS.stateChanged, (_e, state: OverlayState) => fn(state));
  },
  /**
   * Chromium honours the macOS "Reduce motion" setting, and the main process
   * has no reliable API for it — so the page reports it upward instead.
   */
  reportReducedMotion: (value: boolean): void => {
    ipcRenderer.send(OVERLAY_CHANNELS.reducedMotion, Boolean(value));
  },
  // morph: main plans it and syncs the real bounds; the page runs the frames.
  onMorphBegin: (fn: (plan: unknown) => void): void => {
    ipcRenderer.on(OVERLAY_CHANNELS.morphBegin, (_e, plan) => fn(plan));
  },
  onMorphRun: (fn: () => void): void => {
    ipcRenderer.on(OVERLAY_CHANNELS.morphRun, () => fn());
  },
  onMorphRetarget: (fn: (payload: { to: number }) => void): void => {
    ipcRenderer.on(OVERLAY_CHANNELS.morphRetarget, (_e, payload) => fn(payload));
  },
  onMorphEnd: (fn: (payload: { mode: string }) => void): void => {
    ipcRenderer.on(OVERLAY_CHANNELS.morphEnd, (_e, payload) => fn(payload));
  },
  morphReady: (): void => ipcRenderer.send(OVERLAY_CHANNELS.morphReady),
  morphDone: (): void => ipcRenderer.send(OVERLAY_CHANNELS.morphDone),
  onSnapshot: (fn: (dataUrl: string) => void): void => {
    ipcRenderer.on(OVERLAY_CHANNELS.snapshot, (_e, url: string) => fn(String(url)));
  },
  onAnimationLab: (fn: (enabled: boolean) => void): void => {
    ipcRenderer.on(OVERLAY_CHANNELS.animationLab, (_e, on: boolean) => fn(Boolean(on)));
  },
  labCommand: (command: string): void => {
    ipcRenderer.send(OVERLAY_CHANNELS.labCommand, String(command));
  },
  onStageEnter: (fn: (plan: unknown) => void): void => {
    ipcRenderer.on(OVERLAY_CHANNELS.stageEnter, (_e, plan) => fn(plan));
  },
  onStageSnap: (fn: (snap: unknown) => void): void => {
    ipcRenderer.on(OVERLAY_CHANNELS.stageSnap, (_e, snap) => fn(snap));
  },
  onStageExit: (fn: (payload: unknown) => void): void => {
    ipcRenderer.on(OVERLAY_CHANNELS.stageExit, (_e, payload) => fn(payload));
  },
  onBoundsCommitted: (fn: (payload: BoundsCommitted) => void): void => {
    ipcRenderer.on(OVERLAY_CHANNELS.boundsCommitted, (_e, payload: BoundsCommitted) => fn(payload));
  },
  transitionComplete: (): void => ipcRenderer.send(OVERLAY_CHANNELS.transitionComplete),
  stageDone: (): void => ipcRenderer.send(OVERLAY_CHANNELS.stageDone),
  dragStart: (): void => ipcRenderer.send(OVERLAY_CHANNELS.dragStart),
  /** whether the stage should be reachable by the mouse right now */
  setStageInteractive: (interactive: boolean): void => {
    ipcRenderer.send(OVERLAY_CHANNELS.dragMove, Boolean(interactive));
  },
  dragEnd: (payload: { surface: DragDelta & { width: number; height: number }; velocity: Velocity }): void => {
    ipcRenderer.send(OVERLAY_CHANNELS.dragEnd, payload);
  },
});
