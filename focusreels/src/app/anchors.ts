/**
 * Window placement geometry. Deliberately free of Electron: it takes plain
 * rectangles and returns plain coordinates, so every rule here is testable
 * without a display, a window, or a running app.
 */

export type WindowMode = 'expanded' | 'collapsed';

export type WindowAnchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export const ANCHORS: readonly WindowAnchor[] = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

/**
 * The four corners — what system Picture in Picture snaps to, and the default
 * here. The full nine-point grid stays available as a setting.
 */
export const CORNER_ANCHORS: readonly WindowAnchor[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];

/** First run parks the window here. */
export const DEFAULT_ANCHOR: WindowAnchor = 'bottom-right';

/** Distance kept from every edge of the work area. */
export const ANCHOR_MARGIN = 16;

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface SavedWindowPlacement {
  anchor: WindowAnchor;
  displayId?: string;
  mode: WindowMode;
}

export function isAnchor(value: unknown): value is WindowAnchor {
  return typeof value === 'string' && (ANCHORS as readonly string[]).includes(value);
}

export function isMode(value: unknown): value is WindowMode {
  return value === 'expanded' || value === 'collapsed';
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function columnOf(anchor: WindowAnchor): 'start' | 'center' | 'end' {
  if (anchor.endsWith('-left')) return 'start';
  if (anchor.endsWith('-right')) return 'end';
  return 'center';
}

function rowOf(anchor: WindowAnchor): 'start' | 'center' | 'end' {
  if (anchor.startsWith('top-')) return 'start';
  if (anchor.startsWith('bottom-')) return 'end';
  return 'center';
}

/**
 * Where an anchor puts a window of this size inside this work area.
 *
 * The work area already excludes the macOS menu bar and the Dock, so honouring
 * it is what keeps the window clear of both. The result is clamped, so a window
 * taller or wider than the space available is pinned inside rather than allowed
 * to hang off an edge.
 */
export function getAnchorPosition(
  anchor: WindowAnchor,
  workArea: Rect,
  windowSize: Size,
  margin: number = ANCHOR_MARGIN,
): Point {
  // With no room for the margin on both sides, split what there is.
  const usableWidth = workArea.width - windowSize.width;
  const usableHeight = workArea.height - windowSize.height;
  const mx = Math.min(margin, Math.max(0, usableWidth / 2));
  const my = Math.min(margin, Math.max(0, usableHeight / 2));

  const column = columnOf(anchor);
  const row = rowOf(anchor);

  const x =
    column === 'start'
      ? workArea.x + mx
      : column === 'end'
        ? workArea.x + workArea.width - windowSize.width - mx
        : workArea.x + (workArea.width - windowSize.width) / 2;

  const y =
    row === 'start'
      ? workArea.y + my
      : row === 'end'
        ? workArea.y + workArea.height - windowSize.height - my
        : workArea.y + (workArea.height - windowSize.height) / 2;

  return clampToWorkArea({ x: Math.round(x), y: Math.round(y) }, workArea, windowSize);
}

/**
 * Keeps a window fully inside a work area. If the window is larger than the
 * area, its top-left corner wins — a window hanging off the bottom-right is
 * recoverable, one whose title area is off-screen is not.
 */
export function clampToWorkArea(position: Point, workArea: Rect, windowSize: Size): Point {
  const maxX = workArea.x + workArea.width - windowSize.width;
  const maxY = workArea.y + workArea.height - windowSize.height;
  return {
    x: Math.round(clamp(position.x, workArea.x, Math.max(workArea.x, maxX))),
    y: Math.round(clamp(position.y, workArea.y, Math.max(workArea.y, maxY))),
  };
}

/** True when every edge of the window sits inside the work area. */
export function isInsideWorkArea(bounds: Rect, workArea: Rect): boolean {
  return (
    bounds.x >= workArea.x &&
    bounds.y >= workArea.y &&
    bounds.x + bounds.width <= workArea.x + workArea.width &&
    bounds.y + bounds.height <= workArea.y + workArea.height
  );
}

/**
 * The anchor whose slot the window landed nearest, compared centre to centre.
 *
 * Centres rather than corners, because a corner comparison makes the window's
 * own size decide the winner: dragging a 720-tall window to the middle of the
 * screen would otherwise read as "top".
 */
export function nearestAnchor(
  bounds: Rect,
  workArea: Rect,
  margin: number = ANCHOR_MARGIN,
  candidates: readonly WindowAnchor[] = ANCHORS,
): WindowAnchor {
  const size = { width: bounds.width, height: bounds.height };
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;

  let best: WindowAnchor = candidates[0] ?? DEFAULT_ANCHOR;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const anchor of candidates) {
    const p = getAnchorPosition(anchor, workArea, size, margin);
    const dx = p.x + size.width / 2 - cx;
    const dy = p.y + size.height / 2 - cy;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = anchor;
    }
  }
  return best;
}

/**
 * The anchor nearest a *point* — the window's top-left, usually a position
 * projected forward from the release velocity rather than the release itself.
 * That projection is what makes a flick land where it was thrown.
 */
export function selectNearestAnchor(
  projectedPosition: Point,
  workArea: Rect,
  windowSize: Size,
  margin: number = ANCHOR_MARGIN,
  candidates: readonly WindowAnchor[] = CORNER_ANCHORS,
): WindowAnchor {
  return nearestAnchor({ ...projectedPosition, ...windowSize }, workArea, margin, candidates);
}

/** Which corner a surface is heading for — the transform origin of a morph. */
export function anchorOrigin(anchor: WindowAnchor): { x: '0%' | '50%' | '100%'; y: '0%' | '50%' | '100%' } {
  const x = anchor.endsWith('-left') ? '0%' : anchor.endsWith('-right') ? '100%' : '50%';
  const y = anchor.startsWith('top-') ? '0%' : anchor.startsWith('bottom-') ? '100%' : '50%';
  return { x, y };
}

/**
 * The smallest rectangle containing both — the stage a morph plays inside.
 *
 * Holding the window at this size for the length of the transition is what lets
 * the surface be animated by the compositor instead of by resizing the window
 * sixty times a second.
 */
export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** Eased 0…1 progress — fast first, settling at the end. */
export function easeOutCubic(t: number): number {
  const p = clamp(t, 0, 1);
  return 1 - Math.pow(1 - p, 3);
}

/** One frame of an interpolated bounds animation. */
export function interpolateRect(from: Rect, to: Rect, t: number): Rect {
  const e = easeOutCubic(t);
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * e);
  return {
    x: lerp(from.x, to.x),
    y: lerp(from.y, to.y),
    width: lerp(from.width, to.width),
    height: lerp(from.height, to.height),
  };
}
