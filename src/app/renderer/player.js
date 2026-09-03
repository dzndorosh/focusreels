/* The player knows a playlist of local files, four signals (show / status /
   hide / settings), its controls, and one gesture. It never learns what the
   agent is doing — only that it is doing something. */

const frame = document.getElementById('frame');
const stage = document.getElementById('stage');
const slideA = document.getElementById('slideA');
const slideB = document.getElementById('slideB');
const placeholder = document.getElementById('placeholder');
const hint = document.getElementById('hint');
const label = document.getElementById('label');
const elapsedEl = document.getElementById('elapsed');
const parallelEl = document.getElementById('parallel');

const playPause = document.getElementById('playPause');
const playPauseIcon = document.getElementById('playPauseIcon');
const muteBtn = document.getElementById('mute');
const muteIcon = document.getElementById('muteIcon');
const audioPill = document.getElementById('audio');
const volume = document.getElementById('volume');
const track = document.getElementById('track');
const fill = document.getElementById('fill');
const knob = document.getElementById('knob');
const curEl = document.getElementById('cur');
const durEl = document.getElementById('dur');
const likeBtn = document.getElementById('like');
const likeCount = document.getElementById('likeCount');
const captionsBtn = document.getElementById('captions');

const SOURCE_LABELS = {
  cursor: 'Cursor',
  'vscode-copilot': 'Copilot',
  jetbrains: 'JetBrains AI',
  'claude-code': 'Claude Code',
  demo: 'Demo',
};

const ICON_PLAY = 'M8 5l11 7-11 7z';
const ICON_PAUSE = 'M7 5h4v14H7zM13 5h4v14h-4z';
const ICON_MUTED = 'M11 5 6 9H3v6h3l5 4zM22 9.4 20.6 8 18 10.6 15.4 8 14 9.4l2.6 2.6L14 14.6 15.4 16 18 13.4 20.6 16 22 14.6 19.4 12z';
const ICON_LOW = 'M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7l-1.4-1.4a3 3 0 0 0 0-4.2z';
const ICON_HIGH = 'M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7l-1.4-1.4a3 3 0 0 0 0-4.2zM18 5.6a9 9 0 0 1 0 12.8l-1.4-1.4a7 7 0 0 0 0-10z';

let playlist = [];
/** index of the clip on screen */
let pos = 0;
/* Consecutive load failures. A folder of files the codec cannot read would
   otherwise spin error → next → error forever, burning CPU behind a
   permanently blank overlay. */
let failures = 0;
let startedAt = Date.now();
let ticker = null;
/* The user's explicit pause survives clip changes; an automatic advance must
   not quietly resume playback they stopped. */
let userPaused = false;
let swipeEnabled = true;

/** the slide showing now, and the one staged next to it during a gesture */
let front = slideA;
let back = slideB;

const videoOf = (slide) => slide.querySelector('video');
const current = () => videoOf(front);

// ── playlist ───────────────────────────────────────────────────────────────

function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function wrap(i) {
  if (playlist.length === 0) return 0;
  return ((i % playlist.length) + playlist.length) % playlist.length;
}

function srcFor(index) {
  const path = playlist[wrap(index)];
  // Only ever a local file path handed down by the main process.
  return 'file://' + encodeURI(path).replace(/#/g, '%23');
}

function mount(slide, index) {
  const video = videoOf(slide);
  video.src = srcFor(index);
  video.loop = playlist.length === 1;
  video.currentTime = 0;
}

function setEmpty(empty) {
  placeholder.classList.toggle('on', empty);
  stage.classList.toggle('hidden', empty);
}

async function loadPlaylist() {
  try {
    playlist = shuffle(await window.focusreels.playlist());
  } catch {
    playlist = [];
  }
  setEmpty(playlist.length === 0);
  pos = 0;
}

function playFront() {
  const video = current();
  if (userPaused) return;
  const p = video.play();
  if (p && typeof p.catch === 'function') p.catch(() => {});
}

/** Load `pos` into the front slide and start it. Used on show and on failure. */
function showCurrent() {
  if (playlist.length === 0) return;
  park(1);
  if (failures >= playlist.length) {
    // One full pass with nothing playable: stop rather than spin.
    videoOf(front).removeAttribute('src');
    videoOf(front).load();
    setEmpty(true);
    return;
  }
  mount(front, pos);
  syncAudio();
  playFront();
}

// ── swiping ────────────────────────────────────────────────────────────────
//
// `direction` is +1 for "next" (drag up) and -1 for "previous" (drag down).
// The incoming clip is mounted into the back slide and parked one screen away,
// so the whole gesture is a single translate of the stage.

let dragging = false;
let dragStartY = 0;
let dragDy = 0;
let dragDirection = 0;
let animating = false;

function height() {
  return frame.getBoundingClientRect().height || 1;
}

/**
 * The back slide is stacked on top of the front one, so it must always sit off
 * the frame — otherwise its empty video paints black over the clip that plays.
 * Default parking is below; a "previous" gesture moves it above.
 */
function park(direction) {
  back.style.transform = `translateY(${direction < 0 ? -100 : 100}%)`;
  front.style.transform = 'translateY(0)';
}

function prepare(direction) {
  if (direction === dragDirection) return;
  dragDirection = direction;
  park(direction);
  mount(back, pos + direction);
  const video = videoOf(back);
  video.pause();
}

function moveStage(dy) {
  stage.style.transform = `translateY(${dy}px)`;
}

function resetStage() {
  stage.classList.remove('animating');
  stage.style.transform = '';
  dragDirection = 0;
  park(1); // back below, front in view
}

/** Finish a gesture: either commit to the staged clip, or snap back. */
function settle(commit) {
  if (animating) return;
  const direction = dragDirection;
  if (!commit || direction === 0) {
    animating = true;
    stage.classList.add('animating');
    moveStage(0);
    window.setTimeout(() => {
      animating = false;
      const staged = videoOf(back);
      staged.pause();
      staged.removeAttribute('src');
      resetStage();
    }, 260);
    return;
  }

  animating = true;
  stage.classList.add('animating');
  moveStage(direction > 0 ? -height() : height());

  window.setTimeout(() => {
    // The staged slide becomes the front one; roles swap, no reload, no flash.
    const leaving = videoOf(front);
    leaving.pause();
    leaving.removeAttribute('src');

    const t = front;
    front = back;
    back = t;

    pos = wrap(pos + direction);
    animating = false;
    resetStage();
    syncAudio();
    playFront();
    renderPlayState();
    renderProgress();
  }, 260);
}

function go(direction) {
  if (playlist.length < 2 || animating || dragging) return;
  prepare(direction);
  settle(true);
}

/* Asking for a different clip is an explicit request for something to watch,
   so it lifts an earlier pause. The pause button is right there to undo it. */
function requestedByGesture() {
  userPaused = false;
}

// pointer drag over the video body
stage.addEventListener('pointerdown', (event) => {
  if (!swipeEnabled || playlist.length < 2 || animating) return;
  dragging = true;
  dragStartY = event.clientY;
  dragDy = 0;
  stage.setPointerCapture?.(event.pointerId);
  stage.classList.remove('animating');
});

stage.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  dragDy = event.clientY - dragStartY;
  if (Math.abs(dragDy) < 4) return;
  prepare(dragDy < 0 ? 1 : -1);
  // Resist past the edge so the gesture always feels bounded.
  const limit = height();
  const eased = Math.abs(dragDy) > limit ? Math.sign(dragDy) * limit : dragDy;
  moveStage(eased);
});

const endDrag = (event) => {
  if (!dragging) return;
  dragging = false;
  if (stage.hasPointerCapture?.(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  // A quarter of the frame is enough to mean it; anything less snaps back.
  const commit = Math.abs(dragDy) > height() * 0.25;
  if (commit) requestedByGesture();
  settle(commit);
};

stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

// two-finger scroll / wheel
let wheelAccum = 0;
let wheelLock = 0;

stage.addEventListener(
  'wheel',
  (event) => {
    if (!swipeEnabled || playlist.length < 2) return;
    event.preventDefault();
    const now = Date.now();
    if (now < wheelLock) return;
    wheelAccum += event.deltaY;
    if (Math.abs(wheelAccum) < 40) return;
    requestedByGesture();
    go(wheelAccum > 0 ? 1 : -1);
    wheelAccum = 0;
    // One notch per gesture: a trackpad flick emits dozens of events.
    wheelLock = now + 420;
  },
  { passive: false },
);

// ── playback ───────────────────────────────────────────────────────────────

function onEnded(event) {
  if (event.target !== current()) return;
  go(1);
}

function onPlaying(event) {
  if (event.target !== current()) return;
  /* A clip that starts playing proves the codec works — forget earlier
     failures, so one bad file never counts against a later good one. */
  failures = 0;
  setEmpty(false);
}

function onError(event) {
  if (event.target !== current()) return;
  failures += 1;
  pos = wrap(pos + 1);
  showCurrent();
}

for (const slide of [slideA, slideB]) {
  const video = videoOf(slide);
  video.addEventListener('ended', onEnded);
  video.addEventListener('playing', onPlaying);
  video.addEventListener('error', onError);
  video.addEventListener('play', renderPlayState);
  video.addEventListener('pause', renderPlayState);
  video.addEventListener('timeupdate', (e) => {
    if (e.target === current() && !scrubbing) renderProgress();
  });
  video.addEventListener('loadedmetadata', (e) => {
    if (e.target === current()) renderProgress();
  });
}

function renderPlayState() {
  const paused = current().paused;
  playPauseIcon.setAttribute('d', paused ? ICON_PLAY : ICON_PAUSE);
  playPause.title = paused ? 'Play' : 'Pause';
  playPause.setAttribute('aria-label', playPause.title);
}

playPause.addEventListener('click', () => {
  if (current().paused) {
    userPaused = false;
    playFront();
  } else {
    userPaused = true;
    current().pause();
  }
});

// ── audio ──────────────────────────────────────────────────────────────────

/** Both slides carry the same audio state, so a swap never changes the volume. */
function syncAudio() {
  const source = current();
  for (const slide of [slideA, slideB]) {
    const video = videoOf(slide);
    if (video === source) continue;
    video.muted = source.muted;
    video.volume = source.volume;
  }
  renderAudio();
}

function renderAudio() {
  const video = current();
  const level = video.muted ? 0 : video.volume;
  muteIcon.setAttribute('d', level === 0 ? ICON_MUTED : level < 0.5 ? ICON_LOW : ICON_HIGH);
  muteBtn.title = video.muted ? 'Unmute' : 'Mute';
  muteBtn.setAttribute('aria-label', muteBtn.title);
  volume.value = String(video.volume);
  volume.style.setProperty('--pct', `${Math.round(level * 100)}%`);
}

function persistAudio() {
  window.focusreels.saveAudio(current().muted, current().volume);
}

muteBtn.addEventListener('click', () => {
  const video = current();
  video.muted = !video.muted;
  // Unmuting a track sitting at zero should make a sound, not pretend to.
  if (!video.muted && video.volume === 0) video.volume = 0.6;
  audioPill.classList.toggle('open', !video.muted);
  syncAudio();
  persistAudio();
});

volume.addEventListener('input', () => {
  const video = current();
  video.volume = Number(volume.value);
  if (video.volume > 0 && video.muted) video.muted = false;
  if (video.volume === 0) video.muted = true;
  syncAudio();
});

// Save on release, not on every drag frame: each save round-trips through
// settings.json, and that is not a per-pixel operation.
volume.addEventListener('change', persistAudio);

// ── scrubbing ──────────────────────────────────────────────────────────────

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

let scrubbing = false;

function renderProgress() {
  const video = current();
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
  const ratio = duration > 0 ? Math.min(1, video.currentTime / duration) : 0;
  fill.style.width = `${ratio * 100}%`;
  knob.style.left = `${ratio * 100}%`;
  curEl.textContent = formatTime(video.currentTime);
  durEl.textContent = formatTime(duration);
}

function seekFromPointer(event) {
  const rect = track.getBoundingClientRect();
  if (rect.width === 0) return;
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  fill.style.width = `${ratio * 100}%`;
  knob.style.left = `${ratio * 100}%`;
  const video = current();
  if (Number.isFinite(video.duration) && video.duration > 0) {
    video.currentTime = ratio * video.duration;
    curEl.textContent = formatTime(video.currentTime);
  }
}

track.addEventListener('pointerdown', (event) => {
  scrubbing = true;
  track.classList.add('dragging');
  track.setPointerCapture(event.pointerId);
  seekFromPointer(event);
});
track.addEventListener('pointermove', (event) => {
  if (scrubbing) seekFromPointer(event);
});
const endScrub = (event) => {
  if (!scrubbing) return;
  scrubbing = false;
  track.classList.remove('dragging');
  if (track.hasPointerCapture?.(event.pointerId)) track.releasePointerCapture(event.pointerId);
  renderProgress();
};
track.addEventListener('pointerup', endScrub);
track.addEventListener('pointercancel', endScrub);

// ── like / captions (UI only for now) ──────────────────────────────────────

let liked = false;
const BASE_LIKES = 41208;

likeBtn.addEventListener('click', () => {
  liked = !liked;
  likeBtn.classList.toggle('on', liked);
  likeBtn.setAttribute('aria-pressed', String(liked));
  likeCount.textContent = (BASE_LIKES + (liked ? 1 : 0)).toLocaleString('en-US').replace(/,/g, ' ');
  likeBtn.classList.remove('bump');
  void likeBtn.offsetWidth; // restart the animation
  likeBtn.classList.add('bump');
});

let captionsOn = false;
captionsBtn.addEventListener('click', () => {
  captionsOn = !captionsOn;
  captionsBtn.classList.toggle('on', captionsOn);
  captionsBtn.setAttribute('aria-pressed', String(captionsOn));
});

// ── the pointer grab ───────────────────────────────────────────────────────
//
// The window ignores the mouse by default, so the IDE underneath keeps every
// click. `forward: true` still delivers mousemove here, which is what lets us
// notice the pointer arriving and ask the main process for the mouse — then
// hand it straight back on the way out.
//
// With swiping on, the whole surface has to take the mouse while hovered: a
// gesture over the video body cannot be seen otherwise. With it off, only the
// control zones grab and the video body stays click-through.

let grabbed = false;

function setGrab(want) {
  if (want === grabbed) return;
  grabbed = want;
  window.focusreels.setPointerGrab(want);
}

function overZone(x, y) {
  const zones = swipeEnabled ? [frame] : document.querySelectorAll('.zone');
  for (const zone of zones) {
    const r = zone.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // A few px of slack keeps a fast pointer from tearing off a small button.
    if (x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 6 && y <= r.bottom + 6) return true;
  }
  return false;
}

let hintShown = false;

function onMove(event) {
  frame.classList.add('hovered');
  if (!hintShown && swipeEnabled && playlist.length > 1) {
    hintShown = true;
    frame.classList.add('hint-on');
    window.setTimeout(() => frame.classList.remove('hint-on'), 1800);
  }
  setGrab(scrubbing || dragging || overZone(event.clientX, event.clientY));
}

document.addEventListener('mousemove', onMove);
document.addEventListener('pointermove', onMove);

function leave() {
  if (scrubbing || dragging) return; // a drag may travel outside the window
  frame.classList.remove('hovered');
  frame.classList.remove('hint-on');
  audioPill.classList.remove('open');
  setGrab(false);
}

document.addEventListener('mouseleave', leave);
window.addEventListener('blur', leave);

// Safety net: if the pointer leaves without a mouseleave (it happens when the
// window is click-through), drop the grab once nothing has moved for a while.
let idleTimer = null;
document.addEventListener('mousemove', () => {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(leave, 2500);
});

// ── status ─────────────────────────────────────────────────────────────────

function renderStatus(status) {
  label.textContent = (SOURCE_LABELS[status.source] || status.source) + ' is working…';
  parallelEl.textContent = status.parallel > 1 ? `×${status.parallel}` : '';
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

window.focusreels.onSettings((s) => {
  if (!s) return;
  const video = current();
  // Ignore an echo of what we just saved — applying it mid-drag would fight the
  // control the user is holding. A change from the tray still lands here.
  if (typeof s.muted === 'boolean' && s.muted !== video.muted) video.muted = s.muted;
  if (typeof s.volume === 'number' && Math.abs(s.volume - video.volume) > 0.001) {
    video.volume = s.volume;
  }
  if (typeof s.swipe === 'boolean') swipeEnabled = s.swipe;
  syncAudio();
});

window.focusreels.onShow(async (status) => {
  if (playlist.length === 0) await loadPlaylist();
  failures = 0; // a new turn re-tries the folder, in case it changed
  userPaused = false;
  resetStage();
  showCurrent();
  renderStatus(status);
  startTicker();
  requestAnimationFrame(() => frame.classList.add('visible'));
});

window.focusreels.onStatus(renderStatus);

window.focusreels.onHide(() => {
  frame.classList.remove('visible');
  leave();
  stopTicker();
  // let the fade finish before we stop pulling frames
  setTimeout(() => {
    for (const slide of [slideA, slideB]) videoOf(slide).pause();
  }, 240);
});

renderPlayState();
renderAudio();
renderProgress();
loadPlaylist();
