# Repository recovery and migration

## Canonical repository

`dzndorosh/focusreels` is the active repository. It retains the newer adapter,
turn-lifecycle, source-policy, diagnostics, and packaged-adapter architecture.
The older local checkout is preserved separately as an immutable recovery
source; it is not a second active implementation.

## Selective migration

The two repositories have unrelated Git roots, so a merge would make it hard to
review which behaviour won. Features were compared against the current runtime
chain and transferred only where they were absent and still safe:

| Previous capability | Current disposition |
| --- | --- |
| Master enable switch | Restored in `settings.json`, Settings, and the tray; it cancels open turns through `TurnRegistry` and refuses future starts. |
| Always-on-top preference | Restored in `settings.json`, Settings, tray, and both player surfaces. |
| Launch at login | Restored as an explicit macOS preference, off by default. |
| Core Audio activity probe | Restored as `npm run diagnose:audio`, diagnostic-only. |
| Native scrolling | Already superseded by the current scroll-to-change gesture and its tests; not duplicated. |
| Control Center | Superseded by the current Dock-reachable Settings window; its missing controls were added there. |
| Automatic external-audio muting | Not migrated. The old project's own backlog identifies its signal as unvalidated; enabling it would cause unreliable audio behaviour. |

## Recovery rule

Never overwrite the active repository with the old checkout. Preserve the old
history in an archive remote and port any future capability in a reviewed,
tested commit.
