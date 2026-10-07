import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BeeView, LOOK } from '../../src/games/hive/features/bee-view.js';

test('bee view flies where it looks, strafes sideways, and keeps the camera on the bee', () => {
  const view = new BeeView(); view.pitch = 0;
  const ahead = view.movement(1, 0); assert.ok(Math.abs(ahead.x) < 1e-9 && Math.abs(ahead.z - 1) < 1e-9 && ahead.y === 0);
  const right = view.movement(0, 1); assert.ok(Math.abs(right.x + 1) < 1e-9 && Math.abs(right.z) < 1e-9, 'right of +Z is -X, as on screen');
  view.look(-Math.PI / 2 / LOOK.yaw, 0); const turned = view.movement(1, 0); assert.ok(turned.x > 0.99, 'turning right faces +X');
  view.look(0, 10000); assert.ok(view.pitch >= -1.25); const dive = view.movement(1, 0); assert.ok(dive.y < -0.9, 'looking down and flying forward dives');
  assert.equal(view.movement(0, 0, 1).y, 1);
  const camera = new THREE.PerspectiveCamera(); view.pitch = 0; view.yaw = 0;
  view.apply(camera, { x: 3, y: 2, z: 1 }, 0.016, 0);
  camera.updateMatrixWorld(); const forward = new THREE.Vector3(); camera.getWorldDirection(forward);
  assert.ok(forward.z > 0.99, 'camera looks along +Z at yaw 0'); assert.ok(camera.position.distanceTo(new THREE.Vector3(3, 2.2, 1.32)) < 0.05);
});
