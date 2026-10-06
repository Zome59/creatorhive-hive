// Sound files live in public/games/hive/audio/ (see the README there for source and rights).
// `gain` is the mix level; `loop` sounds play continuously, positioned at a bee.
// `variants: n` means files `<name>-1.mp3` … `<name>-n.mp3`; one is picked at random per play.
export const HIVE_SOUNDS = Object.freeze([
  { name: 'buzz', loop: true, gain: 0.5 },
  { name: 'bumble', loop: true, gain: 0.9 },
  { name: 'garden', loop: true, gain: 0.07 },
  { name: 'pass', gain: 0.9 },
  { name: 'bump', gain: 1 },
  { name: 'thud', gain: 0.7 },
  { name: 'collect', gain: 0.6 },
  { name: 'deliver', gain: 0.8 },
  { name: 'boost', gain: 0.7 },
  { name: 'crash', gain: 1 },
  { name: 'grumble', gain: 0.75, variants: 3 },
  { name: 'alarm', gain: 0.35 },
  { name: 'dizzy', gain: 0.4 },
]);
export const soundFiles = sound => sound.variants ? Array.from({ length: sound.variants }, (_, i) => `${sound.name}-${i + 1}`) : [sound.name];
