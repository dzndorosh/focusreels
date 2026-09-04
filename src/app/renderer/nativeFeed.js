/* Development-only production seam. It owns native scrolling and stable feed
   slides; the legacy renderer remains the default when the URL flag is absent. */
(() => {
  const enabled = new URLSearchParams(location.search).get('nativeScroll') === '1';
  if (!enabled) return;
  const iframeHover = new URLSearchParams(location.search).get('nativeIframeHover') === '1';
  const chromeless = new URLSearchParams(location.search).get('nativeChromeless') === '1';

  const feed = document.getElementById('nativeFeed');
  document.body.classList.add('native-scroll');
  if (iframeHover) document.body.classList.add('native-iframe-hover');
  const curtain = document.getElementById('curtain');
  const title = document.getElementById('title');
  const channel = document.getElementById('channel');
  const nextButton = document.getElementById('next');
  const previousButton = document.getElementById('previous');
  const muteButton = document.getElementById('mute');
  const ids = [];
  const slides = [];
  const players = [];
  const ready = [];
  const playing = [];
  const prewarmed = [];
  let active = -1;
  let muted = true;
  let apiPromise = null;
  let loadingNext = false;
  let catalogConsumed = 0;

  const trace = (event, videoId, extra = {}) => {
    if (window.__FOCUSREELS_E2E__) console.log('[feed-trace]' + JSON.stringify({
      timestamp: new Date().toISOString(), event, ...(videoId ? { videoId } : {}), ...extra,
    }));
  };

  function loadApi() {
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      if (window.YT?.Player) return resolve(window.YT);
      window.onYouTubeIframeAPIReady = () => resolve(window.YT);
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => reject(new Error('iframe api blocked'));
      document.head.appendChild(script);
    });
    return apiPromise;
  }

  function render(video) {
    title.textContent = video?.title || 'Nothing to play';
    channel.textContent = video?.channelTitle || '';
  }

  function applyMute(index) {
    const player = players[index];
    if (!player) return;
    player.mute();
  }

  function prewarm(index) {
    const player = players[index];
    if (!player || !ready[index] || prewarmed[index] || index === active) return;
    prewarmed[index] = true;
    applyMute(index);
    trace('prewarm-start', ids[index].id);
    player.playVideo();
  }

  function onState(index, state) {
    if (state === YT.PlayerState.PLAYING) {
      playing[index] = true;
      trace('player-playing', ids[index].id, { active: index === active, prewarm: Boolean(prewarmed[index]) });
      if (index !== active && prewarmed[index]) trace('prewarm-playing-kept', ids[index].id);
      if (index === active) curtain.classList.add('gone');
    } else {
      playing[index] = false;
      if (state === YT.PlayerState.BUFFERING) trace('player-buffering', ids[index].id);
      if (state === YT.PlayerState.PAUSED) trace('player-paused', ids[index].id);
    }
    if (state === YT.PlayerState.ENDED && index === active && index < slides.length - 1) {
      trace('player-ended', ids[index].id);
      slides[index + 1].scrollIntoView({ behavior: 'auto', block: 'start' });
    }
  }

  async function mount(index) {
    const video = ids[index];
    const host = document.createElement('div');
    host.className = 'native-player-host';
    slides[index].prepend(host);
    const player = new (await loadApi()).Player(host, {
      videoId: video.id,
      playerVars: { autoplay: 0, mute: 1, controls: chromeless ? 0 : 1, playsinline: 1, rel: 0, enablejsapi: 1 },
      events: {
        onReady: () => {
          ready[index] = true;
          applyMute(index);
          trace('player-ready', video.id);
          if (index === active) {
            if (!muted) player.unMute();
            player.playVideo();
          }
          else if (Math.abs(index - active) === 1) prewarm(index);
        },
        onStateChange: (event) => onState(index, event.data),
        onError: (event) => trace('player-error', video.id, { errorCode: event.data }),
      },
    });
    players[index] = player;
    trace('player-created', video.id);
  }

  function append(video) {
    const index = ids.length;
    ids.push(video);
    const slide = document.createElement('section');
    slide.className = 'native-slide';
    slide.dataset.index = String(index);
    const input = document.createElement('div');
    input.className = 'native-input-surface';
    input.setAttribute('aria-hidden', 'true');
    slide.append(input);
    feed.append(slide);
    slides.push(slide);
    ready.push(false); playing.push(false); prewarmed.push(false);
    void mount(index);
  }

  async function ensureNext() {
    if (loadingNext) return;
    loadingNext = true;
    try {
      const video = await window.feed.next();
      if (video) {
        if (ids[catalogConsumed]?.id === video.id) catalogConsumed += 1;
        else { append(video); catalogConsumed += 1; }
        const upcoming = await window.feed.peek();
        if (upcoming && !ids.some((item) => item.id === upcoming.id)) append(upcoming);
        trace('video-selected', video.id, { reason: 'native-next' });
      }
    } finally { loadingNext = false; }
  }

  function settle(index) {
    if (index === active || !ids[index]) return;
    const from = active;
    active = index;
    render(ids[index]);
    reportImpression(ids[index]);
    trace('active-slide-changed', ids[index].id, { fromIndex: from, toIndex: index });
    if (Math.abs(index - from) > 1) trace('multi-skip-observed', ids[index].id, { fromIndex: from, toIndex: index });
    players.forEach((player, playerIndex) => {
      if (!player || !ready[playerIndex]) return;
      player.mute();
      if (playerIndex === active) {
        // A prewarmed neighbour may already be several seconds in. Every
        // settled visit must begin at zero.
        player.seekTo(0, true);
        if (!muted) player.unMute();
        player.playVideo();
      }
      else { player.pauseVideo(); player.seekTo(0, true); }
    });
    if (index === ids.length - 1) void ensureNext();
  }

  async function show(status) {
    feed.replaceChildren(); ids.length = 0; slides.length = 0; players.length = 0;
    ready.length = 0; playing.length = 0; prewarmed.length = 0; active = -1;
    const first = await window.feed.next();
    if (!first) return;
    catalogConsumed = 1;
    active = 0;
    append(first);
    const upcoming = await window.feed.peek();
    if (upcoming) append(upcoming);
    render(first);
    trace('video-selected', first.id, { reason: 'native-initial' });
    reportImpression(first);
    slides[0].scrollIntoView({ behavior: 'auto', block: 'start' });
    if (status) curtain.classList.remove('gone');
  }

  function reportImpression(video) {
    window.feed.reportFeedback({ videoId: video.id, category: video.category || 'other', impressions: 1, completedViews: 0, quickSkips: 0, lastViewedAt: new Date().toISOString() });
  }

  nextButton.addEventListener('click', () => {
    if (active < slides.length - 1) slides[active + 1].scrollIntoView({ behavior: 'auto', block: 'start' });
  });
  previousButton?.addEventListener('click', () => {
    if (active > 0) slides[active - 1].scrollIntoView({ behavior: 'auto', block: 'start' });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const destination = event.key === 'ArrowDown' ? active + 1 : active - 1;
    if (destination < 0 || destination >= slides.length) return;
    event.preventDefault();
    slides[destination].scrollIntoView({ behavior: 'auto', block: 'start' });
  });
  feed.addEventListener('scroll', () => {
    const nearest = Math.max(0, Math.min(slides.length - 1, Math.round(feed.scrollTop / feed.clientHeight)));
    prewarm(nearest);
  }, { passive: true });
  feed.addEventListener('scrollend', () => {
    const destination = Math.max(0, Math.min(slides.length - 1, Math.round(feed.scrollTop / feed.clientHeight)));
    trace('native-scroll-end', undefined, { toIndex: destination });
    settle(destination);
  });

  window.FocusReelsNativeFeed = {
    show, hide: () => players.forEach((player) => player?.pauseVideo()),
    next: () => { if (active < slides.length - 1) slides[active + 1].scrollIntoView({ behavior: 'auto', block: 'start' }); },
    isPlaying: () => Boolean(playing[active]),
    pause: () => players[active]?.pauseVideo(),
    resume: () => players[active]?.playVideo(),
    setMuted: (value) => {
      muted = Boolean(value);
      players.forEach((player, index) => {
        if (!player) return;
        // Prewarm players are always muted; only the settled active player can
        // become audible.
        player.mute();
        if (index === active && !muted) player.unMute();
      });
    },
  };
})();
