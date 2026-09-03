import { describe, expect, it } from 'vitest';
import {
  ANCHORS,
  ANCHOR_MARGIN,
  clampToWorkArea,
  easeOutCubic,
  getAnchorPosition,
  interpolateRect,
  isAnchor,
  isInsideWorkArea,
  isMode,
  ANCHORS as ALL_ANCHORS,
  CORNER_ANCHORS,
  nearestAnchor,
  selectNearestAnchor,
  unionRect,
  type Rect,
  type WindowAnchor,
} from '../src/app/anchors.js';

/** A macOS-shaped work area: menu bar above it, Dock below it. */
const WORK: Rect = { x: 0, y: 25, width: 1440, height: 815 };
const EXPANDED = { width: 326, height: 720 };
const COLLAPSED = { width: 56, height: 56 };

describe('getAnchorPosition', () => {
  it('puts a corner anchor exactly one margin from both edges', () => {
    expect(getAnchorPosition('top-left', WORK, COLLAPSED)).toEqual({ x: 16, y: 41 });
    expect(getAnchorPosition('bottom-right', WORK, COLLAPSED)).toEqual({
      x: 1440 - 56 - 16,
      y: 25 + 815 - 56 - 16,
    });
  });

  it('centres the centre anchors on the axis that has no edge', () => {
    const top = getAnchorPosition('top-center', WORK, COLLAPSED);
    expect(top.x).toBe(Math.round((1440 - 56) / 2));
    expect(top.y).toBe(41);

    const middleRight = getAnchorPosition('middle-right', WORK, COLLAPSED);
    expect(middleRight.x).toBe(1440 - 56 - 16);
    expect(middleRight.y).toBe(Math.round(25 + (815 - 56) / 2));
  });

  it('respects a work area that does not start at the origin', () => {
    const second: Rect = { x: -1920, y: 0, width: 1920, height: 1080 };
    const p = getAnchorPosition('top-left', second, EXPANDED);
    expect(p).toEqual({ x: -1904, y: 16 });
  });

  it('never places any anchor even partly outside the work area', () => {
    for (const anchor of ANCHORS) {
      for (const size of [EXPANDED, COLLAPSED]) {
        const p = getAnchorPosition(anchor, WORK, size);
        expect(isInsideWorkArea({ ...p, ...size }, WORK)).toBe(true);
      }
    }
  });

  it('pins a window taller than the work area instead of letting it hang off', () => {
    const shallow: Rect = { x: 0, y: 25, width: 1440, height: 500 };
    const p = getAnchorPosition('bottom-right', shallow, EXPANDED);
    expect(p.y).toBe(25); // top edge wins — a lost top edge is unrecoverable
    expect(p.x).toBeLessThanOrEqual(1440 - 326);
  });

  it('splits the space when there is not room for a full margin', () => {
    const tight: Rect = { x: 0, y: 0, width: 336, height: 740 };
    const p = getAnchorPosition('top-left', tight, EXPANDED);
    expect(p.x).toBe(5); // (336 − 326) / 2
  });
});

describe('nearestAnchor', () => {
  const at = (anchor: WindowAnchor, size = COLLAPSED) => ({
    ...getAnchorPosition(anchor, WORK, size),
    ...size,
  });

  it('returns the anchor a window is already sitting on', () => {
    for (const anchor of ANCHORS) {
      expect(nearestAnchor(at(anchor), WORK)).toBe(anchor);
    }
  });

  it('still returns it after a small nudge', () => {
    for (const anchor of ANCHORS) {
      const b = at(anchor);
      expect(nearestAnchor({ ...b, x: b.x + 12, y: b.y - 9 }, WORK)).toBe(anchor);
    }
  });

  it('compares centres, so a tall window dropped mid-screen reads as middle', () => {
    const centred = {
      x: Math.round((1440 - 326) / 2),
      y: Math.round(25 + (815 - 720) / 2),
      ...EXPANDED,
    };
    expect(nearestAnchor(centred, WORK)).toBe('center');
  });

  it('picks a corner for a window dragged into that corner', () => {
    expect(nearestAnchor({ x: 4, y: 30, ...COLLAPSED }, WORK)).toBe('top-left');
    expect(nearestAnchor({ x: 1400, y: 800, ...COLLAPSED }, WORK)).toBe('bottom-right');
  });

  it('works on a second display with negative coordinates', () => {
    const left: Rect = { x: -1920, y: 0, width: 1920, height: 1080 };
    const b = { ...getAnchorPosition('bottom-left', left, COLLAPSED), ...COLLAPSED };
    expect(nearestAnchor(b, left)).toBe('bottom-left');
  });
});

describe('selectNearestAnchor — the projected-point form', () => {
  it('magnets to the four corners by default, as system PiP does', () => {
    expect(CORNER_ANCHORS).toHaveLength(4);
    for (const anchor of CORNER_ANCHORS) {
      const p = getAnchorPosition(anchor, WORK, COLLAPSED);
      expect(selectNearestAnchor(p, WORK, COLLAPSED)).toBe(anchor);
    }
  });

  it('never returns an edge or centre position with the default candidates', () => {
    // Dropped dead centre, it still has to choose a corner.
    const middle = { x: (1440 - 56) / 2, y: 25 + (815 - 56) / 2 };
    expect(CORNER_ANCHORS).toContain(selectNearestAnchor(middle, WORK, COLLAPSED));
  });

  it('uses all nine when the setting asks for them', () => {
    for (const anchor of ALL_ANCHORS) {
      const p = getAnchorPosition(anchor, WORK, COLLAPSED);
      expect(selectNearestAnchor(p, WORK, COLLAPSED, ANCHOR_MARGIN, ALL_ANCHORS)).toBe(anchor);
    }
  });

  it('follows the projection, not the release point', () => {
    // Released left of centre but thrown hard right: the projected point is
    // what decides, and it lands on the right-hand side.
    expect(selectNearestAnchor({ x: 300, y: 700 }, WORK, COLLAPSED)).toBe('bottom-left');
    expect(selectNearestAnchor({ x: 1300, y: 700 }, WORK, COLLAPSED)).toBe('bottom-right');
  });
});

describe('unionRect', () => {
  it('covers both rectangles exactly', () => {
    const u = unionRect({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 5, width: 10, height: 10 });
    expect(u).toEqual({ x: 0, y: 0, width: 30, height: 15 });
  });

  it('returns the outer one when nested', () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    expect(unionRect(outer, { x: 10, y: 10, width: 10, height: 10 })).toEqual(outer);
  });

  it('spans an expanded and a collapsed window at the same anchor', () => {
    const big = { ...getAnchorPosition('bottom-right', WORK, EXPANDED), ...EXPANDED };
    const small = { ...getAnchorPosition('bottom-right', WORK, COLLAPSED), ...COLLAPSED };
    const u = unionRect(big, small);
    expect(isInsideWorkArea(u, WORK)).toBe(true);
    // Same anchor, so the small one nests inside the big one's corner.
    expect(u).toEqual(big);
  });
});

describe('clampToWorkArea', () => {
  it('pulls a window back from beyond every edge', () => {
    expect(clampToWorkArea({ x: -500, y: -500 }, WORK, COLLAPSED)).toEqual({ x: 0, y: 25 });
    expect(clampToWorkArea({ x: 9999, y: 9999 }, WORK, COLLAPSED)).toEqual({
      x: 1440 - 56,
      y: 25 + 815 - 56,
    });
  });

  it('leaves a window that is already inside alone', () => {
    expect(clampToWorkArea({ x: 100, y: 100 }, WORK, COLLAPSED)).toEqual({ x: 100, y: 100 });
  });
});

describe('mode and anchor guards', () => {
  it('accepts only the nine anchors and two modes', () => {
    expect(ANCHORS).toHaveLength(9);
    expect(isAnchor('middle-right')).toBe(true);
    expect(isAnchor('middle-centre')).toBe(false);
    expect(isAnchor(null)).toBe(false);
    expect(isMode('collapsed')).toBe(true);
    expect(isMode('minimised')).toBe(false);
  });
});

describe('animation helpers', () => {
  it('eases out, and is pinned at both ends', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5); // fast first
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });

  it('interpolates position and size together, landing exactly on the target', () => {
    const from = { x: 0, y: 0, width: 326, height: 720 };
    const to = { x: 100, y: 200, width: 56, height: 56 };
    expect(interpolateRect(from, to, 0)).toEqual(from);
    expect(interpolateRect(from, to, 1)).toEqual(to);

    const mid = interpolateRect(from, to, 0.5);
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThan(100);
    expect(mid.width).toBeLessThan(326);
    expect(mid.height).toBeLessThan(720);
  });
});

describe('the two sizes share an anchor', () => {
  it('recomputes coordinates for the same anchor after a resize', () => {
    for (const anchor of ANCHORS) {
      const big = getAnchorPosition(anchor, WORK, EXPANDED);
      const small = getAnchorPosition(anchor, WORK, COLLAPSED);
      expect(isInsideWorkArea({ ...big, ...EXPANDED }, WORK)).toBe(true);
      expect(isInsideWorkArea({ ...small, ...COLLAPSED }, WORK)).toBe(true);
      // A right-hand anchor keeps its right edge one margin in, at either size.
      if (anchor.endsWith('-right')) {
        expect(big.x + EXPANDED.width).toBe(WORK.x + WORK.width - ANCHOR_MARGIN);
        expect(small.x + COLLAPSED.width).toBe(WORK.x + WORK.width - ANCHOR_MARGIN);
      }
    }
  });
});
