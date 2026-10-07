import * as THREE from 'three';
import { createGameHost } from './game-host.js';
import { openDisplaySettings } from './display-settings.js';
import { toggleFullscreen } from './fullscreen.js';
import './style.css';

// Folder discovery lets contributors add a game without editing this shell.
const modules = import.meta.glob('./games/*/index.js', { eager: true, import: 'game' });
import.meta.glob('./games/*/style.css', { eager: true });
const games = Object.values(modules).sort((a, b) => a.order - b.order);
const hexIcon = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m16 2 12 7v14l-12 7-12-7V9Z" stroke="currentColor" stroke-width="2"/><path d="M11 10h10v3H11zm-2 6h14v3H9zm2 6h10v3H11Z" fill="currentColor"/></svg>';
document.querySelector('#app').innerHTML = `
  <header class="masthead"><a class="brand" href="/">${hexIcon}<span>The CreatorHive... Hive... The Game!</span></a>
    <nav aria-label="Games"></nav><button id="settings-button" class="global-settings" aria-label="Global settings" title="Global settings">⚙</button></header>
  <main><section class="arena"><div id="world"></div><div id="game-ui" class="mode-ui"></div><div id="toast" class="toast" role="status" aria-live="polite"></div></section><section id="controls" class="controls" aria-label="Game controls"></section></main>
  <dialog id="modal"><button id="close-modal" aria-label="Close dialog">×</button><div id="modal-content"></div></dialog>`;
const $ = id => document.getElementById(id);
const modal = $('modal');
const openDialog = html => { $('modal-content').innerHTML = html; if (!modal.open) modal.showModal(); };
const closeDialog = () => modal.close();
$('close-modal').onclick = closeDialog;
modal.addEventListener('click', event => { if (event.target === modal) closeDialog(); });
let toastTimer;
function notify(message) {
  $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 2600);
}
const arenaFullscreen = () => toggleFullscreen(document.querySelector('.arena'));
let renderer, host;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
  $('world').appendChild(renderer.domElement);
  host = createGameHost({ games, renderer, container: $('game-ui'), controls: $('controls'), navigation: document.querySelector('nav'), arena: document.querySelector('.arena'), notify, openDialog, closeDialog, clearNotification: () => { clearTimeout(toastTimer); $('toast').classList.remove('visible'); }, toggleFullscreen: arenaFullscreen });
  renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); host.pause(); notify('Graphics paused. Refresh to restore the game.'); });
  host.select(games[0].id);
} catch (error) {
  console.error(error);
  // Only blame the graphics when the renderer itself could not start; any other error is a loading problem.
  $('game-ui').innerHTML = renderer
    ? '<div class="intro"><div><h2>The game could not start.</h2><p>Please reload the page. Details are in the browser console.</p></div></div>'
    : '<div class="intro"><div><h2>WebGL 2 required.</h2><p>Enable hardware acceleration to play.</p></div></div>';
}
$('settings-button').onclick = () => openDisplaySettings({ openDialog, notify, pause: () => host?.pause(), toggleFullscreen: arenaFullscreen });
function resize() {
  if (!renderer) return;
  const { width, height } = $('world').getBoundingClientRect();
  if (!width || !height) return;
  renderer.setSize(width, height); host?.resize(width, height);
}
new ResizeObserver(resize).observe($('world')); resize();
const clock = new THREE.Clock();
function animate() { requestAnimationFrame(animate); const dt = Math.min(clock.getDelta(), 0.05); host?.update(dt, clock.elapsedTime); }
animate();
