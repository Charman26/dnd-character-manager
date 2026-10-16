// Regenerates examples/*.json (the "Load example characters" set).
// Run: RULES_REPO=https://github.com/owner/repo npm run examples   (downloads the rules data, then fails on any name that is not in it)
import { writeFileSync } from 'node:fs';
import { downloadRules, setRules, find, list } from '../data.js';
if (!process.env.RULES_REPO) throw Error('set RULES_REPO to the GitHub link of the rules data repository');
setRules(await downloadRules(process.env.RULES_REPO));
const OUT = new URL('../examples/', import.meta.url);
const must = (cat, name, src) => { const x = find(cat, name, src); if (!x || x.name.toLowerCase() !== name.toLowerCase()) throw Error(`${cat} not found: ${name}`); return { name: x.name, source: x.source }; };
let n = 0; const id = () => `ex${++n}`;
const item = (name, extra = {}) => ({ id: id(), qty: 1, equipped: false, attuned: false, ...(find('item', name) ? must('item', name) : must('baseitem', name)), ...extra });
const spell = (name, cls, prepared = true) => ({ ...must('spell', name), cls, prepared });
const sub = (cls, name) => { const s = list('subclass').find(x => x.className === cls && x.name === name && x.classSource === 'PHB'); if (!s) throw Error('subclass ' + name); return { name: s.name, source: s.source }; };
const opt = name => { const o = must('optionalfeature', name); return `${o.name}|${o.source}`; };
const base = (o) => ({
  setupDone: true, profV: 2, abilityMethod: 'manual', abilityAssign: {}, rolledPool: null, abilityChoices: {}, asiBonuses: {}, skillProfs: {}, saveProfs: {},
  extraProfs: { armor: [], weapon: [], tool: [], lang: [] }, hp: { current: null, temp: 0 }, hitDiceUsed: {}, deathSaves: { s: 0, f: 0 }, inspiration: false,
  exhaustion: 0, conditions: [], activeToggles: [], customEffects: {}, customSources: [], concentration: null, spells: [], slotsUsed: [], pactUsed: 0,
  inventory: [], currency: { pp: 0, gp: 15, ep: 0, sp: 0, cp: 0 }, feats: [], optionalFeatures: [], resources: [], profChoices: {}, featureChoices: {},
  featureUses: {}, actionSlots: {}, shape: null, companions: [], overrides: {}, alignment: '', xp: 0,
  notes: { personality: '', ideals: '', bonds: '', flaws: '', backstory: '', other: '' }, ...o,
});
const cls = (name, level, subclass) => ({ ...must('class', name, 'PHB'), level, hpRolls: [], subclass: subclass ? sub(name, subclass) : null });
const weaponAct = (inv) => ({ id: id(), kind: 'weapon', ref: inv.id, group: 'action', ability: 'auto', prof: 'auto' });
const spellAct = (name, c, slot) => ({ id: id(), kind: 'spell', ref: must('spell', name), cls: c, slot: slot ?? find('spell', name).level });
const unarmed = () => ({ id: id(), kind: 'custom', name: 'Unarmed Strike', group: 'action', ability: 'str', prof: true, addMod: true, unarmed: true, dmgType: 'bludgeoning' });

const chars = [];

// 1. Barbarian — Totem Warrior (Bear spirit, Elk aspect): rage uses + toggle, totem effects while raging
{
  const axe = item('Greataxe', { equipped: true }), jav = item('Javelin', { qty: 4 });
  chars.push(base({ id: 'example-barbarian', name: 'Thorgar Bonebreaker', race: must('race', 'Half-Orc', 'PHB'), background: must('background', 'Outlander', 'PHB'),
    alignment: 'Chaotic good', classes: [cls('Barbarian', 6, 'Path of the Totem Warrior')], baseScores: { str: 15, dex: 14, con: 14, int: 8, wis: 12, cha: 10 },
    asiBonuses: { str: 2 }, profChoices: { 'skill:class': ['perception', 'animal handling'], 'lang:background': ['giant'] },
    featureChoices: { 'fo:sf:Totem Warrior:Totem Spirit:3': ['Bear'], 'fo:sf:Totem Warrior:Aspect of the Beast:6': ['Elk'] },
    inventory: [axe, jav, item('Backpack'), item('Bedroll')], actions: [weaponAct(axe), weaponAct(jav), unarmed()],
    notes: { personality: 'Shows his scars with pride; speaks to the bear spirit before every fight.', ideals: '', bonds: '', flaws: '', backstory: 'Raised among the northern clans after his village fell.', other: 'Showcase: Rage (bonus action, uses), Bear totem resistance and Elk aspect via Choices, Relentless Endurance, Extra Attack.' } }));
}
// 2. Druid — Circle of the Moon, currently wild-shaped into a Brown Bear
{
  const sc = item('Scimitar', { equipped: true }), qs = item('Quarterstaff');
  chars.push(base({ id: 'example-druid', name: 'Willow Thornsong', race: must('race', 'Elf', 'PHB'), subrace: { name: 'Wood', source: 'PHB' }, background: must('background', 'Hermit', 'PHB'),
    alignment: 'Neutral good', classes: [cls('Druid', 6, 'Circle of the Moon')], baseScores: { str: 10, dex: 14, con: 14, int: 12, wis: 15, cha: 8 }, asiBonuses: { wis: 2 },
    profChoices: { 'skill:class': ['nature', 'perception'], 'lang:background': ['gnomish'] },
    inventory: [sc, qs, item('Leather Armor', { equipped: true }), item('Shield', { equipped: true }), item('Herbalism Kit')],
    spells: ['Shillelagh', 'Produce Flame', 'Guidance', 'Healing Word', 'Entangle', 'Moonbeam', 'Call Lightning', 'Conjure Animals', 'Thunderwave'].map(s => spell(s, 'Druid')),
    actions: [weaponAct(sc), weaponAct(qs), spellAct('Produce Flame', 'Druid')], shape: { name: 'Brown Bear', source: 'MM', hp: 34, max: 34 }, featureUses: { 'f:Wild Shape': 1 },
    notes: { personality: 'Prefers the company of bears to people.', ideals: '', bonds: '', flaws: '', backstory: '', other: 'Showcase: Wild Shape (Moon druid: CR 2 beasts, bonus action), beast HP pool, physical stats and attacks replaced; press Revert. Toggle Shillelagh: the Quarterstaff action switches to WIS and a d8.' } }));
}
// 3. Monk — Way of the Open Hand: ki pool, martial arts die, flurry, stunning strike
{
  const ss = item('Shortsword', { equipped: true }), darts = item('Dart', { qty: 10 });
  chars.push(base({ id: 'example-monk', name: 'Kael Windstep', race: must('race', 'Human', 'PHB'), subrace: { name: '', source: 'PHB' }, background: must('background', 'Hermit', 'PHB'),
    alignment: 'Lawful neutral', classes: [cls('Monk', 5, 'Way of the Open Hand')], baseScores: { str: 11, dex: 16, con: 13, int: 11, wis: 15, cha: 9 }, asiBonuses: { dex: 2 },
    profChoices: { 'skill:class': ['acrobatics', 'insight'], 'tool:class': ['flute'], 'lang:race': ['elvish'], 'lang:background': ['dwarvish'] },
    inventory: [ss, darts], actions: [weaponAct(ss), weaponAct(darts), unarmed()],
    notes: { personality: '', ideals: 'Balance in all things.', bonds: '', flaws: '', backstory: '', other: 'Showcase: Ki Points, Martial Arts strike (d6 at 5th, uses DEX), Flurry of Blows / Patient Defense / Step of the Wind / Stunning Strike (DC from WIS).' } }));
}
// 4. Paladin — Oath of Devotion dragonborn: smite with slot picker, lay on hands pool, sacred weapon, oath spells, breath weapon
{
  const ls = item('Longsword', { equipped: true });
  chars.push(base({ id: 'example-paladin', name: 'Seraphine Vale', race: must('race', 'Dragonborn', 'PHB'), background: must('background', 'Acolyte', 'PHB'),
    alignment: 'Lawful good', classes: [cls('Paladin', 5, 'Oath of Devotion')], baseScores: { str: 15, dex: 10, con: 14, int: 8, wis: 12, cha: 13 }, asiBonuses: { str: 1, cha: 1 },
    profChoices: { 'skill:class': ['athletics', 'persuasion'], 'lang:background': ['halfling', 'dwarvish'] },
    featureChoices: { 'of:Paladin:cls:Fighting Style': [opt('Defense')] },
    inventory: [ls, item('Shield', { equipped: true }), item('Chain Mail', { equipped: true }), item('Javelin', { qty: 5 })],
    spells: ['Bless', 'Cure Wounds', 'Shield of Faith', 'Aid'].map(s => spell(s, 'Paladin')), actions: [weaponAct(ls)],
    notes: { personality: '', ideals: 'Honor.', bonds: '', flaws: '', backstory: '', other: 'Showcase: Divine Smite (pick slot, spends it), Lay on Hands pool (25), Sacred Weapon toggle via Channel Divinity, Oath spells always prepared, Breath Weapon, Defense style via Choices.' } }));
}
// 5. Warlock — The Fiend, Pact of the Chain with an imp familiar, invocations, tiefling innate spells
{
  chars.push(base({ id: 'example-warlock', name: 'Mirela Ashgrave', race: must('race', 'Tiefling', 'PHB'), background: must('background', 'Charlatan', 'PHB'),
    alignment: 'Chaotic neutral', classes: [cls('Warlock', 5, 'The Fiend')], baseScores: { str: 8, dex: 14, con: 14, int: 12, wis: 10, cha: 15 }, asiBonuses: { cha: 2 },
    profChoices: { 'skill:class': ['arcana', 'intimidation'] },
    featureChoices: { 'of:Warlock:cls:Eldritch Invocations': [opt('Agonizing Blast'), opt("Devil's Sight"), opt('Mask of Many Faces')], 'of:Warlock:cls:Pact Boon': [opt('Pact of the Chain')] },
    inventory: [item('Dagger', { qty: 2 }), item('Leather Armor', { equipped: true })],
    spells: ['Eldritch Blast', 'Mage Hand', 'Minor Illusion', 'Hex', 'Armor of Agathys', 'Hold Person', 'Misty Step', 'Fireball', 'Find Familiar'].map(s => spell(s, 'Warlock')),
    actions: [spellAct('Eldritch Blast', 'Warlock'), spellAct('Fireball', 'Warlock', 3)], companions: [{ id: id(), ...must('monster', 'Imp'), hp: 10, max: 10, nick: 'Sizzle' }],
    notes: { personality: '', ideals: '', bonds: 'Sizzle the imp never leaves my shoulder.', flaws: '', backstory: '', other: 'Showcase: invocations and pact boon via Choices (Agonizing Blast adds CHA to Eldritch Blast), Hex toggle, tiefling innate spells, imp familiar in Companions, pact slots.' } }));
}
// 6. Cleric — Life Domain hill dwarf: domain spells, channel divinity turn undead / preserve life
{
  const mace = item('Mace', { equipped: true });
  chars.push(base({ id: 'example-cleric', name: 'Brother Aldric', race: must('race', 'Dwarf', 'PHB'), subrace: { name: 'Hill', source: 'PHB' }, background: must('background', 'Acolyte', 'PHB'),
    alignment: 'Lawful good', classes: [cls('Cleric', 5, 'Life Domain')], baseScores: { str: 14, dex: 8, con: 15, int: 10, wis: 15, cha: 12 }, asiBonuses: { wis: 2 },
    profChoices: { 'skill:class': ['medicine', 'history'], 'lang:background': ['elvish', 'halfling'], 'tool:race': ["smith's tools"] },
    inventory: [mace, item('Shield', { equipped: true }), item('Chain Mail', { equipped: true }), item('Holy Water (flask)', { qty: 2 })],
    spells: ['Guidance', 'Sacred Flame', 'Spare the Dying', 'Healing Word', 'Guiding Bolt', 'Prayer of Healing', 'Spirit Guardians', 'Mass Healing Word'].map(s => spell(s, 'Cleric')),
    actions: [weaponAct(mace), spellAct('Sacred Flame', 'Cleric'), spellAct('Guiding Bolt', 'Cleric')],
    notes: { personality: '', ideals: '', bonds: '', flaws: '', backstory: '', other: 'Showcase: Life domain spells always prepared (★), Channel Divinity (Turn Undead DC, Preserve Life 25 HP), Disciple of Life note, Dwarven Toughness HP.' } }));
}
// 7. Fighter — Battle Master: superiority dice, maneuvers, action surge, second wind, extra attack
{
  const gs = item('Greatsword', { equipped: true }), bow = item('Longbow'), arrows = item('Arrow', { qty: 20 });
  chars.push(base({ id: 'example-fighter', name: 'Rhea Ironclad', race: must('race', 'Human', 'PHB'), subrace: { name: '', source: 'PHB' }, background: must('background', 'Soldier', 'PHB'),
    alignment: 'Lawful neutral', classes: [cls('Fighter', 5, 'Battle Master')], baseScores: { str: 16, dex: 14, con: 15, int: 11, wis: 11, cha: 9 }, asiBonuses: { str: 2 },
    profChoices: { 'skill:class': ['perception', 'survival'], 'lang:race': ['orc'], 'tool:background': ['dice set'], 'tool:sub': ["smith's tools"] },
    featureChoices: { 'of:Fighter:cls:Fighting Style': [opt('Great Weapon Fighting')], 'of:Fighter:sub:Maneuvers': [opt('Riposte'), opt('Trip Attack'), opt('Precision Attack')] },
    inventory: [gs, bow, arrows, item('Chain Mail', { equipped: true })], actions: [weaponAct(gs), weaponAct(bow), unarmed()],
    notes: { personality: '', ideals: '', bonds: '', flaws: '', backstory: '', other: 'Showcase: Extra Attack (2 attacks), Second Wind (heals 1d10+5), Action Surge, Superiority Dice d8 with maneuver DC, three maneuvers via Choices.' } }));
}
// 8. Bard — College of Lore halfling: bardic inspiration (short rest at 5), cutting words
{
  const rapier = item('Rapier', { equipped: true });
  chars.push(base({ id: 'example-bard', name: 'Lyra Quickstring', race: must('race', 'Halfling', 'PHB'), subrace: { name: 'Lightfoot', source: 'PHB' }, background: must('background', 'Entertainer', 'PHB'),
    alignment: 'Chaotic good', classes: [cls('Bard', 5, 'College of Lore')], baseScores: { str: 8, dex: 14, con: 13, int: 12, wis: 10, cha: 15 }, asiBonuses: { cha: 2 },
    profChoices: { 'skill:class': ['persuasion', 'deception', 'insight'], 'skill:sub': ['arcana', 'history', 'investigation'], 'tool:class': ['lute', 'flute', 'drum'], 'tool:background': ['viol'],
      'expertise:cf:Bard:Expertise:3': ['persuasion', 'performance'] },
    inventory: [rapier, item('Leather Armor', { equipped: true }), item('Lute')],
    spells: ['Vicious Mockery', 'Minor Illusion', 'Healing Word', 'Dissonant Whispers', 'Faerie Fire', 'Shatter', 'Invisibility', 'Hypnotic Pattern'].map(s => spell(s, 'Bard')),
    actions: [weaponAct(rapier), spellAct('Vicious Mockery', 'Bard')],
    notes: { personality: '', ideals: '', bonds: '', flaws: '', backstory: '', other: 'Showcase: Bardic Inspiration d8 (recharges on short rest from 5th), Cutting Words reaction, Jack of All Trades, Expertise picks.' } }));
}
// 9. Sorcerer — Draconic Bloodline: draconic resilience AC, font of magic slot/point conversion, metamagic
{
  chars.push(base({ id: 'example-sorcerer', name: 'Ember Kastor', race: must('race', 'Half-Elf', 'PHB'), background: must('background', 'Noble', 'PHB'),
    alignment: 'Neutral', classes: [cls('Sorcerer', 5, 'Draconic Bloodline')], baseScores: { str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 15 }, asiBonuses: { cha: 2 },
    abilityChoices: { race: ['con', 'dex'] }, profChoices: { 'skill:class': ['arcana', 'intimidation'], 'skill:race': ['perception', 'insight'], 'lang:race': ['draconic'], 'lang:background': ['dwarvish'], 'tool:background': ['dragonchess set'] },
    featureChoices: { 'of:Sorcerer:cls:Metamagic': [opt('Quickened Spell'), opt('Twinned Spell')] },
    inventory: [item('Dagger', { qty: 2 }), item('Quarterstaff')],
    spells: ['Fire Bolt', 'Mage Hand', 'Prestidigitation', 'Light', 'Shield', 'Magic Missile', 'Scorching Ray', 'Fireball'].map(s => spell(s, 'Sorcerer')),
    actions: [spellAct('Fire Bolt', 'Sorcerer'), spellAct('Fireball', 'Sorcerer', 3)], slotsUsed: [1, 1],
    notes: { personality: '', ideals: '', bonds: '', flaws: '', backstory: '', other: 'Showcase: Draconic Resilience (AC 13+DEX, +1 HP/level), Font of Magic converter in Spellcasting (create slots / slots to points), Metamagic via Choices, Shield toggle.' } }));
}

for (const c of chars) writeFileSync(new URL(`${c.id.replace('example-', '')}.json`, OUT), JSON.stringify(c, null, 2) + '\n');
writeFileSync(new URL('index.json', OUT), JSON.stringify(chars.map(c => `${c.id.replace('example-', '')}.json`), null, 2) + '\n');
console.log('wrote', chars.map(c => c.name).join(', '));
