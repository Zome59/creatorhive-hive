// Pollen baskets on all six legs: the nectar load (0..1) fills the hind pair first, then the middle pair,
// then the front pair. Each pair's share is its own 0..1 fill, so the legs show the load as a percentage.
export const POLLEN = Object.freeze({ pairs: 3, base: 0.032, grow: 0.056, front: 0.82 });

export function basketFills(load) {
  const l = Math.max(0, Math.min(1, load));
  return Array.from({ length: POLLEN.pairs }, (_, pair) => Math.max(0, Math.min(1, l * POLLEN.pairs - pair)));
}
