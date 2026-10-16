// Built-in effect presets. Keys are lowercase names, or "name|class" when a name is shared between classes.
// Effect: {target, op, value, when?, die?}
//   target: ac | acBase | speed | initiative | hpMax | prof | ability.X | save.X|all | check.X|all | skill.X|all
//           passive.X | attack.all|weapon|melee|ranged|spell | damage.all|weapon|melee|ranged|spell | spellDc | spellAttack
//           weapon.ability (op set, value str..cha or 'spell' = caster's ability; used only when higher) | weapon.die (op set, value 'd8' or
//           a [formula] die; the biggest die wins) | weapon.dmgType (op set, value 'slashing')
//   op: add | set | min | mul | adv | dis | note | dice (value = count formula, die = 'd6')
//   value: number, dice ('1d4'), or formula over mod.X, score.X, prof, level, level.<class>, max/min/floor/ceil
//   when: all must hold — armor noArmor shield noShield notHeavyArmor lightOrNoArmor nonProficient
//         weapon melee ranged oneHanded heavyWeapon finesseOrRanged str spell:<name> weapon:<base>|<base> (e.g. weapon:club|quarterstaff)
//         unarmed (unarmed strikes) monkWeapon noWeapon (no weapon equipped)
// toggle: true → a switch on the sheet; otherwise always on.
// Keys may also be "name|class|level" when the same name means different things at different levels (Bear totem 3/6/14).
// uses: a class resource created automatically while the feature is known
//   {max: formula, reset: 'short'|'long', shortIf?: formula (e.g. Font of Inspiration), die?: dice with [formula], name?: shown name}
// actions: entries added to the Actions panel while the feature is known
//   {name?, group: action|bonus|reaction|other, use?: n (from this feature's resource), res?: other resource name, toggle?: turns this
//    feature's switch on, slot?: spends a spell slot (formulas see `slot`), ability ('best' = higher of STR/DEX), prof, dice, addMod,
//    dmgType, saveDc, saveAbility, notes, special?: 'wildshape'}

const T = true;
const fx = (target, op, value, when) => ({ target, op, value, ...(when && { when }) });
const note = (target, value, when) => fx(target, 'note', value, when);
const RAGING = ['active:rage'];
const STAFF = ['weapon:club|quarterstaff'];
const MA_DIE = '1d[4+2*((level.monk>=5)+(level.monk>=11)+(level.monk>=17))]';
const BI_DIE = '1d[6+2*((level.bard>=5)+(level.bard>=10)+(level.bard>=15))]';
const SUP_DIE = '1d[8+2*((level.fighter>=10)+(level.fighter>=18))]';
const strike = (extra = {}) => ({ ability: 'best', prof: T, dice: MA_DIE, addMod: T, dmgType: 'bludgeoning', unarmed: T, ...extra });
const UNARMED = ['unarmed'];
// natural weapons that make unarmed strikes (race traits; the book decides the die, so keys carry the source)
const claws = (die, type) => ({ effects: [fx('weapon.die', 'set', die, UNARMED), fx('weapon.dmgType', 'set', type, UNARMED)] });
const plus = n => [fx('attack.weapon', 'add', n, UNARMED), fx('damage.weapon', 'add', n, UNARMED)];

export const FEATURES = {
  // barbarian
  'rage': { toggle: T, effects: [fx('damage.melee', 'add', '2+(level.barbarian>=9)+(level.barbarian>=16)', ['str']), fx('check.str', 'adv'), fx('save.str', 'adv'), fx('ac', 'note', 'Resistance to bludgeoning, piercing and slashing damage')],
    uses: { max: '2+(level.barbarian>=3)+(level.barbarian>=6)+(level.barbarian>=12)+(level.barbarian>=17)+97*(level.barbarian>=20)', reset: 'long', name: 'Rage' },
    actions: [{ group: 'bonus', use: 1, toggle: T, notes: 'Lasts 1 minute; ends early if you neither attack nor take damage' }] },
  // Path of the Totem Warrior: chosen options of Totem Spirit (3), Aspect of the Beast (6), Totemic Attunement (14)
  'bear|barbarian|3': { effects: [note('ac', 'Bear totem: resistance to all damage except psychic', RAGING)] },
  'eagle|barbarian|3': { effects: [note('speed', 'Eagle totem: Dash as a bonus action; opportunity attacks against you have disadvantage', RAGING)] },
  'elk|barbarian|3': { effects: [fx('speed', 'add', 15, [...RAGING, 'notHeavyArmor'])] },
  'tiger|barbarian|3': { effects: [note('skill.athletics', 'Tiger totem: +10 ft long jump, +3 ft high jump', RAGING)] },
  'wolf|barbarian|3': { effects: [note('attack.melee', 'Wolf totem: friends have advantage on melee attacks against enemies within 5 ft of you', RAGING)] },
  'bear|barbarian|6': { effects: [note('check.str', 'Aspect of the Bear: carrying capacity doubled; advantage on STR checks to push, pull, lift or break')] },
  'eagle|barbarian|6': { effects: [note('passive.perception', 'Aspect of the Eagle: see up to 1 mile clearly; dim light does not impose disadvantage')] },
  'elk|barbarian|6': { effects: [note('speed', 'Aspect of the Elk: travel pace doubled for you and up to 10 companions')] },
  'tiger|barbarian|6': { effects: [note('skill.all', 'Aspect of the Tiger: proficiency in two of Athletics, Acrobatics, Stealth, Survival')] },
  'wolf|barbarian|6': { effects: [note('skill.survival', 'Aspect of the Wolf: track at a fast pace; stealthy at normal pace')] },
  'bear|barbarian|14': { effects: [note('ac', 'Bear attunement: hostile creatures within 5 ft have disadvantage attacking others', RAGING)] },
  'eagle|barbarian|14': { effects: [note('speed', 'Eagle attunement: flying speed equal to walking speed', RAGING)] },
  'elk|barbarian|14': { effects: [note('attack.melee', 'Elk attunement: bonus action knock a Large or smaller creature prone (STR save)', RAGING)] },
  'tiger|barbarian|14': { effects: [note('attack.melee', 'Tiger attunement: after moving 20 ft, bonus action melee attack', RAGING)] },
  'wolf|barbarian|14': { effects: [note('attack.melee', 'Wolf attunement: bonus action knock a Large or smaller creature prone on a hit', RAGING)] },
  'brutal critical (1 die)': { effects: [note('damage.melee', 'Brutal Critical: extra weapon damage die(s) on a critical hit')] },
  'unarmored defense|barbarian': { effects: [fx('acBase', 'add', '10+mod.dex+mod.con', ['noArmor'])] },
  'danger sense': { effects: [fx('save.dex', 'adv')] },
  'fast movement': { effects: [fx('speed', 'add', 10, ['notHeavyArmor'])] },
  'feral instinct': { effects: [fx('initiative', 'adv')] },
  'reckless attack': { toggle: T, effects: [fx('attack.melee', 'adv', null, ['str']), fx('ac', 'note', 'Attacks against you have advantage')] },
  // fighter
  'second wind': { uses: { max: 1, reset: 'short' }, actions: [{ group: 'bonus', use: 1, dice: '1d10+[level.fighter]', dmgType: 'healing' }] },
  'action surge': { uses: { max: '1+(level.fighter>=17)', reset: 'short' }, actions: [{ group: 'other', use: 1, notes: 'Take one additional action this turn' }] },
  'indomitable': { uses: { max: '(level.fighter>=9)+(level.fighter>=13)+(level.fighter>=17)', reset: 'long' }, actions: [{ group: 'other', use: 1, notes: 'Reroll a failed saving throw' }] },
  'combat superiority': { uses: { max: '4+(level.fighter>=7)+(level.fighter>=15)', reset: 'short', die: SUP_DIE, name: 'Superiority Dice' },
    actions: [{ name: 'Maneuver', group: 'other', use: 1, dice: SUP_DIE, dmgType: 'superiority die', saveDc: '8+prof+max(mod.str,mod.dex)', saveAbility: 'maneuver', notes: 'Spend a superiority die on a known maneuver' }] },
  'improved critical': { effects: [note('attack.weapon', 'Improved Critical: crit on 19–20')] },
  'psionic power|fighter': { uses: { max: '2*prof', reset: 'long', die: '1d[6+2*((level.fighter>=5)+(level.fighter>=11)+(level.fighter>=17))]', name: 'Psionic Energy' },
    actions: [{ name: 'Protective Field', group: 'reaction', use: 1, dice: '1d[6+2*((level.fighter>=5)+(level.fighter>=11)+(level.fighter>=17))]+[mod.int]', dmgType: 'damage prevented' }] },
  // monk
  'ki': { uses: { max: 'level.monk', reset: 'short', name: 'Ki Points' } },
  'martial arts': { effects: [fx('weapon.ability', 'set', 'dex', UNARMED), fx('weapon.die', 'set', MA_DIE, UNARMED),
    fx('weapon.ability', 'set', 'dex', ['monkWeapon']), fx('weapon.die', 'set', MA_DIE, ['monkWeapon'])], actions: [strike({ name: 'Martial Arts strike', group: 'bonus', notes: 'Unarmed strike after taking the Attack action' })] },
  'flurry of blows': { actions: [strike({ group: 'bonus', res: 'Ki Points', use: 1, notes: 'Two unarmed strikes after the Attack action' })] },
  'step of the wind': { actions: [{ group: 'bonus', res: 'Ki Points', use: 1, notes: 'Disengage or Dash; jump distance doubled' }] },
  'stunning strike': { actions: [{ group: 'other', res: 'Ki Points', use: 1, saveDc: '8+prof+mod.wis', saveAbility: 'CON', notes: 'After a melee hit: stunned until the end of your next turn' }] },
  'deflect missiles': { actions: [{ group: 'reaction', dice: '1d10+[mod.dex+level.monk]', dmgType: 'damage reduced', notes: 'If reduced to 0 you may catch and throw it (1 ki)' }] },
  'wholeness of body': { uses: { max: 1, reset: 'long' }, actions: [{ group: 'action', use: 1, dice: '[3*level.monk]', dmgType: 'healing' }] },
  // rogue
  'cunning action': { actions: [{ group: 'bonus', notes: 'Dash, Disengage or Hide' }] },
  'uncanny dodge': { actions: [{ group: 'reaction', notes: 'Halve the damage of an attack you can see' }] },
  'evasion': { effects: [note('save.dex', 'Evasion: no damage on a success, half on a failure')] },
  // paladin
  'divine sense': { uses: { max: '1+mod.cha', reset: 'long' }, actions: [{ group: 'action', use: 1, notes: 'Sense celestials, fiends and undead within 60 ft' }] },
  'lay on hands': { uses: { max: '5*level.paladin', reset: 'long', name: 'Lay on Hands' },
    actions: [{ group: 'action', use: 1, dice: '1', dmgType: 'healing', notes: 'Each press spends 1 point for 1 HP; press again to heal more' },
      { name: 'Lay on Hands: Cure', group: 'action', use: 5, notes: 'Cure one disease or neutralize one poison' }] },
  'divine smite': { actions: [{ group: 'other', slot: T, dice: '[min(5,slot+1)]d8', dmgType: 'radiant', notes: 'On a melee weapon hit; +1d8 against undead or fiends' }] },
  'improved divine smite': { effects: [fx('damage.melee', 'add', '1d8', ['weapon'])] },
  'channel divinity|paladin': { uses: { max: 1, reset: 'short', name: 'Channel Divinity' } },
  'sacred weapon': { toggle: T, effects: [fx('attack.weapon', 'add', 'max(1,mod.cha)')], actions: [{ group: 'action', res: 'Channel Divinity', use: 1, toggle: T, notes: '1 minute; weapon sheds light' }] },
  'turn the unholy': { actions: [{ group: 'action', res: 'Channel Divinity', use: 1, saveDc: '8+prof+mod.cha', saveAbility: 'WIS', notes: 'Fiends and undead within 30 ft are turned for 1 minute' }] },
  // cleric
  'channel divinity|cleric': { uses: { max: '1+(level.cleric>=6)+(level.cleric>=18)', reset: 'short', name: 'Channel Divinity' } },
  'channel divinity: turn undead': { actions: [{ name: 'Turn Undead', group: 'action', res: 'Channel Divinity', use: 1, saveDc: '8+prof+mod.wis', saveAbility: 'WIS', notes: 'Undead within 30 ft are turned for 1 minute' }] },
  'channel divinity: preserve life': { actions: [{ name: 'Preserve Life', group: 'action', res: 'Channel Divinity', use: 1, dice: '[5*level.cleric]', dmgType: 'healing to split', notes: 'Divide among creatures within 30 ft (up to half their max HP)' }] },
  'disciple of life': { effects: [note('spellAttack', 'Disciple of Life: healing spells of 1st level+ heal an extra 2 + spell level')] },
  'divine strike|cleric': { toggle: T, effects: [{ ...fx('damage.weapon', 'dice', '1+(level.cleric>=14)'), die: 'd8' }] },
  // druid
  'wild shape': { uses: { max: '2+97*(level.druid>=20)', reset: 'short' }, actions: [{ group: 'action', use: 1, special: 'wildshape', notes: 'Transform into a beast (choose it after pressing Use)' }] },
  'wild companion': { actions: [{ group: 'action', res: 'Wild Shape', use: 1, notes: 'Cast Find Familiar without material components' }] },
  // bard
  'bardic inspiration': { uses: { max: 'max(1,mod.cha)', reset: 'long', shortIf: 'level.bard>=5', die: BI_DIE },
    actions: [{ group: 'bonus', use: 1, dice: BI_DIE, dmgType: 'inspiration die', notes: 'A creature within 60 ft gains the die for 10 minutes' }] },
  'cutting words': { actions: [{ group: 'reaction', res: 'Bardic Inspiration', use: 1, dice: BI_DIE, dmgType: 'subtracted', notes: "Subtract from a creature's attack, check or damage roll" }] },
  // sorcerer (Font of Magic also drives the slot ⇄ point converter in the Spells block)
  'font of magic': { uses: { max: 'level.sorcerer', reset: 'long', name: 'Sorcery Points' } },
  'elemental affinity': { effects: [note('damage.spell', 'Elemental Affinity: add CHA to damage of your ancestry type')] },
  'tides of chaos': { uses: { max: 1, reset: 'long' }, actions: [{ group: 'other', use: 1, notes: 'Advantage on one attack, check or save' }] },
  // warlock
  "dark one's blessing": { actions: [{ group: 'other', dice: '[max(1,mod.cha+level.warlock)]', dmgType: 'temporary HP', notes: 'When you reduce a hostile creature to 0 HP' }] },
  "dark one's own luck": { uses: { max: 1, reset: 'short' }, actions: [{ group: 'other', use: 1, dice: '1d10', dmgType: 'added to check/save' }] },
  'hex warrior': { toggle: T, effects: [fx('weapon.ability', 'set', 'cha', ['melee', 'oneHanded'])] },
  "hexblade's curse": { toggle: T, effects: [fx('damage.all', 'add', 'prof'), note('attack.all', "Hexblade's Curse: crit on 19–20 against the target")],
    uses: { max: 1, reset: 'short' }, actions: [{ group: 'bonus', use: 1, toggle: T, notes: '1 minute; regain HP when the target dies' }] },
  // wizard
  'arcane recovery': { uses: { max: 1, reset: 'long' }, actions: [{ group: 'other', use: 1, notes: 'During a short rest, recover spell slots totalling up to half your wizard level (max 5th)' }] },
  // ranger
  'colossus slayer': { toggle: T, effects: [fx('damage.weapon', 'add', '1d8')] },
  // artificer
  'flash of genius': { uses: { max: 'max(1,mod.int)', reset: 'long' }, actions: [{ group: 'reaction', use: 1, dice: '[mod.int]', dmgType: 'added to check/save' }] },
  // racial traits with uses
  'breath weapon': { uses: { max: 1, reset: 'short' }, actions: [{ group: 'action', use: 1, saveDc: '8+mod.con+prof', saveAbility: 'DEX or CON (ancestry)', dice: '[2+(level>=6)+(level>=11)+(level>=16)]d6' }] },
  'relentless endurance': { uses: { max: 1, reset: 'long' }, actions: [{ group: 'other', use: 1, notes: 'Drop to 1 HP instead of 0' }] },
  "stone's endurance": { uses: { max: 1, reset: 'short' }, actions: [{ group: 'reaction', use: 1, dice: '1d12+[mod.con]', dmgType: 'damage reduced' }] },
  'healing hands': { uses: { max: 1, reset: 'long' }, actions: [{ group: 'action', use: 1, dice: '[level]', dmgType: 'healing' }] },
  'lucky|feat': { uses: { max: 3, reset: 'long', name: 'Luck Points' }, actions: [{ group: 'other', use: 1, notes: 'Roll an extra d20 for an attack, check or save' }] },
  // bard
  'jack of all trades': { effects: [fx('check.all', 'add', 'floor(prof/2)', ['nonProficient'])] },
  // monk
  'unarmored defense|monk': { effects: [fx('acBase', 'add', '10+mod.dex+mod.wis', ['noArmor', 'noShield'])] },
  'unarmored movement': { effects: [fx('speed', 'add', '5*(1+floor((level.monk+2)/4))', ['noArmor', 'noShield'])] },
  'patient defense': { toggle: T, effects: [fx('save.dex', 'adv'), fx('ac', 'note', 'Attacks against you have disadvantage (Dodge)')],
    actions: [{ group: 'bonus', res: 'Ki Points', use: 1, toggle: T, notes: 'Dodge until your next turn' }] },
  // paladin
  'aura of protection': { effects: [fx('save.all', 'add', 'max(1,mod.cha)')] },
  'divine health': { effects: [fx('save.con', 'note', 'Immune to disease')] },
  // rogue
  'sneak attack': { toggle: T, effects: [fx('damage.weapon', 'dice', 'ceil(level.rogue/2)', ['finesseOrRanged'])].map(e => ({ ...e, die: 'd6' })) },
  'reliable talent': { effects: [fx('skill.all', 'note', 'Treat d20 rolls of 9 or lower as 10 when proficient')] },
  // sorcerer
  'draconic resilience': { effects: [fx('acBase', 'add', '13+mod.dex', ['noArmor']), fx('hpMax', 'add', 'level.sorcerer')] },
  // warlock invocations
  'agonizing blast': { effects: [fx('damage.spell', 'add', 'mod.cha', ['spell:eldritch blast'])] },
  'armor of shadows': { effects: [fx('acBase', 'add', '13+mod.dex', ['noArmor'])] },
  // wizard
  'bladesong': { toggle: T, uses: { max: 'prof', reset: 'long' }, actions: [{ group: 'bonus', use: 1, toggle: T, notes: '1 minute' }], effects: [fx('ac', 'add', 'max(1,mod.int)', ['lightOrNoArmor', 'noShield']), fx('speed', 'add', 10, ['lightOrNoArmor', 'noShield']), fx('skill.acrobatics', 'adv'), fx('save.con', 'note', '+INT mod to Constitution saves to keep concentration')] },
  // fighting styles
  'archery': { effects: [fx('attack.ranged', 'add', 2, ['weapon'])] },
  'defense': { effects: [fx('ac', 'add', 1, ['armor'])] },
  'unarmed fighting': { effects: [fx('weapon.die', 'set', 'd6', UNARMED), fx('weapon.die', 'set', 'd8', ['unarmed', 'noWeapon', 'noShield']),
    note('damage.weapon', 'Start of each turn: 1d4 bludgeoning to one creature you grapple', UNARMED)] },
  'tavern brawler': { effects: [fx('weapon.die', 'set', 'd4', UNARMED)] },
  'dragon hide': { effects: [...claws('d4', 'slashing').effects, fx('acBase', 'add', '13+mod.dex', ['noArmor'])] },
  'arms of the astral self': { toggle: T, effects: [fx('weapon.ability', 'set', 'wis', UNARMED), fx('weapon.die', 'set', MA_DIE, UNARMED), fx('weapon.dmgType', 'set', 'force', UNARMED)],
    actions: [{ group: 'bonus', res: 'Ki Points', use: 1, toggle: T, notes: '10 minutes; unarmed strikes reach +5 ft' }] },
  "cat's claws|vgm": claws('d4', 'slashing'), "cat's claws|mpmm": claws('d6', 'slashing'),
  'claws|ttp': claws('d4', 'slashing'), 'claws|mot': claws('d4', 'slashing'), 'claws|mpmm': claws('d6', 'slashing'),
  'talons|dmg': claws('d4', 'slashing'), 'talons|mpmm': claws('d6', 'slashing'),
  'hooves|ggr': claws('d4', 'bludgeoning'), 'hooves|mot': claws('d4', 'bludgeoning'), 'hooves|mpmm': claws('d6', 'bludgeoning'),
  'bite|dmg': claws('d4', 'piercing'), 'bite|vgm': claws('d6', 'piercing'), 'bite|mpmm': claws('d6', 'slashing'),
  'horns|ggr': claws('d6', 'piercing'), 'horns|mot': claws('d6', 'piercing'), 'horns|mpmm': claws('d6', 'piercing'),
  'ram|mot': claws('d4', 'bludgeoning'), 'ram|mpmm': claws('d6', 'bludgeoning'),
  'dueling': { effects: [fx('damage.melee', 'add', 2, ['weapon', 'oneHanded'])] },
  'great weapon fighting': { effects: [fx('damage.melee', 'note', 'Reroll 1s and 2s on damage dice (two-handed/versatile)')] },
  'protection': { effects: [fx('ac', 'note', 'Reaction: impose disadvantage on an attack against an adjacent ally (needs shield)')] },
  // feats
  'alert': { effects: [fx('initiative', 'add', 5)] },
  'tough': { effects: [fx('hpMax', 'add', '2*level')] },
  'mobile': { effects: [fx('speed', 'add', 10)] },
  'observant': { effects: [fx('passive.perception', 'add', 5), fx('passive.investigation', 'add', 5)] },
  'sharpshooter': { toggle: T, effects: [fx('attack.ranged', 'add', -5, ['weapon']), fx('damage.ranged', 'add', 10, ['weapon'])] },
  'great weapon master': { toggle: T, effects: [fx('attack.melee', 'add', -5, ['heavyWeapon']), fx('damage.melee', 'add', 10, ['heavyWeapon'])] },
  'war caster': { effects: [fx('save.con', 'note', 'Advantage on Constitution saves to maintain concentration')] },
  'dual wielder': { toggle: T, effects: [fx('ac', 'add', 1)] },
  'medium armor master': { effects: [fx('ac', 'note', 'Max DEX bonus with medium armor is 3 — add +1 via override if applicable')] },
  // racial traits
  'dwarven toughness': { effects: [fx('hpMax', 'add', 'level')] },
  'dwarven resilience': { effects: [fx('save.con', 'note', 'Advantage on saves against poison')] },
  'fey ancestry': { effects: [fx('save.wis', 'note', 'Advantage on saves against being charmed')] },
  'brave': { effects: [fx('save.wis', 'note', 'Advantage on saves against being frightened')] },
  'lucky': { effects: [fx('check.all', 'note', 'Reroll natural 1s on attacks, checks and saves')] },
  'gnome cunning': { effects: [fx('save.int', 'note', 'Advantage on INT/WIS/CHA saves against magic'), fx('save.wis', 'note', 'Advantage against magic'), fx('save.cha', 'note', 'Advantage against magic')] },
  'natural armor': { effects: [fx('acBase', 'add', '13+mod.dex', ['noArmor'])] },
};

export const SPELLS = {
  'shield': { toggle: T, effects: [fx('ac', 'add', 5)] },
  'mage armor': { toggle: T, effects: [fx('acBase', 'add', '13+mod.dex', ['noArmor'])] },
  'shield of faith': { toggle: T, effects: [fx('ac', 'add', 2)] },
  'haste': { toggle: T, effects: [fx('ac', 'add', 2), fx('speed', 'mul', 2), fx('save.dex', 'adv')] },
  'barkskin': { toggle: T, effects: [fx('ac', 'min', 16)] },
  'longstrider': { toggle: T, effects: [fx('speed', 'add', 10)] },
  'bless': { toggle: T, effects: [fx('attack.all', 'add', '1d4'), fx('save.all', 'add', '1d4')] },
  'guidance': { toggle: T, effects: [fx('check.all', 'add', '1d4')] },
  'resistance': { toggle: T, effects: [fx('save.all', 'add', '1d4')] },
  'hunter\'s mark': { toggle: T, effects: [fx('damage.weapon', 'add', '1d6')] },
  'hex': { toggle: T, effects: [fx('damage.all', 'add', '1d6')] },
  'divine favor': { toggle: T, effects: [fx('damage.weapon', 'add', '1d4')] },
  'magic weapon': { toggle: T, effects: [fx('attack.weapon', 'add', 1), fx('damage.weapon', 'add', 1)] },
  'alter self': { toggle: T, effects: [fx('weapon.die', 'set', 'd6', UNARMED), ...plus(1), note('damage.weapon', 'Natural Weapons form; magical', UNARMED)] },
  'shillelagh': { toggle: T, effects: [fx('weapon.ability', 'set', 'spell', STAFF), fx('weapon.die', 'set', 'd8', STAFF), note('damage.weapon', 'Magical', STAFF)] },
  'elemental weapon': { toggle: T, effects: [fx('attack.weapon', 'add', 1), fx('damage.weapon', 'add', '1d4'), note('damage.weapon', 'Extra 1d4 is the chosen element')] },
  'holy weapon': { toggle: T, effects: [fx('damage.weapon', 'add', '2d8'), note('damage.weapon', 'Extra 2d8 radiant')] },
  'crusader\'s mantle': { toggle: T, effects: [fx('damage.weapon', 'add', '1d4'), note('damage.weapon', 'Extra 1d4 radiant')] },
  'spirit shroud': { toggle: T, effects: [fx('damage.all', 'add', '1d8'), note('damage.all', 'Targets within 10 ft; extra 1d8 radiant, necrotic or cold')] },
  'flame arrows': { toggle: T, effects: [fx('damage.ranged', 'add', '1d6', ['weapon']), note('damage.ranged', 'Extra 1d6 fire', ['weapon'])] },
  // smites: switch on after casting, off after the hit
  'searing smite': { toggle: T, effects: [fx('damage.melee', 'add', '1d6', ['weapon'])] },
  'thunderous smite': { toggle: T, effects: [fx('damage.melee', 'add', '2d6', ['weapon'])] },
  'wrathful smite': { toggle: T, effects: [fx('damage.melee', 'add', '1d6', ['weapon'])] },
  'branding smite': { toggle: T, effects: [fx('damage.weapon', 'add', '2d6')] },
  'blinding smite': { toggle: T, effects: [fx('damage.melee', 'add', '3d8', ['weapon'])] },
  'staggering smite': { toggle: T, effects: [fx('damage.melee', 'add', '4d6', ['weapon'])] },
  'aid': { toggle: T, effects: [fx('hpMax', 'add', 5)] },
  'enhance ability': { toggle: T, effects: [fx('check.all', 'note', 'Advantage on checks with the chosen ability')] },
  'enlarge/reduce': { toggle: T, effects: [fx('damage.weapon', 'add', '1d4'), fx('check.str', 'adv'), fx('save.str', 'adv')] },
  'blur': { toggle: T, effects: [fx('ac', 'note', 'Attacks against you have disadvantage')] },
  'mirror image': { toggle: T, effects: [fx('ac', 'note', 'Duplicates may absorb attacks')] },
  'protection from evil and good': { toggle: T, effects: [fx('ac', 'note', 'Aberrations, celestials, elementals, fey, fiends and undead have disadvantage to hit you')] },
  'heroism': { toggle: T, effects: [fx('save.wis', 'note', 'Immune to frightened; temp HP each turn')] },
};

export const ITEMS = {
  // item presets add to the bonuses read from the item's data; replace: true swaps them out instead
  'bracers of defense': { replace: T, effects: [fx('ac', 'add', 2, ['noArmor', 'noShield'])] },
  'demon armor': { effects: [...claws('d8', 'slashing').effects, ...plus(1)] },
  'eldritch claw tattoo': { effects: plus(1) }, 'insignia of claws': { effects: plus(1) },
  '+1 wraps of unarmed prowess': { effects: plus(1) }, '+2 wraps of unarmed prowess': { effects: plus(2) }, '+3 wraps of unarmed prowess': { effects: plus(3) },
};

export const CONDITIONS = {
  'blinded': { effects: [fx('attack.all', 'dis'), fx('ac', 'note', 'Attacks against you have advantage')] },
  'charmed': { effects: [fx('check.all', 'note', 'Charmer has advantage on social checks against you')] },
  'deafened': { effects: [fx('check.all', 'note', 'Fail checks that require hearing')] },
  'frightened': { effects: [fx('attack.all', 'dis'), fx('check.all', 'dis')] },
  'grappled': { effects: [fx('speed', 'set', 0)] },
  'incapacitated': { effects: [fx('ac', 'note', 'No actions or reactions')] },
  'invisible': { effects: [fx('attack.all', 'adv'), fx('ac', 'note', 'Attacks against you have disadvantage')] },
  'paralyzed': { effects: [fx('speed', 'set', 0), fx('save.str', 'note', 'Auto-fail'), fx('save.dex', 'note', 'Auto-fail')] },
  'petrified': { effects: [fx('speed', 'set', 0), fx('save.str', 'note', 'Auto-fail'), fx('save.dex', 'note', 'Auto-fail')] },
  'poisoned': { effects: [fx('attack.all', 'dis'), fx('check.all', 'dis')] },
  'prone': { effects: [fx('attack.all', 'dis'), fx('speed', 'note', 'Crawling costs double; standing costs half your speed')] },
  'restrained': { effects: [fx('speed', 'set', 0), fx('attack.all', 'dis'), fx('save.dex', 'dis')] },
  'stunned': { effects: [fx('speed', 'set', 0), fx('save.str', 'note', 'Auto-fail'), fx('save.dex', 'note', 'Auto-fail')] },
  'unconscious': { effects: [fx('speed', 'set', 0), fx('save.str', 'note', 'Auto-fail'), fx('save.dex', 'note', 'Auto-fail')] },
};
