import { fullscreenAvailable, isFullscreen, toggleFullscreen as toggleElement } from './fullscreen.js';

export function openDisplaySettings({ openDialog: showModal, notify: toast, pause, toggleFullscreen = () => toggleElement(document.documentElement) }) {
  pause();
  const $ = id => document.getElementById(id);
  const modal = $('modal');
  showModal(`<p class="eyebrow">GLOBAL</p><h2>Display settings</h2><div class="settings-row"><button id="fullscreen-button" class="primary">⛶ ${isFullscreen() ? 'Exit' : 'Enter'} fullscreen</button></div><div class="settings-row"><label for="theme-choice">Appearance <select id="theme-choice"><option value="dark">Dark</option><option value="light">Light</option></select></label></div><div class="settings-row"><label for="accent-color">Accent color <input id="accent-color" type="color" value="${document.documentElement.style.getPropertyValue('--accent') || '#f1ce50'}"/></label><div class="palette-options">${[['#f1ce50','Honey'],['#a3e88b','Green'],['#74d9e6','Cyan'],['#ee9ab4','Pink']].map(([color,label]) => `<button data-accent="${color}" aria-label="${label} accent" title="${label}" style="background:${color}"></button>`).join('')}</div></div><div class="settings-row"><label for="compact-ui">Compact interface <input id="compact-ui" type="checkbox" ${document.body.classList.contains('compact-ui') ? 'checked' : ''}/></label></div>`);
  $('fullscreen-button').disabled = !fullscreenAvailable();
  $('fullscreen-button').onclick = async () => { try { modal.close(); await toggleFullscreen(); } catch { toast('Fullscreen unavailable in this browser.'); } };
  $('compact-ui').onchange = e => document.body.classList.toggle('compact-ui', e.target.checked);
  $('theme-choice').value = document.documentElement.dataset.theme || 'dark';
  $('theme-choice').onchange = e => { document.documentElement.dataset.theme = e.target.value; };
  const setAccent = color => { document.documentElement.style.setProperty('--accent', color); $('accent-color').value = color; };
  $('accent-color').oninput = e => setAccent(e.target.value);
  document.querySelectorAll('[data-accent]').forEach(button => { button.onclick = () => setAccent(button.dataset.accent); });
}
