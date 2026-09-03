import { describe, expect, it } from 'vitest';
import { DEFAULT_CATALOG_URL, catalogUrl } from '../src/youtube/catalogUrl.js';

describe('catalogUrl', () => {
  it('falls back to the shipped default when nothing is set', () => {
    expect(catalogUrl({})).toBe(DEFAULT_CATALOG_URL);
  });

  it('lets an operator point the app somewhere else', () => {
    expect(catalogUrl({ FOCUSREELS_REMOTE_CATALOG_URL: 'https://example.test/c.json' })).toBe(
      'https://example.test/c.json',
    );
  });

  it('treats an empty or blank override as unset', () => {
    // A shell hands over an unset variable as an empty string. Reading that as
    // "fetch nothing" would silently leave the user with no feed.
    expect(catalogUrl({ FOCUSREELS_REMOTE_CATALOG_URL: '' })).toBe(DEFAULT_CATALOG_URL);
    expect(catalogUrl({ FOCUSREELS_REMOTE_CATALOG_URL: '   ' })).toBe(DEFAULT_CATALOG_URL);
  });

  it('trims a stray newline off an override', () => {
    expect(catalogUrl({ FOCUSREELS_REMOTE_CATALOG_URL: 'https://example.test/c.json\n' })).toBe(
      'https://example.test/c.json',
    );
  });

  it('ships a syntactically valid https default', () => {
    // A typo here breaks every install and no other test would catch it.
    const parsed = new URL(DEFAULT_CATALOG_URL);
    expect(parsed.protocol).toBe('https:');
    expect(DEFAULT_CATALOG_URL.endsWith('.json')).toBe(true);
  });
});
