/* global focusreelsSettings */

const form = document.querySelector('main');
const saved = document.querySelector('#saved');
let saveTimer;

function controls() {
  return [...document.querySelectorAll('input[name], select[name]')];
}

function showSaved() {
  saved.classList.add('visible');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saved.classList.remove('visible'), 1000);
}

function setValue(control, value) {
  if (control.type === 'checkbox') control.checked = Boolean(value);
  else control.value = String(value);
  const output = document.querySelector(`output[for="${control.name}"]`);
  if (output) output.textContent = control.name === 'volume' || control.name === 'opacity'
    ? `${Math.round(Number(value) * 100)}%`
    : String(value);
}

function render(settings) {
  controls().forEach((control) => setValue(control, settings[control.name]));
}

function patchFor(control) {
  if (control.type === 'checkbox') return { [control.name]: control.checked };
  if (control.type === 'number' || control.type === 'range') return { [control.name]: Number(control.value) };
  return { [control.name]: control.value };
}

async function save(control) {
  const settings = await focusreelsSettings.update(patchFor(control));
  if (settings) render(settings);
  showSaved();
}

form.addEventListener('change', (event) => {
  const control = event.target;
  if (control.matches('input[name], select[name]')) void save(control);
});
form.addEventListener('input', (event) => {
  const control = event.target;
  if (control.matches('input[type="range"]')) void save(control);
});
document.querySelector('#open-file').addEventListener('click', () => void focusreelsSettings.openFile());

focusreelsSettings.onChanged(render);
void focusreelsSettings.get().then(render);
