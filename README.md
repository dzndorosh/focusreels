# FocusReels

An ambient vertical-video overlay that fills the dead time while an AI agent in
your IDE is working — and gets out of the way the moment it is done.

You send a prompt → after 500 ms a small, non-interactive player appears in a
corner → it disappears when the agent finishes, when you cancel, or when
anything goes wrong. It never takes focus, never eats a keystroke, and never
sees a single character of your prompts or your code.

**Two players.** The default is a **326×720 YouTube feed window** — a fresh feed
of short videos, no sign-in, no channel picking. The alternative is the original
small overlay playing your own local clips. Switch in the menu bar.

**Status:** MVP. macOS, four event sources: Cursor, VS Code + Copilot Agent,
JetBrains AI Assistant, and Claude Code (which also covers GUI shells built on
the CLI, such as Orca).

---

## The privacy invariant

An adapter may send exactly this, and nothing else:

```json
{ "source": "cursor", "turn_id": "a1b2c3", "event": "turn_started", "outcome": null, "timestamp": 1730000000000 }
```

- No prompt, no response, no code, no file path, no project name, no window title.
- `sanitizeEvent` (`src/core/events.ts`) rebuilds every incoming event field by
  field, so an extra key cannot survive even if an adapter sends one. `turn_id`
  must match `[A-Za-z0-9._:-]{1,128}`, which rejects anything path- or
  prose-shaped.
- The broker listens on a **Unix domain socket** with mode `0600` — no TCP port
  is opened, so nothing on the network can reach it.
- Rejected lines are counted, never logged: the offending line is precisely the
  thing that might contain content.

`tests/events.test.ts` and `tests/broker.test.ts` assert this end to end.

---

## The YouTube feed

Install, add a key, and the first turn already has something to watch.

### Getting a key

```bash
cp .env.example .env      # then paste your key into it — .env is gitignored
```

Create the key at [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
with **YouTube Data API v3** enabled. Without one the app still runs and falls
back to Demo mode (below).

### Where the key lives, and why it cannot leak

- It is read in the **main process only** (`src/youtube/env.ts`), from
  `YOUTUBE_API_KEY` — a real environment variable, then `.env` beside the app,
  then one in the support directory.
- The renderer's entire view of the world is `window.feed` from a
  `contextBridge` preload: `next`, `peek`, `refresh`, `status`, `close`,
  `setMuted`. It receives finished `FeedVideo` objects and cannot reach the key,
  the network, or the filesystem. `contextIsolation: true`, `nodeIntegration:
  false`.
- Errors never carry the request URL, because the URL carries the key. The
  startup log prints `present (38 chars)` — never the value.
- `npm run build` runs `scripts/check-no-key.mjs`, which greps every renderer
  asset for the configured key *and* for anything shaped like a Google key, and
  fails the build if it finds one.

### How a queue is built

1. Two of the five built-in queries (`funny shorts`, `gaming shorts`,
   `satisfying shorts`, `memes shorts`, `tech shorts`), picked at random.
   **Two, not five** — `search.list` costs 100 quota units against a 10,000/day
   default, while `videos.list` costs 1.
2. The regional `mostPopular` chart for your `regionCode`.
3. `videos.list` with `snippet,contentDetails,status,liveStreamingDetails` for
   the real details.
4. Keep only what is playable: **public**, `status.embeddable === true`,
   **≤ 180 s**, not a live stream (checked two ways, since either signal can be
   absent), and not already shown this session.
5. Mix **70% search / 30% popular**. If one side is thin the other backfills — an
   exact ratio is worth less than a queue that is long enough.
6. No more than **two videos from one channel in a row**.
7. Shuffle, and hand the player at least 10.
8. Cache the raw result for **30 minutes** on disk, so a restart is instant and
   the quota lasts.
9. Refill in the background when the queue drops to three, so it never runs dry.

Everything in steps 4–7 is pure and tested (`tests/feed.test.ts`,
`tests/feedService.test.ts`) rather than eyeballed.

### Demo mode

If the API fails — no key, quota gone, offline — the feed falls back to **your
own local clips** and shows a quiet `Demo mode · <reason>` chip in the control
area.

The fallback is deliberately *not* a hardcoded list of YouTube ids: third-party
ids rot, get taken down, or turn non-embeddable, so that fallback would fail
exactly when it is needed.

### The player window

- Exactly **326×720**, set with `useContentSize` so the frame never eats into the
  video's aspect ratio, and `resizable: false`.
- The video is the official **YouTube IFrame Player**, with `autoplay=1`,
  `mute=1`, `playsinline=1`, `enablejsapi=1`, `controls=1`. Nothing is ever
  downloaded.
- **Nothing of ours is drawn on top of the player.** Next, Mute and Close live in
  a control area *below* it, along with the title, the channel, and the turn
  status.
- Two stacked player instances: the next clip is cued in the hidden one, so
  advancing is a swap rather than a load.
- A clip that ends advances automatically. One that is unavailable, refuses
  embedding, or simply never starts within 6 s is skipped.
- The window appears with `showInactive()`, so it never steals focus from the
  editor — but it is genuinely clickable, unlike the local-clip overlay.

### Collapsing, and magnetic placement

The feed window has two states, and it is **one BrowserWindow** in both — the
player, the queue and the playback position are never torn down.

| | Expanded | Collapsed |
|---|---|---|
| Size | 326×720 | 56×56 |
| Shows | the player and its controls | a floating circular button |
| Video | playing | paused, position kept |

Collapsing pauses; expanding resumes at the exact second it stopped. The pill
carries a quiet activity ring so you can still tell the agent is working, and
nothing from the IDE — no prompt, no project name — ever appears on it. It is a
real button: hover state, `Expand video` tooltip, a screen-reader label, and
Enter / Space.

**The window never sits at an arbitrary position.** Drag it anywhere and, on
release, it glides to the nearest of nine anchors:

```
top-left       top-center       top-right
middle-left    center           middle-right
bottom-left    bottom-center    bottom-right
```

- Placement is computed against `screen.getDisplayMatching(...).workArea`, which
  already excludes the macOS menu bar and the Dock — that is what keeps the
  window clear of both — with a 16 px margin and a final clamp, so no edge can
  ever end up off-screen.
- The anchor survives a collapse: the coordinates are recomputed for the new
  size, so `bottom-right` means the same thing at 326×720 and at 56×56.
- Dragging binds the window to the display where the drag *ended*, so it follows
  you between monitors.
- Unplug that monitor and the window comes home to the primary display, and the
  saved placement is corrected rather than left naming a screen that is gone.
- The anchor, the mode and the display are remembered in `settings.json`. First
  run starts at `middle-right`.

**Two implementation notes**, both non-obvious:

- Electron has no animated `setBounds`, so position and size are interpolated
  together in the main process on one timer — collapse 200 ms, expand 260 ms,
  magnet 180 ms, all eased out. Starting an animation cancels the one in flight,
  so two moves can never fight over the window. With **Reduce motion** on, every
  move is instant; Chromium mirrors the OS setting, so the page reports it up to
  main rather than main guessing.
- The chrome strip uses a native `-webkit-app-region: drag`, and buttons and the
  iframe opt out with `no-drag`. The **pill cannot**: a native drag region
  swallows the click, and the pill has to be both draggable and clickable. So it
  drives the move itself over IPC and treats a press that never travelled more
  than 5 px as a tap.

### How the motion works

Collapse, expand and the magnet are all driven by a **damped spring**, not a
timed tween — which is what makes them feel thrown rather than played back.

**Two kinds of motion, deliberately different:**

- **Morph** (collapse / expand). The window is pinned to a *stage* that contains
  both shapes — at any anchor the 56 px pill nests inside the 326×720 rectangle,
  so the stage is simply the expanded rect — and it does not resize at all while
  the transition runs. Inside it, one spring drives a single 0…1 progress, and
  every visual property is derived from that one number: scale, the transform
  origin, the corner radius, and the three opacities. Only `transform` and
  `opacity` change, so the compositor owns the frames. The real window bounds are
  synced **once**, at the end.
- **Drag and snap** run in a *stage*: the window is resized once to the work
  area and then held still, and the surface inside is moved by `translate3d`
  alone. A gesture and the magnet that follows it therefore share one coordinate
  space, so there is no handover and nothing for the velocity to jump across.
  The real bounds are set twice per gesture — entering the stage and leaving it.
  Before this the two together cost **54** native window moves (30 for the drag,
  24 for the snap), each one a relayout and an iframe repaint.

There is **no `-webkit-app-region: drag`** anywhere: a native drag region is
moved by the window server, one `setBounds` per frame, and reports no velocity —
so the gesture could not hand anything to the spring. Both drag handles (the
control strip and the pill) are driven by pointer events instead.

The magnet uses the **four corners** by default, as system Picture in Picture
does; `nineAnchors: true` restores the full grid.

**The transform origin is the anchor.** The surface contracts toward the point
where the pill will be, so a collapse at `bottom-right` pulls into its own
bottom-right corner rather than shrinking toward the middle. That is what makes
it read as one object becoming a button instead of a window being replaced.

**Throwing it.** During a drag the last ~100 ms of positions are sampled; on
release that gives a velocity, the position is projected 100–160 ms ahead
(further the harder the throw), and the anchor is chosen from the *projected*
point. Released at the same pixel, a slow drag lands on `center` and a hard flick
carries to `top-left`. The spring then starts with the gesture's own velocity, so
the throw continues into the snap instead of stopping and restarting.

**Interruptible.** One controller, one spring, one loop. Pressing Expand during a
Collapse retargets the spring in place — value and velocity carry over — so the
motion turns around instead of restarting. A new drag takes the window away from
whatever was moving it, right where that motion had reached.

**Reduce Motion** removes the springs entirely: the shapes and positions change
at once, with nothing lost.

**Development only.** `FOCUSREELS_ANIM_LAB=1 npm start` adds an Animation Lab
panel — replay Collapse and Expand, snap to any of the nine anchors, drop to
0.25× to look at a transition, and watch live FPS, animation state and spring
velocity. It is gated on the environment variable alone: no setting and no menu
item can turn it on.

### Scrolling to change clip

Two-finger scroll on the trackpad, or a mouse wheel, over the video — up for the
next clip, down for the previous one. Scrolling back replays what you have
already seen rather than burning fresh clips, and stepping forward again picks up
exactly where you left off.

**Why this needs a capture layer, and what it costs.** The player is a
cross-origin iframe, so it consumes the wheel: neither the page nor the main
process can see it. Measured, not assumed — `webContents.on('input-event')`
catches 11 of 11 wheel events over our own markup and **0** over a real
`youtube.com` frame.

So `#wheelCatcher` is a transparent layer over the video whose only job is to
receive the wheel. It is the one deliberate exception to *nothing of ours on top
of the player*, and it is kept as small as possible:

- it stops 52 px short of the bottom, leaving YouTube's own control bar exposed
  and clickable;
- a click on it toggles play/pause, so clicking the video still does what
  clicking a video should;
- it is gone entirely when the window is collapsed, and when `scrollToChange` is
  off.

One clip per gesture: a trackpad flick emits dozens of events, so there is a
40-unit threshold and a 420 ms cooldown, and reversing mid-gesture cancels it.

### MVP simulation buttons

In the menu bar, under **Simulate**: *AI start*, *AI stop*, *Next video*,
*Refresh feed*. Start and stop dispatch a real sanitized event into the registry,
exactly as an IDE hook would — so they exercise what ships, not a shortcut past
it.

## How it works

```
IDE hook / AX adapter          Unix socket (NDJSON)        Electron
────────────────────           ────────────────────        ────────
beforeSubmitPrompt  ─┐
UserPromptSubmit    ─┼─►  focusreels-emit  ─►  Event Broker ─►  TurnRegistry ─►  overlay
Stop / stop         ─┘         (metadata only)   sanitize        state machines    show/hide
```

One turn = one state machine:

```
idle ──turn_started──► waiting ──after showDelay──► active ──turn_ended──► ended
          │                                            │
          └──────── ends inside the grace window ──────┴──► ended  (never shown)
```

- **`waiting`** is the sub-500 ms grace window. A fast answer must never flash an
  overlay, so nothing is drawn until the wait has genuinely lasted that long.
- **`active`** is the only state in which the overlay is on screen.
- **`ended`** is absorbing — a chatty adapter's duplicate events are dropped.
- The overlay is **derived, never commanded**: it is visible exactly while *some*
  turn is `active`. That is what makes parallel turns work — two IDEs running at
  once produce one overlay, and it drops only when the last of them finishes.
- Every turn ends, one way or another: `turn_ended`, user cancel, IDE quit
  (detected within 5 s by process name), or the watchdog at 10 minutes.

The whole decision layer (`src/core/`) is pure TypeScript with no Electron and no
I/O — which is why it is the part that is tested.

---

## Project layout

```
focusreels/
├─ src/
│  ├─ core/                  # pure logic, no I/O — the tested part
│  │  ├─ events.ts           #   event contract + the privacy choke point
│  │  ├─ turnStateMachine.ts #   idle → waiting → active → ended
│  │  └─ turnRegistry.ts     #   many turns → one overlay visibility
│  ├─ broker/
│  │  ├─ paths.ts            #   socket / settings / media locations
│  │  └─ server.ts           #   NDJSON over a Unix domain socket
│  ├─ app/                   # Electron main process
│  │  ├─ main.ts             #   wiring only
│  │  ├─ overlayWindow.ts    #   the non-activating, click-through panel
│  │  ├─ settings.ts         #   settings.json, hand-editable
│  │  ├─ tray.ts             #   menu-bar settings
│  │  ├─ ideWatcher.ts       #   "the IDE died mid-turn" safety net
│  │  ├─ mediaLibrary.ts     #   local clips
│  │  ├─ youtubeWindow.ts    #   the feed window: modes, dragging, magnets
│  │  ├─ anchors.ts          #   the nine anchors — pure geometry, no Electron
│  │  ├─ overlayIpc.ts       #   the typed window-control contract
│  │  ├─ youtubePreload.ts   #   the renderer's whole view of main
│  │  └─ renderer/           #   player.* (local) + youtube.* (feed)
│  └─ cli/
│     ├─ emit.ts             #   what a hook runs
│     ├─ demo.ts             #   synthetic events, no IDE needed
│     └─ headless.ts         #   the pipeline without the window
├─ adapters/
│  ├─ cursor/                # official Hooks
│  ├─ claude-code/           # Claude Code hooks — covers Orca too
│  ├─ vscode-copilot/        # Agent Hooks (Preview) + fallback
│  └─ ax/                    # Swift: macOS Accessibility adapter
├─ tests/                    # vitest
└─ media/                    # your vertical clips
```

---

## Run it

Requires macOS, Node 20+, and (for the JetBrains adapter) Swift 5.9+.

```bash
npm install
npm start          # builds, then launches the app into the menu bar (◍)
```

**The terminal stays occupied, and that is the app running normally.** The last
line you see is `[focusreels] listening on …` — there is no further output, no
dock icon and no window, because FocusReels lives in the menu bar (a ring icon,
next to the clock). Drive it from a *second* terminal, and stop it with Ctrl+C
or **Quit FocusReels** in the menu.

Add some vertical clips via **menu bar → Open media folder…**; without them the
overlay shows a placeholder and still works.

If the menu-bar icon is missing, regenerate it with `npm run icons` — macOS does
not render a status item that has no image.

### Try it with no IDE at all

```bash
npm run demo                              # endless mixed traffic
node dist/cli/demo.js --scenario fast     # 250 ms turn — must NOT show
node dist/cli/demo.js --scenario long     # 8 s turn
node dist/cli/demo.js --scenario parallel # two IDEs at once, one overlay
node dist/cli/demo.js --scenario abort    # cancelled
node dist/cli/demo.js --scenario error    # failed
node dist/cli/demo.js --scenario stuck    # never ends — watchdog closes it
```

### Watch the pipeline without the window

```bash
npm run headless      # prints every state transition and SHOW/HIDE decision
```

Useful for checking an adapter: if `headless` shows `turn_started → waiting`
when you prompt your IDE, the adapter works and any remaining problem is in the
window.

### Tests

```bash
npm test         # 124 tests: state machine, registry, events, broker, settings, feed, anchors, springs
npm run typecheck
```

---

## Connect your IDEs

Your tool is not on this list? It does not need to be — see
[`docs/ADAPTER-PROTOCOL.md`](docs/ADAPTER-PROTOCOL.md).

### Cursor — official Hooks

```bash
npm run install:cursor    # merges into ~/.cursor/hooks.json, keeps what's there
```

`beforeSubmitPrompt` sends `turn_started`; `stop` sends `turn_ended` with
`completed` / `aborted` / `error`. The hook script reads two fields out of the
payload Cursor puts on stdin — an opaque id and a status — and forwards nothing
else. It exits 0 on every path: a broken overlay is never a reason to break a
prompt.

Restart Cursor afterwards. Field names differ between Cursor versions, so the
script passes a list of candidates (`generation_id,conversation_id,…`) and takes
the first one present.

### VS Code + Copilot Agent — Agent Hooks (Preview)

Copy `adapters/vscode-copilot/hooks.json` to `.vscode/hooks.json`, fix the paths,
reload the window. `UserPromptSubmit` → `turn_started`, `Stop` → `turn_ended`.

Agent Hooks are Preview and can be disabled by organisation policy, in which case
they never fire. The fallback is the Accessibility adapter:

```bash
npm run ax:build
./adapters/ax/.build/release/focusreels-ax --profile vscode
```

See `adapters/vscode-copilot/README.md`.

### Claude Code — including Orca and other GUI shells

```bash
npm run install:claude    # merges into ~/.claude/settings.json, keeps what's there
```

Then start a **new** agent session. Claude Code's hooks belong to the CLI, not to
a window, so this one adapter covers the terminal, Orca, and anything else built
on the CLI. `UserPromptSubmit` → `turn_started`, `Stop` → `completed`,
`StopFailure` → `error`; `session_id` becomes the `turn_id` and nothing else is
read from the payload.

Claude Code allows several hooks per event, so an existing Orca or corporate hook
is left untouched. Details in `adapters/claude-code/README.md`.

### JetBrains AI Assistant — Accessibility adapter

JetBrains has no hook API, so the MVP watches the AI Chat UI instead:

```bash
npm run ax:build
./adapters/ax/.build/release/focusreels-ax --profile jetbrains --verbose
```

Grant Accessibility permission to whatever runs it (your terminal) when macOS
asks. It reads button labels and roles only — never chat text. Several signals
plus hysteresis plus a watchdog keep false positives down; details and tuning in
`adapters/ax/README.md`.

---

## Settings

Menu-bar item, or edit `~/Library/Application Support/FocusReels/settings.json`
directly and pick **Reload settings from disk**.

| Key | Default | What it does |
|---|---|---|
| `enabledSources` | all on | per-IDE switch; an off source never opens a turn |
| `showDelayMs` | `500` | how long the wait must last before anything appears |
| `hideMode` | `full-completion` | `full-completion` or `first-response` |
| `watchdogMs` | `600000` | hard stop for a turn no adapter ever closed |
| `muted` | `true` | audio; the overlay's mute button writes here |
| `volume` | `0.6` | 0…1, set by the overlay's volume slider |
| `clickThrough` | `true` | overlay is invisible to mouse and keyboard |
| `swipe` | `true` | swipe/scroll to change clip; costs click-through while hovering |
| `player` | `youtube` | `youtube` (326×720 feed) or `local` (small overlay) |
| `regionCode` | `US` | ISO-3166-1 alpha-2, for the regional `mostPopular` chart |
| `placement` | `middle-right`, expanded | the feed window's anchor, mode and display |
| `scrollToChange` | `true` | scroll over the video to change clip; adds a capture layer |
| `corner` | `bottom-right` | which corner, on the display holding the cursor |
| `width` | `260` | height follows a 9:16 frame |
| `margin` | `24` | distance from the screen edge |
| `opacity` | `1` | window opacity |

A settings change applies to the **next** turn, never to a running one.

### Environment variables

Useful when testing, or when running a second instance beside a live one.

| Variable | What it does |
|---|---|
| `FOCUSREELS_SOCKET` | broker socket path — the one thing that must differ between two instances |
| `FOCUSREELS_MEDIA_DIR` | clip folder for this run |
| `FOCUSREELS_DEBUG` | logs bounds, visibility and every morph transition |
| `FOCUSREELS_ANIM_LAB` | adds the Animation Lab panel (development only) |
| `FOCUSREELS_HOME` | where the hook scripts look for `dist/cli/emit.js` |
| `FOCUSREELS_NODE` | Node binary the hook scripts use, when it is not on `PATH` |
| `YOUTUBE_API_KEY` | the feed's key — main process only, never the renderer |

Running `npm start` twice is refused: the second instance sees a live socket and
exits with `FocusReels is already running`.

### Controls

They appear on hover and fade out when the pointer leaves:

- **top left** — play/pause, and mute with a volume slider that grows out of it.
  Mute and volume are remembered in `settings.json`.
- **bottom** — like and captions (UI only for now), and a scrubber with the
  clip's current time and duration.
- The turn status (*"Claude Code is working… 2:17"*) slides out of the way while
  you are hovering and comes straight back.

### Swiping

Drag the video up for the next clip, down for the previous one — or two-finger
scroll over it. A drag shorter than a quarter of the frame snaps back, so a
misfire costs nothing. The next clip is mounted in a second, stacked video
element and parked one frame away, so it is already on screen as you drag rather
than appearing after you let go.

Asking for another clip lifts an earlier pause: a swipe is an explicit request
for something to watch, and the pause button is right there to undo it.

**The trade-off, stated plainly.** The gesture happens over the video body, and
a body that ignores the mouse cannot see a gesture. So while `swipe` is on and
the pointer is over the overlay, the overlay takes the mouse — a click there
lands in the player, not in the IDE behind it. Move away and it is click-through
again. Turn `swipe` off (menu bar, or `settings.json`) and only the controls
ever take the mouse, exactly as before.

### Why the overlay still cannot steal your focus

`focusable: false` plus `showInactive()` (never `show()`) plus always-on-top at
the `screen-saver` level, visible across Spaces and fullscreen apps.

**The mouse is the interesting part.** The window ignores it by default, so every
click lands in the IDE underneath — but `setIgnoreMouseEvents(true, { forward:
true })` keeps delivering *mousemove* to the page. The renderer uses that to
notice the pointer entering a control and asks the main process for the mouse,
then hands it straight back on the way out. So the controls are clickable while
the video body stays completely click-through, and neither ever takes keyboard
focus.

Two details that this depends on, both easy to get wrong:

- `acceptFirstMouse: true` — the app is an accessory and never becomes active,
  so *every* click is a "first mouse". Without this the system swallows all of
  them as activation clicks and no control ever fires.
- Saving the volume must not re-arm the mouse. `applySettings` only touches
  `setIgnoreMouseEvents` when the click-through *policy* changed; otherwise
  dragging the slider would yank the mouse out from under itself.

Setting `clickThrough: false` makes the whole surface interactive, and that stays
opt-in.

---

## Known limits of this MVP

- **macOS only.** The Accessibility adapter, the socket path and the panel
  behaviour are all macOS-specific.
- **Hook payload schemas are not frozen.** Cursor hooks are official but their
  field names move; VS Code Agent Hooks are Preview. Both adapters degrade to a
  single `default` turn lane rather than failing.
- **The Accessibility adapter is heuristic.** It reads the chat's Stop/Send
  controls, so a JetBrains UI change or a localized IDE can need a pattern
  update. Prefer hooks wherever they exist.
- **The feed is not personalised, by design.** Five fixed queries plus the
  regional chart; no sign-in, no channel picking, no recommendations.
- **Quota is finite.** Two searches per refresh and a 30-minute cache keep a
  default 10,000-unit day comfortable, but a very long session will eventually
  exhaust it and drop to Demo mode.
- **No packaging yet.** `npm start` runs it from source; there is no signed
  `.app`, no auto-launch, no notarization.
- **No playlist UI.** Clips are whatever is in the media folder.
