import * as THREE from 'three';
import { WASP, waspHead } from './wasp.js';
import { createWasp, WASP as SHAPE } from './wasp-model.js';
import { createDizzyStars } from './models.js';
import { OBSTACLES, contact } from '../world.js';

// For the knock-out shot: of eight directions around the wasp, the one nearest the preferred one whose line of
// sight is not blocked by a tree, flower or bush (sampled along the line, keeping half a metre of air).
export function clearShot(w, preferred, { distance = 8, height = 3.6, standing = () => true } = {}) {
  for (const step of [0, 1, -1, 2, -2, 3, -3, 4]) {
    const a = preferred + step * Math.PI / 4, ex = w.x + Math.sin(a) * distance, ez = w.z + Math.cos(a) * distance;
    let blocked = false;
    for (let k = 1; k < 12 && !blocked; k++) {
      const t = k / 12, x = ex + (w.x - ex) * t, y = height + (0.8 - height) * t, z = ez + (w.z - ez) * t;
      for (const o of OBSTACLES) if (o.kind !== 'hive' && standing(o) && Math.abs(o.x - x) < 5 && Math.abs(o.z - z) < 5 && contact(o, x, y, z).gap < 0.5) { blocked = true; break; }
    }
    if (!blocked) return a;
  }
  return preferred;
}

// Scene side of the boss fight: places and poses the wasp model for every phase of the simulation, shows the
// slam target over its head, and directs the camera (the climb over the rim, the swarm's attack ride, the
// fall, and the raid on the hive). The simulation (wasp.js) decides; this only shows it.
const UP = new THREE.Vector3(0, 1, 0);
const ease = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

// `onExit(position)` fires when the wasp leaves, so the scene can add a puff of particles while it fades out.
export function createWaspBoss(scene, { onExit = () => {}, inView = () => true } = {}) {
  const model = createWasp(); model.group.visible = false; scene.add(model.group);
  const stars = createDizzyStars(); stars.group.scale.setScalar(2.4); stars.group.visible = false; scene.add(stars.group);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.6, 28), new THREE.MeshBasicMaterial({ color: '#2a2418', transparent: true, opacity: 0.3, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.visible = false; scene.add(shadow);
  // A glowing ring over its head: where to be for a butt slam.
  const target = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.06, 8, 40), new THREE.MeshBasicMaterial({ color: '#ffdd33', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  target.rotation.x = Math.PI / 2; target.visible = false; scene.add(target);
  const climbQ = new THREE.Quaternion(), flyQ = new THREE.Quaternion(), spin = new THREE.Quaternion(), basis = new THREE.Matrix4();
  const xAxis = new THREE.Vector3(), out = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0), euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const fleeEye = new THREE.Vector3(), fleeLook = new THREE.Vector3();
  let knockout = null; // the camera direction chosen for the knock-out shot
  const eye = new THREE.Vector3(), look = new THREE.Vector3(), mix = new THREE.Vector3(), lookMix = new THREE.Vector3(), swarmAt = new THREE.Vector3();
  // Hit flash: every material with an emissive colour glows red for a moment when a slam lands.
  const flashing = [], RED = new THREE.Color('#ff1a1a');
  model.group.traverse(o => { for (const m of [].concat(o.material ?? [])) if (m?.emissive && !flashing.some(f => f.m === m)) flashing.push({ m, base: m.emissive.clone(), intensity: m.emissiveIntensity ?? 1 }); });
  let flash = 0;
  let mode = 'fly', modeT = 0, lastYaw = 0, bank = 0, camWeight = 0, cineFov = 0, exit = 0, seen = false;
  const EXIT = 1.3, drift = new THREE.Vector3(), last = new THREE.Vector3();
  // The beaten wasp's farewell: a star pings in the sky where it disappears.
  const starCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null; let starMap = null;
  if (starCanvas?.getContext) { starCanvas.width = starCanvas.height = 64; const c = starCanvas.getContext('2d'); if (c?.createRadialGradient && c.moveTo) { const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,240,170,0.9)'); gr.addColorStop(1, 'rgba(255,220,80,0)'); c.fillStyle = gr; c.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = i % 2 ? 9 : 32; c.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); } c.closePath(); c.fill(); starMap = new THREE.CanvasTexture(starCanvas); } }
  const twinkle = new THREE.Sprite(new THREE.SpriteMaterial({ map: starMap, color: '#fff6c8', transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending })); twinkle.visible = false; scene.add(twinkle);
  let twinkleT = 0, lastPhase = '';
  const setMode = next => { if (next !== mode) { mode = next; modeT = 0; } };

  function pose(w, dt, game) {
    const g = model.group, phase = w.phase;
    if (phase === 'climb' || phase === 'flip') {
      // Climbing the outside of the cliff: head up, back facing out, belly against the rock.
      out.set(Math.sin(w.angle), 0, Math.cos(w.angle)); xAxis.crossVectors(out, UP);
      basis.makeBasis(xAxis, out, UP); climbQ.setFromRotationMatrix(basis);
      if (phase === 'climb') { setMode('climb'); g.quaternion.copy(climbQ); }
      else { // a forward flip up over the edge into flight
        const k = ease(w.t / WASP.flip); setMode('flip');
        flyQ.setFromEuler(euler.set(0, w.yaw, 0)); g.quaternion.slerpQuaternions(climbQ, flyQ, k).multiply(spin.setFromAxisAngle(X, -Math.PI * 2 * k));
      }
      g.position.set(w.x, w.y, w.z); lastYaw = w.yaw;
      return;
    }
    const grounded = phase === 'onBack' || phase === 'rightItself' || phase === 'fall';
    const turn = Math.atan2(Math.sin(w.yaw - lastYaw), Math.cos(w.yaw - lastYaw)) / Math.max(dt, 1e-3); lastYaw = w.yaw;
    bank += (Math.max(-0.5, Math.min(0.5, -turn * 0.25)) - bank) * Math.min(1, dt * 4);
    g.quaternion.setFromEuler(euler.set(grounded || phase === 'kick' || phase === 'eat' ? 0 : 0.08, w.yaw, grounded ? 0 : bank));
    g.position.set(w.x, grounded || phase === 'eat' ? Math.max(w.y, SHAPE.groundClearance) : w.y, w.z);
    if (phase === 'fall' || phase === 'onBack') setMode('onBack');
    else if (phase === 'rightItself') setMode('rightItself');
    else if (phase === 'mobbed') setMode('confused');
    else if (phase === 'shake') setMode('shake');
    else if (phase === 'kick') setMode('kick');
    else if (phase === 'eat') setMode('eat');
    else if (w.caughtId || (phase === 'hunt' && nearPrey(game, w) < 4)) setMode('attack');
    else setMode('fly');
  }
  function nearPrey(game, w) {
    let d = Infinity; for (const p of game.players.values()) if (p.bot && !p.ko) d = Math.min(d, Math.hypot(p.x - w.x, p.y - w.y, p.z - w.z));
    return d;
  }

  return {
    model,
    // Places, poses and decorates the wasp; `player` is the player's state (for the slam ring).
    update(dt, elapsed, game, player, slamReady) {
      const w = game.wasp, g = model.group;
      if (!w) { // gone: drift on, shrink and fade with a puff instead of vanishing
        stars.group.visible = target.visible = false;
        if (seen) { seen = false; exit = inView(g.position) ? EXIT : 0; if (exit) { onExit(g.position); if (lastPhase === 'flee') { twinkleT = 0.9; twinkle.position.copy(g.position); } } } // effects only where the camera sees them
        if (twinkleT > 0) { twinkleT = Math.max(0, twinkleT - dt); const k = 1 - twinkleT / 0.9, size = Math.sin(Math.PI * k) * 7; twinkle.visible = twinkleT > 0; twinkle.scale.setScalar(Math.max(0.01, size)); twinkle.material.opacity = Math.sin(Math.PI * k); twinkle.material.rotation = k * 3; }
        if (exit > 0) {
          exit = Math.max(0, exit - dt); const k = exit / EXIT;
          g.position.addScaledVector(drift, dt * k); g.position.y += dt * 1.5; g.scale.setScalar(Math.max(0.001, k * k * (3 - 2 * k)));
          model.update(dt, elapsed, { mode: 'fly', t: modeT += dt, speed: 6 }); shadow.material.opacity = 0.3 * k;
          if (!exit) { g.visible = shadow.visible = false; g.scale.setScalar(1); mode = 'fly'; }
        } else g.visible = shadow.visible = false;
        return;
      }
      g.visible = true; g.scale.setScalar(1); modeT += dt; seen = true; exit = 0; lastPhase = w.phase;
      if (flash > 0 || flashing.some(f => f.dirty)) { flash = Math.max(0, flash - dt * 3.5); for (const f of flashing) { f.m.emissive.copy(f.base).lerp(RED, flash); f.m.emissiveIntensity = f.intensity + flash * 1.4; f.dirty = flash > 0; } }
      pose(w, dt, game);
      if (w.phase === 'flee') { g.rotation.z += Math.sin(elapsed * 9) * 0.35; g.rotation.x += Math.sin(elapsed * 6) * 0.15; } // reeling, dizzy
      drift.copy(g.position).sub(last).divideScalar(Math.max(dt, 1e-3)); last.copy(g.position);
      model.update(dt, elapsed, { mode, t: modeT, speed: 4 });
      stars.group.visible = w.phase === 'mobbed' || w.phase === 'onBack' || w.phase === 'flee';
      if (stars.group.visible) { if (model.parts.crown) model.parts.crown.getWorldPosition(stars.group.position); else { const h = waspHead(w); stars.group.position.set(h.x, h.y + 0.9, h.z); } stars.group.position.y += 0.35; stars.update(elapsed); }
      shadow.visible = w.y > -0.5; shadow.position.set(w.x, 0.09, w.z); shadow.material.opacity = Math.max(0.08, 0.34 - w.y * 0.03);
      // The slam ring: faint while you are nearby, bright when a slam would land.
      const h = waspHead(w), near = player && Math.hypot(player.x - h.x, player.z - h.z) < 6 && ['hunt', 'approach', 'mobbed', 'shake', 'advance'].includes(w.phase);
      target.visible = !!near;
      if (near) { target.position.set(h.x, h.y + 1.2, h.z); target.scale.setScalar(1 + Math.sin(elapsed * 6) * 0.08); target.material.opacity = slamReady ? 0.95 : 0.3; target.material.color.set(slamReady ? '#ffe14a' : '#ffffff'); }
    },
    hit() { model.hit(); flash = 1; },
    // Camera shots for the big moments. Blends from the normal garden camera (`baseLook` is where it looks).
    camera(dt, camera, game, player, baseLook) {
      const w = game.wasp;
      let want = 0, fov = 0;
      if (w) {
        const h = waspHead(w), ox = Math.sin(w.angle ?? 0), oz = Math.cos(w.angle ?? 0);
        if (w.phase === 'climb' || w.phase === 'flip') { // from inside the rim, looking out at the claws coming over the edge
          const r = WASP.rim - 9, side = 3.2;
          eye.set(ox * r - oz * side, 2.2, oz * r + ox * side);
          look.set(w.phase === 'climb' ? ox * WASP.rim : w.x, w.phase === 'climb' ? 0.4 : w.y, w.phase === 'climb' ? oz * WASP.rim : w.z);
          want = 1; fov = 44;
        } else if (w.swarm === 'charging') { // ride behind the swarm as it flies at the wasp
          let n = 0; swarmAt.set(0, 0, 0);
          for (const p of game.players.values()) if (p.bot && p.swarmSlot >= 0 && !p.ko) { swarmAt.x += p.x; swarmAt.y += p.y; swarmAt.z += p.z; n++; }
          if (n) swarmAt.divideScalar(n); else swarmAt.set(player.x, player.y, player.z);
          const dx = w.x - swarmAt.x, dz = w.z - swarmAt.z, d = Math.hypot(dx, dz) || 1;
          eye.set(swarmAt.x - dx / d * 5, swarmAt.y + 1.4, swarmAt.z - dz / d * 5); look.set(w.x, w.y, w.z); want = 1; fov = 52;
        } else if (w.swarm === 'formation' && player) { // behind the arrowhead, the wasp ahead
          const dx = w.x - player.x, dz = w.z - player.z, d = Math.hypot(dx, dz) || 1;
          eye.set(player.x - dx / d * 7.5, player.y + 2.6, player.z - dz / d * 7.5); look.set((player.x + w.x) / 2, (player.y + w.y) / 2, (player.z + w.z) / 2); want = 1; fov = 46;
        } else if (w.phase === 'fall' || w.phase === 'onBack' || (w.phase === 'rightItself' && w.t < 0.8)) { // the big moment: on its back, legs in the air
          knockout ??= clearShot(w, (w.angle ?? 0) + Math.PI * 0.75, { standing: o => game.standing(o) }); // a view no tree is in the way of
          const a = knockout + (w.phase === 'onBack' ? w.t * 0.12 : 0);
          eye.set(w.x + Math.sin(a) * 8, 3.6, w.z + Math.cos(a) * 8); look.set(w.x, 0.8, w.z); want = 1; fov = 42;
        } else if (w.phase === 'flee') { // follow it as it reels off over the rim, until it is a speck in the sky
          const ox2 = w.x / (Math.hypot(w.x, w.z) || 1), oz2 = w.z / (Math.hypot(w.x, w.z) || 1);
          eye.set(w.x - ox2 * 8 - oz2 * 3, w.y + 2.2, w.z - oz2 * 8 + ox2 * 3); look.set(w.x, w.y, w.z); want = 1; fov = 44; fleeEye.copy(eye); fleeLook.copy(look);
        } else if (w.phase === 'kick' || w.phase === 'eat') { // the raid on the hive
          const a = (w.angle ?? 0);
          eye.set(Math.sin(a) * 17, 9, Math.cos(a) * 17); look.set(0, w.phase === 'kick' ? 4 : 1.5, 0); want = 1; fov = 44;
        }
        void h;
      }
      if (!w) knockout = null;
      if (!w && twinkleT > 0) { eye.copy(fleeEye); look.copy(fleeLook).lerp(twinkle.position, 0.6); want = 1; fov = 44; } // hold on the ping in the sky
      camWeight += (want - camWeight) * Math.min(1, dt * (want ? 2.6 : 1.8));
      if (want) cineFov = fov;
      if (camWeight < 0.002) return false;
      mix.copy(camera.position).lerp(eye, camWeight); camera.position.copy(mix);
      lookMix.copy(baseLook).lerp(look, camWeight); camera.lookAt(lookMix);
      const f = camera.userData.baseFov ?? camera.fov, targetFov = f + (cineFov - f) * camWeight;
      if (Math.abs(camera.fov - targetFov) > 0.05) { camera.fov = targetFov; camera.updateProjectionMatrix(); }
      return true;
    },
    get directing() { return camWeight > 0.002; },
    reset() { camWeight = 0; mode = 'fly'; },
  };
}
