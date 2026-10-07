import * as THREE from 'three';
import { Game, RULES, BOOST, TURBO, WILT, HEIST, POWER, SHOVE, LOAD, RAIN, loadFactor } from './simulation.js';
import { createRainCloud, createBoostRings } from './features/weather.js';
import { readingTime } from './features/reading.js';
import { createWaspBoss } from './features/wasp-boss.js';
import { createBeeToken } from './features/bee-token.js';
import { waspHead, WASP } from './features/wasp.js';
import { basketFills, POLLEN } from './features/pollen.js';
import { createStream, streamDistance, STREAM, STREAM_INFO, STREAM_Y } from './features/stream.js';
import { createPowerAura } from './features/power-aura.js';
import { createShellFur } from './features/shell-fur.js';
import { createHoneyGauge, GAUGE } from './features/honey-gauge.js';
import { releaseBumblebee } from './features/bumblebee.js';
import { WORLD, FLOWERS, TREES, BUSHES } from './world.js';
import { markup } from './ui.js';
import { GARDEN_PALETTE as palette } from './palette.js';
import { OrbitView, bindOrbitControls } from './features/orbit-view.js';
import { BeeView, bindBeeLook, createBeeViewModel } from './features/bee-view.js';
import { createFlower, createHoneyDrop, createBumblebee, createBurst, createDizzyStars, createHiveModel } from './features/models.js';
import { createHiveAudio } from './features/audio/engine.js';
import { MIXER, MUSIC_TRACKS } from './features/audio/manifest.js';
import { createSoundscape } from './features/audio/soundscape.js';
import { createBubbles } from './features/speech/bubbles.js';
import { isFullscreenOf } from './features/fullscreen-state.js';
import { createTour } from './features/tour.js';
import { GUIDE_HTML } from './features/guide.js';
import { createCinematic, CINEMATIC_LENGTH } from './features/cinematic.js';
import { createReactions } from './features/speech/reactions.js';
import { createDemo } from './features/demo.js';

const ORBIT_FOV = 38;

// `game` lets tests hand in their own simulation; the game itself always creates a fresh one.
export function createHive({ renderer, container, notify: toast, openDialog: showModal, closeDialog = () => {}, toggleFullscreen = async () => {}, game: injected = null }) {
  const root = document.createElement('div'); root.id = 'garden-ui'; root.className = 'garden-ui'; root.innerHTML = markup;
  const $ = id => root.querySelector(`#${id}`);
  const game = injected ?? new Game();
  let player = null, started = false, paused = false, active = false, view = 'orbit', soundOn = true, width = 1, height = 1;
  const keys = new Set();
  const modal = { get open() { return !!document.querySelector('dialog[open]'); }, close: closeDialog };
  const audio = createHiveAudio(), soundscape = createSoundscape(audio), react = createReactions();
  const bubbles = createBubbles($('speech'));

  function setSound(on) {
    soundOn = on;
    if (started || audio.enabled || on) audio.setEnabled(on);
    $('sound').innerHTML = `♪ <span>Sound ${on ? 'on' : 'off'}</span>`; $('sound').setAttribute('aria-pressed', on); $('sound').setAttribute('aria-label', on ? 'Disable sound' : 'Enable sound');
  }
  $('sound').onclick = () => setSound(!soundOn);
  const fullscreen = () => Promise.resolve().then(toggleFullscreen).catch(() => toast('Fullscreen unavailable in this browser.'));
  $('fullscreen').onclick = fullscreen;
  $('view').disabled = true;
  // The landing screen plays quietly from the first click or key press (browsers need a gesture for sound).
  const INTRO_MIX = 0.5; // a light mix on the landing screen; the round start fades up to the full default
  // The landing screen plays the garden and its music quietly: right away if the browser allows it, otherwise
  // from the first click, key or touch. Starting the round fades everything up to the normal mix.
  let unlockClick = false; // the click that only switched the sound on (the browser had blocked it) does not start the round
  function introSound(event) {
    if (!active || started || !soundOn) return;
    if (event?.type === 'pointerdown' && !audio.playing && !event.target?.closest?.('#start')) unlockClick = true;
    if (!audio.enabled) { audio.setMix(INTRO_MIX, 0); audio.setEnabled(true); } else audio.resume();
    setTimeout(() => { if (audio.playing) $('sound-hint').hidden = true; }, 60);
  }
  document.addEventListener('pointerdown', introSound, true); document.addEventListener('keydown', introSound, true);
  $('start').onclick = () => {
    if (!renderer || started) return;
    endTour();
    game.reset(); game.round = 1; player = game.addPlayer(); started = true;
    $('intro').hidden = true; $('flight-hud').hidden = false; $('pause').disabled = false; $('view').disabled = false; $('phase').textContent = 'ACTIVE';
    if (!audio.enabled) audio.setMix(INTRO_MIX, 0); $('sound-hint').hidden = true;
    audio.setEnabled(soundOn); audio.setMix(1, 1.5); soundscape.reset(); // fade up from the quiet intro (about 4 s)
    $('intro-best').hidden = true;
    orbit.panX = orbit.panZ = 0; orbitTarget.set(player.x, player.y, player.z);
    if (reducedMotion || view === 'bee') { spotlight = SPOTLIGHT; bubbles.say(player.id, 'That\u2019s you!', { delay: 0.6 }); startTip(); }
    else { flyover = 0; saidHi = false; orbit.azimuth = FLY.to; game.cutscene = FLY.circle + FLY.swoop + FLY.hold; root.classList.add('flyover'); }
  };
  // Demo mode: the normal round start, then a director and a pilot play about a minute of it, and it returns here.
  // Scores and the session best stay untouched.
  let demo = null, demoSaved = null;
  function startDemo() {
    if (!renderer || started) return;
    demoSaved = { best: game.best, scores: game.scores };
    $('start').click(); if (!started || !player) return;
    demo = createDemo(game, player); root.classList.add('demo'); $('demo-badge').hidden = false;
  }
  function stopDemo() {
    if (!demo) return;
    demo = null; root.classList.remove('demo'); $('demo-badge').hidden = true;
    endCinematic(); endTokenShot(); bubbles.clear(); resetBoss(); modal.close();
    game.reset(); game.round = 1; game.best = demoSaved.best; game.scores = demoSaved.scores;
    if (player) game.players.delete(player.id);
    player = null; started = false; paused = false; autoPaused = false; spotlight = 0; flyover = -1; strafe = 0;
    lastRound = game.round; lastResult = null; scoresDue = false; heistNote = null; alertTime = 0; release();
    root.classList.remove('flyover', 'cinematic', 'powered', 'top-busy', 'bee-view');
    $('pause').textContent = 'Ⅱ'; $('pause').disabled = true; $('view').disabled = true; $('phase').textContent = 'READY';
    $('intro').hidden = false; $('flight-hud').hidden = true; $('tour-caption').hidden = false; tour.reset(); tourStep = -1;
    camera.fov = ORBIT_FOV; camera.updateProjectionMatrix();
    soundscape.reset(); if (audio.enabled) audio.setMix(INTRO_MIX, 1);
    updateUI();
  }
  $('demo').onclick = startDemo; $('demo-exit').onclick = stopDemo;
  // On the landing screen a click anywhere in the garden starts the round, not only the ▶ button.
  let pressAt = null;
  renderer.domElement.addEventListener('pointerdown', event => { pressAt = { x: event.clientX, y: event.clientY }; if (flyover >= 0 && flyover < FLY.circle + FLY.swoop) skipFlyover(); });
  const startByClick = () => { if (unlockClick) { unlockClick = false; return; } $('start').click(); };
  renderer.domElement.addEventListener('click', event => { if (active && !started && !modal.open && (!pressAt || Math.hypot(event.clientX - pressAt.x, event.clientY - pressAt.y) < 8)) startByClick(); });
  root.addEventListener('click', event => { if (active && !started && !modal.open && !event.target.closest?.('button, a, input, select, label, summary, details, #controls-panel')) startByClick(); else if (event.target.closest?.('button, a, input, select, label, summary, details, #controls-panel')) unlockClick = false; });
  let autoPaused = false; // paused only because the window lost focus: coming back resumes on its own
  function togglePause() {
    if (!started) return;
    paused = !paused; autoPaused = false; release(); viewControls.cancel(); look.release();
    paused ? audio.suspend() : audio.resume();
    $('pause').textContent = paused ? '▶' : 'Ⅱ'; $('pause').setAttribute('aria-label', paused ? 'Resume game' : 'Pause game'); $('phase').textContent = paused ? 'PAUSED' : 'ACTIVE';
    toast(paused ? 'Paused. Press P to resume.' : 'Resumed.');
  }
  $('pause').onclick = togglePause;
  $('home').onclick = () => { toast('The glowing golden hive is in the center. Fly into its ring to deliver.'); hiveBeacon = 5; };
  function setView(next) {
    if (!player || next === view) return;
    view = next; release(); viewControls.cancel();
    const bee = view === 'bee';
    if (bee) beeView.face(player); else { look.release(); camera.fov = ORBIT_FOV; camera.updateProjectionMatrix(); }
    viewModel.group.visible = bee; $('reticle').hidden = !bee; root.classList.toggle('bee-view', bee);
    $('view').setAttribute('aria-pressed', bee); $('view').setAttribute('aria-label', bee ? 'Switch to garden view' : 'Switch to bee view');
    $('view').innerHTML = bee ? '🌼 <span>Garden view</span>' : '👁 <span>Bee view</span>'; renderControls();
    toast(bee ? 'Bee view: click the garden to steer with the mouse (or drag). W flies where you look.' : 'Garden view.');
  }
  $('view').onclick = () => setView(view === 'bee' ? 'orbit' : 'bee');
  // Side panel listing the controls for the current view; keys light up while held.
  const k = (code, label) => `<kbd data-k="${code}">${label}</kbd>`;
  const row = (label, keys, extra = '') => `<div class="control-row${extra}"><span>${label}</span><span>${keys}</span></div>`;
  function renderControls() {
    const bee = view === 'bee';
    $('controls-list').innerHTML = [
      bee ? row('Fly', `${k('KeyW', 'W')}<small>where you look</small>${k('KeyS', 'S')}`) : row('Fly', `${k('KeyW', 'W')}${k('KeyA', 'A')}${k('KeyS', 'S')}${k('KeyD', 'D')}<small>or arrows</small>`),
      row('▲ Up', k('Space', 'SPACE'), ' altitude-row'),
      row('▼ Down', k('KeyC', 'C'), ' altitude-row'),
      bee ? row('Strafe / turn', `${k('KeyA', 'A')}${k('KeyD', 'D')}${k('ArrowLeft', '←')}${k('ArrowRight', '→')}`) : '',
      row('Boost', k('ShiftLeft', 'SHIFT')),
      row('💨 Speed mode', `<small>double-tap direction</small>${k('KeyE', 'E')}`),
      row('🐝 Call 5 bees', `<small>with a bee token</small>${k('KeyB', 'B')}`),
      row('🐝 Swarm (wasp)', `<small>tap 3×</small>${k('KeyX', 'X')}`),
      row('⚡ Power boost', `<small>when glowing</small>${k('ShiftLeft', 'SHIFT')}`),
      row('🐝 Shove bumblebee', '<small>power boost · 2 🍯</small>'),
      bee ? row('Look', '<small>click + mouse, or drag</small>') : row('Rotate / zoom', '<small>drag · scroll</small>'),
      bee ? '' : row('Pan', '<small>⌥ + drag · right-drag</small>'),
      row(bee ? 'Garden view' : 'Bee view', k('KeyV', 'V')),
      row('Fullscreen', k('KeyF', 'F')),
      row('Pause', k('KeyP', 'P')),
      row('This panel', k('KeyH', 'H')),
    ].join('');
    syncHeld();
  }
  function syncHeld() {
    for (const key of root.querySelectorAll('kbd[data-k]')) key.classList.toggle('held', key.dataset.k.split(' ').some(code => keys.has(code) || (code === 'ShiftLeft' && keys.has('ShiftRight'))));
  }
  let panelOpen = !globalThis.matchMedia?.('(pointer: coarse)')?.matches, panelSpot = null, panelBeforeFullscreen = null, drag = null;
  function setPanel(open) {
    panelOpen = open; $('controls-panel').hidden = !open;
    $('controls-toggle').setAttribute('aria-pressed', open); $('controls-toggle').setAttribute('aria-label', open ? 'Hide controls' : 'Show controls');
    placePanel();
  }
  // The panel floats above the page, so it can be dragged beside the game; a strip always stays on screen.
  function placePanel() {
    const panel = $('controls-panel');
    if (panel.hidden || !root.isConnected) return;
    const area = root.getBoundingClientRect(), w = panel.offsetWidth || 212, h = panel.offsetHeight || 320;
    // By default it hangs half over the left edge of the game, outside where there is room.
    const spot = panelSpot ?? { x: Math.max(8, area.left - w * 0.45), y: area.top + Math.max(64, (area.height - h) / 2) };
    const x = Math.max(56 - w, Math.min((globalThis.innerWidth || 1280) - 56, spot.x)), y = Math.max(0, Math.min((globalThis.innerHeight || 800) - 40, spot.y));
    panel.style.left = `${x}px`; panel.style.top = `${y}px`;
  }
  $('controls-grip').addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const box = $('controls-panel').getBoundingClientRect();
    drag = { id: e.pointerId, dx: e.clientX - box.left, dy: e.clientY - box.top };
    try { $('controls-grip').setPointerCapture(e.pointerId); } catch {}
    $('controls-panel').classList.add('dragging'); e.preventDefault();
  });
  $('controls-grip').addEventListener('pointermove', e => {
    if (drag?.id !== e.pointerId) return;
    panelSpot = { x: e.clientX - drag.dx, y: e.clientY - drag.dy }; placePanel();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) $('controls-grip').addEventListener(name, () => { drag = null; $('controls-panel').classList.remove('dragging'); });
  globalThis.addEventListener?.('resize', () => { if (active) placePanel(); });
  // Fullscreen hides the panel (H brings it back) and shows a shortcut bar; leaving restores the panel.
  function onFullscreen() {
    const full = isFullscreenOf(root);
    if (full === root.classList.contains('is-fullscreen')) return;
    root.classList.toggle('is-fullscreen', full); panelSpot = null;
    if (full) { panelBeforeFullscreen = panelOpen; setPanel(false); } else if (panelBeforeFullscreen !== null) { setPanel(panelBeforeFullscreen); panelBeforeFullscreen = null; }
  }
  for (const name of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(name, onFullscreen);
  for (const button of root.querySelectorAll('[data-fs]')) button.onclick = () => $(button.dataset.fs).click();
  $('controls-toggle').onclick = () => setPanel(!panelOpen);
  // Full guide: pauses a running round first.
  const openGuide = () => { if (started && !paused) togglePause(); showModal(GUIDE_HTML); };
  $('guide').onclick = openGuide; $('tour-info').onclick = openGuide;
  $('controls-close').onclick = () => setPanel(false);
  const release = () => { keys.clear(); syncHeld(); };
  // Sound mixer: one slider per channel plus master, previewing the channel when released.
  let music = MUSIC_TRACKS[0].id;
  $('mixer-list').innerHTML = MIXER.map(channel => (channel.id === 'music' ? `<label class="mix-row track"><span>Background music</span><select id="music-track" aria-label="Background music">${MUSIC_TRACKS.map(track => `<option value="${track.id}">${track.label}</option>`).join('')}</select></label>` : '') + `<label class="mix-row${channel.id === 'master' ? ' master' : ''}"><span>${channel.label}</span><input type="range" min="0" max="150" step="5" value="100" data-bus="${channel.id}" aria-label="${channel.label}"><output>100%</output></label>`).join('');
  $('music-track').onchange = e => { music = e.target.value; };
  const showLevel = slider => { slider.nextElementSibling.textContent = `${slider.value}%`; };
  for (const slider of root.querySelectorAll('[data-bus]')) {
    showLevel(slider);
    slider.addEventListener('input', () => { audio.setLevel(slider.dataset.bus, slider.value / 100); showLevel(slider); });
    slider.addEventListener('change', () => {
      const preview = MIXER.find(channel => channel.id === slider.dataset.bus)?.preview;
      if (preview && started && !paused) audio.play(preview, null, { bus: slider.dataset.bus === 'master' ? undefined : slider.dataset.bus });
    });
  }
  // Game settings: how many bumps within how many seconds bring the rain cloud.
  const rainSetting = () => {
    game.rainRule = { bumps: Number($('rain-bumps').value), window: Number($('rain-window').value) };
    $('rain-bumps').nextElementSibling.textContent = $('rain-bumps').value; $('rain-window').nextElementSibling.textContent = `${$('rain-window').value} s`;
  };
  $('rain-bumps').oninput = rainSetting; $('rain-window').oninput = rainSetting;
  $('boss-mode').onchange = () => {
    const on = $('boss-mode').checked; $('boss-mode-note').textContent = on ? '4:00 · 450' : '3:30 · 400';
    if (!started) applyBoss(on); else { pendingBoss = on; toast(on ? 'From the next round: the wasp is back, 4-minute rounds for 450 nectar.' : 'From the next round: no wasp, 3½-minute rounds for 400 nectar.'); }
  };
  $('mixer-reset').onclick = () => {
    audio.resetLevels();
    for (const slider of root.querySelectorAll('[data-bus]')) { slider.value = 100; showLevel(slider); }
    toast('Sound mixer reset to default.');
  };
  document.addEventListener('keydown', e => {
    if (!active || modal.open || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target?.closest?.('input, select, textarea')) return; // Arrow keys adjust a focused slider, not the bee.
    if (e.code === 'KeyF' && !e.repeat) { e.preventDefault(); fullscreen(); return; }
    if (e.code === 'KeyH' && !e.repeat) { setPanel(!panelOpen); return; }
    if (demo) {
      if (e.code === 'Escape' && !e.repeat) { e.preventDefault(); stopDemo(); }
      else if (e.code === 'KeyP' && !e.repeat) togglePause();
      else if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      return;
    }
    if (e.code === 'Enter' && !started && !e.repeat && e.target === document.body) { $('start').click(); return; }
    if (cinematic.active && ['Enter', 'Escape', 'Space'].includes(e.code)) { e.preventDefault(); endCinematic(); return; }
    if (tokenShot >= 0 && ['Enter', 'Escape'].includes(e.code)) { e.preventDefault(); endTokenShot(); return; }
    // During the start flight Enter/Esc jump to the close-up; a flight key ends it and you fly at once.
    if (flyover >= 0 && flyover < FLY.circle + FLY.swoop && ['Enter', 'Escape'].includes(e.code) && !e.repeat) { e.preventDefault(); skipFlyover(); return; }
    if (flyover >= 0 && flyover < FLY.circle + FLY.swoop + FLY.hold && FLIGHT_KEYS.has(e.code)) { flyover = FLY.circle + FLY.swoop + FLY.hold; game.cutscene = 0; }
    if (!started) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.code === 'KeyP' && !e.repeat) togglePause();
    if (e.code === 'KeyX' && !e.repeat && !paused) swarmTap();
    if (e.code === 'KeyB' && !e.repeat && !paused) callBees();
    if (e.code === 'Space' && !e.repeat && !paused && player && game.slamReady(player)) slamTap = true;
    if (e.code === 'Enter' && !e.repeat && game.wasp?.swarm === 'formation') swarmAttack();
    if (e.code === 'KeyV' && !e.repeat && !paused) setView(view === 'bee' ? 'orbit' : 'bee');
    keys.add(e.code); syncHeld();
    // Double-tapping the key you fly with starts the speed mode (in bee view the turn arrows don't count).
    if (!e.repeat && TAP_KEYS.has(e.code) && !(view === 'bee' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight'))) {
      const now = performance.now();
      if (lastTap.code === e.code && now - lastTap.time < 300) { turboTap = true; lastTap = { code: '', time: 0 }; } else lastTap = { code: e.code, time: now };
    }
  });
  document.addEventListener('keyup', e => { keys.delete(e.code); syncHeld(); });
  window.addEventListener('blur', () => { release(); viewControls.cancel(); if (active && started && !paused) { togglePause(); autoPaused = true; } if (active && !started) audio.suspend(); });
  window.addEventListener('focus', () => { if (active && !started) audio.resume(); if (active && started && paused && autoPaused && !modal.open) togglePause(); });
  for (const button of root.querySelectorAll('[data-key]')) {
    button.addEventListener('pointerdown', e => { e.preventDefault(); button.setPointerCapture(e.pointerId); keys.add(button.dataset.key); syncHeld(); });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, () => { keys.delete(button.dataset.key); syncHeld(); });
  }

  // All artwork is procedural. No remote models, textures, fonts, or services.
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(palette.sky);
  scene.fog = new THREE.Fog(palette.sky, 62, 135);
  const camera = new THREE.PerspectiveCamera(ORBIT_FOV, 1, 0.05, 240); scene.add(camera);
  const orbit = new OrbitView();
  const viewControls = bindOrbitControls(renderer.domElement, orbit, () => active && !paused && !modal.open && view === 'orbit');
  const beeView = new BeeView(), viewModel = createBeeViewModel(); viewModel.group.visible = false; camera.add(viewModel.group);
  const look = bindBeeLook(renderer.domElement, beeView, () => active && !paused && !modal.open && view === 'bee');
  const orbitTarget = new THREE.Vector3();
  orbit.apply(camera, orbitTarget);
  const hemi = new THREE.HemisphereLight('#fff4df', '#4b6151', 2.4); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff0c5', 3.2); sun.position.set(-18, 40, 20); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 36, bottom: -36, far: 100 }); sun.shadow.bias = -0.0008; scene.add(sun);
  const materials = new Map();
  function material(color, extra = {}) { const key = color + JSON.stringify(extra); if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra })); return materials.get(key); }
  function mesh(geometry, color, parent = scene, x = 0, y = 0, z = 0, extra = {}) { const m = new THREE.Mesh(geometry, material(color, extra)); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }
  const cylinder = (rt, rb, h, segments = 6) => new THREE.CylinderGeometry(rt, rb, h, segments);
  const sphere = new THREE.SphereGeometry(1, 16, 12);
  function orb(parent, color, x, y, z, sx, sy = sx, sz = sx, extra) { const m = mesh(sphere, color, parent, x, y, z, extra); m.scale.set(sx, sy, sz); return m; }
  // Seeded randomness keeps the garden stable across visits.
  let seed = 47;
  function random() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  const dummy = new THREE.Object3D();
  // Hex tiles are instanced: the larger island stays a handful of draw calls.
  const tiles = [], edges = [];
  for (let q = -13; q <= 13; q++) for (let r = -13; r <= 13; r++) {
    const x = Math.sqrt(3) * 1.7 * (q + r / 2), z = 2.55 * r, d = Math.hypot(x, z);
    if (d > WORLD.island + 0.6) continue;
    tiles.push({ x, z, y: -0.35 + random() * 0.07, color: palette.tiles[Math.floor(random() * palette.tiles.length)] });
    if (d > WORLD.island - 2.8) edges.push({ x, z, h: 3 + random() * 2.5 });
  }
  const tileMesh = new THREE.InstancedMesh(cylinder(1.7, 1.55, 0.75), material('#ffffff'), tiles.length);
  tiles.forEach((t, i) => { dummy.position.set(t.x, t.y, t.z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.updateMatrix(); tileMesh.setMatrixAt(i, dummy.matrix); tileMesh.setColorAt(i, new THREE.Color(t.color)); });
  tileMesh.receiveShadow = true; tileMesh.castShadow = true; scene.add(tileMesh);
  const edgeMesh = new THREE.InstancedMesh(cylinder(1.52, 0.8, 1), material(palette.soil), edges.length);
  edges.forEach((e, i) => { dummy.position.set(e.x, -0.7 - e.h / 2, e.z); dummy.scale.set(1, e.h, 1); dummy.updateMatrix(); edgeMesh.setMatrixAt(i, dummy.matrix); });
  scene.add(edgeMesh);
  mesh(cylinder(WORLD.island - 0.4, 21, 6, 6), palette.soil, scene, 0, -3.6, 0);
  mesh(cylinder(21, 5, 6.5, 6), palette.bedrock, scene, 0, -9.8, 0);
  const ground = mesh(new THREE.PlaneGeometry(320, 320), palette.sky, scene, 0, -16, 0); ground.rotation.x = -Math.PI / 2; ground.castShadow = false;
  const grid = new THREE.GridHelper(220, 80, '#425868', '#314858'); grid.position.y = -15.98; grid.material.transparent = true; grid.material.opacity = 0.35; scene.add(grid);
  // Grass blades are instanced to keep the scene light on the GPU.
  const grass = new THREE.InstancedMesh(new THREE.ConeGeometry(0.065, 0.55, 3), material('#ffffff'), 1700);
  for (let i = 0; i < 1700; i++) { const a = random() * Math.PI * 2, r = 4.2 + Math.sqrt(random()) * 26; dummy.position.set(Math.cos(a) * r, 0.27, Math.sin(a) * r); dummy.rotation.set(random() * 0.2, a, random() * 0.3); dummy.scale.setScalar(0.7 + random()); if (streamDistance(dummy.position.x, dummy.position.z) < 0.15) dummy.scale.setScalar(0); dummy.updateMatrix(); grass.setMatrixAt(i, dummy.matrix); grass.setColorAt(i, new THREE.Color(palette.foliage[i % palette.foliage.length])); }
  scene.add(grass);
  const hive = createHiveModel(); scene.add(hive.group);
  let gauge = createHoneyGauge({ cells: game.goal / GAUGE.unit }); scene.add(gauge.group);
  // The boss wasp, and what it can do to the hive: wreck 0..1 squashes the hive, spills honey, and on a lost round
  // the light goes down and WASTED fades in.
  const boss = createWaspBoss(scene, { inView: at => inView(at, 3), onExit: at => { burst.emit(at, { color: '#ffe066', count: 40, speed: 3.6, gravity: -1.2, size: 0.16, life: 1.2 }); burst.emit(at, { color: '#2b2620', count: 16, speed: 2.4, gravity: -2, size: 0.12, life: 1 }); } });
  const bossLook = new THREE.Vector3();
  const beeToken = createBeeToken(); scene.add(beeToken.group);
  let victoryT = 0, wreck = 0, wreckTarget = 0, wastedT = -1, swarmTaps = [], slamTap = false, waspSaid = new Set();
  // Final boss on/off (Game settings): 4:00 rounds for 450 nectar with the wasp, 3:30 for 400 without.
  let pendingBoss = null;
  function applyBoss(on) {
    game.setBoss(on); game.restartClock();
    scene.remove(gauge.group); gauge = createHoneyGauge({ cells: game.goal / GAUGE.unit }); scene.add(gauge.group);
    $('goal-total').textContent = `/ ${game.goal}`;
    $('intro-text').innerHTML = `${game.goal} nectar. ${game.duration % 60 ? `${Math.floor(game.duration / 60)}½` : game.duration / 60} minutes. You + 6 AI scouts. Fly high and low, dodge the clumsy bumblebee${on ? ', and <b>beware the wasp!</b>' : '.'}`;
  }
  // Goal celebration: the hive swells, honey floods out to a third of the island, and trees turn gold.
  const flood = new THREE.Mesh((() => {
    const g = new THREE.CircleGeometry(1, 96), pos = g.attributes.position;
    for (let i = 1; i < pos.count; i++) { const a = Math.atan2(pos.getY(i), pos.getX(i)), r = 1 + Math.sin(a * 7) * 0.035 + Math.sin(a * 13 + 1) * 0.02; pos.setXY(i, pos.getX(i) * r, pos.getY(i) * r); }
    return g;
  })(), new THREE.MeshPhysicalMaterial({ color: '#f0a020', roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08, transparent: true, opacity: 0.92, emissive: '#5a2c00', emissiveIntensity: 0.25 }));
  flood.rotation.x = -Math.PI / 2; flood.position.y = 0.12; flood.visible = false; flood.receiveShadow = true; scene.add(flood); // just above the highest hex tile
  const GOLD = new THREE.Color('#f2c14e'), GOLD_GLOW = new THREE.Color('#6b4a00');
  const ease = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  function celebrate(dt, elapsed) {
    const t = game.celebration?.t ?? -1, party = t >= 0;
    const swell = party ? 1 + 0.35 * ease(t / 2) : 1;
    hive.group.scale.set(swell * (1 + 0.3 * wreck), swell * (1 - 0.72 * wreck), swell * (1 + 0.3 * wreck)); gauge.group.scale.setScalar(swell);
    flood.visible = party || wreck > 0.02;
    if (!party && wreck > 0.02) { const r = 2.5 + 5 * wreck; flood.scale.set(r, r, 1); }
    if (party) { const r = 3 + (WORLD.radius / 3 - 3) * ease(t / 9); flood.scale.set(r, r, 1); flood.rotation.z = elapsed * 0.02; }
    const gold = party ? ease(t / 6) : 0;
    for (const canopy of canopies) {
      if (gold > 0 && !canopy.userData.base) { canopy.userData.base = canopy.material; canopy.material = canopy.material.clone(); }
      if (canopy.userData.base) {
        if (!gold) { canopy.material.dispose(); canopy.material = canopy.userData.base; canopy.userData.base = null; continue; }
        canopy.material.color.copy(canopy.userData.base.color).lerp(GOLD, gold); canopy.material.emissive.copy(GOLD_GLOW).multiplyScalar(gold * 0.6);
      }
    }
  }
  // Bushes: four leafy blobs each, all in one instanced mesh (one draw call).
  const bushBlobs = new THREE.InstancedMesh(sphere, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 }), BUSHES.length * 4);
  BUSHES.forEach((b, n) => [[0, 0.42, 0, 0.62], [0.42, 0.32, 0.12, 0.46], [-0.36, 0.3, -0.1, 0.48], [0.05, 0.62, -0.18, 0.4]].forEach(([x, y, z, r], k) => {
    const turn = b.id * 1.7, s = b.size;
    dummy.position.set(b.x + (x * Math.cos(turn) - z * Math.sin(turn)) * s, y * s, b.z + (x * Math.sin(turn) + z * Math.cos(turn)) * s); dummy.rotation.set(0, 0, 0); dummy.scale.set(r * s * 1.15, r * s * 0.95, r * s * 1.15); dummy.updateMatrix();
    bushBlobs.setMatrixAt(n * 4 + k, dummy.matrix); bushBlobs.setColorAt(n * 4 + k, new THREE.Color(palette.foliage[(b.id + k * 2) % palette.foliage.length]).multiplyScalar(0.82 + k * 0.06));
  }));
  bushBlobs.castShadow = bushBlobs.receiveShadow = true; scene.add(bushBlobs);
  let hiveBeacon = 0;
  const pivots = new Map();
  const flowerModels = FLOWERS.map(f => {
    const flower = createFlower({ color: palette.flowers[f.color % palette.flowers.length], height: f.height, seed: f.id + 1 });
    // A pivot at the stem's base lets a power boost knock the whole plant over.
    const pivot = new THREE.Group(); pivot.position.set(f.x, 0, f.z); pivot.add(flower.group); scene.add(pivot); pivots.set(`flower:${f.id}`, pivot);
    const drop = createHoneyDrop(); drop.group.position.set(f.x, f.y, f.z); scene.add(drop.group);
    return { flower, drop };
  });
  const canopies = [];
  for (const [i, t] of TREES.entries()) {
    const tree = new THREE.Group(); tree.position.set(t.x, 0, t.z); scene.add(tree); pivots.set(`tree:${t.id}`, tree);
    mesh(cylinder(0.2, 0.32, t.height + 0.4, 7), '#806145', tree, 0, (t.height + 0.4) / 2, 0);
    canopies.push(orb(tree, palette.foliage[i % palette.foliage.length], 0, t.height + 0.9, 0, t.canopy, t.canopy * 1.12, t.canopy),
      orb(tree, palette.foliage[(i + 1) % palette.foliage.length], t.canopy * 0.4, t.height + 1.6, t.canopy * 0.15, t.canopy * 0.7),
      orb(tree, palette.foliage[(i + 3) % palette.foliage.length], -t.canopy * 0.35, t.height + 1.3, -t.canopy * 0.3, t.canopy * 0.62));
  }
  const rockGeometry = new THREE.DodecahedronGeometry(1);
  for (let i = 0; i < 44; i++) { const a = random() * Math.PI * 2, r = 27.5 + random() * 3.5; const rock = mesh(rockGeometry, ['#aaa79a', '#92968c', '#b5aa93'][i % 3], scene, Math.cos(a) * r, 0.15, Math.sin(a) * r); rock.scale.set(0.3 + random() * 0.45, 0.2 + random() * 0.25, 0.3 + random() * 0.45); rock.visible = streamDistance(rock.position.x, rock.position.z) > 0.6; }
  const motesGeometry = new THREE.BufferGeometry(); const motePositions = new Float32Array(220 * 3);
  for (let i = 0; i < 220; i++) { motePositions[i * 3] = (random() - 0.5) * 62; motePositions[i * 3 + 1] = 1 + random() * 9; motePositions[i * 3 + 2] = (random() - 0.5) * 62; }
  motesGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3)); const motes = new THREE.Points(motesGeometry, new THREE.PointsMaterial({ color: '#fff2c0', size: 0.07, transparent: true, opacity: 0.8 })); scene.add(motes);
  const burst = createBurst(scene);
  // A brook springs up in the meadow and pours over the island's rim as a waterfall; stones line it.
  const stream = createStream(); scene.add(stream.group);
  const brookSpot = new THREE.Vector3(), water = [{ key: 'brook', x: 0, y: STREAM_Y, z: 0 }, { key: 'waterfall', x: STREAM_INFO.lip.x, y: -1.2, z: STREAM_INFO.lip.z, rate: 0.72, gain: 1.6 }];
  // The brook sounds from its point nearest to the listener, so the whole stream is audible along its length.
  function nearBrook(at) {
    let best = Infinity;
    for (let i = 1; i < STREAM.length; i++) {
      const a = STREAM[i - 1], b = STREAM[i], dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.z - a.z) * dz) / (dx * dx + dz * dz)));
      const x = a.x + dx * t, z = a.z + dz * t, d = (at.x - x) ** 2 + (at.z - z) ** 2;
      if (d < best) { best = d; brookSpot.set(x, STREAM_Y, z); }
    }
    Object.assign(water[0], { x: brookSpot.x, z: brookSpot.z });
    return water;
  }
  const rainCloud = createRainCloud(); scene.add(rainCloud.group);
  const boostRings = createBoostRings(scene);
  // The sky drifts to a deeper blue now and then and back; a boost flashes it briefly.
  const SKY = new THREE.Color(palette.sky), DEEP_SKY = new THREE.Color('#1b4c8c'), FLASH = new THREE.Color('#4f7fb0'), skyColor = new THREE.Color();
  const groundMaterial = ground.material = ground.material.clone(); // the deep ground below the island shades with the sky
  let skyMix = 0, skyGoal = 0, skyTimer = 40 + Math.random() * 20, skyFlash = 0, dripTimer = 0;
  function updateSky(dt) {
    skyTimer -= dt;
    if (skyTimer <= 0) { skyGoal = skyGoal ? 0 : 1; skyTimer = skyGoal ? 10 + Math.random() * 6 : 40 + Math.random() * 25; }
    skyMix += (skyGoal - skyMix) * Math.min(1, dt * 0.35); skyFlash = Math.max(0, skyFlash - dt * 1.8);
    skyColor.copy(SKY).lerp(DEEP_SKY, skyMix).lerp(FLASH, skyFlash * 0.6);
    scene.background.copy(skyColor); scene.fog.color.copy(skyColor); groundMaterial.color.copy(skyColor);
  }

  const beeModels = new Map();
  // Soft shell fuzz for the honeybees: poles at head and tail, dark bands baked into the fur colour.
  const fuzzSphere = new THREE.SphereGeometry(1, 20, 14).rotateX(Math.PI / 2);
  const BANDS = [{ z: -0.385, width: 0.13, color: '#34352d' }, { z: 0.231, width: 0.13, color: '#34352d' }];
  // Level of detail: fewer fur layers the farther the camera is (none when the bee is a dot).
  const fuzzLayers = d => d < 6 ? 8 : d < 14 ? 6 : d < 26 ? 4 : 0;
  const bumbleLayers = d => cinematic.active || !started ? 32 : d < 8 ? 24 : d < 18 ? 16 : d < 32 ? 10 : 6;
  function createBee(p) {
    const group = new THREE.Group(); scene.add(group);
    const body = new THREE.Group(); group.add(body);
    orb(body, p.bot ? palette.bees[p.id % palette.bees.length] : '#ffd052', 0, 0, 0, 0.32, 0.3, 0.52);
    for (const z of [-0.2, 0.12]) { const band = mesh(cylinder(0.305, 0.305, 0.13, 16), '#34352d', body, 0, 0, z); band.rotation.x = Math.PI / 2; }
    orb(body, '#34352d', 0, 0.04, 0.44, 0.29, 0.27, 0.23);
    for (const x of [-0.13, 0.13]) { orb(body, '#fff7d7', x, 0.13, 0.61, 0.07); orb(body, '#282f29', x, 0.13, 0.66, 0.035); const antenna = mesh(cylinder(0.015, 0.02, 0.24, 5), '#34352d', body, x, 0.36, 0.47); antenna.rotation.z = x * -3; }
    // Six thin legs, each with a pollen basket that fills with the nectar load (hind pair first, then middle, then front).
    for (const z of [0.2, 0.02, -0.16]) for (const side of [-1, 1]) { const leg = mesh(cylinder(0.02, 0.012, 0.3, 5), '#2f2d27', body, side * 0.17, -0.28, z); leg.rotation.set(z * 0.9, 0, side * 0.45); }
    const baskets = [[-0.2, 0], [0.0, 1], [0.19, 2]].flatMap(([z, pair]) => [-1, 1].map(side => { const basket = orb(body, '#f0a31c', side * 0.25, -0.41, z, 1, 1.15, 1.3, { roughness: 0.32, emissive: '#7a4a00', emissiveIntensity: 0.3 }); basket.scale.setScalar(0.001); basket.visible = false; basket.userData.pair = pair; return basket; }));
    if (p.defender) { // a red sash across the body and a gold star: a defender of the hive
      const sash = mesh(new THREE.TorusGeometry(0.315, 0.04, 8, 36), '#c8102e', body, 0, 0.02, 0.06, { roughness: 0.55 }); sash.rotation.set(0.15, 0.9, 0.5);
      const star = mesh(new THREE.OctahedronGeometry(0.06, 0), '#ffd84a', body, 0.2, 0.22, 0.1, { roughness: 0.3, metalness: 0.4, emissive: '#6b4a00' }); star.scale.set(1, 1, 0.5);
    }
    const fuzz = createShellFur(fuzzSphere, { layers: 8, length: 0.13, density: [70, 46], color: p.bot ? palette.bees[p.id % palette.bees.length] : '#ffd052', stripes: BANDS, rootShade: 0.62, droop: 0.12 });
    fuzz.scale.set(0.32, 0.3, 0.52); body.add(fuzz);
    const wings = [];
    for (const side of [-1, 1]) { const wing = orb(body, p.bot ? palette.wings[p.id % palette.wings.length] : '#fff8e4', side * 0.36, 0.22, -0.06, 0.4, 0.035, 0.22, { transparent: true, opacity: 0.65, roughness: 0.3 }); wings.push(wing); }
    const shadow = mesh(new THREE.CircleGeometry(p.bot ? 0.35 : 0.5, 24), p.bot ? palette.bees[p.id % palette.bees.length] : '#f9d260', scene, 0, 0.08, 0, { transparent: true, opacity: 0.4 }); shadow.rotation.x = -Math.PI / 2; shadow.castShadow = false;
    // The player's altitude line connects the bee to its shadow for depth in the garden view.
    const stem = p.bot ? null : new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -1, 0)]), new THREE.LineDashedMaterial({ color: '#ffe49c', dashSize: 0.18, gapSize: 0.14, transparent: true, opacity: 0.7 }));
    if (stem) { stem.computeLineDistances(); scene.add(stem); }
    const labelCanvas = document.createElement('canvas'); labelCanvas.width = p.bot ? 256 : 128; labelCanvas.height = p.bot ? 64 : 128;
    const ctx = labelCanvas.getContext('2d'); ctx.font = `${p.bot ? '600 23px' : '700 38px'} monospace`; ctx.textAlign = 'center'; ctx.fillStyle = p.bot ? '#f0e9ff' : '#fff8df';
    // The player's badge: a round disc in the deep sky blue, with a light rim, for strong contrast on the meadow.
    if (!p.bot) { ctx.beginPath(); ctx.roundRect(4, 4, 120, 120, 60); ctx.fillStyle = '#cfe4ff'; ctx.fill(); ctx.beginPath(); ctx.roundRect(11, 11, 106, 106, 53); ctx.fillStyle = '#1b4c8c'; ctx.fill(); ctx.fillStyle = '#ffffff'; }
    if (p.bot) ctx.fillText(p.name, 128, 39); else ctx.fillText('YOU', 64, 77);
    const labelTexture = new THREE.CanvasTexture(labelCanvas); const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, depthTest: false })); label.position.y = p.bot ? 1.1 : 1.25; if (p.bot) label.scale.set(2.5, 0.625, 1); else label.scale.set(0.95, 0.95, 1); group.add(label);
    const stars = createDizzyStars(); stars.group.position.y = 0.55; stars.group.visible = false; group.add(stars.group);
    const aura = p.bot ? null : createPowerAura(); if (aura) { body.add(aura.outline); group.add(aura.halo); }
    group.position.set(p.x, p.y, p.z);
    beeModels.set(p.id, { group, body, wings, shadow, stem, stars, aura, fuzz, baskets, load: 0, labelTexture, label, tumble: 0 });
  }
  const bumble = createBumblebee(); bumble.group.visible = false; scene.add(bumble.group);
  const BUMBLE_EXIT = 1.1, bumbleDrift = new THREE.Vector3(), bumbleLast = new THREE.Vector3(); let bumbleExit = 0;
  // Is a point (with some radius) inside the camera's view? Exit effects only play where someone can see them.
  const viewFrustum = new THREE.Frustum(), viewMatrix = new THREE.Matrix4(), viewSphere = new THREE.Sphere();
  function inView(at, radius = 1) { camera.updateMatrixWorld(); viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); viewFrustum.setFromProjectionMatrix(viewMatrix); return viewFrustum.intersectsSphere(viewSphere.set(at, radius)); }
  const bumbleShadow = mesh(new THREE.CircleGeometry(1.1, 28), '#2a2a20', scene, 0, 0.08, 0, { transparent: true, opacity: 0.3 }); bumbleShadow.rotation.x = -Math.PI / 2; bumbleShadow.castShadow = false; bumbleShadow.visible = false;

  const head = new THREE.Vector3(), probe = new THREE.Vector3(), hiveTop = new THREE.Vector3(0, 5.4, 0), axis = new THREE.Vector3();
  function locate(id) {
    if (id === 'bumble') return bumble.group.visible ? head.copy(bumble.group.position).add(probe.set(0, 1.9, 0)) : null;
    if (id === 'wasp') { if (!game.wasp) return null; const h = waspHead(game.wasp); return head.set(h.x, h.y + 1.6, h.z); }
    if (view === 'bee' && player && id === player.id) return null;
    const bee = beeModels.get(id); return bee ? head.copy(bee.group.position).add(probe.set(0, 0.72, 0)) : null;
  }
  function screen(position, out = { x: 0, y: 0, visible: false }) {
    probe.copy(position).project(camera);
    out.visible = probe.z < 1 && Math.abs(probe.x) < 1 && Math.abs(probe.y) < 1;
    out.x = (probe.x + 1) / 2 * width; out.y = (1 - probe.y) / 2 * height; out.behind = probe.z >= 1;
    return out;
  }
  // Points to the bumblebee (or where it will enter) from the screen edge when it is out of view.
  const marker = { x: 0, y: 0 }, markerTarget = new THREE.Vector3();
  function placeMarker(position) {
    const s = screen(position, marker);
    if (s.visible) { $('bumble-marker').hidden = true; return; }
    let dx = s.x - width / 2, dy = s.y - height / 2;
    if (s.behind) { dx = -dx; dy = -dy; }
    const scale = Math.min((width / 2 - 34) / Math.max(1e-6, Math.abs(dx)), (height / 2 - 34) / Math.max(1e-6, Math.abs(dy)));
    const x = width / 2 + dx * scale, y = height / 2 + dy * scale;
    $('bumble-marker').hidden = false;
    $('bumble-marker').style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    $('bumble-marker').style.setProperty('--angle', `${(Math.atan2(dx, -dy) * 180 / Math.PI).toFixed(1)}deg`);
  }

  const TAP_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  let turboTap = false, lastTap = { code: '', time: 0 };
  let lastBag = 0, lastScore = 0, lastResult = null, lastRound = 1, uiTime = 0, alertTime = 0, heistNote = null, powerTip = 0, powerNag = 0, loadTip = 0;
  // Short reminder overlay while the nectar power waits to be used.
  function updatePowerTip(dt) {
    const charged = started && player?.powered && !game.boosting(player);
    // The reminder returns every 30 s and, like every hint, stays up long enough to read.
    if (charged) { powerNag -= dt; if (powerNag <= 0) { powerTip = readingTime($('power-tip').textContent); powerNag = 30; } } else { powerTip = 0; powerNag = 30; }
    powerTip = Math.max(0, powerTip - dt); loadTip = Math.max(0, loadTip - dt);
    // Only one hint at a time: the power reminder wins.
    $('power-tip').hidden = !powerTip; $('load-tip').hidden = !loadTip || !!powerTip;
    root.classList.toggle('top-busy', !$('bumble-alert').hidden || !$('heist-banner').hidden); root.classList.toggle('powered', !!(started && player?.powered));
  }
  const heistOutcome = (saved, drained) => saved ? `You knocked the bumblebee off the hive. It got away with ${drained} nectar.` : `The bumblebee flew off with ${drained} nectar.`;
  // Information sign while the bumblebee raids the hive, then the outcome for as long as it takes to read.
  function updateHeist(dt) {
    const b = game.bumble, raid = started && b?.mode === 'heist' && (b.phase === 'approach' || b.phase === 'perched');
    if (heistNote) heistNote.time -= dt;
    if (heistNote && heistNote.time <= 0) heistNote = null;
    const banner = $('heist-banner'), show = raid || (started && heistNote);
    banner.hidden = !show; $('mission-status').classList.toggle('draining', !!raid && b.phase === 'perched');
    if (!show) return;
    banner.classList.toggle('saved', !raid && heistNote.saved);
    if (raid) {
      $('heist-title').textContent = '🍯 HONEY THIEF!';
      $('heist-text').textContent = b.phase === 'perched' ? `It's drinking your honey! Fly to the hive and bump into it ${HEIST.hits}×.` : b.roamFor > 0 ? 'It\u2019s back, bumbling around and knocking bees over. Soon it goes for the honey!' : 'The bumblebee is heading for the hive. Get ready to bump it off!';
      $('heist-hits').innerHTML = Array.from({ length: HEIST.hits }, (_, i) => `<i class="${i < b.knocks ? 'hit' : ''}"></i>`).join('');
    } else {
      $('heist-title').textContent = heistNote.saved ? '🎉 HONEY SAVED!' : '🍯 HONEY STOLEN';
      $('heist-text').textContent = heistOutcome(heistNote.saved, heistNote.drained);
      $('heist-hits').innerHTML = '';
    }
  }
  // Highscore table for this page session. Every finished round is entered with the last initials
  // used; the player can retype them (three letters or digits, arcade style). Nothing is stored or sent.
  const highscores = []; let initials = 'BEE', entry = null, scoresDue = false;
  const sanitize = text => text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  function scoreRows() {
    return highscores.map((e, i) => `<li class="${e === entry ? 'mine' : ''}"><span>${i + 1}.</span><b>${e.initials || '???'}</b><span>${e.points.toLocaleString('en')}</span><small>Round ${e.round} ${e.goal ? '🍯' : '⏱'}</small></li>`).join('');
  }
  function showScores() {
    const goal = game.result === 'complete';
    entry = { initials, points: player.points, round: game.round, goal };
    highscores.push(entry); highscores.sort((a, b) => b.points - a.points); highscores.splice(10);
    const rank = highscores.indexOf(entry) + 1;
    showModal(`<p class="eyebrow">ROUND ${game.round} · HIGHSCORE</p><h2>${goal ? '🍯 Goal reached! The hive overflows.' : '⏱ Time\u2019s up.'}</h2>
      <p>Hive: <strong>${game.honey} / ${game.goal} nectar</strong> · you brought <strong>${player.score}</strong><br>Your score: <strong>${player.points.toLocaleString('en')} points</strong>${rank === 1 && highscores.length > 1 ? ' · <strong>🏆 NEW HIGHSCORE!</strong>' : ''}</p>
      ${rank ? `<form class="score-entry" id="hive-score-form"><label for="hive-initials">Your initials</label><input id="hive-initials" maxlength="3" autocomplete="off" spellcheck="false" value="${initials}"><button class="primary" type="submit">Save</button></form>` : ''}
      <ol class="score-table" id="hive-score-table">${scoreRows()}</ol>
      <p class="result-note">Next round in <span id="hive-next">${Math.ceil(game.remaining)}</span> s. Scores last for this page session only.</p>`);
    audio.chime(rank === 1 ? 1318 : 1046);
    const input = document.getElementById('hive-initials'), form = document.getElementById('hive-score-form');
    if (!input) return;
    const apply = () => { input.value = sanitize(input.value); initials = input.value || initials; if (entry) entry.initials = input.value; document.getElementById('hive-score-table').innerHTML = scoreRows(); };
    input.oninput = apply; input.focus(); input.select();
    form.onsubmit = e => { e.preventDefault(); apply(); input.blur(); form.classList.add('saved'); form.querySelector('button').textContent = '✓ Saved'; };
  }
  // ---- boss fight glue: swarm commands, prompts, and the WASTED ending
  function swarmTap() {
    const w = game.wasp; if (!w || !started || demo) return;
    const now = performance.now(); swarmTaps = swarmTaps.filter(t => now - t < 1200); swarmTaps.push(now);
    if (swarmTaps.length < 3) return;
    swarmTaps = [];
    const command = w.swarm === 'none' ? 'gather' : w.swarm === 'gathered' ? 'formation' : null;
    if (command) game.waspCommand(command);
  }
  // Bee tokens: B (or the buttons) calls five bees out of the hive; during the wasp fight they come as defenders.
  function callBees() { if (started && player && !demo && game.redeemBeeItem()) $('defender-call').hidden = true; }
  $('defender-call').onclick = callBees;
  $('touch-bees').addEventListener('pointerdown', event => { event.preventDefault(); callBees(); });
  function swarmAttack() { if (!demo && game.waspCommand('attack')) $('swarm-attack').hidden = true; }
  $('swarm-attack').onclick = swarmAttack;
  $('touch-swarm').addEventListener('pointerdown', event => { event.preventDefault(); swarmTap(); });
  for (const button of root.querySelectorAll('[data-key="Space"]')) button.addEventListener('pointerdown', () => { if (player && game.slamReady(player)) slamTap = true; });
  const FIGHT = ['hunt', 'approach', 'mobbed', 'shake', 'advance'];
  function updateBossUI() {
    const w = started ? game.wasp : null, fight = !!w && FIGHT.includes(w.phase);
    $('boss-bar').hidden = !w || w.phase === 'climb' || w.phase === 'flip';
    if (w) {
      $('boss-hits').innerHTML = Array.from({ length: 5 }, (_, i) => `<i class="${i < w.hits ? 'hit' : ''}"></i>`).join('');
      const swarm = [...game.players.values()].filter(p => p.bot && p.swarmSlot >= 0 && !p.ko).length, down = [...game.players.values()].filter(p => p.ko).length;
      $('boss-swarm').textContent = w.hits >= WASP.hits ? 'DEFEATED' : `HP ${WASP.hp - w.hits * WASP.hp / WASP.hits}/${WASP.hp} · swarm ${swarm} · down ${down}`;
    }
    const asking = fight && (w.swarm === 'none' || w.swarm === 'gathered');
    $('swarm-prompt').hidden = !asking;
    if (asking) {
      $('swarm-text').textContent = w.swarm === 'none' ? 'Tap X three times fast: gather the swarm!' : 'Again, X X X: attack formation!';
      const now = performance.now(), n = swarmTaps.filter(t => now - t < 1200).length;
      $('swarm-taps').innerHTML = [0, 1, 2].map(i => `<b class="${i < n ? 'on' : ''}"></b>`).join('');
    }
    $('swarm-attack').hidden = !(fight && w.swarm === 'formation');
    $('slam-prompt').hidden = !(fight && player && game.slamReady(player));
    const tokens = started && player ? player.beeItems ?? 0 : 0;
    $('bee-tokens').hidden = !tokens; $('bee-token-count').textContent = `×${tokens}`;
    $('defender-call').hidden = !(fight && tokens > 0); $('defender-count').textContent = tokens;
    if (w) $('phase').textContent = 'BOSS FIGHT';
  }
  function resetBoss() {
    wreck = wreckTarget = 0; wastedT = -1; victoryT = 0; $('victory').hidden = true; $('wasted').hidden = true; renderer.domElement.style.filter = ''; hemi.intensity = 2.4; sun.intensity = 3.2; boss.reset();
    hive.group.rotation.set(0, 0, 0); waspSaid.clear();
  }
  const say = (id, lines, options) => bubbles.say(id, lines[Math.floor(Math.random() * lines.length)], options);
  function bossEvent(event) {
    const t = event.type;
    if (t === 'wasp-climb') { root.classList.add('cinematic'); $('letterbox').hidden = false; $('cine-title').textContent = '⚠ Something is climbing up the island…'; release(); }
    if (t === 'wasp-alarm') {
      root.classList.remove('cinematic'); $('letterbox').hidden = true;
      $('alert-text').textContent = 'WASP ATTACK'; $('bumble-alert').hidden = false; alertTime = 3.5;
      toast('🐝🐝🐝 Tap X three times fast to gather the remaining scouts into a swarm!');
      say('wasp', ['BZZZT! Lunch time!', 'Nice little hive you have…', 'Who wants to go first?'], { style: 'bumble', delay: 0.4 });
    }
    if (t === 'wasp-catch') { say(event.id, ['Help!', 'Let go of me!', 'Mmmph!', 'Not the wings!'], { style: 'shout' }); bubbles.pow(event, 'CHOMP!', 'bumble'); }
    if (t === 'wasp-ko') { bubbles.say(event.id, 'Ugh…'); burst.emit(probe.set(event.x, event.y, event.z), { color: '#ffe066', count: 14, speed: 2, gravity: -5 }); }
    if (t === 'swarm-gathered') { toast('Swarm ready! Now X X X again for the attack formation.'); for (const p of game.players.values()) if (p.bot && p.swarmSlot >= 0 && Math.random() < 0.4) say(p.id, ['We\u2019re with you!', 'Together!', 'Buzz squad!'], { delay: Math.random() }); }
    if (t === 'swarm-formation') toast('Attack formation! Hit ⚔ ATTACK (or Enter) to charge.');
    if (t === 'swarm-charging') for (const p of game.players.values()) if (p.bot && p.swarmSlot >= 0 && Math.random() < 0.5) say(p.id, ['Chaaarge!', 'For the queen!', 'Get it!'], { style: 'shout', delay: Math.random() * 0.4 });
    if (t === 'wasp-mobbed') { bubbles.pow(event, 'POKE! POKE!', 'bump'); if (!waspSaid.has('slam')) { waspSaid.add('slam'); toast('It\u2019s dazed! Fly above its head and press SPACE for a butt slam.'); } }
    if (t === 'wasp-shake') { bubbles.pow(event, 'SHAKE!', 'bumble'); say('wasp', ['GET OFF ME!', 'Pests!', 'ENOUGH!'], { style: 'bumble' }); }
    if (t === 'wasp-hit') {
      boss.hit(); bubbles.pow(event, ['BONK!', 'WHAM!', 'BOOF!', 'SPLAT!', 'KAPOW!'][Math.min(4, event.hits - 1)], 'bumble');
      bubbles.pow({ x: event.x + 0.7, y: event.y + 1.6, z: event.z }, `−${WASP.hp / WASP.hits}`, 'damage'); // floating damage, like in an RPG
      burst.emit(probe.set(event.x, event.y, event.z), { color: '#ffe066', count: 30, speed: 4.5, gravity: -4 }); beeView.bump(0.8);
      if (event.hits === 1) toast('Slam! Four more: climb up and do it again. The bar shows your hits.'); // later hits show in the boss bar (queued toasts would lag behind)
    }
    if (t === 'wasp-swat' && !waspSaid.has('swat')) { waspSaid.add('swat'); toast('Ouch! Don\u2019t fly into it: slam its head from above.'); }
    if (t === 'wasp-bonus') { toast(`🏆 You beat the wasp! +${event.points} points`); for (const p of game.players.values()) if (p.bot && Math.random() < 0.5) say(p.id, ['Hooray!', 'Bye-bye, wasp!', 'Best bee ever!'], { delay: 0.5 + Math.random() }); }
    if (t === 'wasp-fall') { bubbles.pow(event, 'K.O.!', 'bumble'); say('wasp', ['Ooof…', 'My head…'], { style: 'bumble', delay: 0.8 }); }
    if (t === 'wasp-flee') { // the farewell: banner, confetti, cheering
      victoryT = 4.2; $('victory').hidden = false; $('victory-text').textContent = `The wasp reels off into the sky. +${WASP.bonus} points!`;
      const at = beeModels.get(player?.id)?.group.position;
      if (at) for (const [color, delay] of [['#ffd21a', 0], ['#ff7a1a', 0.25], ['#fff3c4', 0.5], ['#7fd36a', 0.75]]) setTimeout(() => burst.emit(probe.set(at.x, at.y + 1, at.z), { color, count: 34, speed: 5, gravity: -5, size: 0.13, life: 1.4 }), delay * 1000);
      for (const p of game.players.values()) if (p.bot && !p.ko) say(p.id, ['Hooray!', 'And stay out!', 'Bye-bye, wasp!', 'We did it!'], { delay: 0.3 + Math.random() * 1.2 });
    }
    if (t === 'wasp-gone') toast('The wasp flew off. Back to the honey!');
    if (t === 'wasp-kick') toast('Oh no! The wasp is smashing the hive!');
    if (t === 'hive-collapse') {
      wreckTarget = 1; bubbles.pow({ x: 0, y: 4, z: 0 }, 'CRUNCH!', 'bumble');
      for (let i = 0; i < 4; i++) burst.emit(probe.set(Math.sin(i * 1.6) * 1.5, 2 + i * 0.5, Math.cos(i * 1.6) * 1.5), { color: '#f2a516', count: 40, speed: 6, gravity: -9, size: 0.2, life: 1.4 });
    }
    if (t === 'wasp-wasted') wastedT = 0;
    if (t === 'bee-item') { startTokenShot(event); toast('🐝 A bee token appeared! Grab it for five extra bees.'); }
    if (t === 'bee-item-collect') { burst.emit(probe.set(event.x, event.y, event.z), { color: '#ffd84a', count: 26, speed: 3, gravity: -3 }); toast(game.wasp ? '🐝 Bee token! Press B to call 5 defender bees.' : '🐝 Bee token! Press B for 5 new bees now, or save it for the wasp.'); }
    if (t === 'bee-item-gone') toast('The bee token faded away.');
    if (t === 'bee-reinforce') {
      toast(event.defenders ? '🛡 Five defender bees join the fight!' : '🐝 Five new bees crawl out of the hive!');
      event.ids.forEach((id, i) => { if (i % 2 === 0) say(id, event.defenders ? ['For the hive!', 'Defenders, go!', 'Stand back, wasp!'] : ['Reporting for duty!', 'Fresh wings!', 'Where\u2019s the nectar?'], { delay: 1 + i * 0.3 }); });
    }
  }
  function bossFrame(dt, elapsed) {
    boss.update(paused ? 0 : dt, elapsed, game, player, !!(player && game.slamReady(player)));
    beeToken.update(paused ? 0 : dt, elapsed, started ? game.beeItem : null);
    // Reinforcements leave with the round: drop their models.
    for (const [id, bee] of beeModels) if (!game.players.has(id)) { scene.remove(bee.group); scene.remove(bee.shadow); if (bee.stem) scene.remove(bee.stem); bee.labelTexture?.dispose(); beeModels.delete(id); }
    wreck += (wreckTarget - wreck) * Math.min(1, dt * 3);
    const w = game.wasp;
    if (w?.phase === 'kick') { const k = Math.sin(elapsed * 14); hive.group.rotation.z = k * 0.04 * (0.5 + w.t / 4.6); hive.group.rotation.x = Math.cos(elapsed * 11) * 0.03; }
    else if (!w) hive.group.rotation.z *= 0.9;
    if (victoryT > 0) { victoryT = Math.max(0, victoryT - dt); if (!victoryT) $('victory').hidden = true; }
    if (wastedT >= 0) { // the light goes down, colour drains, WASTED fades in
      wastedT += dt; const k = Math.min(1, wastedT / 2.2);
      hemi.intensity = 2.4 * (1 - 0.75 * k); sun.intensity = 3.2 * (1 - 0.8 * k);
      renderer.domElement.style.filter = `grayscale(${(k * 0.85).toFixed(2)}) brightness(${(1 - 0.25 * k).toFixed(2)})`;
      if (wastedT > 1.1) $('wasted').hidden = false;
    }
  }
  function updateUI() {
    const seconds = Math.max(0, Math.ceil(game.remaining)); $('timer').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    $('round').textContent = String(game.round).padStart(2, '0'); $('honey').textContent = game.honey;
    const percent = Math.min(100, Math.floor(game.honey / game.goal * 100)); $('honey-progress').style.width = `${percent}%`; $('percent').textContent = `${percent}%`;
    // Your share of the hive's honey, shown in your colour on the same bar.
    const mine = started ? gauge.player : 0; $('player-progress').style.width = `${Math.min(100, mine / game.goal * 100)}%`; $('your-share').textContent = started ? `YOU ${mine}` : '';
    if (player) {
      $('bag').innerHTML = Array.from({ length: RULES.capacity }, (_, i) => `<i class="${i < player.bag ? 'filled' : ''}"></i>`).join('') + `<strong>${player.bag}<span> / 8</span></strong>`;
      const recharge = BOOST.cooldown - BOOST.duration;
      if (player.turbo) { $('turbo-label').textContent = `SPEED ${player.turbo.toFixed(1)}s`; $('turbo-meter').style.width = `${player.turbo / TURBO.duration * 100}%`; }
      else { $('turbo-label').textContent = player.turboWait ? `SPEED IN ${Math.ceil(player.turboWait)}s` : 'SPEED READY'; $('turbo-meter').style.width = `${(1 - player.turboWait / TURBO.cooldown) * 100}%`; }
      if (game.boosting(player)) { $('boost-label').textContent = `BOOST ${(player.boost - recharge).toFixed(1)}s`; $('boost-meter').style.width = `${(player.boost - recharge) / BOOST.duration * 100}%`; }
      else { $('boost-label').textContent = player.boost ? `BOOST IN ${Math.ceil(player.boost)}s` : 'BOOST READY'; $('boost-meter').style.width = `${(1 - player.boost / recharge) * 100}%`; }
      $('power-pips').innerHTML = Array.from({ length: POWER.need }, (_, i) => `<i class="${player.powered || i < player.power ? 'on' : ''}"></i>`).join('');
      $('power').classList.toggle('ready', player.powered); $('power-label').textContent = player.powered ? '⚡ POWER READY' : 'NECTAR POWER';
      // Bumblebee shoves left: each costs 2 nectar from the bag, so the count drops with every shove.
      const shoves = Math.floor(player.bag / SHOVE.cost); $('shoves').hidden = !player.powered; $('shoves').textContent = `🐝 SHOVES ×${shoves}`; $('shoves').classList.toggle('empty', !shoves);
      $('alt').textContent = player.y.toFixed(1); $('alt-marker').style.bottom = `${(player.y - WORLD.floor) / (WORLD.ceiling - WORLD.floor) * 26}px`;
      if (player.bag > lastBag && player.bag === RULES.capacity) toast('Nectar bag full! Bring it to the hive for double points.');
      $('points').textContent = player.points.toLocaleString('en'); $('best').textContent = `BEST ${Math.max(game.best, player.points).toLocaleString('en')}`;
      const heavy = player.bag >= LOAD.heavy; $('bag-label').textContent = heavy ? `YOUR NECTAR · HEAVY −${Math.round((1 - loadFactor(player.bag)) * 100)}%` : 'YOUR NECTAR'; $('bag-label').classList.toggle('heavy', heavy);
      lastBag = player.bag; lastScore = player.score;
    }
    if (started && game.result && game.result !== lastResult) { $('phase').textContent = 'RESETTING'; scoresDue = !demo; }
    if (demo) { const s = Math.floor(demo.time); $('demo-time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; $('demo-label').textContent = demo.label; }
    // After a win the party plays for a few seconds before the highscore table covers it.
    if (scoresDue && game.result && RULES.break - game.remaining >= (game.result === 'complete' ? 6 : game.result === 'wasted' ? 5.5 : 0.4)) { scoresDue = false; showScores(); }
    if (game.round !== lastRound && pendingBoss !== null) { applyBoss(pendingBoss); pendingBoss = null; }
    if (game.round !== lastRound) { resetBoss(); modal.close(); $('phase').textContent = 'ACTIVE'; toast(game.best ? `New round. Best this session: ${game.best.toLocaleString('en')} points.` : 'New round.'); lastScore = 0; lastBag = 0; }
    lastResult = game.result; lastRound = game.round;
    $('alert-count').textContent = game.wasp ? '!' : Math.ceil(game.bumbleWarn);
    updateBossUI();
    const next = document.getElementById('hive-next'); if (next && game.result) next.textContent = Math.max(0, Math.ceil(game.remaining));
  }
  function handle(events, dt) {
    for (const event of events) {
      if (event.type === 'collect') burst.emit(probe.set(FLOWERS[event.flower].x, FLOWERS[event.flower].y, FLOWERS[event.flower].z), { color: '#ffd35a', count: 16, speed: 2.2 });
      if (event.type === 'deliver') { const bee = game.players.get(event.id); if (bee) gauge.deliver(probe.set(bee.x, bee.y, bee.z), event.amount, player && event.id === player.id ? 'player' : 'scouts'); }
      if (event.type === 'heist-drain') gauge.drain(1);
      if (event.type === 'deliver' && player && event.id === player.id) {
        bubbles.pow({ x: 0, y: 5.6, z: 0 }, `+${event.points}${event.bonus > 1 ? ` ×${event.bonus}` : ''}`, 'points');
        toast(`+${event.points} points: ${event.amount} nectar${event.bonus > 1 ? ` × ${event.bonus} ${event.amount >= RULES.capacity ? 'full' : 'big'}-load bonus` : ''}.`);
        burst.emit(probe.set(0, 4.3, 0), { color: '#f5b324', count: 34, speed: 3.6, gravity: -5 }); hiveBeacon = Math.max(hiveBeacon, 0.6);
      }
      else if (event.type === 'deliver') { burst.emit(probe.set(0, 4.3, 0), { color: '#f5b324', count: 34, speed: 3.6, gravity: -5 }); hiveBeacon = Math.max(hiveBeacon, 0.6); }
      else if (event.type === 'bump') burst.emit(probe.set(event.x, event.y, event.z), { color: '#fff7d9', count: 10, speed: 2.4, gravity: 0, life: 0.5 });
      else if (event.type === 'thud') burst.emit(probe.set(event.x, event.y, event.z), { color: '#d9c49a', count: 8, speed: 1.8, gravity: -2, life: 0.6 });
      else if (event.type === 'bumble-hit') {
        burst.emit(probe.set(event.x, event.y, event.z), { color: '#ffe066', count: 24, speed: 4.2, gravity: -2 });
        if (event.spilled) burst.emit(probe, { color: '#f6b21b', count: event.spilled * 7, speed: 1.6, gravity: -9, size: 0.16, life: 1.1 });
        if (player && event.id === player.id) { beeView.bump(1); toast(event.spilled ? `Bumped by the bumblebee! You spilled ${event.spilled} nectar.` : 'Bumped by the bumblebee!'); }
      }
      if (started && event.type === 'bumble-warning') { $('alert-text').textContent = event.mode === 'heist' ? 'BUMBLEBEE WANTS YOUR HONEY' : 'BUMBLEBEE INCOMING'; $('bumble-alert').hidden = false; alertTime = event.seconds + 0.6; }
      if (started && event.type === 'bumble-enter') startCinematic(event.mode);
      if (started && event.type === 'bumble-enter' && event.mode !== 'heist' && reducedMotion) toast('Here it comes! Dodge the bumblebee!');
      if (started && event.type === 'heist-end') heistNote = { saved: event.rescued, drained: event.drained, time: readingTime(heistOutcome(event.rescued, event.drained)) };
      if (started && event.type === 'power-ready') { powerTip = readingTime($('power-tip').textContent); powerNag = 30; }
      if (started && event.type === 'scout-mood') { const lines = event.mood === 'fast' ? ['Wheee!', 'Coming through!', 'Zoom zoom!'] : ['Yawn…', 'So sleepy…', 'Slow and steady…']; bubbles.say(event.id, lines[Math.floor(Math.random() * lines.length)]); }
      if (player && event.id === player.id && event.type === 'turbo' && started) { boostRings.trigger(false); skyFlash = 0.5; toast(`💨 Speed mode for ${TURBO.duration} seconds!`); }
      if (player && event.id === player.id && event.type === 'boost' && started) { boostRings.trigger(event.power); skyFlash = event.power ? 1 : 0.6; }
      if (player && event.id === player.id && event.type === 'rain-start' && started) {
        toast(`☁ ${game.rainRule.bumps} bumps in ${game.rainRule.window} s! A rain cloud soaks you: slower for ${RAIN.wet} seconds.`);
        // The bee thinks out loud once the cloud has sailed in.
        if (view !== 'bee') { const lines = ['Oh no, not again…', 'What a lousy day…', 'Why always me?', 'Great. Just great.', 'My poor wings…']; bubbles.say(player.id, lines[Math.floor(Math.random() * lines.length)], { style: 'think', delay: 1 }); }
      }
      if (player && event.id === player.id && event.type === 'rain-end') { const at = beeModels.get(player.id)?.group.position; if (at) burst.emit(at, { color: '#9fd6ff', count: 26, speed: 3.2, gravity: -6, size: 0.08, life: 0.7 }); if (view !== 'bee') bubbles.say(player.id, 'Brrrrr!'); }
      if (started) bossEvent(event);
      if (event.type === 'round-end') { alertTime = 0; $('bumble-alert').hidden = true; endCinematic(); }
      if (started && event.type === 'round-end' && event.result === 'complete') { toast('🍯 Goal reached! The hive overflows with honey!'); audio.play('deliver', null, { rate: 0.85 }); }
      if (started && event.type === 'heavy' && player && event.id === player.id) loadTip = readingTime($('load-tip').textContent);
      if (event.type === 'wilt') burst.emit(probe.set(event.x, event.y, event.z), { color: '#a08a4a', count: 12, speed: 1.2, gravity: -3, size: 0.1, life: 1.2 });
      if (event.type === 'sprout') burst.emit(probe.set(event.x, 0.4, event.z), { color: '#9bd36a', count: 16, speed: 2.2, gravity: -5, size: 0.09 });
      if (event.type === 'topple') burst.emit(probe.set(event.x, event.y, event.z), { color: event.kind === 'tree' ? '#7fae5c' : '#f2a5c0', count: 22, speed: 3.4, gravity: -4, size: 0.14 });
      if (event.type === 'restore') burst.emit(probe.set(event.x, 0.6, event.z), { color: '#fff3b0', count: 10, speed: 1.6, gravity: 0, life: 0.5 });
      if (event.type === 'bumble-shoved') { burst.emit(probe.set(event.x, event.y, event.z), { color: '#ffd23f', count: 30, speed: 5.5, gravity: -1, life: 0.8 }); if (player && event.id === player.id) beeView.bump(0.6); }
      if (event.type === 'bump' && event.power) burst.emit(probe.set(event.x, event.y, event.z), { color: '#ffd23f', count: 26, speed: 5, gravity: -1, life: 0.7 });
      if (player && (event.type === 'bump' && (event.by === player.id || event.victim === player.id) || event.type === 'thud' && event.id === player.id)) beeView.bump(0.35);
    }
    for (const action of react(events, game, dt)) {
      if (action.kind === 'pow') { bubbles.pow(action, action.text, action.style); continue; }
      // In bee view the player hears their own bee grumble but sees no bubble over their head.
      if (!(view === 'bee' && player && action.id === player.id)) bubbles.say(action.id, action.text, { style: action.style, delay: action.delay });
      const speaker = action.id === 'bumble' ? game.bumble : game.players.get(action.id);
      if (speaker) soundscape.voice({ x: speaker.x, y: speaker.y, z: speaker.z }, { delay: action.delay ?? 0, angry: action.style === 'shout', deep: action.id === 'bumble' });
    }
    soundscape.events(events, game, player);
  }
  function input(dt) {
    const held = (...codes) => codes.some(code => keys.has(code));
    const turbo = held('KeyE') || turboTap; turboTap = false;
    const slam = slamTap; slamTap = false;
    const forward = Number(held('KeyW', 'ArrowUp')) - Number(held('KeyS', 'ArrowDown'));
    const vertical = Number(held('Space')) - Number(held('KeyC'));
    const dash = held('ShiftLeft', 'ShiftRight');
    if (view === 'bee') {
      const turn = Number(held('ArrowRight')) - Number(held('ArrowLeft'));
      beeView.turn(turn, dt);
      const right = Number(held('KeyD')) - Number(held('KeyA'));
      return { ...beeView.movement(forward, right, vertical), dash, turbo, slam, face: beeView.yaw, strafe: right };
    }
    const right = Number(held('KeyD', 'ArrowRight')) - Number(held('KeyA', 'ArrowLeft'));
    return { ...orbit.movement(forward, right), y: vertical, dash, turbo, slam };
  }
  // Start of play: zoom in on the player's bee and make it glow for a moment, then ease back out.
  const SPOTLIGHT = 3.5, spotEye = new THREE.Vector3(), spotAim = new THREE.Vector3();
  // Start of play: a slow flight around the island from outside (the brook and waterfall in view), then the
  // camera swoops down to the player's bee, holds a moment, and eases into the garden view. Skippable.
  const FLY = Object.freeze({ circle: 4.2, swoop: 1.6, hold: 0.9, out: 1.3, from: 2.4, to: 1.05, radius: 72, elevation: 0.3 });
  const flyEye = new THREE.Vector3(), flyAim = new THREE.Vector3(), closeEye = new THREE.Vector3(), orbitEye = new THREE.Vector3();
  let flyover = -1, saidHi = false;
  const FLIGHT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyC', 'ShiftLeft', 'ShiftRight', 'KeyE']);
  function circlePose(t) {
    const az = FLY.from + (FLY.to - FLY.from) * Math.min(1, t / (FLY.circle + FLY.swoop)), r = FLY.radius - 8 * Math.min(1, t / FLY.circle), flat = Math.cos(FLY.elevation) * r;
    flyAim.set(0, -2.5, 0); flyEye.set(Math.sin(az) * flat, Math.sin(FLY.elevation) * r, Math.cos(az) * flat);
  }
  const startTip = () => toast('Fly near the honey drops to collect. Space / C to climb and sink. V for bee view.');
  function skipFlyover() { flyover = FLY.circle + FLY.swoop; game.cutscene = Math.min(game.cutscene, FLY.hold); }
  function flyoverCamera(dt, own) {
    flyover += paused ? 0 : dt;
    const t = flyover, swoopEnd = FLY.circle + FLY.swoop, holdEnd = swoopEnd + FLY.hold, outEnd = holdEnd + FLY.out, bee = own.group.position;
    orbitEye.copy(camera.position); closeEye.copy(camera.position).sub(orbitTarget).setLength(9).add(bee); // the garden view's direction, 9 m from the bee
    spotlight = t >= FLY.circle && t < outEnd ? 1 : 0;
    if (!saidHi && t >= FLY.circle + FLY.swoop * 0.6) { saidHi = true; bubbles.say(player.id, 'That\u2019s you!'); }
    // The HUD returns as you take over.
    if (t >= holdEnd && root.classList.contains('flyover')) { root.classList.remove('flyover'); startTip(); }
    if (t < FLY.circle) { circlePose(t); camera.position.copy(flyEye); camera.lookAt(flyAim); }
    else if (t < swoopEnd) { const k = ease((t - FLY.circle) / FLY.swoop); circlePose(t); camera.position.lerpVectors(flyEye, closeEye, k); camera.lookAt(probe.lerpVectors(flyAim, bee, k)); }
    else if (t < holdEnd) { camera.position.copy(closeEye); camera.lookAt(bee); }
    else if (t < outEnd) { const k = ease((t - holdEnd) / FLY.out); camera.position.lerpVectors(closeEye, orbitEye, k); camera.lookAt(probe.lerpVectors(bee, orbitTarget, k)); }
    else { flyover = -1; spotlight = 0; }
  }
  // A neglected flower droops and sinks away, then a new one sprouts with a little overshoot.
  function wiltPose(g, w) {
    if (!w) { if (g.userData.wilted) { g.scale.setScalar(1); g.rotation.z = 0; g.visible = true; g.userData.wilted = false; } return; }
    g.userData.wilted = true;
    if (w > WILT.regrow) { const t = 1 - (w - WILT.regrow) / WILT.fade; g.visible = true; g.rotation.z = 0.9 * t * t; g.scale.set(1 - 0.3 * t, Math.max(0.05, 1 - 0.95 * t), 1 - 0.3 * t); }
    else if (w > WILT.grow) g.visible = false;
    else { const t = 1 - w / WILT.grow; g.visible = true; g.rotation.z = 0; g.scale.setScalar(Math.max(0.02, t < 0.8 ? t / 0.8 * 1.08 : 1.08 - (t - 0.8) / 0.2 * 0.08)); }
  }
  let strafe = 0, spotlight = 0;
  function update(dt, elapsed) {
    if (!active) return;
    let ticked = false;
    if (!paused) {
      if (player) { const move = demo ? demo.update(dt) : modal.open ? { x: 0, y: 0, z: 0 } : input(dt); strafe = move.strafe ?? 0; game.setInput(player.id, move); }
      game.tick(dt); ticked = true;
      // Keep the landing screen's world alive without using up its first round.
      if (!started) { game.remaining = game.duration; if (game.result) game.reset(); }
    }
    if (ticked) handle(game.events, dt);
    if (ticked && demo) { demo.observe(game.events); if (demo.done) stopDemo(); }
    for (const p of game.players.values()) {
      if (!beeModels.has(p.id)) createBee(p);
      const bee = beeModels.get(p.id), own = p === player;
      bee.group.position.lerp(probe.set(p.x, p.y + Math.sin(elapsed * 7 + p.id) * 0.06, p.z), 1 - Math.exp(-dt * (own ? 22 : 15)));
      const angle = Math.atan2(Math.sin(p.yaw - bee.body.rotation.y), Math.cos(p.yaw - bee.body.rotation.y)); bee.body.rotation.y += angle * Math.min(1, dt * 12);
      // Stunned bees tumble; upset bees shake.
      bee.tumble = p.stun ? bee.tumble + dt * 13 : bee.tumble * Math.exp(-dt * 8);
      bee.body.rotation.z = p.stun ? Math.sin(bee.tumble) * 0.9 : p.angry ? Math.sin(elapsed * 38) * 0.18 : Math.sin(elapsed * 2 + p.id) * 0.04;
      bee.body.rotation.x = p.stun ? Math.cos(bee.tumble * 0.7) * 0.5 : Math.max(-0.35, Math.min(0.35, -p.vy * 0.06));
      // Pollen baskets swell with every drop and shrink away after delivering.
      bee.load += (p.bag / RULES.capacity - bee.load) * Math.min(1, dt * 8);
      const fills = basketFills(bee.load);
      bee.baskets.forEach(b => { const f = fills[b.userData.pair], s = f > 0.01 ? (POLLEN.base + POLLEN.grow * f) * (b.userData.pair === 2 ? POLLEN.front : 1) : 0; b.visible = s > 0; b.scale.set(s, s * 1.15, s * 1.3); });
      bee.wings.forEach((w, i) => { w.rotation.z = Math.sin(elapsed * (game.boosting(p) || p.turbo ? 95 : 75)) * 0.45 * (i ? 1 : -1); });
      if (p.crawl > 0) { bee.body.rotation.x = 0.28; bee.body.rotation.z = Math.sin(elapsed * 16 + p.id) * 0.06; bee.wings.forEach((w, i) => { w.rotation.z = (i ? 1 : -1) * 0.08; }); } // crawling out of the door
      bee.shadow.position.set(p.x, 0.07, p.z); bee.shadow.material.opacity = 0.45 - Math.min(0.3, (p.y - WORLD.floor) * 0.035);
      if (p.ko) { bee.body.rotation.z = Math.PI * 0.92; bee.body.rotation.x = 0.2; } // knocked out: on its back in the grass
      if (p.caught) bee.body.rotation.z = Math.sin(elapsed * 30) * 0.5; // struggling in the mandibles
      bee.stars.group.visible = p.stun > 0.2 || p.ko; if (p.stun || p.ko) bee.stars.update(elapsed);
      bee.aura?.update(dt, elapsed, { active: p.powered || (own && spotlight > 0.3), boosting: game.powerBoosting(p) });
      // Shaking itself dry after the rain: a fast, fading wiggle.
      if (p.shake) bee.body.rotation.z = Math.sin(elapsed * 55) * 0.55 * (p.shake / RAIN.shake);
      bee.group.visible = !(own && view === 'bee' && !game.celebration); // Name tags of bees right in front of the camera would cover the view (tour close-ups, bee view).
      if (own) bee.label.material.opacity = started ? 0.8 : 1; // slightly see-through during play
      const near = camera.position.distanceTo(bee.group.position); bee.label.visible = cinematic.active ? false : !started ? near > 11 : (view !== 'bee' && !spotlight) || near > 6;
      bee.fuzz.userData.setLayers(fuzzLayers(near));
      if (bee.stem) { bee.stem.visible = view === 'orbit' && started; bee.stem.position.copy(bee.group.position); bee.stem.scale.y = Math.max(0.01, bee.group.position.y - 0.1); }
    }
    const b = game.bumble;
    if (b) {
      bumbleExit = 0; bumble.group.visible = bumbleShadow.visible = true; bumble.group.scale.setScalar(1); bumbleShadow.material.opacity = 0.3;
      if (!bumble.seen) { bumble.group.position.set(b.x, b.y, b.z); bumble.group.rotation.y = b.yaw; bumble.seen = true; }
      // A bumped thief shakes on the hive; a dislodged one tumbles while it falls.
      const shake = b.wobble ? Math.sin(elapsed * 42) * 0.12 * b.wobble : 0;
      bumble.group.position.lerp(probe.set(b.x + shake, b.y, b.z - shake), 1 - Math.exp(-dt * 10));
      bumble.group.rotation.y += Math.atan2(Math.sin(b.yaw - bumble.group.rotation.y), Math.cos(b.yaw - bumble.group.rotation.y)) * Math.min(1, dt * 6);
      if (b.phase === 'falling') { bumble.group.rotation.z += dt * 9; bumble.group.rotation.x += dt * 4; }
      else { bumble.group.rotation.z *= Math.exp(-dt * 6); bumble.group.rotation.x *= Math.exp(-dt * 6); }
      const perched = b.phase === 'perched';
      bumble.update(dt, elapsed, { speed: b.speed, stunned: b.oops > 0 || b.wobble > 0.3, perched, sucking: perched, flailing: b.phase === 'falling' });
      bumbleShadow.position.set(b.x, 0.07, b.z);
      bumbleDrift.copy(bumble.group.position).sub(bumbleLast).divideScalar(Math.max(dt, 1e-3)); bumbleLast.copy(bumble.group.position);
    } else if (bumble.seen) { // it just left: if the camera sees it, fade out with a puff of pollen and sparkles
      bumble.seen = false; bumbleExit = inView(bumble.group.position, 2) ? BUMBLE_EXIT : 0;
      if (bumbleExit) { burst.emit(bumble.group.position, { color: '#ffe08a', count: 34, speed: 3.2, gravity: -1.2, size: 0.15, life: 1.1 }); burst.emit(bumble.group.position, { color: '#ffffff', count: 18, speed: 2.2, gravity: 0.6, size: 0.1, life: 0.9 }); }
    }
    if (!b && bumbleExit > 0) { // drifts on, shrinks, spins a little; the shadow fades with it
      bumbleExit = Math.max(0, bumbleExit - dt); const k = bumbleExit / BUMBLE_EXIT;
      bumble.group.position.addScaledVector(bumbleDrift, dt * k); bumble.group.position.y += dt * 1.4;
      bumble.group.scale.setScalar(Math.max(0.001, k * k * (3 - 2 * k))); bumble.group.rotation.y += dt * 5 * (1 - k);
      bumble.update(dt, elapsed, { speed: 5 }); bumbleShadow.material.opacity = 0.3 * k;
      if (!bumbleExit) { bumble.group.visible = bumbleShadow.visible = false; bumble.group.scale.setScalar(1); bumbleShadow.material.opacity = 0.3; }
    } else if (!b) bumble.group.visible = bumbleShadow.visible = false;
    bumble.fur.userData.setLayers(bumbleLayers(camera.position.distanceTo(bumble.group.position)));
    if (!started) tourFrame(dt, elapsed);
    flowerModels.forEach(({ flower, drop }, i) => { flower.update(elapsed); drop.update(dt, elapsed, !game.cooldowns[i]); wiltPose(flower.group, game.wilt[i]); });
    // Toppled trees and flowers fall over, lie a moment with a small bounce, and stand up again.
    for (const [owner, pivot] of pivots) {
      const state = game.toppled.get(owner);
      if (!state) { if (pivot.userData.down) { pivot.quaternion.identity(); pivot.userData.down = false; } continue; }
      const total = POWER.topple + POWER.rise, since = total - state.time;
      const angle = since < 0.35 ? 1.45 * (since / 0.35) ** 2 : state.time > POWER.rise ? 1.45 - Math.abs(Math.sin((since - 0.35) * 9)) * 0.12 * Math.exp(-(since - 0.35) * 4) : 1.45 * (1 - (1 - state.time / POWER.rise) ** 2);
      pivot.quaternion.setFromAxisAngle(axis.set(state.dz, 0, -state.dx).normalize(), angle); pivot.userData.down = true;
    }
    burst.update(dt);
    hiveBeacon = Math.max(0, hiveBeacon - dt); hive.update(elapsed, hiveBeacon);
    gauge.sync(game.honey); gauge.update(dt, elapsed); celebrate(dt, elapsed); bossFrame(dt, elapsed);
    updateSky(paused ? 0 : dt); if (!paused) stream.update(dt, elapsed);
    const mine = player && beeModels.get(player.id);
    if (mine) {
      rainCloud.group.position.copy(mine.group.position).add(probe.set(0, 3, 0)); // well above the bee, its badge and bubbles
      boostRings.update(paused ? 0 : dt, mine.group.position);
      if (player.wet && !paused) { dripTimer -= dt; if (dripTimer <= 0) { dripTimer = 0.25; burst.emit(mine.group.position, { color: '#9fd6ff', count: 2, speed: 0.4, gravity: -7, size: 0.05, life: 0.5 }); } }
    }
    rainCloud.update(paused ? 0 : dt, elapsed, !!player?.wet && view !== 'bee');
    $('rain-overlay').hidden = !(player?.wet && view === 'bee');
    motes.rotation.y = Math.sin(elapsed * 0.07) * 0.1;
    const own = player && beeModels.get(player.id);
    if (cinematic.active && cinematicFrame(dt)) { /* The bumblebee entrance placed the camera. */ }
    else if (!started && !reducedMotion) { /* The landing tour placed the camera. */ }
    else if (view === 'bee' && own && !game.celebration) {
      beeView.apply(camera, own.group.position, dt, elapsed, { strafe, boosting: game.boosting(player) || player.turbo > 0, stunned: player.stun > 0 });
      viewModel.update(elapsed, { boosting: game.boosting(player) || player.turbo > 0 });
    } else {
      // The garden view keeps your bee in the centre (plus a pan offset while you drag, which eases back).
      if (!orbit.panning) orbit.settle(paused ? 0 : dt);
      orbitTarget.lerp(probe.set(player ? player.x + orbit.panX : 0, player ? player.y : 0, player ? player.z + orbit.panZ : 0), 1 - Math.exp(-dt * 8));
      orbit.apply(camera, orbitTarget);
      if (game.celebration) {
        // Frame the party: the swollen hive, the honey flood, and the honeycomb of bees above it.
        const k = ease(game.celebration.t / 2.5); spotAim.set(0, 5, 0);
        spotEye.copy(camera.position).sub(orbitTarget).setLength(22).add(spotAim);
        camera.position.lerp(spotEye, k); camera.lookAt(probe.copy(orbitTarget).lerp(spotAim, k));
        if (camera.fov !== ORBIT_FOV) { camera.fov = ORBIT_FOV; camera.updateProjectionMatrix(); }
      } else if (flyover >= 0 && own) flyoverCamera(dt, own);
      else if (spotlight > 0 && own) {
        // Ease in over the first second, hold, ease out over the last 1.2 s.
        spotlight = Math.max(0, spotlight - (paused ? 0 : dt));
        const since = SPOTLIGHT - spotlight, k = Math.min(1, since / 1, spotlight / 1.2), ease = k * k * (3 - 2 * k);
        spotAim.copy(own.group.position); spotEye.copy(camera.position).sub(orbitTarget).setLength(9).add(spotAim);
        camera.position.lerp(spotEye, ease); camera.lookAt(probe.copy(orbitTarget).lerp(spotAim, ease));
      }
    }
    if (tokenShot >= 0) tokenShotCamera(dt);
    // The boss fight's camera shots blend over the garden or bee view (and ease back out afterwards).
    if ((started && game.wasp) || boss.directing) { camera.userData.baseFov = view === 'bee' ? beeView.fov : ORBIT_FOV; camera.getWorldDirection(bossLook); boss.camera(paused ? 0 : dt, camera, game, player, bossLook.multiplyScalar(12).add(camera.position)); }
    if (!started && audio.enabled && !paused) {
      // Landing screen: the ear sits where the tour camera looks (the hive, the chased scout), not at the camera
      // far outside the island, so the bees and their bumps are heard and the waterfall at the rim stays distant.
      // The scout the tour follows buzzes up close, like your own bee in play; the others fly past it.
      const ear = reducedMotion ? orbitTarget : tourAim, featured = game.players.get(tourScout) ?? null; camera.getWorldDirection(probe);
      soundscape.frame(game, featured, dt, { listener: { x: ear.x, y: ear.y, z: ear.z, yaw: Math.atan2(probe.x, probe.z), pitch: Math.asin(Math.max(-1, Math.min(1, probe.y))) }, music, water: nearBrook(ear) });
    }
    if (player && started) {
      const listener = cinematic.active ? { x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw: Math.atan2(-camera.matrixWorld.elements[8], -camera.matrixWorld.elements[10]) } : view === 'bee' ? { x: player.x, y: player.y, z: player.z, yaw: beeView.yaw, pitch: beeView.pitch } : { x: player.x, y: player.y, z: player.z, yaw: orbit.azimuth + Math.PI };
      if (!paused) soundscape.frame(game, player, dt, { listener, beeView: view === 'bee', music, water: nearBrook(listener) });
    }
    renderer.render(scene, camera);
    bubbles.update(dt, camera, width, height, locate);
    const label = screen(hiveTop);
    $('hive-label').hidden = !label.visible || view === 'bee';
    if (label.visible) $('hive-label').style.transform = `translate3d(${label.x.toFixed(1)}px, ${(label.y - 6).toFixed(1)}px, 0) translate(-50%, -100%)`;
    alertTime = Math.max(0, alertTime - (paused ? 0 : dt));
    if (!alertTime) $('bumble-alert').hidden = true;
    updateHeist(paused ? 0 : dt); updatePowerTip(paused ? 0 : dt);
    const entry = game.bumbleMode === 'heist' ? game.heistAngle : game.bumbleAngle, gone = b && (b.leaving || b.phase === 'leaving' || b.phase === 'falling');
    if (started && (game.bumbleWarn || b) && !gone) placeMarker(b ? bumble.group.position : markerTarget.set(Math.sin(entry) * WORLD.radius, 4, Math.cos(entry) * WORLD.radius));
    else $('bumble-marker').hidden = true;
    uiTime += dt; if (uiTime > 0.12) { updateUI(); uiTime = 0; }
  }

  // A new bee token: the camera glides over to show where it floats, pushes in a little, eases back out and
  // returns to your bee. The round clock waits meanwhile (a short cutscene); Enter, Esc or a click skips it.
  const TOKEN_SHOT = Object.freeze({ to: 1.1, hold: 1.4, back: 1.1, far: 17, near: 13.5, elevation: 0.62, skip: 5 });
  const TOKEN_SHOT_LENGTH = TOKEN_SHOT.to + TOKEN_SHOT.hold + TOKEN_SHOT.back;
  const tokenAt = new THREE.Vector3(), shotEye = new THREE.Vector3(), shotLook = new THREE.Vector3(), baseLook = new THREE.Vector3();
  let tokenShot = -1;
  function startTokenShot(event) {
    // Not over another cutscene, the start flight, the boss, or when the token is right beside your bee.
    if (!started || !player || reducedMotion || cinematic.active || flyover >= 0 || game.wasp || game.celebration || game.cutscene) return;
    if (Math.hypot(event.x - player.x, event.y - player.y, event.z - player.z) < TOKEN_SHOT.skip) return;
    tokenAt.set(event.x, event.y, event.z); tokenShot = 0; game.cutscene = TOKEN_SHOT_LENGTH; release();
    root.classList.add('cinematic'); $('letterbox').hidden = false; $('cine-title').textContent = '🐝 A bee token appeared over there!';
  }
  function endTokenShot() {
    if (tokenShot < 0) return;
    tokenShot = -1; game.cutscene = 0; root.classList.remove('cinematic'); $('letterbox').hidden = true;
  }
  function tokenShotCamera(dt) {
    tokenShot += paused ? 0 : dt;
    const { to, hold, back, far, near, elevation } = TOKEN_SHOT, t = tokenShot;
    if (t >= TOKEN_SHOT_LENGTH) { endTokenShot(); return; }
    // w blends from the normal view to the shot and back; the distance closes in during the hold and opens again.
    const w = t < to ? ease(t / to) : t < to + hold ? 1 : ease(1 - (t - to - hold) / back);
    const push = t < to ? 0 : t < to + hold ? ease((t - to) / hold) : ease(1 - (t - to - hold) / back);
    camera.getWorldDirection(baseLook); baseLook.multiplyScalar(12).add(camera.position);
    // Seen from the side the camera already looks from, at a fixed angle from above.
    const dx = camera.position.x - tokenAt.x, dz = camera.position.z - tokenAt.z, h = Math.hypot(dx, dz) || 1, d = far + (near - far) * push;
    shotEye.set(tokenAt.x + dx / h * Math.cos(elevation) * d, tokenAt.y + Math.sin(elevation) * d, tokenAt.z + dz / h * Math.cos(elevation) * d);
    camera.position.lerp(shotEye, w); camera.lookAt(shotLook.lerpVectors(baseLook, tokenAt, w));
  }
  // Landing tour: camera shots of the live garden, captions on how to play, then "Let's go!".
  const tour = createTour(), reducedMotion = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const tourPos = new THREE.Vector3(), tourAim = new THREE.Vector3(), tourLook = new THREE.Vector3();
  // Glide path for the tour's bee view: a wide, gentle arc around the hive that climbs and sinks
  // (flowers grow at different heights), chosen so it passes at least 2 m from trees and flowers.
  const beePath = new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, k) => {
    const s = k / 8, a = 5.5 + s * 1.5, r = 17 - s * 7;
    return new THREE.Vector3(Math.sin(a) * r, 2.8 + Math.sin(s * Math.PI * 1.6) * 1.2, Math.cos(a) * r);
  }), false, 'centripetal');
  let tourStep = -1, tourYaw = null, tourScout = 1;
  const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
  function showCaption(step) {
    const caption = $('tour-caption'), steps = tour.count - 1;
    $('tour-step').textContent = step.finale ? 'READY?' : `HOW TO PLAY · ${tour.index + 1} / ${steps}`;
    $('tour-title').textContent = step.title; $('tour-text').textContent = step.text;
    $('tour-dots').innerHTML = Array.from({ length: steps }, (_, i) => `<i class="${i <= tour.index ? 'on' : ''}"></i>`).join('');
    caption.classList.toggle('finale', !!step.finale);
    caption.classList.remove('show'); void caption.offsetWidth; caption.classList.add('show');
    $('start').classList.toggle('pulse', !!step.finale);
  }
  function tourFrame(dt, elapsed) {
    const { cover } = tour.update(paused || !active ? 0 : dt), step = tour.step, t = tour.time;
    if (tour.index !== tourStep) {
      tourStep = tour.index; tourYaw = null; showCaption(step);
      const scouts = [...game.players.values()].filter(p => p.bot); tourScout = scouts[tour.index % scouts.length]?.id ?? 1;
      if (step.shot === 'bumble') bubbles.say('bumble', 'Coming throoough!', { style: 'bumble', delay: 0.5 });
    }
    $('tour-cover').style.opacity = reducedMotion ? '0' : (cover * 0.92).toFixed(3);
    root.classList.toggle('bee-view', step.shot === 'bee' && !reducedMotion);
    if (reducedMotion) return;
    const scout = game.players.get(tourScout) ?? game.players.values().next().value;
    let fov = ORBIT_FOV, snap = cover > 0.8 || tourPos.lengthSq() === 0; // cut during the dark part of each fade
    if (step.shot === 'orbit' || step.shot === 'finale') {
      const a = 0.6 + elapsed * 0.08, r = step.finale ? 46 : 36;
      tourPos.set(Math.sin(a) * r, step.finale ? 27 : 19, Math.cos(a) * r); tourLook.set(0, 1.5, 0);
    } else if (step.shot === 'hive') {
      const a = t * 0.3 + 0.4; tourPos.set(Math.sin(a) * 16, 8, Math.cos(a) * 16); tourLook.set(0, 2.4, 0);
    } else if (step.shot === 'chase') {
      // Follow one scout from behind, smoothing its quick turns so the camera stays calm.
      const model = beeModels.get(scout.id), at = model ? model.group.position : scout;
      tourYaw = tourYaw === null ? scout.yaw : tourYaw + wrap(scout.yaw - tourYaw) * Math.min(1, dt * 1.2);
      const fx = Math.sin(tourYaw), fz = Math.cos(tourYaw);
      tourPos.set(at.x - fx * 4.2, at.y + 1.8, at.z - fz * 4.2); tourLook.set(at.x + fx * 2, at.y + 0.2, at.z + fz * 2);
      if (model) model.label.visible = false;
    } else if (step.shot === 'bee') {
      // A calm first-person glide past flowers of different heights toward the hive.
      fov = 66;
      const u = Math.min(1, t / step.time) * 0.9, point = beePath.getPointAt(u), ahead = beePath.getPointAt(Math.min(1, u + 0.12));
      tourPos.set(point.x, point.y + Math.sin(elapsed * 1.2) * 0.02, point.z); tourLook.set(ahead.x, ahead.y + 0.15, ahead.z); // nearly level gaze: flowers and bees ahead, not grass
    } else if (step.shot === 'bumble') {
      // A real bumblebee charges into a group of scouts, so the tour shows bumps, stars, and shouting.
      if (!game.bumble) releaseBumblebee(game);
      const p = bumble.group.visible ? bumble.group.position : (game.bumble ? probe.set(game.bumble.x, game.bumble.y, game.bumble.z) : tourLook), yaw = game.bumble?.yaw ?? 0;
      tourPos.set(p.x + Math.sin(yaw + 0.6) * 9, p.y + 1.8, p.z + Math.cos(yaw + 0.6) * 9); tourLook.copy(p);
    }
    if (snap) { camera.position.copy(tourPos); tourAim.copy(tourLook); }
    else { camera.position.lerp(tourPos, 1 - Math.exp(-dt * 4)); tourAim.lerp(tourLook, 1 - Math.exp(-dt * 2.5)); } // the gaze follows slowly: calm pans
    camera.lookAt(tourAim);
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = snap ? fov : camera.fov + (fov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); }
  }
  // Bumblebee entrance: approach, fly-past, and a look over its shoulder into the garden, then back to play.
  const cinematic = createCinematic(), passSpot = new THREE.Vector3(), cineLook = new THREE.Vector3();
  let cineShot = -1;
  function startCinematic(mode) {
    if (reducedMotion) return;
    endTokenShot(); // the bumblebee's entrance takes over the camera
    cinematic.start(); cineShot = -1; game.cutscene = CINEMATIC_LENGTH + 0.1; release();
    root.classList.add('cinematic'); $('letterbox').hidden = false;
    $('cine-title').textContent = mode === 'heist' ? '🐝 It\u2019s back, and it\u2019s hungry!' : '🐝 Here comes the bumblebee!';
  }
  function endCinematic() {
    if (!cinematic.active && !root.classList.contains('cinematic')) return;
    cinematic.stop(); game.cutscene = 0; root.classList.remove('cinematic'); $('letterbox').hidden = true; $('tour-cover').style.opacity = '0';
    camera.fov = view === 'bee' ? beeView.fov : ORBIT_FOV; camera.updateProjectionMatrix();
  }
  function cinematicFrame(dt) {
    const frame = cinematic.update(paused ? 0 : dt), b = game.bumble;
    if (!frame || !b) { endCinematic(); return false; }
    const p = bumble.group.position, fx = Math.sin(b.yaw), fz = Math.cos(b.yaw), rx = -fz, rz = fx;
    let fov = 46;
    if (frame.index !== cineShot) {
      cineShot = frame.index;
      if (frame.shot === 'pass') { passSpot.set(p.x + fx * 3.6 + rx * 1.5, p.y + 0.35, p.z + fz * 3.6 + rz * 1.5); audio.play('pass', null, { rate: 0.55, bus: 'bumblebee' }); }
    }
    if (frame.shot === 'approach') { const d = 7.5 - frame.t * 1.4; camera.position.set(p.x + fx * d + rx * 0.6, p.y + 0.5, p.z + fz * d + rz * 0.6); cineLook.set(p.x, p.y + 0.2, p.z); }
    else if (frame.shot === 'pass') { fov = 52; camera.position.copy(passSpot); cineLook.copy(p); }
    else { fov = 56; camera.position.set(p.x - fx * 6.5 + rx * 1.2, p.y + 2.8, p.z - fz * 6.5 + rz * 1.2); cineLook.set(p.x + fx * 12, p.y - 1.5, p.z + fz * 12); }
    camera.lookAt(cineLook);
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    $('tour-cover').style.opacity = (frame.cover * 0.9).toFixed(3);
    return true;
  }
  renderer.domElement.addEventListener('pointerdown', () => { if (cinematic.active) endCinematic(); if (tokenShot >= 0) endTokenShot(); }, true);
  function endTour() {
    $('tour-caption').hidden = true; $('tour-cover').style.opacity = '0'; $('start').classList.remove('pulse');
    root.classList.remove('bee-view'); camera.fov = ORBIT_FOV; camera.updateProjectionMatrix(); orbitTarget.set(0, 0, 0); flyover = -1; root.classList.remove('flyover');
  }

  renderControls(); setPanel(panelOpen);
  return {
    update,
    pause() { if (started && !paused) togglePause(); },
    resize(w, h) { width = w; height = h; camera.aspect = w / h; camera.updateProjectionMatrix(); placePanel(); },
    activate() { active = true; container.replaceChildren(root); onFullscreen(); placePanel(); renderer.domElement.setAttribute('aria-label', 'A floating garden with bees and a golden hive'); if (!paused) audio.resume(); if (!started) introSound(); updateUI(); },
    deactivate() { active = false; endCinematic(); release(); viewControls.cancel(); look.release(); audio.suspend(); root.remove(); },
  };
}
