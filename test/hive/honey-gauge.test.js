import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHoneyGauge, GAUGE } from '../../src/games/hive/features/honey-gauge.js';

test('the honeycomb ring fills per 10 nectar, colours the player share, and empties from the top', () => {
  const gauge = createHoneyGauge(), at = new THREE.Vector3(5, 2, 5);
  assert.equal(GAUGE.cells * GAUGE.unit, 350, 'the ring holds the round goal');
  gauge.deliver(at, 8, 'scouts'); gauge.deliver(at, 12, 'player'); gauge.deliver(at, 6, 'scouts');
  assert.equal(gauge.ledger.length, 26); assert.equal(gauge.player, 12);
  for (let i = 0; i < 60; i++) gauge.update(0.05, i * 0.05);
  const cell = i => { const m = new THREE.Matrix4(), at = new THREE.Vector3(), q = new THREE.Quaternion(), size = new THREE.Vector3(); gauge.group.children[1].getMatrixAt(i, m); m.decompose(at, q, size); return { at, size }; };
  assert.ok(Math.abs(Math.hypot(cell(0).at.x, cell(0).at.z) - GAUGE.radius) < 1e-6, 'cells sit on the ring');
  assert.ok(cell(0).size.y > 0.9 && cell(5).size.y < 0.1, 'a full cell stands tall, an empty one stays flat');
  const colour = i => { const c = new THREE.Color(); gauge.group.children[1].getColorAt(i, c); return c; };
  // Gold has clearly more green than the player's orange.
  assert.ok(colour(0).g > colour(1).g * 1.6, 'first cell gold (scouts), second orange (mostly the player)');
  gauge.drain(10); assert.equal(gauge.ledger.length, 16); assert.equal(gauge.player, 8, 'the thief drinks the newest honey first (6 scout + 4 player units)');
  gauge.sync(0); assert.equal(gauge.ledger.length, 0, 'a new round empties the ring');
});
