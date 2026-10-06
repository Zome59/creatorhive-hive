import { WORLD, OBSTACLES, contact } from '../world.js';

// A clumsy bumblebee crosses the garden once per round, around the middle of the round.
// It is announced `warning` seconds ahead, from the side where it will enter.
export const BUMBLE = Object.freeze({ radius: 1, speed: 4.6, life: 22, spawn: [0.42, 0.58], reach: 9, warning: 4 });
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

// Mid-round means half the time or half the goal, whichever comes first, each slightly randomized.
export function scheduleBumblebee(game, goal) {
  const share = () => BUMBLE.spawn[0] + game.random() * (BUMBLE.spawn[1] - BUMBLE.spawn[0]);
  game.bumbleAt = game.remaining * (1 - share()); game.bumbleHoney = Math.round(goal * share());
  game.bumbleDone = false; game.bumbleWarn = 0; game.bumbleAngle = game.random() * Math.PI * 2;
}
function spawn(game) {
  const angle = game.bumbleAngle;
  game.bumble = { x: Math.sin(angle) * (WORLD.radius + 3), y: 4.5, z: Math.cos(angle) * (WORLD.radius + 3), yaw: angle + Math.PI + (game.random() - 0.5) * 0.6,
    age: 0, retarget: 1.5, target: null, lurch: 0, thud: 0, oops: 0, leaving: false, hits: 0, speed: 0 };
  game.emit({ type: 'bumble-enter', x: game.bumble.x, y: game.bumble.y, z: game.bumble.z });
}
function pickTarget(game) {
  const bees = [...game.players.values()].filter(p => !p.stun);
  const player = bees.find(p => !p.bot);
  if (player && game.random() < 0.45) return player.id;
  return bees.length ? bees[Math.floor(game.random() * bees.length)].id : null;
}
export function tickBumblebee(game, dt) {
  if (!game.bumble && !game.bumbleDone) {
    if (!game.bumbleWarn && (game.remaining <= game.bumbleAt || game.honey >= game.bumbleHoney)) {
      game.bumbleWarn = BUMBLE.warning;
      game.emit({ type: 'bumble-warning', seconds: BUMBLE.warning, angle: game.bumbleAngle, x: Math.sin(game.bumbleAngle) * WORLD.radius, z: Math.cos(game.bumbleAngle) * WORLD.radius });
    } else if (game.bumbleWarn) {
      game.bumbleWarn = Math.max(0, game.bumbleWarn - dt);
      if (!game.bumbleWarn) { game.bumbleDone = true; spawn(game); }
    }
  }
  const b = game.bumble;
  if (!b) return;
  b.age += dt; b.retarget -= dt;
  for (const key of ['lurch', 'thud', 'oops']) b[key] = Math.max(0, b[key] - dt);
  if (b.age > BUMBLE.life) b.leaving = true;
  if (!b.leaving && b.retarget <= 0) { b.target = pickTarget(game); b.retarget = 2.6 + game.random() * 2; if (game.random() < 0.3) b.lurch = 0.9; }
  const target = b.leaving ? null : game.players.get(b.target);
  const desired = b.leaving ? Math.atan2(b.x, b.z) : target ? Math.atan2(target.x - b.x, target.z - b.z) : Math.atan2(-b.x, -b.z);
  // Limited turning plus a wobble makes the flight path clumsy and dodgeable.
  b.yaw = wrap(b.yaw + clamp(wrap(desired - b.yaw), -1.5 * dt, 1.5 * dt) + Math.sin(b.age * 2.1) * 0.9 * dt);
  b.speed = BUMBLE.speed * (b.lurch ? 1.75 : 1) * (b.oops ? 0.4 : 1);
  b.x += Math.sin(b.yaw) * b.speed * dt; b.z += Math.cos(b.yaw) * b.speed * dt;
  const altitude = (target ? target.y : 3.5) + Math.sin(b.age * 1.7) * 0.9;
  b.y = clamp(b.y + clamp(altitude - b.y, -1, 1) * 2.2 * dt, 1.2, 7.5);
  for (const o of OBSTACLES) {
    if (Math.abs(b.x - o.x) > 6 || Math.abs(b.z - o.z) > 6) continue;
    const c = contact(o, b.x, b.y, b.z), overlap = BUMBLE.radius - c.gap;
    if (overlap <= 0) continue;
    b.x += c.nx * overlap; b.y += c.ny * overlap; b.z += c.nz * overlap;
    if (!b.thud) { b.thud = 1.2; b.oops = 0.5; game.emit({ type: 'bumble-thud', kind: o.kind, x: b.x - c.nx, y: b.y - c.ny, z: b.z - c.nz }); }
  }
  for (const p of game.players.values()) {
    const dx = p.x - b.x, dy = p.y - b.y, dz = p.z - b.z, d = Math.hypot(dx, dy, dz);
    if (d >= BUMBLE.radius + WORLD.beeRadius || p.stun) continue;
    const nx = d ? dx / d : 0, ny = d ? dy / d : 1, nz = d ? dz / d : 0;
    p.kx = nx * 8 + Math.sin(b.yaw) * 4; p.ky = 3.5 + ny * 2; p.kz = nz * 8 + Math.cos(b.yaw) * 4;
    p.stun = 2.4; p.angry = 4.5; p.fume = 0;
    const spilled = Math.min(p.bag, 2); p.bag -= spilled;
    b.hits++; b.oops = 0.6;
    game.emit({ type: 'bumble-hit', id: p.id, spilled, x: p.x, y: p.y, z: p.z });
    for (const other of game.players.values()) {
      if (other === p || other.stun || other.angry || Math.hypot(other.x - p.x, other.z - p.z) > BUMBLE.reach) continue;
      other.angry = 3 + game.random() * 1.5;
      if (other.bot) other.fume = 1.3 + game.random() * 0.9;
      game.emit({ type: 'upset', id: other.id });
    }
  }
  if (b.leaving && Math.hypot(b.x, b.z) > WORLD.radius + 5) { game.bumble = null; game.emit({ type: 'bumble-leave' }); }
}
