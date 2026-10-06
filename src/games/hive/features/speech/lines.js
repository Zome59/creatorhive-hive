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
  // Second visit: the bumblebee sits on the hive and drinks honey.
  thiefArrives: ['Ooh, a whole hive of honey!', 'Snack time!', 'Don\'t mind me!'],
  thief: ['Mmm, honey…', 'Nom nom nom!', 'Just one more sip!', 'Slurrrp!', 'Five more minutes!', 'Best. Hive. Ever.', 'You won\'t miss a little, right?'],
  swarm: ['Get off our hive!', 'That\'s OUR honey!', 'Shoo! Shoo!', 'Everybody push!', 'Drop the honey, fuzzball!', 'Paws off the honey!', 'Hey! No snacking!', 'Somebody call the Queen!'],
  thiefHit: ['Hey!', 'Oof! Rude!', 'Whoa, whoa!', 'Easy, tiny!', 'I was eating!'],
  thiefFalls: ['Whoaaa!', 'Okay, okay, I\'m going!', 'Fine! Keep your honey!', 'Wheee… ow!'],
  thiefLeaves: ['Thanks for the snack!', '*burp*', 'See you next round!'],
  topple: ['Who knocked down the tree?!', 'Hey! I was using that!', 'Show-off!', 'Easy, Hercules!', 'My flower!!', 'Whoa, look at that one go!'],
  shoved: ['Whoa! Strong little one!', 'Hey! Watch the fluff!', 'Okay, okay!', 'Ooof! Who ate their spinach?'],
  givesUp: ['I\'m outta here!', 'Fine, fine, I\'m leaving!', 'Tough crowd!'],
  cheer: ['Hooray!', 'Nice one!', 'Our hero!', 'Bye-bye, fuzzball!', 'Bee-autiful!', 'And stay out!'],
});
export const TOPPLE = Object.freeze({ tree: ['TIMBER!', 'CRASH!', 'KA-BOOM!'], flower: ['SMASH!', 'FLOMP!', 'WHAM!'], restore: ['BOING!', 'SPROING!', 'POP!'], power: ['KAPOW!', 'POW!', 'WHAM!'] });
export const SOUNDS = Object.freeze({ bump: ['BOINK!', 'BOP!', 'BUMP!', 'BONK!'], thud: ['THUD!', 'CLONK!', 'DONK!', 'BONK!'], bumble: ['WHUMP!', 'KA-BOOF!', 'WHAM!', 'BOOF!'], poke: ['POKE!', 'BOP!', 'PUSH!'], fall: ['WHOOPS!', 'KA-BOOM!', 'TIMBER!'] });

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
