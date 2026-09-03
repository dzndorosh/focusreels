import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * A Unix domain socket, not a TCP port: nothing on the network can reach the
 * broker, and file permissions (0600) keep it to the logged-in user.
 * Override with FOCUSREELS_SOCKET when running two instances side by side.
 */
export function socketPath(): string {
  const override = process.env.FOCUSREELS_SOCKET;
  if (override && override.length > 0) return override;
  return join(supportDir(), 'broker.sock');
}

export function supportDir(): string {
  if (process.env.NODE_ENV !== 'production' && process.env.FOCUSREELS_E2E_USER_DATA) {
    const p = process.env.FOCUSREELS_E2E_USER_DATA;
    if (p.startsWith('/') && !p.includes('..')) return p;
  }
  return join(homedir(), 'Library', 'Application Support', 'FocusReels');
}

export function settingsPath(): string {
  return join(supportDir(), 'settings.json');
}

export function mediaDir(): string {
  const override = process.env.FOCUSREELS_MEDIA_DIR;
  if (override && override.length > 0) return override;
  return join(supportDir(), 'media');
}
