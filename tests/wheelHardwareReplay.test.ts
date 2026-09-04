import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WheelGestureRecognizer } from '../src/app/renderer/wheelGesture.js';

type Fixture = {
  schemaVersion: 1;
  events: Array<{ gapMs: number; deltaX: number; deltaY: number; deltaMode: number }>;
};

const bundledFixturePath = join(process.cwd(), 'tests', 'fixtures', 'physical-strong-flick.min.json');
const fixturePath = process.env.FOCUSREELS_WHEEL_FIXTURE ?? bundledFixturePath;
const fixture = existsSync(fixturePath) ? JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture : null;
const runtimeCapturePath = process.env.FOCUSREELS_WHEEL_RUNTIME_CAPTURE;
const normalFixture: Fixture | null = runtimeCapturePath && existsSync(runtimeCapturePath)
  ? {
      schemaVersion: 1,
      events: readFileSync(runtimeCapturePath, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
        try {
          const event = JSON.parse(line);
          return event.marker === 'normal-flick'
            ? [{ gapMs: Number.isFinite(event.gapMs) ? event.gapMs : 0, deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode }]
            : [];
        } catch { return []; }
      }),
    }
  : null;

function replayThroughController(input: Fixture): Array<'next' | 'previous'> {
  const recognizer = new WheelGestureRecognizer();
  let now = 0;
  let transitionEndsAt = -1;
  const commits: Array<'next' | 'previous'> = [];
  for (const event of input.events) {
    now += Math.max(0, event.gapMs);
    // This mirrors the renderer contract: the recognizer sees every event,
    // but a committed transition holds its lock for the 320ms slide.
    const result = recognizer.handle(event, now, { holdLock: now < transitionEndsAt });
    if (result.type === 'commit') {
      commits.push(result.direction as 'next' | 'previous');
      transitionEndsAt = now + 320;
    }
  }
  return commits;
}

describe('captured physical wheel replay', () => {
  const replay = fixture ? it : it.skip;

  replay('does not commit twice for one physical strong flick', () => {
    expect(fixture?.schemaVersion).toBe(1);
    // Before the temporal boundary fix, this assertion receives exactly two
    // commits: the expected first one and the false same-direction re-arm.
    expect(replayThroughController(fixture!)).toEqual(['next']);
  });

  const normalReplay = normalFixture?.events.length ? it : it.skip;
  normalReplay('keeps the captured normal flick to one commit', () => {
    expect(replayThroughController(normalFixture!)).toEqual(['next']);
  });
});
