import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHoneyGauge, GAUGE } from '../../src/games/hive/features/honey-gauge.js';

test('the honeycomb ring fills per 10 nectar, colours the player share, and empties from the top', () => {
  const gauge = createHoneyGauge(), at = new THREE.Vector3(5, 2, 5);
  assert.equal(GAUGE.cells * GAUGE.unit, 300, 'the ring holds the round goal');
  gauge.deliver(at, 8, 'scouts'); gauge.deliver(at, 12, 'player'); gauge.deliver(at, 6, 'scouts');
  assert.equal(gauge.ledger.length, 26); assert.equal(gauge.player, 12);
  for (let i = 0; i < 60; i++) gauge.update(0.05, i * 0.05);
  const colour = i => { const c = new THREE.Color(); gauge.group.children[1].getColorAt(i, c); return c; };
  // Gold has clearly more green than the player's orange.
  assert.ok(colour(0).g > colour(1).g * 1.6, 'first cell gold (scouts), second orange (mostly the player)');
  gauge.drain(10); assert.equal(gauge.ledger.length, 16); assert.equal(gauge.player, 8, 'the thief drinks the newest honey first (6 scout + 4 player units)');
  gauge.sync(0); assert.equal(gauge.ledger.length, 0, 'a new round empties the ring');
});
