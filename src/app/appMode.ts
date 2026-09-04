/**
 * FocusReels has two kinds of windows: passive video overlays and ordinary
 * application UI.  The overlays must never activate the app, but the app
 * itself must remain a normal macOS app so its Settings window is reachable
 * from the Dock.
 */
export interface MacDesktopApp {
  dock?: { show(): void };
  setActivationPolicy?(policy: 'regular'): void;
}

export function enableDesktopApp(app: MacDesktopApp): void {
  app.dock?.show();
  app.setActivationPolicy?.('regular');
}
