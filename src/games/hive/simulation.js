import { WORLD, FLOWERS, OBSTACLES, contact } from './world.js';
import { BUMBLE, scheduleBumblebee, tickBumblebee } from './features/bumblebee.js';

export { FLOWERS };
export const RULES = Object.freeze({ radius: WORLD.radius, capacity: 8, duration: 180, break: 12, goal: 300, regrow: 1.2 });
// Shift starts a long boost; nectar pickups shorten the recharge.
export const BOOST = Object.freeze({ duration: 2.5, cooldown: 6, speed: 12.5, refill: 1.2 });
const SPEED = 6, BOT_SPEED = 0.8, CLIMB = 4.6;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
const home = id => ({ x: Math.sin(id) * 4, y: 2, z: Math.cos(id) * 4 });

export class Game {
  constructor({ bots = 6, random = Math.random } = {}) {
    this.random = random;
    this.players = new Map();
    this.sequence = 0;
    this.round = 1;
    this.remaining = RULES.duration;
    this.honey = 0;
    this.result = null;
    this.cooldowns = FLOWERS.map(() => 0);
    this.lastWinners = [];
    this.events = [];
    this.bumble = null;
    this.pairs = new Map();
    scheduleBumblebee(this, RULES.goal);
    for (let i = 0; i < bots; i++) this.addPlayer(true);
  }
  addPlayer(bot = false) {
    if (!bot) {
      const existing = [...this.players.values()].find(p => !p.bot);
      if (existing) return existing;
    }
    const id = ++this.sequence;
    const p = { id, name: `${bot ? 'Scout' : 'Bee'} ${String(id).padStart(3, '0')}`, bot, ...home(id),
      yaw: 0, bag: 0, score: 0, boost: 0, input: { x: 0, y: 0, z: 0, dash: false }, idle: 0, collect: 0, target: id % FLOWERS.length,
      vx: 0, vy: 0, vz: 0, kx: 0, ky: 0, kz: 0, stun: 0, angry: 0, fume: 0, bonk: 0, distracted: 0, focus: 2 + this.random() * 6, dodge: 0 };
    this.players.set(id, p);
    return p;
  }
  setInput(id, input) {
    const p = this.players.get(id);
    if (!p || !input || typeof input !== 'object') return;
    p.input = { x: clamp(finite(input.x), -1, 1), y: clamp(finite(input.y), -1, 1), z: clamp(finite(input.z), -1, 1), dash: input.dash === true,
      face: Number.isFinite(input.face) ? input.face : undefined };
    p.idle = 0;
  }
  boosting(p) { return p.boost > BOOST.cooldown - BOOST.duration; }
  emit(event) { this.events.push(event); }
  tick(dt) {
    dt = clamp(dt, 0, 0.1);
    this.events = [];
    this.remaining -= dt;
    if (this.remaining <= 0) {
      if (!this.result) this.finish();
      else this.reset();
    }
    if (this.result) return;
    this.cooldowns = this.cooldowns.map(c => Math.max(0, c - dt));
    for (const [key, value] of this.pairs) if (value <= dt) this.pairs.delete(key); else this.pairs.set(key, value - dt);
    tickBumblebee(this, dt);
    for (const p of this.players.values()) this.move(p, dt);
    this.separate();
    for (const p of this.players.values()) this.gather(p);
    if (this.honey >= RULES.goal) this.finish();
  }
  move(p, dt) {
    p.idle += dt;
    for (const key of ['collect', 'stun', 'angry', 'fume', 'bonk', 'distracted', 'dodge']) p[key] = Math.max(0, p[key] - dt);
    const wasBoosting = this.boosting(p);
    p.boost = Math.max(0, p.boost - dt);
    if (p.bot) this.steer(p, dt);
    let input = p.idle > 0.5 && !p.bot ? { x: 0, y: 0, z: 0, dash: false } : p.input;
    if (p.stun) input = { ...input, x: input.x * (p.bot ? 0 : 0.3), y: input.y * (p.bot ? 0 : 0.3), z: input.z * (p.bot ? 0 : 0.3), dash: false };
    if (input.dash && p.boost === 0) { p.boost = BOOST.cooldown; this.emit({ type: 'boost', id: p.id }); }
    const length = Math.max(1, Math.hypot(input.x, input.z));
    const speed = (this.boosting(p) ? BOOST.speed : SPEED) * (p.bot ? BOT_SPEED : 1);
    if (wasBoosting && !this.boosting(p)) this.emit({ type: 'boost-end', id: p.id });
    p.vx = input.x / length * speed + p.kx; p.vz = input.z / length * speed + p.kz;
    p.vy = clamp(input.y, -1, 1) * CLIMB * (this.boosting(p) ? 1.3 : 1) + p.ky;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    // Knockback fades quickly; stunned bees tumble a little longer.
    const fade = Math.exp(-dt * (p.stun ? 1.4 : 2.6));
    p.kx *= fade; p.ky = p.ky * fade - (p.stun ? 4 * dt : 0); p.kz *= fade;
    if (Math.hypot(p.kx, p.ky, p.kz) < 0.03 && !p.stun) p.kx = p.ky = p.kz = 0;
    if (Number.isFinite(input.face) && !p.bot) p.yaw = input.face;
    else if (input.x || input.z) p.yaw = Math.atan2(input.x, input.z);
    this.confine(p);
  }
  confine(p) {
    if (p.y < WORLD.floor) { p.y = WORLD.floor; p.ky = Math.max(0, p.ky); }
    if (p.y > WORLD.ceiling) { p.y = WORLD.ceiling; p.ky = Math.min(0, p.ky); }
    const radius = Math.hypot(p.x, p.z);
    if (radius > RULES.radius) { p.x *= RULES.radius / radius; p.z *= RULES.radius / radius; p.kx *= 0.4; p.kz *= 0.4; }
    for (const o of OBSTACLES) {
      if (Math.abs(p.x - o.x) > 6 || Math.abs(p.z - o.z) > 6) continue;
      const c = contact(o, p.x, p.y, p.z), overlap = WORLD.beeRadius - c.gap;
      if (overlap <= 0) continue;
      p.x += c.nx * overlap; p.y += c.ny * overlap; p.z += c.nz * overlap;
      const impact = -(p.vx * c.nx + p.vy * c.ny + p.vz * c.nz);
      if (impact > 0.4) {
        const bounce = 1.4 + impact * 0.55;
        p.kx += c.nx * bounce; p.ky += c.ny * bounce; p.kz += c.nz * bounce;
        if (impact > 1.6 && !p.bonk) {
          p.bonk = 0.7;
          this.emit({ type: 'thud', id: p.id, kind: o.kind, impact, x: p.x - c.nx * WORLD.beeRadius, y: p.y - c.ny * WORLD.beeRadius, z: p.z - c.nz * WORLD.beeRadius });
        }
      }
    }
  }
  // Bee-to-bee collisions push both apart and report who flew into whom.
  separate() {
    const bees = [...this.players.values()], gap = WORLD.beeRadius * 2;
    for (let i = 0; i < bees.length; i++) for (let j = i + 1; j < bees.length; j++) {
      const a = bees[i], b = bees[j];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.hypot(dx, dy, dz);
      if (d >= gap) continue;
      const nx = d ? dx / d : 1, ny = d ? dy / d : 0, nz = d ? dz / d : 0, push = (gap - d) / 2;
      a.x -= nx * push; a.y -= ny * push; a.z -= nz * push; b.x += nx * push; b.y += ny * push; b.z += nz * push;
      const towardB = a.vx * nx + a.vy * ny + a.vz * nz, towardA = -(b.vx * nx + b.vy * ny + b.vz * nz);
      const impact = Math.max(0, towardB + towardA), shove = 1.3 + impact * 0.45;
      a.kx -= nx * shove; a.ky -= ny * shove * 0.5; a.kz -= nz * shove; b.kx += nx * shove; b.ky += ny * shove * 0.5; b.kz += nz * shove;
      const key = `${a.id}:${b.id}`;
      if (impact > 0.9 && !this.pairs.has(key)) {
        this.pairs.set(key, 1.6);
        const by = towardB >= towardA ? a : b, victim = by === a ? b : a;
        this.emit({ type: 'bump', by: by.id, victim: victim.id, impact, x: a.x + dx / 2, y: a.y + dy / 2, z: a.z + dz / 2 });
      }
      this.confine(a); this.confine(b);
    }
  }
  gather(p) {
    if (Math.hypot(p.x, p.z) < WORLD.hive.deliver && p.y < WORLD.hive.height + 0.6 && p.bag > 0) {
      this.emit({ type: 'deliver', id: p.id, amount: p.bag });
      p.score += p.bag; this.honey += p.bag; p.bag = 0;
      if (p.bot) this.pickFlower(p);
    }
    if (p.bag < RULES.capacity && !p.collect && !p.stun) {
      for (const flower of FLOWERS) {
        if (!this.cooldowns[flower.id] && Math.hypot(p.x - flower.x, p.z - flower.z, p.y - flower.y) < 1.7) {
          p.bag++; p.collect = 0.25; this.cooldowns[flower.id] = RULES.regrow;
          // Nectar recharges a waiting boost, never an active one.
          if (p.boost && !this.boosting(p)) p.boost = Math.max(0, p.boost - BOOST.refill);
          this.emit({ type: 'collect', id: p.id, flower: flower.id, bag: p.bag });
          if (p.bot) this.pickFlower(p);
          break;
        }
      }
    }
  }
  pickFlower(p) {
    const taken = new Set([...this.players.values()].filter(o => o.bot && o !== p).map(o => o.target));
    const options = FLOWERS.filter(f => !taken.has(f.id) && f.id !== p.target)
      .map(f => ({ f, d: Math.hypot(f.x - p.x, f.z - p.z) + Math.abs(f.y - p.y) * 0.6 + this.cooldowns[f.id] * 6 }))
      .sort((a, b) => a.d - b.d);
    if (options.length) p.target = options[Math.floor(this.random() * Math.min(3, options.length))].f.id;
  }
  // Scouts fly to nectar or the hive, steer around obstacles and each other, and dodge the bumblebee.
  steer(p, dt) {
    if (p.fume) { // Shaking a fist at the bumblebee for a moment.
      p.input = { x: 0, y: 0, z: 0, dash: false };
      if (this.bumble) p.yaw = Math.atan2(this.bumble.x - p.x, this.bumble.z - p.z);
      return;
    }
    p.focus -= dt; p.check = (p.check ?? 1.5) - dt;
    if (p.check <= 0) { // A scout that barely moved for a while picks another flower.
      if (Math.hypot(p.x - (p.cx ?? 0), p.z - (p.cz ?? 0)) < 0.6 && p.bag < RULES.capacity) this.pickFlower(p);
      p.check = 1.5; p.cx = p.x; p.cz = p.z;
    }
    if (p.focus <= 0) { p.distracted = 1.2 + this.random() * 1.8; p.focus = 4 + this.random() * 7; }
    const full = p.bag >= RULES.capacity;
    let target = full ? null : FLOWERS[p.target];
    if (target && this.cooldowns[target.id] > 0 && Math.hypot(target.x - p.x, target.z - p.z) < 2.5) { this.pickFlower(p); target = FLOWERS[p.target]; }
    if (!target) { const a = Math.atan2(p.x, p.z); target = { x: Math.sin(a) * 3, y: 2, z: Math.cos(a) * 3 }; }
    let dx = target.x - p.x, dz = target.z - p.z;
    const d = Math.hypot(dx, dz) || 1e-6;
    dx /= d; dz /= d;
    let x = d > 0.3 ? dx : 0, z = d > 0.3 ? dz : 0;
    // Climb before arriving so flower heads are approached from above, not from underneath.
    const cruise = d > 3 ? Math.max(target.y, 2.2) : target.y;
    let y = clamp((cruise - p.y) * 1.3, -1, 1);
    for (const o of OBSTACLES) {
      const lx = p.x + dx * 2, lz = p.z + dz * 2;
      if (Math.abs(lx - o.x) > 4 || Math.abs(lz - o.z) > 4) continue;
      if (o.kind === 'flower' && !full && d < 3 && o.x === target.x && o.z === target.z) continue; // Let scouts reach their own flower.
      if (o.kind === 'hive' && full) continue;
      const c = contact(o, lx, p.y, lz), room = WORLD.beeRadius + 0.7 - c.gap;
      if (room <= 0) continue;
      // Slide along the obstacle (tangent toward the goal) and climb over low ones; never stop dead.
      const h = Math.hypot(c.nx, c.nz) || 1, nx = c.nx / h, nz = c.nz / h, turn = -nz * dx + nx * dz >= 0 ? 1 : -1;
      x += (-nz * turn * 1.8 + nx * 0.4) * room; z += (nx * turn * 1.8 + nz * 0.4) * room;
      if ((o.top ?? o.y + o.r) < 6.5) y += room * 0.8;
    }
    const rushHour = Math.hypot(p.x, p.z) < 6.5; // Busy hive traffic: nobody yields at the entrance.
    if (!p.distracted && !rushHour) for (const other of this.players.values()) {
      if (other === p || other.distracted) continue; // Daydreaming scouts surprise each other.
      const ox = p.x - other.x, oy = p.y - other.y, oz = p.z - other.z, od = Math.hypot(ox, oy, oz);
      if (od > 1.8 || od < 1e-6) continue;
      const weight = (1.8 - od) / 1.8 * 1.3;
      x += ox / od * weight; y += oy / od * weight * 0.6; z += oz / od * weight;
    }
    const b = this.bumble;
    if (b && !b.leaving) {
      const bx = p.x - b.x, bz = p.z - b.z, bd = Math.hypot(bx, bz);
      if (bd < 6 && !p.dodge && this.random() < dt * 1.2) p.dodge = this.random() < 0.55 ? 1.2 : -0.6;
      if (p.dodge > 0 && bd < 7) { x += bx / bd * 1.6 - bz / bd; z += bz / bd * 1.6 + bx / bd; y += p.y < 4 ? 1 : -1; }
    }
    p.input = { x: clamp(x, -1, 1), y: clamp(y, -1, 1), z: clamp(z, -1, 1), dash: false };
  }
  finish() {
    this.result = this.honey >= RULES.goal ? 'complete' : 'time';
    this.remaining = RULES.break;
    this.lastWinners = [...this.players.values()].sort((a, b) => b.score - a.score).slice(0, 3).map(p => ({ name: p.name, score: p.score }));
    if (this.bumble) { this.bumble = null; this.emit({ type: 'bumble-leave' }); }
  }
  reset() {
    this.round++; this.remaining = RULES.duration; this.honey = 0; this.result = null; this.cooldowns.fill(0); this.pairs.clear(); this.bumble = null; this.events = [];
    scheduleBumblebee(this, RULES.goal);
    for (const p of this.players.values()) {
      Object.assign(p, home(p.id), { score: 0, bag: 0, boost: 0, kx: 0, ky: 0, kz: 0, vx: 0, vy: 0, vz: 0, stun: 0, angry: 0, fume: 0 });
    }
  }
}
export { BUMBLE };
