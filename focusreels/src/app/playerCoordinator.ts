/**
 * Chooses the one playback surface that represents the registry's visibility.
 *
 * Keeping this policy outside Electron's composition root makes mode switches
 * deterministic: changing player while a turn is active must move the visible
 * session to the newly selected window, not leave both hidden.
 */

import type { PlayerMode } from './settings.js';

export interface PlayerStatus {
  source: string;
  startedAt: number;
  parallel: number;
}

export interface PlayerSurface {
  show(status: PlayerStatus): void;
  hide(): void;
  updateStatus(status: PlayerStatus): void;
  readonly isVisible: boolean;
}

export interface PlayerSurfaces {
  local: PlayerSurface;
  youtube: PlayerSurface;
}

export class PlayerCoordinator {
  private mode: PlayerMode;

  constructor(
    private readonly surfaces: PlayerSurfaces,
    initialMode: PlayerMode,
  ) {
    this.mode = initialMode;
  }

  get active(): PlayerSurface {
    return this.surfaces[this.mode];
  }

  sync(visible: boolean, status: PlayerStatus | null): void {
    if (visible && status) this.active.show(status);
    else this.active.hide();
  }

  updateStatus(status: PlayerStatus | null): void {
    if (status && this.active.isVisible) this.active.updateStatus(status);
  }

  switchTo(next: PlayerMode, visible: boolean, status: PlayerStatus | null): void {
    if (next === this.mode) return;
    this.active.hide();
    this.mode = next;
    this.sync(visible, status);
  }
}
