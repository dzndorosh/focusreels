import { describe, expect, it, vi } from 'vitest';
import { enableDesktopApp } from '../src/app/appMode.js';

describe('desktop app mode', () => {
  it('keeps FocusReels visible in the Dock and uses normal app activation', () => {
    const show = vi.fn();
    const setActivationPolicy = vi.fn();

    enableDesktopApp({ dock: { show }, setActivationPolicy });

    expect(show).toHaveBeenCalledOnce();
    expect(setActivationPolicy).toHaveBeenCalledWith('regular');
  });

  it('works in non-macOS test environments without a Dock API', () => {
    expect(() => enableDesktopApp({})).not.toThrow();
  });
});
