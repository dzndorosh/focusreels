const enabled = document.getElementById('enabled');
const muted = document.getElementById('muted');
const alwaysOnTop = document.getElementById('alwaysOnTop');
const launchAtLogin = document.getElementById('launchAtLogin');
const sources = [...document.querySelectorAll('.source')];
let current = null;

function render(settings) {
  if (!settings || typeof settings !== 'object') return;
  current = settings;
  enabled.checked = settings.enabled !== false;
  muted.checked = settings.muted === false;
  alwaysOnTop.checked = settings.alwaysOnTop !== false;
  launchAtLogin.checked = settings.launchAtLogin === true;
  for (const input of sources) input.checked = settings.sources?.[input.dataset.source]?.enabled === true;
}

function update(patch) {
  void window.focusreelsSettings.update(patch);
}

enabled.addEventListener('change', () => update({ enabled: enabled.checked }));
muted.addEventListener('change', () => update({ muted: !muted.checked }));
alwaysOnTop.addEventListener('change', () => update({ alwaysOnTop: alwaysOnTop.checked }));
launchAtLogin.addEventListener('change', () => update({ launchAtLogin: launchAtLogin.checked }));
for (const input of sources) input.addEventListener('change', () => {
  const source = input.dataset.source;
  update({
    sources: {
      ...current.sources,
      [source]: { ...current.sources[source], enabled: input.checked },
    },
  });
});
window.focusreelsSettings.onChanged(render);
window.focusreelsSettings.get().then(render);
