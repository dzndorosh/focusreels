/**
 * The YouTube player window: exactly 326×720 of content, fixed size.
 *
 * Unlike the local-clip overlay this one is genuinely interactive — an embedded
 * player needs real clicks — so it is not click-through. It still appears with
 * `showInactive()`, so it never pulls focus away from the editor you are typing
 * in; it only takes focus if you click it.
 */

import { BrowserWindow, screen, type Display, type Rectangle } from 'electron';
import { join } from 'node:path';
import { appendFileSync } from 'node:fs';
import {
  ANCHOR_MARGIN,
  DEFAULT_ANCHOR,
  clampToWorkArea,
  getAnchorPosition,
  isAnchor,
  selectNearestAnchor,
  anchorOrigin,
  CORNER_ANCHORS,
  ANCHORS,
  unionRect,
  type Rect,
  type SavedWindowPlacement,
  type Size,
  type WindowAnchor,
  type WindowMode,
} from './anchors.js';
import {
  OVERLAY_CHANNELS,
  type DragDelta,
  type BoundsCommitted,
  type StagePlan,
  type MorphPlan,
  type OverlayAnimationState,
  type OverlayState,
} from './overlayIpc.js';
import {
  projectPosition,
  projectionWindowMs,
  type Velocity,
} from './spring.js';
import type { Settings } from './settings.js';

export const PLAYER_WIDTH = 326;
export const PLAYER_HEIGHT = 720;
/** The collapsed pill: a 56px circle and nothing else. */
export const COLLAPSED_SIZE = 56;

export const SIZES: Record<WindowMode, Size> = {
  expanded: { width: PLAYER_WIDTH, height: PLAYER_HEIGHT },
  collapsed: { width: COLLAPSED_SIZE, height: COLLAPSED_SIZE },
};

/** Main has no requestAnimationFrame; this is the closest honest equivalent. */
const FRAME_MS = 1000 / 60;
/** A native drag emits a stream of `move` events; this much quiet ends it. */
const DRAG_SETTLE_MS = 140;
/** Only the last moments of a drag say anything about how it was released. */
const DRAG_SAMPLE_LIMIT = 16;

export interface PlayerStatus {
  source: string;
  startedAt: number;
  parallel: number;
}

export class YoutubeWindow {
  private win: BrowserWindow | null = null;
  private ready = false;
  private pending: PlayerStatus | null = null;

  private mode: WindowMode = 'expanded';
  private anchor: WindowAnchor = DEFAULT_ANCHOR;
  private displayId: string | undefined;
  private reducedMotion = false;

  /** Set while we are moving the window ourselves, so our own `move` events
   *  are not mistaken for the user dragging it. */
  private animating = false;
  private animationTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bounds at the moment a renderer-driven drag began. */

  constructor(
    private settings: Settings,
    private readonly onPlacementChange: (placement: SavedWindowPlacement) => void = () => {},
  ) {
    this.adoptPlacement(settings.placement);
  }

  // ── placement ────────────────────────────────────────────────────────────

  private adoptPlacement(placement: SavedWindowPlacement): void {
    this.anchor = placement.anchor;
    this.mode = placement.mode;
    this.displayId = placement.displayId;
  }

  private savePlacement(): void {
    const placement: SavedWindowPlacement = { anchor: this.anchor, mode: this.mode };
    if (this.displayId) placement.displayId = this.displayId;
    this.onPlacementChange(placement);
  }

  /**
   * The display this window belongs on: the saved one if it is still connected,
   * otherwise whichever one currently holds the window — and if that fails, the
   * primary. Unplugging a monitor therefore brings the window home rather than
   * leaving it at coordinates nobody can reach.
   */
  private targetDisplay(): Display {
    if (this.displayId) {
      const saved = screen.getAllDisplays().find((d) => String(d.id) === this.displayId);
      if (saved) return saved;
      // It is gone. Fall back *and* record where we actually ended up, so the
      // saved placement stops naming a monitor that no longer exists.
      this.displayId = undefined;
      const replacement = this.currentOrPrimary();
      this.displayId = String(replacement.id);
      this.savePlacement();
      return replacement;
    }
    return this.currentOrPrimary();
  }

  private currentOrPrimary(): Display {
    const win = this.win;
    if (win && !win.isDestroyed()) return screen.getDisplayMatching(win.getBounds());
    return screen.getPrimaryDisplay();
  }

  private workArea(): Rectangle {
    return this.targetDisplay().workArea;
  }

  private size(): Size {
    return SIZES[this.mode];
  }

  /** Where this window should be right now, for its anchor, size and display. */
  private targetBounds(): Rect {
    const size = this.size();
    const position = getAnchorPosition(this.anchor, this.workArea() as Rect, size, ANCHOR_MARGIN);
    return { ...position, ...size };
  }

  // ── one animation controller ─────────────────────────────────────────────
  //
  // Everything that moves the window goes through here, so two motions can
  // never run at once. There are exactly two kinds:
  //
  //   morph  — collapse/expand. The window is pinned to a stage that contains
  //            both shapes and does not resize at all; the surface inside is
  //            animated by the compositor, and the real bounds are synced once,
  //            at the end. That is what stops a collapse from being sixty
  //            window resizes in a row.
  //   snap   — flying to an anchor. Only the position changes, so there is
  //            nothing to relayout; a spring drives the bounds directly.

  private animation: OverlayAnimationState = 'expanded';
  private frameTimer: ReturnType<typeof setTimeout> | null = null;


  private morphPlan: MorphPlan | null = null;
  /** 1 = real time. The Animation Lab uses 0.25 to inspect a transition. */
  private timeScale = 1;
  /** The work-area-sized compositor stage lives for the life of this window. */
  private stage: Rect | null = null;
  private rendererHasStage = false;
  private transitionId = 0;
  private activeStageTransitionId: number | null = null;
  private isCommittingBounds = false;
  private expectedBounds: Rect | null = null;
  private commitTimer: ReturnType<typeof setTimeout> | null = null;
  private commitCallback: ((transitionId: number, bounds: Rect) => void) | null = null;

  private debugBounds(stage: string, extra: Record<string, unknown> = {}): void {
    if (!process.env.FOCUSREELS_DEBUG) return;
    const bounds = this.win && !this.win.isDestroyed() ? this.win.getBounds() : null;
    console.log(`[handoff] ${JSON.stringify({ t: performance.now(), transitionId: this.transitionId, stage, bounds, expectedBounds: this.expectedBounds, isCommittingBounds: this.isCommittingBounds, ...extra })}`);
  }

  private sameBounds(a: Rect, b: Rect): boolean {
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  }

  /**
   * `setBounds` may surface move and resize separately.  A renderer must never
   * observe either half: it receives one event only after all four fields have
   * reached the requested CSS-screen-pixel rectangle.
   */
  private commitBounds(expected: Rect, onCommitted: (transitionId: number, bounds: Rect) => void): number {
    const win = this.win;
    if (!win || win.isDestroyed()) return -1;
    const transitionId = this.activeStageTransitionId ?? ++this.transitionId;
    this.isCommittingBounds = true;
    this.expectedBounds = { ...expected };
    this.commitCallback = onCommitted;
    this.debugBounds('setBounds-requested', { expected });
    win.setBounds(expected);
    this.observeBoundsCommit(transitionId);
    return transitionId;
  }

  private observeBoundsCommit(transitionId: number): void {
    const win = this.win;
    const expected = this.expectedBounds;
    if (!win || win.isDestroyed() || !expected || transitionId !== this.transitionId) return;
    const actual = win.getBounds();
    this.debugBounds('bounds-observed', { actual });
    if (!this.sameBounds(actual, expected)) {
      if (this.commitTimer) clearTimeout(this.commitTimer);
      this.commitTimer = setTimeout(() => this.observeBoundsCommit(transitionId), FRAME_MS);
      return;
    }
    if (this.commitTimer) clearTimeout(this.commitTimer);
    this.commitTimer = null;
    const callback = this.commitCallback;
    this.commitCallback = null;
    this.isCommittingBounds = false;
    this.expectedBounds = null;
    this.debugBounds('bounds-committed', { actual });
    callback?.(transitionId, actual);
  }

  private cancelBoundsCommit(): void {
    // A fresh gesture owns the window. A delayed observation from the previous
    // handoff is no longer allowed to release its transform.
    ++this.transitionId;
    this.activeStageTransitionId = null;
    this.isCommittingBounds = false;
    this.expectedBounds = null;
    this.commitCallback = null;
    if (this.commitTimer) clearTimeout(this.commitTimer);
    this.commitTimer = null;
  }

  private setAnimation(next: OverlayAnimationState): void {
    if (this.animation === next) return;
    this.animation = next;
    this.emitState();
  }

  private get inMotion(): boolean {
    return (
      this.animation === 'collapsing' ||
      this.animation === 'expanding' ||
      this.animation === 'snapping'
    );
  }

  /** The resting animation state for the current mode. */
  private restState(): OverlayAnimationState {
    return this.mode === 'collapsed' ? 'collapsed' : 'expanded';
  }

  // ── the stage ────────────────────────────────────────────────────────────
  //
  // Dragging and the magnet both run here. The window is resized *once* to the
  // work area and then held still; the surface inside is moved by the
  // compositor. Before this, a snap was 24 setBounds calls and a drag 30 — each
  // one a native window move plus a relayout, which is what made the motion
  // stutter and the iframe flicker.

  private anchorCandidates(): readonly WindowAnchor[] {
    return this.settings.nineAnchors ? ANCHORS : CORNER_ANCHORS;
  }

  /** Hold the window at work-area size so the surface can move freely inside. */
  private enterStage(): StagePlan | null {
    const win = this.win;
    if (!win || win.isDestroyed()) return null;
    const work = this.workArea() as Rect;
    // This function must never resize the native window.  Changing transparent
    // BrowserWindow bounds is exactly what produced the empty frames in the
    // recording. The stage is made once in create() and is permanent.
    if (this.stage && this.stage.x === work.x && this.stage.y === work.y &&
        this.stage.width === work.width && this.stage.height === work.height) return null;
    const transitionId = ++this.transitionId;
    this.activeStageTransitionId = transitionId;
    this.stage = { ...work };
    const surface = this.targetBounds();
    return {
      transitionId,
      stage: this.stage,
      surface: {
        x: surface.x - work.x,
        y: surface.y - work.y,
        width: surface.width,
        height: surface.height,
      },
    };
  }

  /**
   * Hand the surface back to the native window.
   *
   * The order matters more than anything else here. `setBounds` is applied by
   * the window server, not by this renderer's next paint, so tearing down the
   * transform at the same moment leaves a frame where the surface is untranslated
   * inside a window that is still work-area sized. That one frame was the jump.
   * Instead the page keeps the last visual frame pinned and releases it only
   * once it has *observed* the new geometry.
   */
  private exitStage(finalRect: Rect): void {
    const win = this.win;
    if (!win || win.isDestroyed()) {
      this.stage = null;
      return;
    }
    const stage = this.stage;
    // Fractional values are for the compositor; the native bounds are integers,
    // rounded exactly once, here.
    const rect = {
      x: Math.round(finalRect.x),
      y: Math.round(finalRect.y),
      width: Math.round(finalRect.width),
      height: Math.round(finalRect.height),
    };

    this.trace('native-bounds-requested');
    this.commitBounds(rect, (transitionId, bounds) => {
      // This is deliberately the sole geometry message of the transaction.
      // In particular, no `move`/`resize` half-state reaches the renderer.
      const payload: BoundsCommitted = { transitionId, bounds };
      win.setHasShadow(true);
      win.setIgnoreMouseEvents(false);
      this.push(OVERLAY_CHANNELS.boundsCommitted, payload);
      this.stage = null;
      this.activeStageTransitionId = null;
      this.setAnimation(this.restState());
    });
  }

  /** Stage markers for one transition. Quiet unless FOCUSREELS_DEBUG is set. */
  private trace(stage: string): void {
    if (process.env.FOCUSREELS_DEBUG) console.log(`[transition] ${stage}`);
  }

  /**
   * The gesture is over. Pick the corner from where the surface is *heading*,
   * and hand the renderer a target to spring to — no window move here at all.
   */
  resolveSnap(surface: Rect, velocity: Velocity): void {
    const stage = this.stage;
    const win = this.win;
    if (!stage || !win || win.isDestroyed()) return;

    const screenRect = { ...surface, x: surface.x + stage.x, y: surface.y + stage.y };
    const projected = projectPosition(screenRect, velocity, projectionWindowMs(velocity));

    const display = screen.getDisplayMatching(screenRect);
    this.displayId = String(display.id);
    this.anchor = selectNearestAnchor(
      projected,
      display.workArea as Rect,
      { width: surface.width, height: surface.height },
      ANCHOR_MARGIN,
      this.anchorCandidates(),
    );
    this.savePlacement();
    this.setAnimation('snapping');

    // The gesture is over, so the mostly-empty stage must stop standing between
    // the user and their editor. `forward` still delivers mousemove, which is
    // what lets a press grab the surface back mid-flight.
    win.setIgnoreMouseEvents(true, { forward: true });

    const target = this.targetBounds();
    this.push(OVERLAY_CHANNELS.stageSnap, {
      target: { ...target, x: target.x - stage.x, y: target.y - stage.y },
      origin: anchorOrigin(this.anchor),
    });
  }

  /** The surface has settled: sync the real bounds, once. */
  onStageDone(): void {
    this.trace('spring-settled');
    // No exit: drag and snap share the same permanent compositor surface.
    this.setAnimation(this.restState());
  }

  /** The page has compensated and released the surface. */
  onTransitionComplete(): void {
    this.trace('transition-complete');
  }

  /** Move without a gesture — a display change, or a placement from settings. */
  private moveTo(target: Rect): void {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    if (this.stage) return; // a gesture owns the window; leave it alone
    win.setBounds(target);
    this.setAnimation(this.restState());
  }

  /** Drop whatever is moving, right where it is. Used when a drag takes over. */
  private stopMotion(): void {
    this.stopFrameLoop();
  }

  private stopFrameLoop(): void {
    if (this.frameTimer) clearTimeout(this.frameTimer);
    this.frameTimer = null;
  }

  // ── morph ────────────────────────────────────────────────────────────────

  /** Both shapes at the current anchor, and the stage that contains them. */
  private morphRects(): { stage: Rect; expanded: Rect; collapsed: Rect } {
    const work = this.workArea() as Rect;
    const expanded = {
      ...getAnchorPosition(this.anchor, work, SIZES.expanded, ANCHOR_MARGIN),
      ...SIZES.expanded,
    };
    const collapsed = {
      ...getAnchorPosition(this.anchor, work, SIZES.collapsed, ANCHOR_MARGIN),
      ...SIZES.collapsed,
    };
    // The renderer has one permanent work-area stage, so both shapes are
    // expressed in that same coordinate system. There is no native morph stage.
    return { stage: work, expanded, collapsed };
  }

  private beginMorph(to: WindowMode): void {
    const win = this.win;
    if (!win || win.isDestroyed()) {
      this.setAnimation(this.restState());
      return;
    }

    const targetProgress = to === 'collapsed' ? 1 : 0;

    // Already morphing: keep the surface exactly where it is and turn it
    // around. A second animation would fight the first and jump.
    if (this.animation === 'collapsing' || this.animation === 'expanding') {
      this.setAnimation(to === 'collapsed' ? 'collapsing' : 'expanding');
      this.push(OVERLAY_CHANNELS.morphRetarget, { to: targetProgress });
      if (process.env.FOCUSREELS_DEBUG) console.log(`[morph] retarget -> ${targetProgress}`);
      return;
    }

    this.stopMotion();

    const { stage, expanded, collapsed } = this.morphRects();
    const rel = (r: Rect): Rect => ({
      x: r.x - stage.x,
      y: r.y - stage.y,
      width: r.width,
      height: r.height,
    });

    const plan: MorphPlan = {
      stage,
      expanded: rel(expanded),
      collapsed: rel(collapsed),
      from: to === 'collapsed' ? 0 : 1,
      to: targetProgress,
      reducedMotion: this.reducedMotion,
    };
    this.morphPlan = plan;
    this.setAnimation(to === 'collapsed' ? 'collapsing' : 'expanding');
    if (process.env.FOCUSREELS_DEBUG) console.log(`[morph] begin -> ${targetProgress}`);
    void this.captureSurface();

    // The page lays out for the stage *before* the window is resized to it —
    // otherwise expanding would paint one frame of a 56px pill stranded in the
    // corner of a 326×720 window.
    this.push(OVERLAY_CHANNELS.morphBegin, plan);
  }

  /**
   * A cross-origin player repaints badly under a transform, so the morph runs
   * over a still of the current frame instead. Best-effort and time-boxed: if
   * the capture is slow the morph starts without it rather than stuttering.
   */
  private async captureSurface(): Promise<void> {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    try {
      const image = await Promise.race([
        win.webContents.capturePage(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 60)),
      ]);
      if (!image || image.isEmpty() || !this.morphPlan) return;
      this.push(OVERLAY_CHANNELS.snapshot, image.toDataURL());
    } catch {
      /* no still; the morph animates the live surface */
    }
  }

  /** The renderer has laid out for the stage: it is now safe to resize. */
  onMorphReady(): void {
    const plan = this.morphPlan;
    if (!plan) return;
    this.push(OVERLAY_CHANNELS.morphRun, null);
  }

  /** The surface has settled: sync the real bounds, once. */
  onMorphDone(): void {
    this.morphPlan = null;
    this.push(OVERLAY_CHANNELS.morphEnd, { mode: this.mode });
    this.setAnimation(this.restState());
  }

  // ── dragging and snapping ────────────────────────────────────────────────

  /**
   * A gesture begins. Every draggable surface goes through here: the pill and
   * the expanded window's control strip both move the same way, so a drag and
   * the magnet that follows it share one coordinate space.
   */
  beginDrag(): void {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    // A new gesture takes the window from whatever was moving it, right where
    // that motion had reached — no jump back to where it started.
    this.stopMotion();
    this.setAnimation('dragging');
    // The renderer already owns the permanent stage.  In particular, do not
    // setBounds() or send a late stage-enter that could reset its transform.
  }

  /**
   * While the pointer is down the surface must be reachable, so the stage stops
   * being click-through for the length of the gesture.
   */
  setStageInteractive(interactive: boolean): void {
    const win = this.win;
    if (!win || win.isDestroyed() || !this.stage) return;
    win.setIgnoreMouseEvents(!interactive, { forward: true });
  }

  // ── modes ────────────────────────────────────────────────────────────────

  get state(): OverlayState {
    return {
      mode: this.mode,
      anchor: this.anchor,
      animation: this.animation,
      animating: this.inMotion,
      reducedMotion: this.reducedMotion,
    };
  }

  private emitState(): void {
    this.push(OVERLAY_CHANNELS.stateChanged, this.state);
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
    this.emitState();
  }

  /**
   * The same window changes shape — never a second BrowserWindow — so the
   * player, the queue and the playback position all survive untouched.
   */
  setMode(mode: WindowMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.savePlacement();
    this.beginMorph(mode);
  }

  collapse(): void {
    this.setMode('collapsed');
  }

  expand(): void {
    this.setMode('expanded');
  }

  /**
   * Development only, and never reachable in a normal run: the Animation Lab
   * replays a transition on demand and can slow it down to look at it.
   */
  labCommand(command: string): void {
    if (command === 'collapse') return this.collapse();
    if (command === 'expand') return this.expand();
    if (command.startsWith('speed:')) {
      const value = Number(command.slice(6));
      this.timeScale = Number.isFinite(value) && value > 0 ? Math.min(4, value) : 1;
      this.push(OVERLAY_CHANNELS.animationLab, { enabled: true, timeScale: this.timeScale });
      return;
    }
    if (command.startsWith('snap:')) {
      const anchor = command.slice(5);
      if (!isAnchor(anchor)) return;
      this.anchor = anchor;
      this.savePlacement();
      this.animateToAnchor();
    }
  }

  /** Spring to the current anchor without a gesture (the Lab, mainly). */
  private animateToAnchor(): void {
    const plan = this.enterStage();
    if (plan) this.push(OVERLAY_CHANNELS.stageEnter, plan);
    const stage = this.stage;
    if (!stage) return;

    this.setAnimation('snapping');
    const target = this.targetBounds();
    this.push(OVERLAY_CHANNELS.stageSnap, {
      target: { ...target, x: target.x - stage.x, y: target.y - stage.y },
      origin: anchorOrigin(this.anchor),
    });
  }

  get labTimeScale(): number {
    return this.timeScale;
  }

  /** A display was added or removed: make sure we are still somewhere valid. */
  reconcileDisplays(): void {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    const before = this.displayId;
    const display = this.targetDisplay();
    this.displayId = String(display.id);
    if (before !== this.displayId) this.savePlacement();
    this.moveTo(this.targetBounds());
  }


  private create(): BrowserWindow {
    const initial = this.workArea();
    this.stage = { ...initial };
    const win = new BrowserWindow({
      width: initial.width,
      height: initial.height,
      x: initial.x,
      y: initial.y,
      // This native surface is deliberately work-area sized for its entire
      // lifetime. The visible panel is positioned solely in the renderer.
      useContentSize: true,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      frame: false,
      // Transparent so the collapsed state can be an actual floating circle
      // rather than a circle inside a visible 56px square. The expanded player
      // paints its own opaque, rounded background.
      transparent: true,
      backgroundColor: '#00000000',
      // macOS shapes the shadow to the alpha, so the pill gets a real circular
      // shadow and the expanded player a rounded one.
      hasShadow: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      // Focusable, because an embedded player has to be clickable — but shown
      // inactive, so appearing never steals the keyboard.
      focusable: true,
      acceptFirstMouse: true,
      webPreferences: {
        preload: join(__dirname, 'youtubePreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });

    win.setAlwaysOnTop(true, 'screen-saver', 1);
    win.setHasShadow(false);
    // The transparent work-area stage must never swallow IDE clicks. `forward`
    // keeps mousemove flowing to the renderer so it can opt back in above the
    // actual panel surface.
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // The player is a local renderer IFrame Player API instance.

    // Diagnostics only: these events may arrive as a position-only and then a
    // size-only update for one setBounds(). They are intentionally never
    // forwarded to the renderer or persisted while a commit is open.
    win.on('move', () => this.debugBounds('native-move'));
    win.on('moved', () => this.debugBounds('native-moved'));
    win.on('resize', () => this.debugBounds('native-resize'));
    win.on('resized', () => this.debugBounds('native-resized'));

    win.on('closed', () => {
      this.win = null;
      this.ready = false;
      this.stopMotion();
    });

    win.webContents.on('did-finish-load', () => {
      this.ready = true;
      this.rendererHasStage = false;
      this.emitState();
      // The page starts knowing nothing about mute or the scroll gesture, so
      // hand it the current settings before anything is shown.
      this.push('settings', {
        muted: this.settings.muted,
        scrollToChange: this.settings.scrollToChange,
        traceStages: Boolean(process.env.FOCUSREELS_DEBUG),
        debugFeed: Boolean(process.env.FOCUSREELS_DEBUG_FEED),
        e2e: process.env.NODE_ENV !== 'production' && Boolean(process.env.FOCUSREELS_E2E),
        failIds: process.env.NODE_ENV !== 'production' ? (process.env.FOCUSREELS_YOUTUBE_FAIL_IDS ?? '') : '',
        failCode: process.env.NODE_ENV !== 'production' ? Number(process.env.FOCUSREELS_YOUTUBE_FAIL_CODE ?? 100) : 100,
      });
      this.pushStageIfNeeded();
      // Gated on an environment variable, so the panel cannot reach a normal
      // run — there is no setting and no menu item that turns it on.
      if (process.env.FOCUSREELS_ANIM_LAB) {
        this.push(OVERLAY_CHANNELS.animationLab, { enabled: true, timeScale: this.timeScale });
      }
      if (this.pending) {
        this.push('show', this.pending);
        this.pending = null;
      }
    });

    // The page embeds YouTube in an iframe; nothing may open a new window, and
    // top-level navigation away from our own file is refused.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith('file://')) event.preventDefault();
    });

    if (process.env.FOCUSREELS_DEBUG || process.env.FOCUSREELS_DEBUG_FEED) {
      win.webContents.on('console-message', (_e, _level, message) => {
        const isFeed = message.startsWith('[feed]') || message.startsWith('[feed-trace]');
        if (process.env.FOCUSREELS_DEBUG_FEED ? isFeed : process.env.FOCUSREELS_DEBUG) console.log(message);
      });
    }
    if (process.env.NODE_ENV !== 'production' && process.env.FOCUSREELS_E2E) {
      const tracePath = join(process.env.FOCUSREELS_E2E_USER_DATA ?? '/tmp', 'feed-trace.jsonl');
      win.webContents.on('console-message', (_e, _level, message) => {
        if (message.startsWith('[feed-trace]')) {
          try { appendFileSync(tracePath, message.slice('[feed-trace]'.length) + '\n'); } catch { /* diagnostics only */ }
        }
      });
    }

    void win.loadFile(join(__dirname, 'renderer', 'youtube.html'));
    return win;
  }

  private push(channel: string, payload: unknown): void {
    if (this.win && !this.win.isDestroyed() && this.ready) {
      this.win.webContents.send(channel, payload);
    }
  }

  private pushStageIfNeeded(): void {
    if (!this.ready || this.rendererHasStage) return;
    const stage = this.stage;
    if (!stage) return;
    const surface = this.targetBounds();
    const plan: StagePlan = {
      transitionId: ++this.transitionId,
      stage: { ...stage },
      surface: { x: surface.x - stage.x, y: surface.y - stage.y, width: surface.width, height: surface.height },
    };
    this.activeStageTransitionId = plan.transitionId;
    this.rendererHasStage = true;
    this.push(OVERLAY_CHANNELS.stageEnter, plan);
  }

  /** Put the window exactly where its anchor says, with no animation. */
  private place(win: BrowserWindow): void {
    // Showing a resting panel must not reconfigure the native surface.
    this.pushStageIfNeeded();
  }

  show(status: PlayerStatus): void {
    if (!this.win || this.win.isDestroyed()) {
      this.win = this.create();
      this.ready = false;
    }
    const win = this.win;
    // A work area can change while we are hidden (a Dock appears, a display is
    // unplugged), so the anchor is resolved again on every show.
    if (!this.animating) this.place(win);

    if (this.ready) this.push('show', status);
    else this.pending = status;

    if (!win.isVisible()) win.showInactive();
    win.setAlwaysOnTop(true, 'screen-saver', 1);
  }

  updateStatus(status: PlayerStatus): void {
    this.push('status', status);
  }

  hide(): void {
    this.push('hide', null);
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide();
  }

  applySettings(settings: Settings): void {
    const previous = this.settings;
    this.settings = settings;
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    // This window is placed by its anchor, not by the overlay's corner setting;
    // a placement written by us is already applied, so re-reading it here would
    // only fight an animation in flight.
    if (previous.placement.anchor !== settings.placement.anchor && !this.inMotion) {
      this.adoptPlacement(settings.placement);
      this.moveTo(this.targetBounds());
    }
    this.push('settings', {
      muted: settings.muted,
      scrollToChange: settings.scrollToChange,
    });
  }

  /** Dev commands from the menu bar: 'next' | 'refresh'. */
  command(name: string): void {
    this.push('command', name);
  }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }

  get isVisible(): boolean {
    return Boolean(this.win && !this.win.isDestroyed() && this.win.isVisible());
  }
}
