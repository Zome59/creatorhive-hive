import * as THREE from 'three';
import { Game, RULES, BOOST } from './simulation.js';
import { WORLD, FLOWERS, TREES } from './world.js';
import { markup } from './ui.js';
import { GARDEN_PALETTE as palette } from './palette.js';
import { OrbitView, bindOrbitControls } from './features/orbit-view.js';
import { BeeView, bindBeeLook, createBeeViewModel } from './features/bee-view.js';
import { createFlower, createHoneyDrop, createBumblebee, createBurst, createDizzyStars, createHiveModel } from './features/models.js';
import { createHiveAudio } from './features/audio/engine.js';
import { createSoundscape } from './features/audio/soundscape.js';
import { createBubbles } from './features/speech/bubbles.js';
import { createReactions } from './features/speech/reactions.js';

const ORBIT_FOV = 38;

export function createHive({ renderer, container, notify: toast, openDialog: showModal, closeDialog = () => {}, toggleFullscreen = async () => {} }) {
  const root = document.createElement('div'); root.id = 'garden-ui'; root.className = 'garden-ui'; root.innerHTML = markup;
  const $ = id => root.querySelector(`#${id}`);
  const game = new Game();
  let player = null, started = false, paused = false, active = false, view = 'orbit', soundOn = true, width = 1, height = 1;
  const keys = new Set();
  const modal = { get open() { return !!document.querySelector('dialog[open]'); }, close: closeDialog };
  const audio = createHiveAudio(), soundscape = createSoundscape(audio), react = createReactions();
  const bubbles = createBubbles($('speech'));

  function setSound(on) {
    soundOn = on;
    if (started) audio.setEnabled(on);
    $('sound').innerHTML = `♪ <span>Sound ${on ? 'on' : 'off'}</span>`; $('sound').setAttribute('aria-pressed', on); $('sound').setAttribute('aria-label', on ? 'Disable sound' : 'Enable sound');
  }
  $('sound').onclick = () => setSound(!soundOn);
  const fullscreen = () => Promise.resolve().then(toggleFullscreen).catch(() => toast('Fullscreen unavailable in this browser.'));
  $('fullscreen').onclick = fullscreen;
  $('view').disabled = true;
  $('start').onclick = () => {
    if (!renderer) return;
    game.reset(); game.round = 1; player = game.addPlayer(); started = true;
    $('intro').hidden = true; $('flight-hud').hidden = false; $('pause').disabled = false; $('view').disabled = false; $('phase').textContent = 'ACTIVE';
    audio.setEnabled(soundOn); soundscape.reset();
    toast('Fly near the honey drops to collect. Space / C to climb and sink. V for bee view.');
  };
  function togglePause() {
    if (!started) return;
    paused = !paused; keys.clear(); viewControls.cancel(); look.release();
    paused ? audio.suspend() : audio.resume();
    $('pause').textContent = paused ? '▶' : 'Ⅱ'; $('pause').setAttribute('aria-label', paused ? 'Resume game' : 'Pause game'); $('phase').textContent = paused ? 'PAUSED' : 'ACTIVE';
    toast(paused ? 'Paused. Press P to resume.' : 'Resumed.');
  }
  $('pause').onclick = togglePause;
  $('home').onclick = () => { toast('The glowing golden hive is in the center. Fly into its ring to deliver.'); hiveBeacon = 5; };
  function setView(next) {
    if (!player || next === view) return;
    view = next; keys.clear(); viewControls.cancel();
    const bee = view === 'bee';
    if (bee) beeView.face(player); else { look.release(); camera.fov = ORBIT_FOV; camera.updateProjectionMatrix(); }
    viewModel.group.visible = bee; $('reticle').hidden = !bee; root.classList.toggle('bee-view', bee);
    $('view').setAttribute('aria-pressed', bee); $('view').setAttribute('aria-label', bee ? 'Switch to garden view' : 'Switch to bee view');
    $('view').innerHTML = bee ? '🌼 <span>Garden view</span>' : '👁 <span>Bee view</span>';
    toast(bee ? 'Bee view: click the garden to steer with the mouse (or drag). W flies where you look.' : 'Garden view.');
  }
  $('view').onclick = () => setView(view === 'bee' ? 'orbit' : 'bee');
  document.addEventListener('keydown', e => {
    if (!active || modal.open || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyF' && !e.repeat) { e.preventDefault(); fullscreen(); return; }
    if (!started) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.code === 'KeyP' && !e.repeat) togglePause();
    if (e.code === 'KeyV' && !e.repeat && !paused) setView(view === 'bee' ? 'orbit' : 'bee');
    keys.add(e.code);
  });
  document.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); viewControls.cancel(); if (active && started && !paused) togglePause(); });
  for (const button of root.querySelectorAll('[data-key]')) {
    button.addEventListener('pointerdown', e => { e.preventDefault(); button.setPointerCapture(e.pointerId); keys.add(button.dataset.key); });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, () => keys.delete(button.dataset.key));
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
  scene.add(new THREE.HemisphereLight('#fff4df', '#4b6151', 2.4));
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
  for (let i = 0; i < 1700; i++) { const a = random() * Math.PI * 2, r = 4.2 + Math.sqrt(random()) * 26; dummy.position.set(Math.cos(a) * r, 0.27, Math.sin(a) * r); dummy.rotation.set(random() * 0.2, a, random() * 0.3); dummy.scale.setScalar(0.7 + random()); dummy.updateMatrix(); grass.setMatrixAt(i, dummy.matrix); grass.setColorAt(i, new THREE.Color(palette.foliage[i % palette.foliage.length])); }
  scene.add(grass);
  const hive = createHiveModel(); scene.add(hive.group);
  let hiveBeacon = 0;
  const flowerModels = FLOWERS.map(f => {
    const flower = createFlower({ color: palette.flowers[f.color % palette.flowers.length], height: f.height, seed: f.id + 1 });
    flower.group.position.set(f.x, 0, f.z); scene.add(flower.group);
    const drop = createHoneyDrop(); drop.group.position.set(f.x, f.y, f.z); scene.add(drop.group);
    return { flower, drop };
  });
  for (const [i, t] of TREES.entries()) {
    const tree = new THREE.Group(); tree.position.set(t.x, 0, t.z); scene.add(tree);
    mesh(cylinder(0.2, 0.32, t.height + 0.4, 7), '#806145', tree, 0, (t.height + 0.4) / 2, 0);
    orb(tree, palette.foliage[i % palette.foliage.length], 0, t.height + 0.9, 0, t.canopy, t.canopy * 1.12, t.canopy);
    orb(tree, palette.foliage[(i + 1) % palette.foliage.length], t.canopy * 0.4, t.height + 1.6, t.canopy * 0.15, t.canopy * 0.7);
    orb(tree, palette.foliage[(i + 3) % palette.foliage.length], -t.canopy * 0.35, t.height + 1.3, -t.canopy * 0.3, t.canopy * 0.62);
  }
  const rockGeometry = new THREE.DodecahedronGeometry(1);
  for (let i = 0; i < 44; i++) { const a = random() * Math.PI * 2, r = 27.5 + random() * 3.5; const rock = mesh(rockGeometry, ['#aaa79a', '#92968c', '#b5aa93'][i % 3], scene, Math.cos(a) * r, 0.15, Math.sin(a) * r); rock.scale.set(0.3 + random() * 0.45, 0.2 + random() * 0.25, 0.3 + random() * 0.45); }
  const motesGeometry = new THREE.BufferGeometry(); const motePositions = new Float32Array(220 * 3);
  for (let i = 0; i < 220; i++) { motePositions[i * 3] = (random() - 0.5) * 62; motePositions[i * 3 + 1] = 1 + random() * 9; motePositions[i * 3 + 2] = (random() - 0.5) * 62; }
  motesGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3)); const motes = new THREE.Points(motesGeometry, new THREE.PointsMaterial({ color: '#fff2c0', size: 0.07, transparent: true, opacity: 0.8 })); scene.add(motes);
  const burst = createBurst(scene);

  const beeModels = new Map();
  function createBee(p) {
    const group = new THREE.Group(); scene.add(group);
    const body = new THREE.Group(); group.add(body);
    orb(body, p.bot ? palette.bees[p.id % palette.bees.length] : '#ffd052', 0, 0, 0, 0.32, 0.3, 0.52);
    for (const z of [-0.2, 0.12]) { const band = mesh(cylinder(0.305, 0.305, 0.13, 16), '#34352d', body, 0, 0, z); band.rotation.x = Math.PI / 2; }
    orb(body, '#34352d', 0, 0.04, 0.44, 0.29, 0.27, 0.23);
    for (const x of [-0.13, 0.13]) { orb(body, '#fff7d7', x, 0.13, 0.61, 0.07); orb(body, '#282f29', x, 0.13, 0.66, 0.035); const antenna = mesh(cylinder(0.015, 0.02, 0.24, 5), '#34352d', body, x, 0.36, 0.47); antenna.rotation.z = x * -3; }
    const wings = [];
    for (const side of [-1, 1]) { const wing = orb(body, p.bot ? palette.wings[p.id % palette.wings.length] : '#fff8e4', side * 0.36, 0.22, -0.06, 0.4, 0.035, 0.22, { transparent: true, opacity: 0.65, roughness: 0.3 }); wings.push(wing); }
    const shadow = mesh(new THREE.CircleGeometry(p.bot ? 0.35 : 0.5, 24), p.bot ? palette.bees[p.id % palette.bees.length] : '#f9d260', scene, 0, 0.08, 0, { transparent: true, opacity: 0.4 }); shadow.rotation.x = -Math.PI / 2; shadow.castShadow = false;
    // The player's altitude line connects the bee to its shadow for depth in the garden view.
    const stem = p.bot ? null : new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -1, 0)]), new THREE.LineDashedMaterial({ color: '#ffe49c', dashSize: 0.18, gapSize: 0.14, transparent: true, opacity: 0.7 }));
    if (stem) { stem.computeLineDistances(); scene.add(stem); }
    const labelCanvas = document.createElement('canvas'); labelCanvas.width = 256; labelCanvas.height = 64;
    const ctx = labelCanvas.getContext('2d'); ctx.font = `600 ${p.bot ? 23 : 27}px monospace`; ctx.textAlign = 'center'; ctx.fillStyle = p.bot ? '#f0e9ff' : '#fff8df';
    if (!p.bot) { ctx.fillStyle = '#242b45'; ctx.beginPath(); ctx.roundRect(50, 6, 156, 48, 4); ctx.fill(); ctx.fillStyle = '#ffe49c'; }
    ctx.fillText(p.bot ? p.name : 'YOU', 128, 39);
    const labelTexture = new THREE.CanvasTexture(labelCanvas); const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, depthTest: false })); label.position.y = 1.1; label.scale.set(2.5, 0.625, 1); group.add(label);
    const stars = createDizzyStars(); stars.group.position.y = 0.55; stars.group.visible = false; group.add(stars.group);
    group.position.set(p.x, p.y, p.z);
    beeModels.set(p.id, { group, body, wings, shadow, stem, stars, labelTexture, tumble: 0 });
  }
  const bumble = createBumblebee(); bumble.group.visible = false; scene.add(bumble.group);
  const bumbleShadow = mesh(new THREE.CircleGeometry(1.1, 28), '#2a2a20', scene, 0, 0.08, 0, { transparent: true, opacity: 0.3 }); bumbleShadow.rotation.x = -Math.PI / 2; bumbleShadow.castShadow = false; bumbleShadow.visible = false;

  const head = new THREE.Vector3(), probe = new THREE.Vector3(), hiveTop = new THREE.Vector3(0, 5.4, 0);
  function locate(id) {
    if (id === 'bumble') return bumble.group.visible ? head.copy(bumble.group.position).add(probe.set(0, 1.9, 0)) : null;
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

  let lastBag = 0, lastScore = 0, lastResult = null, lastRound = 1, uiTime = 0, alertTime = 0;
  function updateUI() {
    const seconds = Math.max(0, Math.ceil(game.remaining)); $('timer').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    $('round').textContent = String(game.round).padStart(2, '0'); $('honey').textContent = game.honey;
    const percent = Math.min(100, Math.floor(game.honey / RULES.goal * 100)); $('honey-progress').style.width = `${percent}%`; $('percent').textContent = `${percent}%`;
    if (player) {
      $('bag').innerHTML = Array.from({ length: RULES.capacity }, (_, i) => `<i class="${i < player.bag ? 'filled' : ''}"></i>`).join('') + `<strong>${player.bag}<span> / 8</span></strong>`;
      const recharge = BOOST.cooldown - BOOST.duration;
      if (game.boosting(player)) { $('boost-label').textContent = `BOOST ${(player.boost - recharge).toFixed(1)}s`; $('boost-meter').style.width = `${(player.boost - recharge) / BOOST.duration * 100}%`; }
      else { $('boost-label').textContent = player.boost ? `BOOST IN ${Math.ceil(player.boost)}s` : 'BOOST READY'; $('boost-meter').style.width = `${(1 - player.boost / recharge) * 100}%`; }
      $('alt').textContent = player.y.toFixed(1); $('alt-marker').style.bottom = `${(player.y - WORLD.floor) / (WORLD.ceiling - WORLD.floor) * 26}px`;
      if (player.score > lastScore) toast(`+${player.score - lastScore} nectar delivered.`);
      else if (player.bag > lastBag && player.bag === RULES.capacity) toast('Nectar bag full! Head back to the golden hive.');
      lastBag = player.bag; lastScore = player.score;
    }
    if (started && game.result && game.result !== lastResult) {
      $('phase').textContent = 'RESETTING';
      showModal(`<p class="eyebrow">ROUND ${game.round}</p><h2>${game.result === 'complete' ? 'Goal reached.' : 'Time expired.'}</h2><p>Hive: <strong>${game.honey} / 300 nectar</strong><br>Your contribution: <strong>${player.score}</strong></p><p class="result-note">Next round in 12 seconds.</p>`); audio.chime(1046);
    }
    if (game.round !== lastRound) { modal.close(); $('phase').textContent = 'ACTIVE'; toast('New round.'); lastScore = 0; lastBag = 0; }
    lastResult = game.result; lastRound = game.round;
    $('alert-count').textContent = Math.ceil(game.bumbleWarn);
  }
  function handle(events, dt) {
    for (const event of events) {
      if (event.type === 'collect') burst.emit(probe.set(FLOWERS[event.flower].x, FLOWERS[event.flower].y, FLOWERS[event.flower].z), { color: '#ffd35a', count: 16, speed: 2.2 });
      else if (event.type === 'deliver') { burst.emit(probe.set(0, 4.3, 0), { color: '#f5b324', count: 34, speed: 3.6, gravity: -5 }); hiveBeacon = Math.max(hiveBeacon, 0.6); }
      else if (event.type === 'bump') burst.emit(probe.set(event.x, event.y, event.z), { color: '#fff7d9', count: 10, speed: 2.4, gravity: 0, life: 0.5 });
      else if (event.type === 'thud') burst.emit(probe.set(event.x, event.y, event.z), { color: '#d9c49a', count: 8, speed: 1.8, gravity: -2, life: 0.6 });
      else if (event.type === 'bumble-hit') {
        burst.emit(probe.set(event.x, event.y, event.z), { color: '#ffe066', count: 24, speed: 4.2, gravity: -2 });
        if (event.spilled) burst.emit(probe, { color: '#f6b21b', count: event.spilled * 7, speed: 1.6, gravity: -9, size: 0.16, life: 1.1 });
        if (player && event.id === player.id) { beeView.bump(1); toast(event.spilled ? `Bumped by the bumblebee! You spilled ${event.spilled} nectar.` : 'Bumped by the bumblebee!'); }
      }
      if (started && event.type === 'bumble-warning') { $('bumble-alert').hidden = false; alertTime = event.seconds + 0.6; }
      if (started && event.type === 'bumble-enter') toast('Here it comes! Dodge the bumblebee!');
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
    const forward = Number(held('KeyW', 'ArrowUp')) - Number(held('KeyS', 'ArrowDown'));
    const vertical = Number(held('Space', 'KeyE')) - Number(held('KeyC', 'KeyQ'));
    const dash = held('ShiftLeft', 'ShiftRight');
    if (view === 'bee') {
      const turn = Number(held('ArrowRight')) - Number(held('ArrowLeft'));
      if (turn) beeView.turn(turn, dt);
      const right = Number(held('KeyD')) - Number(held('KeyA'));
      return { ...beeView.movement(forward, right, vertical), dash, face: beeView.yaw, strafe: right };
    }
    const right = Number(held('KeyD', 'ArrowRight')) - Number(held('KeyA', 'ArrowLeft'));
    return { ...orbit.movement(forward, right), y: vertical, dash };
  }
  let strafe = 0;
  function update(dt, elapsed) {
    if (!active) return;
    let ticked = false;
    if (!paused) {
      if (player) { const move = modal.open ? { x: 0, y: 0, z: 0 } : input(dt); strafe = move.strafe ?? 0; game.setInput(player.id, move); }
      game.tick(dt); ticked = true;
      // Keep the landing screen's world alive without using up its first round.
      if (!started) { game.remaining = RULES.duration; if (game.result) game.reset(); }
    }
    if (ticked) handle(game.events, dt);
    for (const p of game.players.values()) {
      if (!beeModels.has(p.id)) createBee(p);
      const bee = beeModels.get(p.id), own = p === player;
      bee.group.position.lerp(probe.set(p.x, p.y + Math.sin(elapsed * 7 + p.id) * 0.06, p.z), 1 - Math.exp(-dt * (own ? 22 : 15)));
      const angle = Math.atan2(Math.sin(p.yaw - bee.body.rotation.y), Math.cos(p.yaw - bee.body.rotation.y)); bee.body.rotation.y += angle * Math.min(1, dt * 12);
      // Stunned bees tumble; upset bees shake.
      bee.tumble = p.stun ? bee.tumble + dt * 13 : bee.tumble * Math.exp(-dt * 8);
      bee.body.rotation.z = p.stun ? Math.sin(bee.tumble) * 0.9 : p.angry ? Math.sin(elapsed * 38) * 0.18 : Math.sin(elapsed * 2 + p.id) * 0.04;
      bee.body.rotation.x = p.stun ? Math.cos(bee.tumble * 0.7) * 0.5 : Math.max(-0.35, Math.min(0.35, -p.vy * 0.06));
      bee.wings.forEach((w, i) => { w.rotation.z = Math.sin(elapsed * (game.boosting(p) ? 95 : 75)) * 0.45 * (i ? 1 : -1); });
      bee.shadow.position.set(p.x, 0.07, p.z); bee.shadow.material.opacity = 0.45 - Math.min(0.3, (p.y - WORLD.floor) * 0.035);
      bee.stars.group.visible = p.stun > 0.2; if (p.stun) bee.stars.update(elapsed);
      bee.group.visible = !(own && view === 'bee');
      if (bee.stem) { bee.stem.visible = view === 'orbit' && started; bee.stem.position.copy(bee.group.position); bee.stem.scale.y = Math.max(0.01, bee.group.position.y - 0.1); }
    }
    const b = game.bumble;
    bumble.group.visible = bumbleShadow.visible = !!b;
    if (b) {
      if (!bumble.seen) { bumble.group.position.set(b.x, b.y, b.z); bumble.group.rotation.y = b.yaw; bumble.seen = true; }
      bumble.group.position.lerp(probe.set(b.x, b.y, b.z), 1 - Math.exp(-dt * 10));
      bumble.group.rotation.y += Math.atan2(Math.sin(b.yaw - bumble.group.rotation.y), Math.cos(b.yaw - bumble.group.rotation.y)) * Math.min(1, dt * 6);
      bumble.update(dt, elapsed, { speed: b.speed, stunned: b.oops > 0 });
      bumbleShadow.position.set(b.x, 0.07, b.z);
    } else bumble.seen = false;
    flowerModels.forEach(({ flower, drop }, i) => { flower.update(elapsed); drop.update(dt, elapsed, !game.cooldowns[i]); });
    burst.update(dt);
    hiveBeacon = Math.max(0, hiveBeacon - dt); hive.update(elapsed, hiveBeacon);
    motes.rotation.y = Math.sin(elapsed * 0.07) * 0.1;
    const own = player && beeModels.get(player.id);
    if (view === 'bee' && own) {
      beeView.apply(camera, own.group.position, dt, elapsed, { strafe, boosting: game.boosting(player), stunned: player.stun > 0 });
      viewModel.update(elapsed, { boosting: game.boosting(player) });
    } else {
      // The garden view follows the player more on the larger island but keeps the hive in frame.
      orbitTarget.lerp(probe.set(player ? player.x * 0.55 : 0, player ? Math.max(0, player.y - 2) * 0.5 : 0, player ? player.z * 0.55 : 0), 1 - Math.exp(-dt * 3));
      orbit.apply(camera, orbitTarget);
    }
    if (player && started) {
      const listener = view === 'bee' ? { x: player.x, y: player.y, z: player.z, yaw: beeView.yaw, pitch: beeView.pitch } : { x: player.x, y: player.y, z: player.z, yaw: orbit.azimuth + Math.PI };
      if (!paused) soundscape.frame(game, player, dt, { listener, beeView: view === 'bee' });
    }
    renderer.render(scene, camera);
    bubbles.update(dt, camera, width, height, locate);
    const label = screen(hiveTop);
    $('hive-label').hidden = !label.visible || view === 'bee';
    if (label.visible) $('hive-label').style.transform = `translate3d(${label.x.toFixed(1)}px, ${(label.y - 6).toFixed(1)}px, 0) translate(-50%, -100%)`;
    alertTime = Math.max(0, alertTime - (paused ? 0 : dt));
    if (!alertTime) $('bumble-alert').hidden = true;
    if (started && (game.bumbleWarn || b) && !(b && b.leaving)) placeMarker(b ? bumble.group.position : markerTarget.set(Math.sin(game.bumbleAngle) * WORLD.radius, 4, Math.cos(game.bumbleAngle) * WORLD.radius));
    else $('bumble-marker').hidden = true;
    uiTime += dt; if (uiTime > 0.12) { updateUI(); uiTime = 0; }
  }

  return {
    update,
    pause() { if (started && !paused) togglePause(); },
    resize(w, h) { width = w; height = h; camera.aspect = w / h; camera.updateProjectionMatrix(); },
    activate() { active = true; container.replaceChildren(root); renderer.domElement.setAttribute('aria-label', 'A floating garden with bees and a golden hive'); if (started && !paused) audio.resume(); updateUI(); },
    deactivate() { active = false; keys.clear(); viewControls.cancel(); look.release(); audio.suspend(); root.remove(); },
  };
}
