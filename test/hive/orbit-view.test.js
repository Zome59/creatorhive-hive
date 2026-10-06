import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Window } from 'happy-dom';
import { OrbitView, bindOrbitControls } from '../../src/games/hive/features/orbit-view.js';
import { Game } from '../../src/games/hive/simulation.js';
import { WORLD } from '../../src/games/hive/world.js';

test('orbit rotation changes camera-relative movement and zoom stays in useful bounds', () => {
  const orbit = new OrbitView(), camera = new THREE.PerspectiveCamera(), target = new THREE.Vector3(1, 0, 2);
  orbit.apply(camera, target); assert.ok(Math.abs(camera.position.distanceTo(target) - orbit.radius) < 1e-8);
  const before = orbit.movement(1, 0); orbit.rotate(100, 100); assert.notDeepEqual(orbit.movement(1, 0), before);
  for (let i = 0; i < 30; i++) orbit.zoom(-800); assert.equal(orbit.radius, 20);
  for (let i = 0; i < 30; i++) orbit.zoom(800); assert.equal(orbit.radius, 80);
  orbit.rotate(0, 9999); assert.equal(orbit.elevation, 1.25); orbit.rotate(0, -9999); assert.equal(orbit.elevation, 0.28);
});
test('left drag rotates, right drag does not, and inactive controls release wheel scrolling', () => {
  const window = new Window(), canvas = window.document.createElement('canvas'), orbit = new OrbitView(); let active = true;
  const controls = bindOrbitControls(canvas, orbit, () => active);
  const pointer = (type, x, button = 0) => canvas.dispatchEvent(new window.PointerEvent(type, { pointerId: 1, clientX: x, clientY: 10, button, cancelable: true }));
  const initial = orbit.azimuth; pointer('pointerdown', 10, 2); pointer('pointermove', 50, 2); assert.equal(orbit.azimuth, initial);
  pointer('pointerdown', 10); pointer('pointermove', 50); assert.notEqual(orbit.azimuth, initial); controls.cancel();
  const rotated = orbit.azimuth; pointer('pointermove', 70); assert.equal(orbit.azimuth, rotated);
  const radius = orbit.radius, zoom = new window.WheelEvent('wheel', { deltaY: -100, cancelable: true }); canvas.dispatchEvent(zoom);
  assert.ok(orbit.radius < radius); assert.equal(zoom.defaultPrevented, true);
  active = false; const stopped = orbit.radius, wheel = new window.WheelEvent('wheel', { deltaY: -100, cancelable: true }); canvas.dispatchEvent(wheel);
  assert.equal(orbit.radius, stopped); assert.equal(wheel.defaultPrevented, false); window.happyDOM.abort();
});
test('Honey Retrieval climbs and sinks between the garden floor and ceiling', () => {
  const game = new Game({ bots: 0 }), bee = game.addPlayer();
  for (let i = 0; i < 60; i++) { game.setInput(bee.id, { y: 1 }); game.tick(0.05); }
  assert.equal(bee.y, WORLD.ceiling);
  for (let i = 0; i < 80; i++) { game.setInput(bee.id, { y: -1 }); game.tick(0.05); }
  assert.equal(bee.y, WORLD.floor);
});
