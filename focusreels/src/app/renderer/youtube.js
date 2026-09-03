/* The player. It receives finished video objects over IPC and knows nothing
   about the API, the key, or the network — it cannot reach any of them. */

const paneA = document.getElementById('paneA');
const paneB = document.getElementById('paneB');
const curtain = document.getElementById('curtain');
const curtainText = document.getElementById('curtainText');
const titleEl = document.getElementById('title');
const channelEl = document.getElementById('channel');
const badge = document.getElementById('badge');
const nextBtn = document.getElementById('next');
const muteBtn = document.getElementById('mute');
const muteIcon = document.getElementById('muteIcon');
const closeBtn = document.getElementById('close');
const wheelCatcher = document.getElementById('wheelCatcher');
const labState = document.getElementById('labState');
const labFps = document.getElementById('labFps');
const labVel = document.getElementById('labVel');
let labVelocity = 0;
const collapseBtn = document.getElementById('collapse');
const fab = document.getElementById('fab');
const agentEl = document.getElementById('agent');
const elapsedEl = document.getElementById('elapsed');

const ICON_MUTED = 'M11 5 6 9H3v6h3l5 4zM22 9.4 20.6 8 18 10.6 15.4 8 14 9.4l2.6 2.6L14 14.6 15.4 16 18 13.4 20.6 16 22 14.6 19.4 12z';
const ICON_SOUND = 'M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7l-1.4-1.4a3 3 0 0 0 0-4.2zM18 5.6a9 9 0 0 1 0 12.8l-1.4-1.4a7 7 0 0 0 0-10z';

const SOURCE_LABELS = {
  cursor: 'Cursor',
  'vscode-copilot': 'Copilot',
  jetbrains: 'JetBrains AI',
  'claude-code': 'Claude Code',
  demo: 'Demo',
};

/** Errors YouTube reports for a video we simply cannot play — skip, don't retry. */
const FATAL_ERRORS = new Set([2, 5, 100, 101, 150, 153]);
let FEED_DEBUG = Boolean(window.__FOCUSREELS_DEBUG_FEED__);
const feedDebug = (...args) => { if (FEED_DEBUG) console.log('[feed]', ...args); };
let traceSequence = 0;
function trace(event, videoId, extra = {}) {
  if (!window.__FOCUSREELS_E2E__) return;
  console.log('[feed-trace]' + JSON.stringify({ sequence: ++traceSequence, timestamp: new Date().toISOString(), event, ...(videoId ? { videoId } : {}), ...extra }));
}
/** If nothing is playing by then, treat the clip as broken and move on. */
const START_TIMEOUT_MS = 6000;

let muted = true;
let switching = false;
let startedAt = Date.now();
let ticker = null;
let currentVideo = null;
let currentStartedAt = 0;
function reportPlayback(video, kind) { if (!video?.id) return; window.feed.reportFeedback({ videoId: video.id, category: video.category || 'other', impressions: kind === 'impression' ? 1 : 0, completedViews: kind === 'complete' ? 1 : 0, quickSkips: kind === 'quick' ? 1 : 0, lastViewedAt: new Date().toISOString() }); trace('feedback-written', video.id, { reason: kind }); }

/** { pane, kind: 'yt' | 'demo', player, video } */
let front = { pane: paneA, kind: null, player: null, video: null };
let back = { pane: paneB, kind: null, player: null, video: null };

// ── the YouTube IFrame API ─────────────────────────────────────────────────

let ytReady = null;
function loadYouTubeApi() {
  if (ytReady) return ytReady;
  ytReady = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => reject(new Error('iframe api blocked'));
    document.head.appendChild(script);
    setTimeout(() => reject(new Error('iframe api timed out')), 10000);
  });
  return ytReady;
}

function clearSlot(slot) {
  if (slot.player && typeof slot.player.destroy === 'function') {
    try {
      slot.player.destroy();
    } catch {
      /* already gone */
    }
  }
  slot.player = null;
  slot.kind = null;
  slot.video = null;
  slot.pane.replaceChildren();
}

/**
 * Mounts a clip into a slot. `autoplay` false cues it instead — that is what
 * makes the next clip start instantly when it is promoted to the front.
 */
async function mount(slot, video, autoplay) {
  clearSlot(slot);
  slot.video = video;

  if (video.source === 'demo') {
    const el = document.createElement('video');
    el.src = 'file://' + encodeURI(video.id).replace(/#/g, '%23');
    el.muted = muted;
    el.playsInline = true;
    el.preload = 'auto';
    el.addEventListener('ended', () => {
      if (slot === front) void goNext();
    });
    el.addEventListener('error', () => {
      if (slot === front) void goNext();
    });
    slot.pane.appendChild(el);
    slot.kind = 'demo';
    if (autoplay) el.play().catch(() => {});
    return;
  }

  const YT = await loadYouTubeApi();
  const host = document.createElement('div');
  slot.pane.appendChild(host);

  slot.player = new YT.Player(host, {
    videoId: video.id,
    playerVars: {
      autoplay: autoplay ? 1 : 0,
      mute: 1, // autoplay only survives muted; unmuting happens after start
      playsinline: 1,
      enablejsapi: 1,
      controls: 1,
      rel: 0,
      modestbranding: 1,
    },
    events: {
      onReady: (event) => {
        applyMuteTo(slot);
        trace('player-ready', video.id);
        const failIds = String(window.__FOCUSREELS_YOUTUBE_FAIL_IDS__ || '').split(',').map((x) => x.trim()).filter(Boolean);
        if (slot === front && failIds.includes(video.id)) {
          const errorCode = Number(window.__FOCUSREELS_YOUTUBE_FAIL_CODE__ || 100);
          trace('player-error', video.id, { errorCode, reason: 'fault-injection' });
          window.feed.reportPlaybackError({ videoId: video.id, error: errorCode });
          void goNext();
          return;
        }
        if (autoplay) event.target.playVideo();
      },
      onStateChange: (event) => {
        if (slot !== front) return;
        if (event.data === YT.PlayerState.PLAYING) {
          trace('player-playing', video.id);
          currentStartedAt = Date.now();
          curtain.classList.add('gone');
          clearStartWatchdog();
        }
        if (event.data === YT.PlayerState.ENDED) { trace('player-ended', video.id); reportPlayback(video, 'complete'); void goNext(); }
      },
      onError: (event) => {
        feedDebug('player-error', { code: event.data, videoId: video.id });
        trace('player-error', video.id, { errorCode: event.data });
        window.feed.reportPlaybackError({ videoId: video.id, error: event.data });
        if (FATAL_ERRORS.has(event.data)) {
          if (slot === front) void goNext();
          else clearSlot(slot); // a bad preload just gets dropped
        }
      },
    },
  });
  slot.kind = 'yt';
}

// ── mute ───────────────────────────────────────────────────────────────────

function applyMuteTo(slot) {
  if (slot.kind === 'yt' && slot.player) {
    try {
      if (muted) slot.player.mute();
      else slot.player.unMute();
    } catch {
      /* the player may not be ready yet; onReady applies it again */
    }
  }
  const el = slot.pane.querySelector('video');
  if (el) el.muted = muted;
}

function renderMute() {
  muteIcon.setAttribute('d', muted ? ICON_MUTED : ICON_SOUND);
  muteBtn.title = muted ? 'Unmute' : 'Mute';
  muteBtn.setAttribute('aria-label', muteBtn.title);
}

muteBtn.addEventListener('click', () => {
  muted = !muted;
  applyMuteTo(front);
  applyMuteTo(back);
  renderMute();
  window.feed.setMuted(muted);
});

// ── the queue ──────────────────────────────────────────────────────────────

let startWatchdog = null;

function clearStartWatchdog() {
  if (startWatchdog) clearTimeout(startWatchdog);
  startWatchdog = null;
}

function armStartWatchdog() {
  clearStartWatchdog();
  startWatchdog = setTimeout(() => {
    // Never started: unavailable, region-blocked, or embedding refused.
    void goNext();
  }, START_TIMEOUT_MS);
}

function renderMeta(video, status) {
  currentVideo = video;
  titleEl.textContent = video ? video.title || 'Untitled' : 'Nothing to play';
  channelEl.textContent = video ? video.channelTitle : '';
  badge.classList.toggle('on', Boolean(status && status.demoMode));
  if (status && status.demoMode && status.reason) badge.textContent = `Demo mode · ${status.reason}`;
  else badge.textContent = 'Demo mode';
}

async function preloadNext() {
  const upcoming = await window.feed.peek();
  if (!upcoming) return;
  const failIds = String(window.__FOCUSREELS_YOUTUBE_FAIL_IDS__ || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (failIds.includes(upcoming.id)) return; // fault injection must exercise front error path
  if (back.video && back.video.id === upcoming.id) return;
  try {
    await mount(back, upcoming, false);
  } catch {
    clearSlot(back);
  }
}

async function showFirst() {
  const [video, status] = await Promise.all([window.feed.next(), window.feed.status()]);
  feedDebug('initial', { provider: status?.provider, source: status?.catalogSource, videoId: video?.id });
  trace('catalog-loaded', video?.id, { provider: status?.provider, catalogSource: status?.catalogSource, totalVideos: status?.totalVideos });
  if (!video) {
    curtain.classList.remove('gone');
    curtainText.innerHTML =
      'Add test YouTube Shorts IDs to run the catalog demo.';
    renderMeta(null, status);
    return;
  }
  renderMeta(video, status);
  trace('video-selected', video.id);
  reportPlayback(video, 'impression');
  await mount(front, video, true);
  if (video.source === 'demo') curtain.classList.add('gone');
  else armStartWatchdog();
  void preloadNext();
}

/** Promote the preloaded slot, or mount fresh if nothing was staged. */
async function goNext() {
  if (switching) return;
  switching = true;
  clearStartWatchdog();
  nextBtn.disabled = true;

  try {
    if (currentVideo) reportPlayback(currentVideo, Date.now() - currentStartedAt < 3000 ? 'quick' : 'normal');
    const previousId = currentVideo?.id;
    const video = await window.feed.next();
    feedDebug('next', { previousId, videoId: video?.id, reason: 'gesture-or-ended' });
    trace('video-skipped', video?.id, { previousId, reason: 'next-action' });
    const status = await window.feed.status();
    if (!video) {
      renderMeta(null, status);
      return;
    }
    renderMeta(video, status);
    reportPlayback(video, 'impression');
    trace('video-selected', video.id);

    if (back.video && back.video.id === video.id && back.kind) {
      // Already staged — swap panes and press play. This is the fast path.
      const t = front;
      front = back;
      back = t;
      front.pane.classList.add('on');
      back.pane.classList.remove('on');
      applyMuteTo(front);
      if (front.kind === 'yt' && front.player) front.player.playVideo();
      else front.pane.querySelector('video')?.play().catch(() => {});
      clearSlot(back);
    } else {
      await mount(front, video, true);
      front.pane.classList.add('on');
    }

    if (video.source === 'demo') curtain.classList.add('gone');
    else armStartWatchdog();
    void preloadNext();
  } catch {
    /* a failed advance must not wedge the button */
  } finally {
    switching = false;
    nextBtn.disabled = false;
  }
}

/** One step back through what has already been shown. */
async function goPrev() {
  if (switching) return;
  const video = await window.feed.previous();
  if (!video) return; // already at the oldest — nothing to go back to
  switching = true;
  clearStartWatchdog();
  try {
    const status = await window.feed.status();
    renderMeta(video, status);
    // No fast path here: the staged slide always holds the *next* clip.
    await mount(front, video, true);
    front.pane.classList.add('on');
    if (video.source === 'demo') curtain.classList.add('gone');
    else armStartWatchdog();
    void preloadNext();
  } catch {
    /* a failed step back must not wedge the gesture */
  } finally {
    switching = false;
  }
}

nextBtn.addEventListener('click', () => void goNext());
closeBtn.addEventListener('click', () => window.feed.close());

// ── the agent's status ─────────────────────────────────────────────────────

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function renderStatus(status) {
  agentEl.textContent = (SOURCE_LABELS[status.source] || status.source) + ' is working…';
  startedAt = status.startedAt || Date.now();
  elapsedEl.textContent = formatTime((Date.now() - startedAt) / 1000);
}

function startTicker() {
  stopTicker();
  ticker = setInterval(() => {
    elapsedEl.textContent = formatTime((Date.now() - startedAt) / 1000);
  }, 1000);
}

function stopTicker() {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

// ── wiring ─────────────────────────────────────────────────────────────────

window.feed.onSettings((s) => {
  if (s && typeof s.debugFeed === 'boolean') FEED_DEBUG = s.debugFeed;
  if (s && typeof s.e2e === 'boolean') window.__FOCUSREELS_E2E__ = s.e2e;
  if (s && typeof s.failIds === 'string') window.__FOCUSREELS_YOUTUBE_FAIL_IDS__ = s.failIds;
  if (s && typeof s.failCode === 'number') window.__FOCUSREELS_YOUTUBE_FAIL_CODE__ = s.failCode;
  if (s && typeof s.traceStages === 'boolean') traceStages = s.traceStages;
  if (s && typeof s.scrollToChange === 'boolean') {
    document.body.classList.toggle('scroll-gesture', s.scrollToChange);
  }
  if (s && typeof s.muted === 'boolean' && s.muted !== muted) {
    muted = s.muted;
    applyMuteTo(front);
    applyMuteTo(back);
    renderMute();
  }
});

window.feed.onShow((status) => {
  renderStatus(status);
  startTicker();
  void showFirst();
});

window.feed.onStatus(renderStatus);

window.feed.onHide(() => {
  stopTicker();
  clearStartWatchdog();
  // Pause rather than tear down: the next turn should start instantly.
  if (front.kind === 'yt' && front.player) {
    try {
      front.player.pauseVideo();
    } catch {
      /* nothing to pause */
    }
  }
  front.pane.querySelector('video')?.pause();
});

window.feed.onCommand(async (command) => {
  if (command === 'next') await goNext();
  if (command === 'refresh') {
    clearSlot(back);
    clearSlot(front);
    front.pane.classList.add('on');
    curtain.classList.remove('gone');
    curtainText.textContent = 'Refreshing feed…';
    await window.feed.refresh();
    await showFirst();
  }
});

renderMute();

// ── expanded ↔ collapsed ───────────────────────────────────────────────────
//
// The same window changes size; the player, the queue and the playback position
// are never torn down. Collapsing pauses, expanding resumes where it stopped.

let mode = 'expanded';
/** Was the clip running when we collapsed? Only then does expanding resume it. */
let wasPlaying = false;

function isPlaying() {
  if (front.kind === 'yt' && front.player && typeof front.player.getPlayerState === 'function') {
    try {
      return front.player.getPlayerState() === 1; // YT.PlayerState.PLAYING
    } catch {
      return false;
    }
  }
  const el = front.pane.querySelector('video');
  return Boolean(el && !el.paused && !el.ended);
}

function pauseFront() {
  if (front.kind === 'yt' && front.player) {
    try {
      front.player.pauseVideo();
    } catch {
      /* not ready yet — nothing to pause */
    }
  }
  front.pane.querySelector('video')?.pause();
}

function resumeFront() {
  if (front.kind === 'yt' && front.player) {
    try {
      // playVideo() resumes at the retained position; it never reloads.
      front.player.playVideo();
    } catch {
      /* not ready yet — onReady will start it */
    }
    return;
  }
  front.pane.querySelector('video')?.play().catch(() => {});
}

/** Current playback position, for diagnostics only. */
function positionOf() {
  if (front.kind === 'yt' && front.player && typeof front.player.getCurrentTime === 'function') {
    try {
      return front.player.getCurrentTime();
    } catch {
      return -1;
    }
  }
  const el = front.pane.querySelector('video');
  return el ? el.currentTime : -1;
}

/**
 * The visual mode. It follows the morph, not the IPC state — the window is not
 * "collapsed" until the surface has finished becoming a pill.
 */
function applyStatic(next) {
  mode = next;
  document.body.classList.remove('morphing');
  document.body.classList.toggle('collapsed', next === 'collapsed');
  clearMorphVars();
  if (next === 'expanded' && wasPlaying) resumeFront();
  if (next === 'expanded') fab.blur();
}

// ── morph ──────────────────────────────────────────────────────────────────
//
// One spring, one rAF loop, one set of CSS variables. Every visual property is
// derived from the same progress, which is what makes the surface and the pill
// read as a single object instead of a cross-fade between two windows.

const TARGET_SCALE = 56 / 326;
const EXPANDED_RADIUS = 14;
const COLLAPSED_RADIUS = 28;

let morphPlan = null;
let morphState = { value: 0, velocity: 0 };
let morphTarget = 0;
let morphRaf = null;
let morphLast = 0;
let timeScale = 1;
let fabPressed = false;

let traceStages = false;
function log(stage) {
  if (traceStages) console.log(`transition: ${stage}`);
}

const root = document.documentElement;
const setVar = (name, value) => root.style.setProperty(name, value);

/** 0 before `a`, 1 after `b`, smooth in between. */
function band(p, a, b) {
  if (b <= a) return p >= b ? 1 : 0;
  return Math.max(0, Math.min(1, (p - a) / (b - a)));
}

function clearMorphVars() {
  for (const name of [
    '--exp-x', '--exp-y', '--exp-w', '--exp-h', '--col-x', '--col-y',
    '--origin-x', '--origin-y', '--morph-scale', '--morph-radius',
    '--surface-opacity', '--controls-opacity', '--fab-opacity', '--fab-scale',
  ]) {
    root.style.removeProperty(name);
  }
  // will-change is a promise to the compositor; keeping it costs memory.
  document.body.classList.remove('morphing');
}

function applyMorphLayout(plan) {
  setVar('--exp-x', plan.expanded.x + 'px');
  setVar('--exp-y', plan.expanded.y + 'px');
  setVar('--exp-w', plan.expanded.width + 'px');
  setVar('--exp-h', plan.expanded.height + 'px');
  setVar('--col-x', plan.collapsed.x + 'px');
  setVar('--col-y', plan.collapsed.y + 'px');

  // The surface contracts toward the pill, so the origin depends on the anchor:
  // at bottom-right it pulls into its own bottom-right corner, not its centre.
  setVar('--origin-x', plan.collapsed.x + plan.collapsed.width / 2 - plan.expanded.x + 'px');
  setVar('--origin-y', plan.collapsed.y + plan.collapsed.height / 2 - plan.expanded.y + 'px');
}

function applyMorphFrame(progress) {
  const p = Math.max(0, Math.min(1.05, progress));
  const scale = 1 + (TARGET_SCALE - 1) * p;

  // The radius is scaled along with the box, so divide it back out to make the
  // *visible* corner grow evenly from a rounded rectangle to a circle.
  const visualRadius = EXPANDED_RADIUS + (COLLAPSED_RADIUS - EXPANDED_RADIUS) * p;

  // The pill's band depends on the direction: collapsing, it arrives in the
  // last fifth; expanding, it is gone before the halfway point.
  const collapsing = morphTarget === 1;
  const fabIn = collapsing ? band(p, 0.82, 1) : band(p, 0.5, 1);

  setVar('--morph-scale', String(scale));
  setVar('--morph-radius', visualRadius / Math.max(scale, 0.001) + 'px');
  setVar('--surface-opacity', String(1 - band(p, 0.6, 0.95)));
  setVar('--controls-opacity', String(1 - band(p, 0, 0.35)));
  setVar('--fab-opacity', String(fabIn));
  setVar('--fab-scale', String((0.9 + 0.1 * fabIn) * (fabPressed ? 0.94 : 1)));
}

function stopMorphLoop() {
  if (morphRaf !== null) cancelAnimationFrame(morphRaf);
  morphRaf = null;
}

function startMorphLoop() {
  if (morphRaf !== null) return; // never two loops
  morphLast = performance.now();
  const frame = (now) => {
    morphRaf = null;
    // Real elapsed time, so a dropped frame changes the path but not the end.
    const dt = ((now - morphLast) / 1000) * timeScale;
    morphLast = now;
    morphState = window.spring.step(morphState, morphTarget, window.spring.MORPH, dt);
    applyMorphFrame(morphState.value);
    labVelocity = morphState.velocity;

    if (window.spring.atRest(morphState, morphTarget)) {
      applyMorphFrame(morphTarget);
      window.overlay.morphDone();
      return;
    }
    morphRaf = requestAnimationFrame(frame);
  };
  morphRaf = requestAnimationFrame(frame);
}

window.overlay.onMorphBegin((plan) => {
  if (!plan) return;
  morphPlan = plan;
  morphTarget = plan.to;
  // Reversing mid-flight keeps the current position *and* speed; a fresh morph
  // starts from where the previous state left the surface.
  if (morphRaf === null) morphState = { value: plan.from, velocity: 0 };

  if (plan.to === 1) {
    wasPlaying = isPlaying();
    pauseFront();
    clearStartWatchdog();
  }

  document.body.classList.remove('collapsed');
  document.body.classList.add('morphing');
  applyMorphLayout(plan);
  applyMorphFrame(morphState.value);

  // Laid out for the stage — main may now resize the window to it without the
  // page painting a single frame in the wrong place.
  window.overlay.morphReady();
});

window.overlay.onMorphRun(() => {
  if (!morphPlan) return;
  if (morphPlan.reducedMotion) {
    applyMorphFrame(morphTarget);
    window.overlay.morphDone();
    return;
  }
  startMorphLoop();
});

window.overlay.onMorphRetarget((payload) => {
  if (!payload || !morphPlan) return;
  // Same spring, new destination: value and velocity carry over, so pressing
  // Expand during a Collapse turns the motion around instead of restarting it.
  morphTarget = payload.to;
  if (payload.to === 0) {
    document.body.classList.remove('collapsed');
  } else {
    wasPlaying = isPlaying();
    pauseFront();
  }
  startMorphLoop();
});

window.overlay.onMorphEnd((payload) => {
  stopMorphLoop();
  const finalMode = payload && payload.mode === 'collapsed' ? 'collapsed' : 'expanded';
  const finalRect = morphPlan && morphPlan[finalMode];
  // Preserve the exact final work-area coordinate when morphing returns to the
  // static panel model; this runs before classes/transform variables change.
  if (finalRect) setSurface(finalRect.x, finalRect.y);
  morphPlan = null;
  applyStatic(finalMode);

  // Keep the still up for two more frames: the live player is behind it at the
  // final geometry, and dropping the still in the same frame as the bounds
  // change would show one frame of nothing.
  const snap = document.getElementById('snapshot');
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      snap.classList.remove('ready');
      snap.removeAttribute('src');
      document.body.classList.remove('has-snapshot');
      log('snapshot-removed');
    }),
  );
});

window.overlay.onSnapshot((dataUrl) => {
  if (!morphPlan || !dataUrl) return;
  const snap = document.getElementById('snapshot');
  snap.src = dataUrl;
  snap.classList.add('ready');
  document.body.classList.add('has-snapshot');
});

window.overlay.onStateChanged((state) => {
  if (!state) return;
  document.body.classList.toggle('reduce-motion', Boolean(state.reducedMotion));
  labState.textContent = state.animation;
  // Safety net only: while a morph is running it owns the visual mode.
  if (!morphPlan && state.mode !== mode) applyStatic(state.mode);
});

collapseBtn.addEventListener('click', () => window.overlay.collapse());

// ── one gesture system ─────────────────────────────────────────────────────
//
// Every draggable surface — the control strip when expanded, the pill when
// collapsed — goes through here. While a gesture runs the native window is held
// still at work-area size and only `transform` changes, so a drag costs no
// window move, no layout, and no IPC per frame. The magnet that follows starts
// from the same transform with the gesture's own velocity, which is why there
// is nothing for the speed to jump across.

const TAP_SLOP = 5;

let stagePlan = null;
let surfaceX = 0;
let surfaceY = 0;
let stageSpringX = { value: 0, velocity: 0 };
let stageSpringY = { value: 0, velocity: 0 };
let stageTarget = null;
let stageRaf = null;
let stageLast = 0;
let gesture = null;
let stageInteractive = false;
let activeStageTransitionId = null;
let diagnosticFrames = [];

function surfaceElement() {
  return mode === 'collapsed' ? fab : document.getElementById('app');
}

function screenRect() {
  const rect = surfaceElement().getBoundingClientRect();
  return { left: window.screenX + rect.left, top: window.screenY + rect.top, width: rect.width, height: rect.height };
}

function handoffDiagnostic(stage, extra = {}) {
  if (!traceStages) return;
  const el = surfaceElement();
  const rect = el.getBoundingClientRect();
  console.log('[handoff-renderer] ' + JSON.stringify({
    t: performance.now(), transitionId: activeStageTransitionId, stage,
    native: { screenX: window.screenX, screenY: window.screenY, outerWidth: window.outerWidth, outerHeight: window.outerHeight },
    devicePixelRatio: window.devicePixelRatio,
    rootRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    transform: getComputedStyle(el).transform, classes: document.body.className, ...extra,
  }));
}

function setSurface(x, y) {
  surfaceX = x;
  surfaceY = y;
  setVar('--sx', x + 'px');
  setVar('--sy', y + 'px');
  if (stagePlan) {
    diagnosticFrames.push({ t: performance.now(), x, y, rect: screenRect() });
    if (diagnosticFrames.length > 5) diagnosticFrames.shift();
  }
}

function surfaceSize() {
  return mode === 'collapsed' ? { width: 56, height: 56 } : { width: 326, height: 720 };
}

function stopStageSpring() {
  if (stageRaf !== null) cancelAnimationFrame(stageRaf);
  stageRaf = null;
}

function startStageSpring() {
  if (stageRaf !== null || !stageTarget) return; // never two loops
  stageLast = performance.now();
  const frame = (now) => {
    stageRaf = null;
    const dt = ((now - stageLast) / 1000) * timeScale;
    stageLast = now;

    stageSpringX = window.spring.step(stageSpringX, stageTarget.x, window.spring.SNAP, dt);
    stageSpringY = window.spring.step(stageSpringY, stageTarget.y, window.spring.SNAP, dt);
    setSurface(stageSpringX.value, stageSpringY.value);
    labVelocity = Math.hypot(stageSpringX.velocity, stageSpringY.velocity);

    const settled =
      window.spring.atRestPx(stageSpringX, stageTarget.x) &&
      window.spring.atRestPx(stageSpringY, stageTarget.y);
    if (settled) {
      setSurface(stageTarget.x, stageTarget.y);
      handoffDiagnostic('last-five-spring-frames', { frames: diagnosticFrames, visualRect: screenRect() });
      window.overlay.stageDone();
      return;
    }
    stageRaf = requestAnimationFrame(frame);
  };
  stageRaf = requestAnimationFrame(frame);
}

function setStageInteractive(next) {
  if (next === stageInteractive) return;
  stageInteractive = next;
  window.overlay.setStageInteractive(next);
}

window.overlay.onStageEnter((plan) => {
  if (!plan) return;
  if (stagePlan && stagePlan.transitionId === plan.transitionId) return;
  stagePlan = plan;
  activeStageTransitionId = plan.transitionId;
  diagnosticFrames = [];
  handoffDiagnostic('stage-enter-state');
  setSurface(plan.surface.x, plan.surface.y);
});

window.overlay.onStageSnap((snap) => {
  if (!snap || !stagePlan) return;
  stageTarget = snap.target;
  // Lean into the corner it is heading for.
  setVar('--sorigin-x', snap.origin.x);
  setVar('--sorigin-y', snap.origin.y);
  stageSpringX = { value: surfaceX, velocity: stageSpringX.velocity };
  stageSpringY = { value: surfaceY, velocity: stageSpringY.velocity };
  startStageSpring();
});

function finishTransition() {
  stageTarget = null;
  stageInteractive = false;
  log('transition-complete');
  window.overlay.transitionComplete();
}

/** Start a drag from whatever the surface is doing right now. */
function beginGesture(event, handle) {
  if (event.button !== 0 || !stagePlan) return;
  handle.setPointerCapture(event.pointerId);

  // Taking over from a spring: keep the position *and* the speed it had.
  const running = stageRaf !== null;
  stopStageSpring();

  gesture = {
    pointerId: event.pointerId,
    // The work-area stage is our only coordinate system. Keep the pointer's
    // grab offset rather than recomputing an origin from an anchor/native rect.
    grabOffsetX: event.screenX - (stagePlan.stage.x + surfaceX),
    grabOffsetY: event.screenY - (stagePlan.stage.y + surfaceY),
    samples: [],
    travelled: 0,
    handle,
  };
  if (running) {
    gesture.samples.push({ x: surfaceX, y: surfaceY, timestamp: performance.now() });
  }
  setStageInteractive(true);
  window.overlay.dragStart();
}

function moveGesture(event) {
  if (!gesture || !stagePlan) return;
  const nextX = event.screenX - stagePlan.stage.x - gesture.grabOffsetX;
  const nextY = event.screenY - stagePlan.stage.y - gesture.grabOffsetY;
  gesture.travelled = Math.max(gesture.travelled, Math.hypot(nextX - surfaceX, nextY - surfaceY));
  setSurface(nextX, nextY);
  gesture.samples.push({ x: surfaceX, y: surfaceY, timestamp: performance.now() });
  if (gesture.samples.length > 16) gesture.samples.shift();
}

function endGesture(event) {
  if (!gesture) return;
  const g = gesture;
  gesture = null;
  if (g.handle.hasPointerCapture?.(event.pointerId)) {
    g.handle.releasePointerCapture(event.pointerId);
  }
  g.handle.style.transform = '';
  setStageInteractive(false);

  // A press that never travelled is a tap, not a drag.
  if (g.travelled <= TAP_SLOP && g.handle === fab) {
    window.overlay.expand();
    return;
  }

  const velocity = window.spring.velocity(g.samples);
  stageSpringX = { value: surfaceX, velocity: velocity.x };
  stageSpringY = { value: surfaceY, velocity: velocity.y };
  window.overlay.dragEnd({
    surface: { x: surfaceX, y: surfaceY, ...surfaceSize() },
    velocity,
  });
}

for (const handle of [fab, document.getElementById('chrome')]) {
  handle.addEventListener('pointerdown', (event) => {
    // Controls inside the strip are not drag handles — but the pill *is* a
    // button, so the guard only applies to the strip.
    if (handle !== fab && event.target.closest && event.target.closest('button')) return;
    if (handle === fab) fab.style.transform = 'scale(0.94)';
    beginGesture(event, handle);
  });
  handle.addEventListener('pointermove', moveGesture);
  handle.addEventListener('pointerup', endGesture);
  handle.addEventListener('pointercancel', endGesture);
}

window.addEventListener('blur', () => {
  if (gesture) endGesture({ pointerId: gesture.pointerId });
});

// Keyboard: the pill is a real button, so Enter and Space must work.
fab.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    event.preventDefault();
    window.overlay.expand();
  }
});

/**
 * While the magnet is running the stage is click-through, so a press could not
 * reach the surface to interrupt it. `forward: true` still delivers mousemove,
 * which is enough to notice the pointer arriving and take the mouse back.
 */
document.addEventListener('mousemove', (event) => {
  if (!stagePlan || gesture) return;
  const size = surfaceSize();
  const inside =
    event.clientX >= surfaceX &&
    event.clientX <= surfaceX + size.width &&
    event.clientY >= surfaceY &&
    event.clientY <= surfaceY + size.height;
  setStageInteractive(inside);
});

// Chromium mirrors the macOS "Reduce motion" setting; the main process has no
// reliable API for it, so the page reports it upward.
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const reportMotion = () => window.overlay.reportReducedMotion(motionQuery.matches);
motionQuery.addEventListener('change', reportMotion);
reportMotion();

window.overlay.getState().then((state) => {
  if (!state) return;
  document.body.classList.toggle('reduce-motion', Boolean(state.reducedMotion));
  if (state.mode === 'collapsed') {
    mode = 'expanded';
    applyMode('collapsed');
  }
});

// ── scroll to change clip ──────────────────────────────────────────────────
//
// The wheel cannot be read over a cross-origin player, so #wheelCatcher sits on
// top of the video (but not over YouTube's own control bar) purely to receive
// it. Trackpad and mouse both arrive here as wheel events.

const WHEEL_THRESHOLD = 40;
const WHEEL_COOLDOWN_MS = 420;

let wheelAccum = 0;
let wheelLock = 0;

wheelCatcher.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    if (mode !== 'expanded' || switching) return;

    const now = Date.now();
    if (now < wheelLock) return;

    // Reverse of a pending nudge cancels it, so a wobbly gesture does nothing.
    if (Math.sign(event.deltaY) !== Math.sign(wheelAccum)) wheelAccum = 0;
    wheelAccum += event.deltaY;
    if (Math.abs(wheelAccum) < WHEEL_THRESHOLD) return;

    const forward = wheelAccum > 0;
    wheelAccum = 0;
    // One clip per gesture: a trackpad flick emits dozens of events.
    wheelLock = now + WHEEL_COOLDOWN_MS;
    void (forward ? goNext() : goPrev());
  },
  { passive: false },
);

// The layer covers the video, so a click on it has to do what a click on the
// player would: toggle playback.
wheelCatcher.addEventListener('click', () => {
  if (front.kind === 'yt' && front.player) {
    try {
      const playing = front.player.getPlayerState() === 1;
      if (playing) front.player.pauseVideo();
      else front.player.playVideo();
      userPaused = playing;
    } catch {
      /* not ready yet */
    }
    return;
  }
  const el = front.pane.querySelector('video');
  if (!el) return;
  if (el.paused) {
    userPaused = false;
    el.play().catch(() => {});
  } else {
    userPaused = true;
    el.pause();
  }
});


// ── Animation Lab ──────────────────────────────────────────────────────────
//
// Development only: main enables it from an environment variable, so it cannot
// appear in a normal run. It replays transitions and shows what the physics is
// actually doing.

let fpsFrames = 0;
let fpsSince = performance.now();

function labTick(now) {
  fpsFrames += 1;
  if (now - fpsSince >= 500) {
    labFps.textContent = Math.round((fpsFrames * 1000) / (now - fpsSince)) + ' fps';
    labVel.textContent = 'v ' + labVelocity.toFixed(2);
    fpsFrames = 0;
    fpsSince = now;
  }
  requestAnimationFrame(labTick);
}

window.overlay.onAnimationLab((payload) => {
  const enabled = payload === true || (payload && payload.enabled);
  if (payload && typeof payload.timeScale === 'number') timeScale = payload.timeScale;
  if (!enabled) return;
  if (!document.body.classList.contains('lab')) {
    document.body.classList.add('lab');
    // The meter only runs when the panel is open, so an ordinary run has no
    // extra frame callback at all.
    requestAnimationFrame(labTick);
  }
});

document.getElementById('lab').addEventListener('click', (event) => {
  const command = event.target && event.target.getAttribute('data-lab');
  if (command) window.overlay.labCommand(command);
});
