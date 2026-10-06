// Comic one-liners for collisions. Family-friendly: grawlix instead of real swearing.
export const LINES = Object.freeze({
  victim: ['Whoa, I totally didn\'t see you!', 'Hey, buzz-brain, watch it!', 'Too much honey for breakfast?', 'Hey! I\'m flying here!', 'Ever heard of turn signals?',
    'Buzz off!', 'Rude. Very rude.', 'Mind the wings!', 'Are you even licensed to fly?', 'My pollen! You spilled my pollen!', 'Look where you\'re buzzing!',
    'Ouch! That was my good side!', 'Un-bee-lievable!', 'Do you need glasses?', 'Personal space, please!', 'Did you learn to fly yesterday?', 'Sheesh! Easy on the stinger!'],
  reply: ['Sorry! Pollen in my eyes!', 'Oops, my bad!', 'You hit ME!', 'Says you!', 'Bzzz… whatever.', 'Excuse me, coming through!', 'Didn\'t see you there, shorty!', 'Pardon my wings!'],
  thud: ['Who put that there?!', 'Ow! Stupid flower!', 'I meant to do that.', 'Nobody saw that.', 'Ouch, my antennae!', 'That tree came out of nowhere!', 'Note to self: trees are hard.', 'Bonk. Classic me.'],
  hit: ['#@%&!', 'HEY, BIG GUY!!', 'My honey!!', 'Whaaa-aaa!', '$%#@! Fuzzball!', 'I\'m seeing stars!', 'Wheeeee… ow.', 'Who ordered the bowling ball?!'],
  upset: ['Watch where you\'re bumbling!', 'Learn to fly, fuzzball!', 'Unbelievable!', 'That\'s it, I\'m telling the Queen!', 'You overgrown cotton ball!', '#@%&! Not again!', 'Hey! Pick on someone your own size!', 'Boo! Booo!'],
  bumble: ['Oopsie!', 'Pardon me!', 'Coming throoough!', 'Sorry, little guys!', 'Whoopsie-daisy!', 'Hic! Beg your pardon!', 'Wheee!', 'Who moved the garden?'],
  bumbleThud: ['Oof!', 'Who put a tree there?', 'Ow-ow-ow!', 'I\'m okay!'],
});
export const SOUNDS = Object.freeze({ bump: ['BOINK!', 'BOP!', 'BUMP!', 'BONK!'], thud: ['THUD!', 'CLONK!', 'DONK!', 'BONK!'], bumble: ['WHUMP!', 'KA-BOOF!', 'WHAM!', 'BOOF!'] });

// Picks random entries without repeating the previous one of the same list.
export function createPicker(random = Math.random) {
  const last = new Map();
  return function pick(list) {
    if (list.length < 2) return list[0];
    let index = Math.floor(random() * list.length);
    if (index === last.get(list)) index = (index + 1 + Math.floor(random() * (list.length - 1))) % list.length;
    last.set(list, index);
    return list[index];
  };
}
