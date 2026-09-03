import { describe, expect, it } from 'vitest';
import { PlayerCoordinator, type PlayerStatus, type PlayerSurface } from '../src/app/playerCoordinator.js';

const status: PlayerStatus = { source: 'cursor', startedAt: 1, parallel: 1 };

function surface() {
  const calls: string[] = [];
  const value: PlayerSurface = {
    isVisible: false,
    show: () => calls.push('show'),
    hide: () => calls.push('hide'),
    updateStatus: () => calls.push('status'),
  };
  return { calls, value };
}

describe('PlayerCoordinator', () => {
  it('moves an active session to a newly selected player', () => {
    const local = surface();
    const youtube = surface();
    const coordinator = new PlayerCoordinator(
      { local: local.value, youtube: youtube.value },
      'local',
    );

    coordinator.sync(true, status);
    coordinator.switchTo('youtube', true, status);

    expect(local.calls).toEqual(['show', 'hide']);
    expect(youtube.calls).toEqual(['show']);
  });

  it('keeps the newly selected player hidden when no active turn exists', () => {
    const local = surface();
    const youtube = surface();
    const coordinator = new PlayerCoordinator(
      { local: local.value, youtube: youtube.value },
      'youtube',
    );

    coordinator.switchTo('local', false, null);

    expect(youtube.calls).toEqual(['hide']);
    expect(local.calls).toEqual(['hide']);
  });
});
