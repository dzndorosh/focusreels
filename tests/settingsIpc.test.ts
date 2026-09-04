import { describe, expect, it } from 'vitest';
import { parseSettingsPatch } from '../src/app/settingsIpc.js';

describe('Settings window IPC validation', () => {
  it('keeps only known, well-formed settings fields', () => {
    expect(parseSettingsPatch({ enabled: false, muted: false, alwaysOnTop: false, launchAtLogin: true, width: 320, regionCode: 'by', secret: 'nope' })).toEqual({
      enabled: false,
      muted: false,
      alwaysOnTop: false,
      launchAtLogin: true,
      width: 320,
      regionCode: 'BY',
    });
  });

  it('rejects an empty or malformed patch', () => {
    expect(parseSettingsPatch({ player: 'something-else', muted: 'false' })).toBeNull();
    expect(parseSettingsPatch(['muted'])).toBeNull();
  });
});
