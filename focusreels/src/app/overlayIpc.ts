/**
 * The typed contract between the feed window's renderer and the main process.
 *
 * The renderer never touches a BrowserWindow: it sends one of these commands
 * and is told the resulting state. Both sides import this file, so a payload
 * that changes shape breaks the build rather than the app.
 */

import type { Rect, WindowAnchor, WindowMode } from './anchors.js';

/**
 * One controller, one state. Everything the window can be doing is here, so two
 * motions can never run at once.
 */
export type OverlayAnimationState =
  | 'expanded'
  | 'collapsing'
  | 'collapsed'
  | 'expanding'
  | 'dragging'
  | 'snapping';

/** What the renderer knows about its own window. */
export interface OverlayState {
  mode: WindowMode;
  anchor: WindowAnchor;
  animation: OverlayAnimationState;
  /** true while a morph or a magnet move is running */
  animating: boolean;
  /** mirrors the OS setting, so the UI can drop its own transitions too */
  reducedMotion: boolean;
}

/**
 * The stage a morph plays inside. While it runs the window is held at
 * `stage` and nothing resizes — the surface is moved by the compositor, and
 * the real bounds are synced once, at the end.
 *
 * All rectangles are relative to the stage's top-left.
 */
export interface MorphPlan {
  stage: Rect;
  /** the 326×720 surface, in stage coordinates */
  expanded: Rect;
  /** the 56×56 pill, in stage coordinates */
  collapsed: Rect;
  /** 0 = expanded, 1 = collapsed */
  from: number;
  to: number;
  reducedMotion: boolean;
}

export const OVERLAY_CHANNELS = {
  collapse: 'overlay:collapse',
  expand: 'overlay:expand',
  close: 'overlay:close',
  getState: 'overlay:get-state',
  stateChanged: 'overlay:state-changed',
  reducedMotion: 'overlay:reduced-motion',
  morphBegin: 'overlay:morph-begin',
  morphReady: 'overlay:morph-ready',
  morphRun: 'overlay:morph-run',
  morphRetarget: 'overlay:morph-retarget',
  morphDone: 'overlay:morph-done',
  morphEnd: 'overlay:morph-end',
  snapshot: 'overlay:snapshot',
  animationLab: 'overlay:animation-lab',
  labCommand: 'overlay:lab-command',
  stageEnter: 'overlay:stage-enter',
  stageSnap: 'overlay:stage-snap',
  stageExit: 'overlay:stage-exit',
  boundsCommitted: 'overlay:bounds-committed',
  stageDone: 'overlay:stage-done',
  transitionComplete: 'overlay:transition-complete',
  dragStart: 'overlay:drag-start',
  dragMove: 'overlay:drag-move',
  dragEnd: 'overlay:drag-end',
} as const;

/** The one atomic acknowledgement for a programmatic native-bounds handoff. */
export interface BoundsCommitted {
  transitionId: number;
  bounds: Rect;
}

/**
 * Screen-space delta since the drag began.
 *
 * The collapsed pill has to be both draggable and clickable, and a native
 * `-webkit-app-region: drag` swallows the click — so that one control drives
 * the move itself and the main process applies the offset.
 */
export interface DragDelta {
  dx: number;
  dy: number;
}

/**
 * A drag and its magnet run inside a *stage*: the window is resized once to the
 * work area, and the surface is moved by the compositor alone. That is what
 * keeps a gesture and the snap that follows it in one coordinate space — there
 * is no handover, so there is nothing for a velocity to jump across.
 *
 * Every rectangle is relative to the stage's top-left.
 */
export interface StagePlan {
  /** Guards renderer callbacks from a previous drag/snap handoff. */
  transitionId: number;
  stage: Rect;
  /** where the surface is right now */
  surface: Rect;
}

/** Main's answer to a released drag: where the magnet wants the surface. */
export interface StageSnap {
  target: Rect;
  /** the corner it is heading for, so the surface can lean into it */
  origin: { x: string; y: string };
}
