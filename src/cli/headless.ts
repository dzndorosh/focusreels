#!/usr/bin/env node
/**
 * focusreels headless — the whole pipeline except the window.
 *
 * Runs the broker and the registry and prints what the overlay *would* do.
 * Useful for testing an IDE adapter without launching Electron, and for
 * checking that no adapter is leaking anything past the sanitizer.
 */

import { EventBroker } from '../broker/server.js';
import { DEFAULT_REGISTRY_CONFIG, TurnRegistry } from '../core/turnRegistry.js';

const stamp = () => new Date().toLocaleTimeString();

const registry = new TurnRegistry({
  getConfig: () => ({
    ...DEFAULT_REGISTRY_CONFIG,
    showDelayMs: Number(process.env.FOCUSREELS_DELAY ?? 500),
  }),
  onVisibilityChange: (visible) => {
    process.stdout.write(`${stamp()}  ${visible ? '>>> SHOW overlay' : '<<< HIDE overlay'}\n`);
  },
  onTurnChange: (info) => {
    process.stdout.write(
      `${stamp()}  ${info.source}#${info.turnId} -> ${info.state}` +
        `${info.outcome ? ` (${info.outcome})` : ''}\n`,
    );
  },
});

const broker = new EventBroker({
  onEvent: (event) => registry.dispatch(event),
  onRejected: (reason) => process.stdout.write(`${stamp()}  dropped: ${reason}\n`),
});

broker
  .start()
  .then(() => process.stdout.write(`listening on ${broker.address}\nCtrl+C to stop\n`))
  .catch((err: unknown) => {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exit(1);
  });

const shutdown = () => {
  registry.cancelAll('ide_closed');
  void broker.stop().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
