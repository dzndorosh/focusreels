const get = (path) => fetch(path).then((r) => r.ok ? r.json() : {}).catch(() => ({}));

Promise.all([
  get('youtube-catalog.json'),
  get('../../artifacts/youtube-catalog/seed-channels.json'),
  get('../../artifacts/youtube-catalog/candidate-videos.json'),
  get('../../artifacts/youtube-catalog/permanent-candidates.json'),
]).then(([catalog, seed, candidate, permanent]) => {
  const mode = document.querySelector('#mode');
  const channel = document.querySelector('#channel');
  const gallery = document.querySelector('#gallery');
  const reviews = JSON.parse(localStorage.getItem('candidate-review') || '{}');
  const seeds = seed.videos || [];
  const candidates = (candidate.channels || []).flatMap((c) => (c.videos || []).map((v) => ({ ...v, category: 'other' })));
  const permanentVideos = (permanent.channels || []).flatMap((c) => (c.eligible || []).map((v) => ({ ...v, id: v.videoId, enabled: true })));
  const production = catalog.videos || [];
  const metadata = (v) => seeds.find((s) => s.videoId === v.videoId) || v;
  const reviewItem = (v) => ({ id: v.videoId, videoId: v.videoId, category: 'other', weight: 1, enabled: true, addedAt: v.publishedAt });
  function render() {
    const raw = mode.value === 'seed' ? seeds.map(reviewItem) : mode.value === 'candidate' ? candidates : mode.value === 'permanent' ? permanentVideos : production;
    const unique = [...new Map(raw.filter((v) => v.videoId).map((v) => [v.videoId, v])).values()];
    const channels = [...new Set(unique.map((v) => metadata(v).channelId).filter(Boolean))];
    channel.replaceChildren(new Option('All', ''), ...channels.map((id) => new Option(id, id)));
    const visible = unique.filter((v) => !channel.value || metadata(v).channelId === channel.value);
    gallery.replaceChildren(); document.querySelector('#count').textContent = ` ${visible.length} videos`;
    for (const v of visible) {
      const m = metadata(v); const article = document.createElement('article'); article.dataset.videoId = v.videoId;
      article.innerHTML = `<iframe title="${v.videoId}" allow="autoplay; encrypted-media" src="https://www.youtube.com/embed/${encodeURIComponent(v.videoId)}?playsinline=1&rel=0"></iframe><div><b>${v.videoId}</b> · ${v.category || 'other'}<br><small>${m.channelId || ''} · ${m.channelTitle || ''}<br>${m.title || ''}<br>${m.duration || ''} · ${m.publishedAt || ''}</small><select class="decision"><option value="">Review…</option><option>approve</option><option>approve-channel</option><option>wrong-format</option><option>irrelevant</option><option>advertising</option><option>unsafe</option><option>broken</option><option>reject-channel</option></select></div><button type="button">Block</button>`;
      const decision = article.querySelector('.decision'); decision.value = reviews[v.videoId] || ''; decision.onchange = () => { reviews[v.videoId] = decision.value; localStorage.setItem('candidate-review', JSON.stringify(reviews)); }; article.querySelector('button').onclick = () => { article.dataset.blocked = v.videoId; article.style.opacity = '.4'; }; gallery.append(article);
    }
  }
  const download = (name, data) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = name; a.click(); };
  mode.onchange = render; channel.onchange = render;
  document.querySelector('#export').onclick = () => download('youtube-video-blocklist.json', { schemaVersion: 1, videoIds: [...document.querySelectorAll('[data-blocked]')].map((x) => x.dataset.videoId) });
  document.querySelector('#exportReview').onclick = () => { if (mode.value === 'permanent') { const byChannel = [...new Set(permanentVideos.map((v) => v.channelId))].map((id) => { const v = permanentVideos.find((x) => x.channelId === id); const approved = permanentVideos.filter((x) => x.channelId === id).some((x) => reviews[x.videoId] === 'approve-channel'); return { channelId: id, channelTitle: v.channelTitle, category: v.category || 'other', decision: approved ? 'approve-channel' : 'reject-channel' }; }); download('permanent-channel-review.json', { channels: byChannel }); } else download('candidate-review.json', reviews); };
  document.querySelector('#exportTest').onclick = () => { const approved = new Set(Object.entries(reviews).filter(([, d]) => d === 'approve').map(([id]) => id)); download('youtube-sources.test.json', { purpose: 'development-test-only', schemaVersion: 1, sources: [...new Set(candidates.filter((v) => approved.has(v.videoId)).map((v) => v.channelId))].map((channelId) => ({ channelId, category: 'other', weight: 1, enabled: true, maxVideos: 5 })) }); };
  document.querySelector('#import').onchange = (event) => { const file = event.target.files[0]; if (file) file.text().then((text) => { Object.assign(reviews, JSON.parse(text)); localStorage.setItem('candidate-review', JSON.stringify(reviews)); render(); }); };
  render();
});
