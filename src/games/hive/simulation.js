import { WORLD, FLOWERS, OBSTACLES, contact } from './world.js';
import { BUMBLE, HEIST, SHOVE, heistActive, scheduleBumblebee, tickBumblebee } from './features/bumblebee.js';

export { FLOWERS };
export const RULES = Object.freeze({ radius: WORLD.radius, capacity: 8, duration: 180, break: 12, goal: 300, regrow: 1.2 });
// Shift starts a long boost; nectar pickups shorten the recharge.
export const BOOST = Object.freeze({ duration: 2.5, cooldown: 6, speed: 12.5, refill: 1.2 });
// Nectar power: enough collected nectar charges the player's next boost into a power boost that
// sends bees flying and knocks trees and flowers over until they stand up again.
export const POWER = Object.freeze({ need: 6, shove: 3.4, topple: 2.6, rise: 0.7 });
// From half a bag on, nectar weighs the bee down: slightly at first, then more and more (about
// 6 % slower at 4/8 up to 27 % when full). Delivered nectar scores points; bigger loads earn a
// multiplier. The best round of the page session is kept.
export const LOAD = Object.freeze({ heavy: 4, start: 0.05, slow: 0.22, points: 10, bonus: Object.freeze([[8, 2], [6, 1.5]]) });
export const loadFactor = bag => { if (bag < LOAD.heavy) return 1; const t = (bag - LOAD.heavy + 1) / (RULES.capacity - LOAD.heavy + 1); return 1 - LOAD.start - LOAD.slow * t * t; };
export const deliveryPoints = amount => { const bonus = LOAD.bonus.find(([size]) => amount >= size)?.[1] ?? 1; return { points: Math.round(amount * LOAD.points * bonus), bonus }; };
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
    this.toppled = new Map();
    this.best = 0; this.scores = [];
    // While a cutscene plays, the round clock stops and the player's bee waits safely.
    this.cutscene = 0;
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
      yaw: 0, bag: 0, score: 0, points: 0, boost: 0, input: { x: 0, y: 0, z: 0, dash: false }, idle: 0, collect: 0, target: id % FLOWERS.length,
      vx: 0, vy: 0, vz: 0, kx: 0, ky: 0, kz: 0, power: 0, powered: false, stun: 0, angry: 0, fume: 0, bonk: 0, poke: 0, recoil: 0, distracted: 0, focus: 2 + this.random() * 6, dodge: 0 };
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
  powerBoosting(p) { return p.powered && this.boosting(p); }
  // A toppled tree or flower has no collision until it has stood up again.
  standing(o) { return !this.toppled.has(o.owner); }
  topple(o, p, nx, nz) {
    if (o.kind !== 'tree' && o.kind !== 'flower') return false;
    this.toppled.set(o.owner, { time: POWER.topple + POWER.rise, dx: -nx, dz: -nz, kind: o.kind, x: o.x, z: o.z });
    if (o.kind === 'flower') this.cooldowns[Number(o.owner.split(':')[1])] = POWER.topple + POWER.rise;
    this.emit({ type: 'topple', owner: o.owner, kind: o.kind, by: p.id, dx: -nx, dz: -nz, x: o.x, y: o.shape === 'sphere' ? o.y : 1, z: o.z });
    return true;
  }
  emit(event) { this.events.push(event); }
  tick(dt) {
    dt = clamp(dt, 0, 0.1);
    this.events = [];
    if (this.cutscene) this.cutscene = Math.max(0, this.cutscene - dt);
    else this.remaining -= dt;
    if (this.remaining <= 0) {
      if (!this.result) this.finish();
      else this.reset();
    }
    if (this.result) return;
    this.cooldowns = this.cooldowns.map(c => Math.max(0, c - dt));
    for (const [key, value] of this.pairs) if (value <= dt) this.pairs.delete(key); else this.pairs.set(key, value - dt);
    for (const [owner, state] of this.toppled) { state.time -= dt; if (state.time <= 0) { this.toppled.delete(owner); this.emit({ type: 'restore', owner, kind: state.kind, x: state.x, y: 1.2, z: state.z }); } }
    tickBumblebee(this, dt);
    for (const p of this.players.values()) this.move(p, dt);
    this.separate();
    for (const p of this.players.values()) this.gather(p);
    if (this.honey >= RULES.goal) this.finish();
  }
  move(p, dt) {
    p.idle += dt;
    for (const key of ['collect', 'stun', 'angry', 'fume', 'bonk', 'poke', 'recoil', 'distracted', 'dodge']) p[key] = Math.max(0, p[key] - dt);
    const wasBoosting = this.boosting(p);
    p.boost = Math.max(0, p.boost - dt);
    if (p.bot) this.steer(p, dt);
    let input = (p.idle > 0.5 || this.cutscene) && !p.bot ? { x: 0, y: 0, z: 0, dash: false } : p.input;
    if (p.stun) input = { ...input, x: input.x * (p.bot ? 0 : 0.3), y: input.y * (p.bot ? 0 : 0.3), z: input.z * (p.bot ? 0 : 0.3), dash: false };
    // Bouncing off something heavy: steering barely works for a moment.
    else if (p.recoil) input = { ...input, x: input.x * 0.15, y: input.y * 0.15, z: input.z * 0.15 };
    if (input.dash && p.boost === 0) { p.boost = BOOST.cooldown; this.emit({ type: 'boost', id: p.id, power: p.powered }); }
    const length = Math.max(1, Math.hypot(input.x, input.z));
    const speed = (this.boosting(p) ? BOOST.speed : SPEED) * (p.bot ? BOT_SPEED : 1) * loadFactor(p.bag);
    if (wasBoosting && !this.boosting(p)) { this.emit({ type: 'boost-end', id: p.id, power: p.powered }); if (p.powered) { p.powered = false; p.power = 0; } }
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
      if (Math.abs(p.x - o.x) > 6 || Math.abs(p.z - o.z) > 6 || !this.standing(o)) continue;
      const c = contact(o, p.x, p.y, p.z), overlap = WORLD.beeRadius - c.gap;
      if (overlap <= 0) continue;
      // A power-boosting bee smashes straight through trees and flowers.
      if (this.powerBoosting(p) && this.topple(o, p, c.nx, c.nz)) continue;
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
      // A power-boosting bee barely slows down and sends the other one flying.
      const power = this.powerBoosting(a) ? a : this.powerBoosting(b) ? b : null, other = power === a ? b : a;
      const shoveA = power === a ? shove * 0.25 : power === b ? shove * POWER.shove : shove, shoveB = power === b ? shove * 0.25 : power === a ? shove * POWER.shove : shove;
      a.kx -= nx * shoveA; a.ky -= ny * shoveA * 0.5; a.kz -= nz * shoveA; b.kx += nx * shoveB; b.ky += ny * shoveB * 0.5; b.kz += nz * shoveB;
      if (power) { other.ky += 3; other.stun = Math.max(other.stun, 1.1); other.angry = 3; }
      const key = `${a.id}:${b.id}`;
      if (impact > 0.9 && !this.pairs.has(key)) {
        this.pairs.set(key, 1.6);
        const by = towardB >= towardA ? a : b, victim = by === a ? b : a;
        this.emit({ type: 'bump', by: by.id, victim: victim.id, impact, power: !!power, x: a.x + dx / 2, y: a.y + dy / 2, z: a.z + dz / 2 });
      }
      this.confine(a); this.confine(b);
    }
  }
  gather(p) {
    if (Math.hypot(p.x, p.z) < WORLD.hive.deliver && p.y < WORLD.hive.height + 0.6 && p.bag > 0) {
      const { points, bonus } = deliveryPoints(p.bag);
      this.emit({ type: 'deliver', id: p.id, amount: p.bag, points, bonus });
      p.score += p.bag; p.points += points; this.honey += p.bag; p.bag = 0;
      if (p.bot) this.pickFlower(p);
    }
    if (p.bag < RULES.capacity && !p.collect && !p.stun) {
      for (const flower of FLOWERS) {
        if (!this.cooldowns[flower.id] && Math.hypot(p.x - flower.x, p.z - flower.z, p.y - flower.y) < 1.7) {
          p.bag++; p.collect = 0.25; this.cooldowns[flower.id] = RULES.regrow;
          // Nectar recharges a waiting boost, never an active one.
          if (p.boost && !this.boosting(p)) p.boost = Math.max(0, p.boost - BOOST.refill);
          this.emit({ type: 'collect', id: p.id, flower: flower.id, bag: p.bag });
          if (p.bag === LOAD.heavy) this.emit({ type: 'heavy', id: p.id, bag: p.bag });
          if (!p.bot && !p.powered && ++p.power >= POWER.need) { p.powered = true; this.emit({ type: 'power-ready', id: p.id }); }
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
    if (heistActive(this)) { // Everyone rushes to push the honey thief off the hive.
      const b = this.bumble, angle = p.id * 2.4, ring = p.poke ? 2.8 : 0;
      const dx = b.x + Math.sin(angle) * ring - p.x, dy = b.y + (p.id % 3 - 1) * 0.35 - p.y, dz = b.z + Math.cos(angle) * ring - p.z, d = Math.hypot(dx, dz) || 1e-6;
      p.input = { x: dx / d, y: clamp(dy * 1.5, -1, 1), z: dz / d, dash: false };
      return;
    }
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
      if (Math.abs(lx - o.x) > 4 || Math.abs(lz - o.z) > 4 || !this.standing(o)) continue;
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
    const player = [...this.players.values()].find(p => !p.bot);
    if (player) {
      this.newBest = player.points > this.best; this.best = Math.max(this.best, player.points);
      this.scores = [...this.scores, { round: this.round, points: player.points }].sort((a, b) => b.points - a.points).slice(0, 5);
    }
    if (this.bumble) { this.bumble = null; this.emit({ type: 'bumble-leave' }); }
  }
  reset() {
    this.round++; this.remaining = RULES.duration; this.honey = 0; this.result = null; this.cooldowns.fill(0); this.pairs.clear(); this.toppled.clear(); this.bumble = null; this.events = []; this.cutscene = 0;
    scheduleBumblebee(this, RULES.goal);
    for (const p of this.players.values()) {
      Object.assign(p, home(p.id), { score: 0, points: 0, bag: 0, boost: 0, power: 0, powered: false, kx: 0, ky: 0, kz: 0, vx: 0, vy: 0, vz: 0, stun: 0, angry: 0, fume: 0 });
    }
  }
}
export { BUMBLE, HEIST, SHOVE };
export { OBSTACLES };
