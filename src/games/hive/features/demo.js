import { FLOWERS, TREES, OBSTACLES, WORLD, contact } from '../world.js';
import { POWER } from '../simulation.js';
import { HEIST } from './bumblebee.js';
import { BEE_ITEM } from './bee-items.js';
import { waspHead } from './wasp.js';

// Demo mode: about a minute of autoplay that shows what can happen in a round, in a random order, with the wasp as
// the finale. A director nudges the simulation (a bee token near the player, a power boost, the bumblebee or its honey
// raid, the rain cloud, a wilting flower, the wasp), and a pilot flies the player's bee. The round itself runs as in
// play, so the scene shows and sounds everything the usual way.
export const DEMO = Object.freeze({
  intro: 8.5, cap: 85, // the start flight, and a hard stop
  mission: Object.freeze({ token: 14, power: 8, cross: 15, heist: 20 }), // longest time per mission (s)
  party: 5.5, wasted: 4.5, // how long the ending stays on screen
  victory: 0.7, defenders: 0.5, // chance of beating the wasp, and of beating it with defender bees
  deliver: 5, // the pilot takes its nectar home from this many drops on
});

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

// Flies toward a point: slows down on arrival, cruises above the flowers on long stretches, and slides around
// trees, flowers, bushes and the hive like the scouts do. `ignore` names an obstacle it may touch (its target)
// once it is within `near` metres.
export function fly(game, p, target, { ignore = null, near = 4, cruise = true, arrive = 1.2 } = {}) {
  let dx = target.x - p.x, dz = target.z - p.z;
  const d = Math.hypot(dx, dz) || 1e-6, speed = Math.min(1, d / arrive);
  dx /= d; dz /= d;
  let x = dx * speed, z = dz * speed;
  const altitude = cruise && d > 3.5 ? Math.max(target.y, 2.4) : target.y;
  let y = clamp((altitude - p.y) * 1.4, -1, 1);
  for (const o of OBSTACLES) {
    const lx = p.x + dx * 2, lz = p.z + dz * 2;
    if (Math.abs(lx - o.x) > 4 || Math.abs(lz - o.z) > 4 || !game.standing(o) || (o.owner === ignore && d < near)) continue;
    const c = contact(o, lx, p.y, lz), room = WORLD.beeRadius + 0.7 - c.gap;
    if (room <= 0) continue;
    const h = Math.hypot(c.nx, c.nz) || 1, nx = c.nx / h, nz = c.nz / h, turn = -nz * dx + nx * dz >= 0 ? 1 : -1;
    x += (-nz * turn * 1.8 + nx * 0.4) * room; z += (nx * turn * 1.8 + nz * 0.4) * room;
    if ((o.top ?? o.y + o.r) < 6.5) y += room * 0.8;
  }
  return { x: clamp(x, -1, 1), y: clamp(y, -1, 1), z: clamp(z, -1, 1) };
}

export function createDemo(game, player, { random = Math.random } = {}) {
  const shuffle = list => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const order = shuffle(['token', 'power', random() < 0.55 ? 'cross' : 'heist']), missions = [...order];
  const ending = random() < DEMO.victory ? 'victory' : 'wasted', defenders = ending === 'victory' && random() < DEMO.defenders;
  const at = { rain: DEMO.intro + 3 + random() * 14, wilt: DEMO.intro + 1 + random() * 18 };
  const done = { rain: false, wilt: false };
  let time = 0, stage = 'intro', mission = null, missionT = 0, finished = false, endIn = -1, label = 'Start flight';
  let aim = null, avoid = new Map(), check = 1.5, last = { x: player.x, z: player.z }, turbo = false, slams = 0;
  let fightT = -1, reinforced = -1, called = false, tree = null, ram = false;
  game.beeItemIn = Infinity; // no bee tokens of its own: the director places them

  // --- what the pilot flies to when nothing special is on: nectar, then the hive
  function nectar() {
    if (player.bag >= DEMO.deliver) { const a = Math.atan2(player.x, player.z); return fly(game, player, { x: Math.sin(a) * 2.6, y: 2.2, z: Math.cos(a) * 2.6 }, { ignore: 'hive' }); }
    const open = f => !game.cooldowns[f.id] && !game.wilt[f.id] && !avoid.has(f.id) && game.standing({ owner: `flower:${f.id}` });
    if (!aim || !open(aim)) aim = FLOWERS.filter(open).sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z))[0] ?? null;
    return aim ? fly(game, player, aim, { ignore: `flower:${aim.id}`, arrive: 0.6 }) : { x: 0, y: 0, z: 0 };
  }
  function unstick(dt) { // a pilot that barely moved for a while tries another flower
    check -= dt; for (const [id, t] of avoid) if (t <= dt) avoid.delete(id); else avoid.set(id, t - dt);
    if (check > 0) return;
    if (Math.hypot(player.x - last.x, player.z - last.z) < 0.5 && aim) { avoid.set(aim.id, 4); aim = null; }
    check = 1.5; last = { x: player.x, z: player.z };
  }
  // --- missions
  function begin(name) {
    mission = name; missionT = 0;
    if (name === 'token') { // a bee token over a flower a little way off, then five helpers
      label = '🐝 Bee token';
      const spots = FLOWERS.filter(f => !game.wilt[f.id]).map(f => ({ f, d: Math.hypot(f.x - player.x, f.z - player.z) })).filter(s => s.d > 7 && s.d < 17);
      const f = (spots.length ? spots[Math.floor(random() * spots.length)].f : FLOWERS[0]);
      game.beeItem = { x: f.x, y: f.y + BEE_ITEM.lift, z: f.z, life: BEE_ITEM.life, flower: f.id };
      game.emit({ type: 'bee-item', x: f.x, y: f.y + BEE_ITEM.lift, z: f.z });
      turbo = true; reinforced = -1; called = false;
    }
    if (name === 'power') { // charged with nectar power, it boosts through a tree
      label = '⚡ Power boost';
      Object.assign(player, { powered: true, power: POWER.need }); game.emit({ type: 'power-ready', id: player.id });
      tree = TREES.filter(t => t.inside && game.standing({ owner: `tree:${t.id}` })).sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z))[0] ?? null;
    }
    if (name === 'cross') { label = '🐝 Bumblebee'; game.bumbleDone = false; game.bumbleAt = game.remaining + 1; }
    if (name === 'heist') { label = '🍯 Honey thief'; Object.assign(game, { bumbleDone: true, heistDone: false, bumbleGone: HEIST.gap, heistAt: game.remaining + 1 }); ram = false; }
  }
  function missionInput(dt) {
    missionT += dt;
    const limit = DEMO.mission[mission];
    if (mission === 'token') {
      const item = game.beeItem;
      if (item && missionT > 10) Object.assign(item, { x: player.x, y: player.y, z: player.z }); // never stuck on the way
      if (player.beeItems > 0 && !called) { if ((reinforced += dt) > 0.6) { called = !!game.redeemBeeItem(); reinforced = 0; } }
      if (called) reinforced += dt;
      if ((called && reinforced > 2.6) || missionT > limit) return null;
      const press = turbo; turbo = false;
      return item ? { ...fly(game, player, item, { ignore: `flower:${item.flower}`, arrive: 0.5 }), turbo: press } : { ...nectar(), turbo: press };
    }
    if (mission === 'power') {
      if (!tree || game.toppled.has(`tree:${tree.id}`) || missionT > limit) { if (missionT > 1.2 || !tree) return null; }
      const d = Math.hypot(tree.x - player.x, tree.z - player.z), input = fly(game, player, { x: tree.x, y: 1.6, z: tree.z }, { ignore: `tree:${tree.id}`, cruise: false, arrive: 0.1 });
      return { ...input, dash: d < 7 && player.boost === 0 };
    }
    const b = game.bumble;
    if (mission === 'cross') {
      if (b && missionT > 12) b.leaving = true; // it has knocked enough bees around
      if ((missionT > 6 && !b && !game.bumbleWarn) || missionT > limit) return null;
      return nectar();
    }
    if (mission === 'heist') {
      if (b?.mode === 'heist' && b.roamFor > 0) b.roamFor = 0; // straight for the honey
      if ((missionT > 6 && !b && !game.bumbleWarn) || missionT > limit) { if (b) b.phase = 'leaving'; return null; }
      if (b?.phase !== 'perched') return nectar();
      // Back off to a run-up spot level with it, then fly straight in; a counted bump throws the bee back.
      const side = Math.atan2(player.x, player.z), spot = { x: Math.sin(side) * 5.5, y: HEIST.perch.y, z: Math.cos(side) * 5.5 };
      if (player.poke || player.recoil) ram = false;
      if (!ram && Math.hypot(player.x - spot.x, player.y - spot.y, player.z - spot.z) < 1) ram = true;
      return ram ? fly(game, player, b, { ignore: 'hive', near: Infinity, cruise: false, arrive: 0.05 }) : fly(game, player, spot, { ignore: 'hive', near: Infinity, cruise: false, arrive: 0.8 });
    }
    return null;
  }
  // --- the finale: the wasp
  function finaleInput(dt) {
    const w = game.wasp;
    if (fightT >= 0) fightT += dt;
    if (w && fightT >= 0) {
      if (fightT > 1 && w.swarm === 'none' && game.waspCommand('gather')) label = '🐝 Swarm';
      if (ending === 'wasted') {
        if (fightT > 2.5 && w.phase === 'hunt') { w.phase = 'approach'; w.t = 0; } // it breaks through to the hive
      } else if (fightT > 2.4 && w.swarm === 'gathered') game.waspCommand('formation');
      else if (fightT > 3.8 && w.swarm === 'formation') { if (defenders && game.redeemBeeItem()) label = '🛡 Defenders'; else game.waspCommand('attack'); }
      const fighting = ['mobbed', 'shake', 'advance'].includes(w.phase) || (ending === 'wasted' && w.phase === 'approach');
      if (fighting && slams < (ending === 'wasted' ? 2 : Infinity)) return slam(w);
      // Waiting for the swarm: hover a little way off, above it.
      const away = Math.atan2(player.x - w.x, player.z - w.z);
      return fly(game, player, { x: w.x + Math.sin(away) * 8, y: w.y + 1.5, z: w.z + Math.cos(away) * 8 }, { cruise: false });
    }
    return nectar();
  }
  function slam(w) {
    label = '💥 Butt slam';
    const h = waspHead(w), dh = Math.hypot(h.x - player.x, h.z - player.z), top = h.y + 2.6;
    if (game.slamReady(player)) return { x: 0, y: 0, z: 0, slam: true };
    // Climb first when close, so the bee never flies into its body; then come down over the head.
    if (dh < 3.2 && player.y < top - 1) return { x: 0, y: 1, z: 0 };
    return fly(game, player, { x: h.x, y: top, z: h.z }, { cruise: false, arrive: 0.6 });
  }

  return {
    get time() { return time; },
    get label() { return label; },
    get done() { return finished; },
    get ending() { return ending; },
    get plan() { return { missions: order, ending, defenders }; },
    // The player's input for this frame; call before the simulation ticks.
    update(dt) {
      time += dt; unstick(dt);
      if (time > DEMO.cap) finished = true;
      if (endIn >= 0) { endIn -= dt; if (endIn <= 0) finished = true; }
      if (stage === 'intro' && time >= DEMO.intro) { stage = 'missions'; begin(missions.shift()); }
      // While it rams the honey thief, aims at a tree or fights the wasp, bumps in the crowd don't bring rain.
      if (mission === 'heist' || mission === 'power' || game.wasp) player.bumpLog = [];
      // Little things in between: the rain cloud after a run of bumps, a neglected flower wilting.
      // (not while it rams the honey thief or aims at a tree: a soaked bee is too slow for that)
      if (stage !== 'intro' && !done.rain && time >= at.rain && !game.cutscene && !player.wet && !game.wasp && mission !== 'heist' && mission !== 'power') {
        for (let i = 0; i < game.rainRule.bumps; i++) game.noteBump(player);
        done.rain = player.wet > 0;
      }
      if (stage !== 'intro' && !done.wilt && time >= at.wilt) {
        const f = FLOWERS.filter(f => !game.cooldowns[f.id] && !game.wilt[f.id] && f !== aim && f.id !== game.beeItem?.flower).sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z))[0];
        if (f) game.unvisited[f.id] = 1e6;
        done.wilt = true;
      }
      if (stage === 'missions') {
        const input = mission ? missionInput(dt) : null;
        if (input) return { dash: false, turbo: false, slam: false, ...input };
        if (missions.length) { begin(missions.shift()); return { x: 0, y: 0, z: 0 }; }
        stage = 'finale'; mission = null; label = '⚠ The wasp';
        game.waspDone = false; game.waspAt = game.remaining + 1;
        if (game.bumble) game.bumble.leaving = true;
        if (defenders) player.beeItems = Math.max(1, player.beeItems ?? 0);
      }
      if (stage === 'finale') return { dash: false, turbo: false, slam: false, ...finaleInput(dt) };
      return { dash: false, turbo: false, slam: false, ...nectar() };
    },
    // Reads the round's events after each tick.
    observe(events) {
      for (const event of events) {
        if (event.type === 'bee-item-collect') game.beeItemIn = Infinity; // still no tokens of its own
        if (event.type === 'wasp-alarm') fightT = 0;
        if (event.type === 'wasp-hit') slams++;
        if (event.type === 'wasp-flee') label = '🏆 Hive defended';
        if (event.type === 'wasp-gone' && ending === 'victory') { game.honey = game.goal; label = '🍯 Goal reached'; } // ends on the goal party
        if (event.type === 'round-end') endIn = event.result === 'complete' ? DEMO.party : DEMO.wasted;
        if (event.type === 'wasp-wasted') label = '💀 Wasted';
      }
    },
  };
}
