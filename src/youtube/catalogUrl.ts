/**
 * Where the app fetches its published catalog from.
 *
 * A packaged .app has no environment, so the URL cannot come from one: it is
 * compiled in, and the environment variable exists only so a developer can
 * point a build at their own copy.
 */

/** Published daily by .github/workflows/youtube-catalog.yml. */
export const DEFAULT_CATALOG_URL =
  'https://dzndorosh.github.io/focusreels/catalog/youtube-catalog.json';

export function catalogUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.FOCUSREELS_REMOTE_CATALOG_URL?.trim();
  // An empty override is an unset variable, not a request for no feed.
  return override && override.length > 0 ? override : DEFAULT_CATALOG_URL;
}
