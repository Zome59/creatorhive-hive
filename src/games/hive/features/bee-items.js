import { FLOWERS, WORLD } from '../world.js';
import { WASP_FIGHT, joinSwarmAttack } from './wasp.js';

// The bee token: now and then a special item floats above a flower. Only the player can pick it up (up to three).
// Redeemed, five new bees crawl out of the hive entrance and fly off to work like the scouts. Redeemed during the
// wasp fight, they come out as defenders (a red sash, a third stronger) and charge the wasp with the swarm.
export const BEE_ITEM = Object.freeze({ first: Object.freeze([40, 60]), every: Object.freeze([45, 70]), life: 20, reach: 1.7, max: 3, crew: 5, crawl: 1.3, stagger: 0.28, strength: 4 / 3, lift: 1.15 });
const ENTRANCE = Object.freeze({ x: 0, y: 0.45, z: WORLD.hive.radius + WORLD.beeRadius + 0.05 }); // on the landing board in front of the door

const between = (game, [a, b]) => a + game.random() * (b - a);
const playerOf = game => [...game.players.values()].find(p => !p.bot);

export function scheduleBeeItems(game) { game.beeItem = null; game.beeItemIn = between(game, BEE_ITEM.first); game.crewSerial = 0; }

export function tickBeeItems(game, dt) {
  if (game.result) return;
  const item = game.beeItem, player = playerOf(game);
  if (!item) {
    game.beeItemIn -= dt;
    if (game.beeItemIn > 0) return;
    const open = FLOWERS.filter(f => !game.wilt?.[f.id]);
    const f = open[Math.floor(game.random() * open.length)] ?? FLOWERS[0];
    game.beeItem = { x: f.x, y: f.y + BEE_ITEM.lift, z: f.z, life: BEE_ITEM.life, flower: f.id };
    game.emit({ type: 'bee-item', x: f.x, y: f.y + BEE_ITEM.lift, z: f.z });
    return;
  }
  item.life -= dt;
  if (player && !player.ko && Math.hypot(player.x - item.x, player.y - item.y, player.z - item.z) < BEE_ITEM.reach) {
    player.beeItems = Math.min(BEE_ITEM.max, (player.beeItems ?? 0) + 1);
    game.beeItem = null; game.beeItemIn = between(game, BEE_ITEM.every);
    game.emit({ type: 'bee-item-collect', id: player.id, count: player.beeItems, x: item.x, y: item.y, z: item.z });
  } else if (item.life <= 0) {
    game.beeItem = null; game.beeItemIn = between(game, BEE_ITEM.every);
    game.emit({ type: 'bee-item-gone', x: item.x, y: item.y, z: item.z });
  }
}

// Redeems one token: five bees crawl out of the hive door. During the wasp fight they are defenders.
export function redeemBeeItem(game) {
  const player = playerOf(game), w = game.wasp, fight = !!w && WASP_FIGHT.includes(w.phase);
  if (!player || !(player.beeItems > 0) || game.result) return null;
  player.beeItems--;
  const ids = [];
  for (let i = 0; i < BEE_ITEM.crew; i++) {
    const bee = game.addPlayer(true), n = ++game.crewSerial;
    Object.assign(bee, { name: `${fight ? 'Guard' : 'Helper'} ${String(n).padStart(2, '0')}`, extra: true, defender: fight,
      x: ENTRANCE.x + (i - (BEE_ITEM.crew - 1) / 2) * 0.32, y: ENTRANCE.y, z: ENTRANCE.z, yaw: 0, crawl: BEE_ITEM.crawl + i * BEE_ITEM.stagger, bag: 0 });
    ids.push(bee.id);
  }
  if (fight) joinSwarmAttack(game);
  game.emit({ type: 'bee-reinforce', ids, defenders: fight, x: ENTRANCE.x, y: ENTRANCE.y, z: ENTRANCE.z });
  return ids;
}

// New bees first crawl out over the landing board, then hop up and take off. Returns true while crawling.
export function steerCrawl(game, p, dt) {
  if (!(p.crawl > 0)) return false;
  p.crawl = Math.max(0, p.crawl - dt);
  p.input = { x: 0, y: 0, z: 0, dash: false };
  if (p.crawl < BEE_ITEM.crawl) { p.z += 0.9 * dt; p.y = ENTRANCE.y; } // waiting their turn in the doorway, then out
  p.yaw = 0;
  if (!p.crawl) { p.ky = 3.2; game.pickFlower?.(p); }
  return true;
}
