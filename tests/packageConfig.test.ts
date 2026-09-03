import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

describe('macOS package configuration', () => {
  it('ships a DMG, the offline catalog, and adapter installer resources', () => {
    expect(packageJson.scripts['dist:mac']).toContain('CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --mac dmg --arm64');
    expect(packageJson.build.appId).toBe('com.dzndorosh.focusreels');
    expect(packageJson.build.files).toContain('config/youtube-catalog.json');
    expect(packageJson.build.extraResources).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'adapters', to: 'adapters' }),
    ]));
    expect(existsSync(join(root, 'adapters', 'install.sh'))).toBe(true);
  });
});
