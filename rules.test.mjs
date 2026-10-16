// Run: node rules.test.mjs
import assert from 'node:assert/strict';
import * as P from './effects.js';
import { tags, entries } from './data.js';
import { mod, profBonus, evalFormula, parseDice, roll, mergeDice, spellSlots, computeCharacter, gatherEffects, computeAction, dmgExpr } from './rules.js';

assert.equal(mod(10), 0); assert.equal(mod(17), 3); assert.equal(mod(8), -1);
assert.deepEqual([1, 4, 5, 9, 13, 17, 20].map(profBonus), [2, 2, 3, 4, 5, 6, 6]);

assert.equal(evalFormula('10+mod.dex+mod.con', { 'mod.dex': 2, 'mod.con': 3 }), 15);
assert.equal(evalFormula('2+(level.barbarian>=9)+(level.barbarian>=16)', { 'level.barbarian': 9 }), 3);
assert.equal(evalFormula('max(1,mod.int)', { 'mod.int': -1 }), 1);
assert.throws(() => evalFormula('alert(1)', {}));
assert.throws(() => evalFormula('"x"', {}));

assert.deepEqual(parseDice('2d6+1d4-1'), [{ sign: 1, n: 2, f: 6 }, { sign: 1, n: 1, f: 4 }, { sign: -1, flat: 1 }]);
const fixed = () => 0.999; // every die rolls max
assert.equal(roll('2d6+3', {}, fixed).total, 15);
assert.equal(roll('1d8+2', { crit: true }, fixed).total, 18);
assert.equal(roll('1d20+5', { adv: true }, fixed).d20, 20);
assert.equal(mergeDice(['8d6', '1d6', '1d6']), '10d6');

// slots: single class, half/third casters round up; multiclass sums
assert.deepEqual(spellSlots([{ prog: 'full', level: 3 }]).slots, [4, 2]);
assert.deepEqual(spellSlots([{ prog: '1/2', level: 1 }]).slots, []);
assert.deepEqual(spellSlots([{ prog: '1/2', level: 5 }]).slots, [4, 2]);
assert.deepEqual(spellSlots([{ prog: '1/3', level: 7 }]).slots, [4, 2]);
assert.deepEqual(spellSlots([{ prog: 'full', level: 3 }, { prog: '1/2', level: 3 }]).slots, [4, 3]); // CL 4
assert.deepEqual(spellSlots([{ prog: 'pact', level: 5 }]).pact, { n: 2, level: 3 });

// --- Wizard 3 (Bladesinging), High Elf, DEX 16 INT 17 ---
const wizard = { name: 'Wizard', source: 'PHB', hd: { faces: 6 }, proficiency: ['int', 'wis'], casterProgression: 'full', spellcastingAbility: 'int', preparedSpells: '<$level$> + <$int_mod$>', cantripProgression: [3, 3, 3] };
const elf = { name: 'Elf', source: 'PHB', ability: [{ dex: 2 }], speed: 30 };
const high = { name: 'High', source: 'PHB', ability: [{ int: 1 }] };
const c = {
  baseScores: { str: 8, dex: 14, con: 14, int: 16, wis: 12, cha: 10 }, skillProfs: { acrobatics: 1 }, overrides: {},
  activeToggles: [], customEffects: {}, conditions: [], exhaustion: 0, inventory: [],
};
const ring = { inv: { id: 'r', equipped: true, attuned: true }, data: { name: 'Ring of Protection', reqAttune: true, bonusAc: '+1', bonusSavingThrow: '+1' } };
const R = {
  race: elf, subrace: high, classes: [{ cls: wizard, level: 3, hpRolls: [] }], items: [], feats: [],
  sources: [{ key: 'sf:bladesong', name: 'Bladesong', kind: 'feature' }],
};
const sheet = () => computeCharacter(c, R, gatherEffects(c, R, P));

let s = sheet();
assert.equal(s.scores.dex, 16); assert.equal(s.scores.int, 17);
assert.deepEqual(s.slots, [4, 2]);
assert.equal(s.stats.ac.total, 13);
assert.equal(s.stats.ac.parts.reduce((a, p) => a + p.value, 0), 13, 'breakdown sums to total');
assert.equal(s.stats['spellDc.Wizard'].total, 13);
assert.equal(s.spellcasting[0].prepared, 6);
assert.equal(s.stats.hpMax.total, 6 + 4 + 4 + 2 * 3);
assert.equal(s.stats.speed.total, 30);

c.activeToggles = ['sf:bladesong'];
s = sheet();
assert.equal(s.stats.ac.total, 16);
assert.equal(s.stats.speed.total, 40);
assert.ok(s.stats['skill.acrobatics'].adv.includes('Bladesong'));
assert.ok(s.stats.ac.parts.some(p => p.label === 'Bladesong' && p.value === 3));

R.items = [ring];
s = sheet();
assert.equal(s.stats.ac.total, 17);
assert.equal(s.stats['save.int'].total, 3 + 2 + 1);

const firebolt = { name: 'Fire Bolt', level: 0, spellAttack: ['R'], damageInflict: ['fire'], time: [{ unit: 'action' }], range: { distance: { type: 'feet', amount: 120 } }, scalingLevelDice: { scaling: { 1: '1d10', 5: '2d10', 11: '3d10', 17: '4d10' } } };
let a = computeAction({ id: 1, kind: 'spell', cls: 'Wizard' }, { sheet: s, R, c, data: firebolt });
assert.equal(a.hit.total, 5); assert.equal(dmgExpr(a.dmg), '1d10'); assert.equal(a.range, '120 ft');

const fireball = { name: 'Fireball', level: 3, savingThrow: ['dexterity'], entries: ['take {@damage 8d6} fire damage'], entriesHigherLevel: [{ entries: ['increases by {@scaledamage 8d6|3-9|1d6} for each'] }] };
a = computeAction({ id: 2, kind: 'spell', cls: 'Wizard', slot: 5 }, { sheet: s, R, c, data: fireball });
assert.equal(dmgExpr(a.dmg), '10d6'); assert.equal(a.save.dc, 13);

// --- Multiclass Fighter 2 / Wizard 3; Defense only in armor ---
const fighter = { name: 'Fighter', source: 'PHB', hd: { faces: 10 }, proficiency: ['str', 'con'] };
const chain = { inv: { id: 'm', equipped: true }, data: { name: 'Chain Mail', type: 'HA', ac: 16, strength: '13' } };
const mc = { ...c, activeToggles: [] };
const R2 = { ...R, items: [], classes: [{ cls: fighter, level: 2 }, { cls: wizard, level: 3 }], sources: [{ key: 'opt:defense', name: 'Defense', kind: 'feature' }] };
s = computeCharacter(mc, R2, gatherEffects(mc, R2, P));
assert.deepEqual(s.slots, [4, 2]);
assert.equal(s.stats.ac.total, 13);
R2.items = [chain];
s = computeCharacter(mc, R2, gatherEffects(mc, R2, P));
assert.equal(s.stats.ac.total, 17);
assert.equal(s.stats.speed.total, 20, 'STR 8 < 13 in chain mail');

// --- Barbarian: Rage damage, Unarmored Defense beats leather ---
const barb = { name: 'Barbarian', source: 'PHB', hd: { faces: 12 }, proficiency: ['str', 'con'], startingProficiencies: { weapons: ['simple', 'martial'], armorProficiencies: [{ light: true, medium: true, shield: true }] } };
const bc = { ...c, baseScores: { str: 16, dex: 14, con: 16, int: 8, wis: 10, cha: 10 }, activeToggles: [] };
const axe = { inv: { id: 'g', equipped: true }, data: { name: 'Greataxe', type: 'M', weaponCategory: 'martial', property: ['H', '2H'], dmg1: '1d12', dmgType: 'S' } };
const R3 = {
  race: { name: 'Human', ability: [{ str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }], speed: 30 }, subrace: null, feats: [],
  classes: [{ cls: barb, level: 3 }], items: [axe],
  sources: [{ key: 'cf:rage', name: 'Rage', kind: 'feature' }, { key: 'cf:ud', name: 'Unarmored Defense', kind: 'feature', cls: 'Barbarian' }],
};
s = computeCharacter(bc, R3, gatherEffects(bc, R3, P));
assert.equal(s.stats.ac.total, 10 + 2 + 3);
a = computeAction({ id: 3, kind: 'weapon', ref: 'g' }, { sheet: s, R: R3, c: bc, data: axe.data });
assert.equal(a.hit.total, 3 + 2); assert.equal(dmgExpr(a.dmg), '1d12+3');
bc.activeToggles = ['cf:rage'];
s = computeCharacter(bc, R3, gatherEffects(bc, R3, P));
a = computeAction({ id: 3, kind: 'weapon', ref: 'g' }, { sheet: s, R: R3, c: bc, data: axe.data });
assert.equal(dmgExpr(a.dmg), '1d12+5');
assert.ok(s.stats['save.str'].adv.length);

// overrides and exhaustion
bc.overrides = { ac: 20 }; bc.exhaustion = 2;
s = computeCharacter(bc, R3, gatherEffects(bc, R3, P));
assert.equal(s.stats.ac.total, 20); assert.equal(s.stats.speed.total, 15);

// --- derived proficiencies: granted by sources, labelled, removed with the source ---
const sage = { name: 'Sage', skillProficiencies: [{ arcana: true, history: true }] };
const rogue = { name: 'Rogue', hd: { faces: 8 }, proficiency: ['dex', 'int'], startingProficiencies: { skills: [{ choose: { from: ['stealth', 'acrobatics', 'perception'], count: 2 } }] } };
const skilled = { name: 'Skilled', skillToolLanguageProficiencies: [{ choose: [{ from: ['anySkill', 'anyTool'], count: 3 }] }] };
const resilient = { name: 'Resilient', savingThrowProficiencies: [{ choose: { from: ['str', 'dex', 'con', 'int', 'wis', 'cha'] } }] };
const pc = { baseScores: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 }, skillProfs: {}, overrides: {}, activeToggles: [], conditions: [], exhaustion: 0,
  profChoices: { 'skill:class': ['stealth', 'perception'], 'skill:feat:skilled': ['medicine', 'religion', 'nature'], 'save:feat:resilient': ['con'],
    'expertise:cf:Rogue:Expertise:1': ['stealth', 'arcana'] } };
const R4 = { race: null, subrace: null, background: sage, classes: [{ cls: rogue, level: 1 }], items: [],
  feats: [{ key: 'feat:skilled', data: skilled }, { key: 'feat:resilient', data: resilient }],
  sources: [{ key: 'cf:Rogue:Expertise:1', name: 'Expertise', kind: 'feature', cls: 'Rogue', level: 1 }] };
s = computeCharacter(pc, R4, gatherEffects(pc, R4, P));
assert.equal(s.stats['skill.history'].total, 2); assert.ok(s.stats['skill.history'].parts.some(p => p.label === 'Proficiency (Sage)'));
assert.equal(s.stats['skill.perception'].proficient, 1);
assert.equal(s.stats['skill.medicine'].proficient, 1);
assert.equal(s.stats['skill.stealth'].proficient, 2); assert.ok(s.stats['skill.stealth'].parts.some(p => p.label.startsWith('Expertise (Rogue Expertise')));
assert.equal(s.stats['save.con'].proficient, true); assert.ok(s.stats['save.con'].parts.some(p => p.label === 'Proficiency (Resilient)'));
assert.ok(s.stats['save.dex'].parts.some(p => p.label === 'Proficiency (Rogue)'));
R4.feats = []; R4.background = null; // remove feat + background -> their grants disappear
s = computeCharacter(pc, R4, gatherEffects(pc, R4, P));
assert.equal(s.stats['skill.medicine'].proficient, 0); assert.equal(s.stats['skill.history'].proficient, 0); assert.equal(s.stats['save.con'].proficient, false);
pc.skillProfs = { history: 1 }; // manual layer stays independent
s = computeCharacter(pc, R4, gatherEffects(pc, R4, P));
assert.ok(s.stats['skill.history'].parts.some(p => p.label === 'Proficiency (manual)'));

// --- armor/weapon/tool/language grants ---
const hill = { name: 'Elf', languageProficiencies: [{ common: true, elvish: true }] };
const highElf = { name: 'High', weaponProficiencies: [{ 'longsword|phb': true, 'shortbow|phb': true }], languageProficiencies: [{ anyStandard: 1 }] };
const monk = { name: 'Monk', hd: { faces: 8 }, proficiency: ['str', 'dex'], startingProficiencies: { weapons: ['simple', '{@item shortsword|phb|shortswords}'], toolProficiencies: [{ anyArtisansTool: 1 }, { anyMusicalInstrument: 1 }] } };
const pc2 = { ...pc, skillProfs: {}, profChoices: { 'lang:subrace': ['dwarvish'], 'tool:class': ['lute'] }, extraProfs: { lang: ['giant'] } };
const R5 = { race: hill, subrace: highElf, background: null, classes: [{ cls: monk, level: 1 }], items: [], feats: [], sources: [] };
s = computeCharacter(pc2, R5, gatherEffects(pc2, R5, P));
assert.deepEqual(Object.keys(s.profs.lang).sort(), ['common', 'dwarvish', 'elvish', 'giant']);
assert.deepEqual(s.profs.weapon.longsword, ['High']); assert.ok(s.profs.weapon.simple); assert.ok(s.profs.weapon.shortsword);
assert.deepEqual(s.profs.tool.lute, ['Monk']);
const ls = { inv: { id: 'l', equipped: true }, data: { name: '+1 Longsword', baseItem: 'Longsword|PHB', type: 'M', weaponCategory: 'martial', dmg1: '1d8', dmgType: 'S', bonusWeapon: '+1', property: ['V'] } };
a = computeAction({ id: 9, kind: 'weapon', ref: 'l' }, { sheet: s, R: R5, c: pc2, data: ls.data });
assert.equal(a.prof, true, 'High Elf weapon training covers a +1 longsword');
R5.items = [{ inv: { id: 'p', equipped: true }, data: { name: 'Plate Armor', type: 'HA', ac: 18 } }];
s = computeCharacter(pc2, R5, gatherEffects(pc2, R5, P));
assert.ok(s.stats.ac.notes.some(n => n.startsWith('Not proficient with heavy armor')));

// --- extra damage dice are joined with "+" (Sneak Attack on a dagger used to give "1d41d6") ---
const rog3 = { name: 'Rogue', hd: { faces: 8 }, proficiency: ['dex', 'int'], startingProficiencies: { weapons: ['simple'] } };
const dagger = { inv: { id: 'd', equipped: true }, data: { name: 'Dagger', type: 'M', weaponCategory: 'simple', property: ['F', 'L', 'T'], dmg1: '1d4', dmgType: 'P' } };
const rc = { ...pc, skillProfs: {}, profChoices: {}, activeToggles: ['cf:sa'] };
const R6 = { race: null, subrace: null, background: null, classes: [{ cls: rog3, level: 3 }], items: [dagger], feats: [], sources: [{ key: 'cf:sa', name: 'Sneak Attack', kind: 'feature' }] };
s = computeCharacter(rc, R6, gatherEffects(rc, R6, P));
a = computeAction({ id: 7, kind: 'weapon', ref: 'd' }, { sheet: s, R: R6, c: rc, data: dagger.data });
assert.equal(dmgExpr(a.dmg), '1d4+2d6+2');
assert.equal(roll(dmgExpr(a.dmg), {}, () => 0.999).total, 4 + 12 + 2);
assert.equal(dmgExpr({ dice: ['1d8'], total: -1 }), '1d8-1');
assert.equal(dmgExpr({ dice: [], total: 3 }), '3');

// --- a transformation's CON (Wild Shape) must not change your own hit point maximum ---
const druid = { name: 'Druid', hd: { faces: 8 }, proficiency: ['int', 'wis'] };
const dc = { ...pc, baseScores: { str: 10, dex: 12, con: 14, int: 10, wis: 16, cha: 10 }, profChoices: {}, activeToggles: [] };
const R7 = { race: null, subrace: null, background: null, classes: [{ cls: druid, level: 4 }], items: [], feats: [], sources: [] };
const hpBefore = computeCharacter(dc, R7, gatherEffects(dc, R7, P)).stats.hpMax.total;
R7.extraEffects = [{ target: 'ability.con', op: 'set', value: 16, label: 'Wild Shape: Brown Bear', transform: true }];
s = computeCharacter(dc, R7, gatherEffects(dc, R7, P));
assert.equal(s.scores.con, 16); assert.equal(s.stats.hpMax.total, hpBefore);

// --- Shillelagh: a club/quarterstaff uses the caster's ability and a d8; other weapons are untouched ---
const druidC = { ...druid, casterProgression: 'full', spellcastingAbility: 'wis', startingProficiencies: { weapons: ['{@item quarterstaff|phb|quarterstaffs}', '{@item scimitar|phb|scimitars}'] } };
const qs = { inv: { id: 'q', equipped: true }, data: { name: 'Quarterstaff', type: 'M', weaponCategory: 'simple', property: ['V'], dmg1: '1d6', dmg2: '1d8', dmgType: 'B' } };
const scim = { inv: { id: 's', equipped: true }, data: { name: 'Scimitar', type: 'M', weaponCategory: 'martial', property: ['F', 'L'], dmg1: '1d6', dmgType: 'S' } };
const sh = { ...dc, activeToggles: ['spell:Shillelagh|PHB'] };
const R8 = { ...R7, extraEffects: [], classes: [{ cls: druidC, level: 4 }], items: [qs, scim], sources: [{ key: 'spell:Shillelagh|PHB', name: 'Shillelagh', kind: 'spell', cls: 'Druid' }] };
s = computeCharacter(sh, R8, gatherEffects(sh, R8, P));
a = computeAction({ id: 10, kind: 'weapon', ref: 'q' }, { sheet: s, R: R8, c: sh, data: qs.data });
assert.equal(a.hit.total, 3 + 2, 'WIS +3 and proficiency'); assert.equal(dmgExpr(a.dmg), '1d8+3');
assert.ok(a.hit.parts[0].label.includes('Shillelagh')); assert.equal(a.dmg.diceSrc[0], 'Quarterstaff (Shillelagh)');
a = computeAction({ id: 11, kind: 'weapon', ref: 's' }, { sheet: s, R: R8, c: sh, data: scim.data });
assert.equal(dmgExpr(a.dmg), '1d6+1', 'scimitar keeps DEX and its own die');
sh.activeToggles = [];
s = computeCharacter(sh, R8, gatherEffects(sh, R8, P));
assert.equal(dmgExpr(computeAction({ id: 10, kind: 'weapon', ref: 'q' }, { sheet: s, R: R8, c: sh, data: qs.data }).dmg), '1d6', 'STR 10 when off');

// --- Shillelagh is optional ("you can use"): a strong druid keeps STR and its modifier, but still gets the d8 ---
const brute = { ...sh, baseScores: { ...sh.baseScores, str: 16, wis: 10 }, activeToggles: ['spell:Shillelagh|PHB'] };
s = computeCharacter(brute, R8, gatherEffects(brute, R8, P));
a = computeAction({ id: 10, kind: 'weapon', ref: 'q' }, { sheet: s, R: R8, c: brute, data: qs.data });
assert.equal(dmgExpr(a.dmg), '1d8+3'); assert.equal(a.hit.parts[0].label, 'STR mod');

// --- 2014 magic staffs are quarterstaffs: proficiency, Shillelagh and their +2 all apply ---
const woodlands = { name: 'Staff of the Woodlands', weaponCategory: 'simple', property: ['V'], dmg1: '1d6', dmg2: '1d8', dmgType: 'B', bonusWeapon: '+2', staff: true };
s = computeCharacter(sh, R8, gatherEffects({ ...sh, activeToggles: ['spell:Shillelagh|PHB'] }, R8, P));
a = computeAction({ id: 12, kind: 'weapon', ref: 'w' }, { sheet: s, R: R8, c: sh, data: woodlands });
assert.equal(a.prof, true); assert.equal(a.hit.total, 3 + 2 + 2); assert.equal(dmgExpr(a.dmg), '1d8+5');

// --- toggled weapon spells add labelled dice (Hunter's Mark) ---
const hm = { ...sh, activeToggles: ["spell:Hunter's Mark|PHB"] };
const R9 = { ...R8, sources: [{ key: "spell:Hunter's Mark|PHB", name: "Hunter's Mark", kind: 'spell' }] };
s = computeCharacter(hm, R9, gatherEffects(hm, R9, P));
a = computeAction({ id: 11, kind: 'weapon', ref: 's' }, { sheet: s, R: R9, c: hm, data: scim.data });
assert.equal(dmgExpr(a.dmg), '1d6+1d6+1'); assert.equal(a.dmg.diceSrc[1], "Hunter's Mark");

// --- unarmed strikes: 1 + STR, upgraded by whatever offers the biggest die / best ability ---
const fighterU = { name: 'Fighter', hd: { faces: 10 }, proficiency: ['str', 'con'], startingProficiencies: { weapons: ['simple', 'martial'] } };
const uc = { ...pc, baseScores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 }, profChoices: {}, activeToggles: [] };
const fist = { id: 20, kind: 'custom', name: 'Unarmed Strike', ability: 'str', prof: true, addMod: true, unarmed: true, dmgType: 'bludgeoning' };
const RU = (sources, items = []) => ({ race: null, subrace: null, background: null, classes: [{ cls: fighterU, level: 1 }], items, feats: [], sources });
const punch = (R, c = uc, act = fist) => computeAction(act, { sheet: computeCharacter(c, R, gatherEffects(c, R, P)), R, c, data: null });
assert.equal(dmgExpr(punch(RU([])).dmg), '4', 'plain unarmed strike: 1 + STR');
const uf = { key: 'opt:Unarmed Fighting|TCE', name: 'Unarmed Fighting', kind: 'feature', cls: 'Fighter' };
a = punch(RU([uf]));
assert.equal(dmgExpr(a.dmg), '1d8+3', 'Unarmed Fighting, nothing in hand: d8'); assert.equal(a.dmg.diceSrc[0], 'Unarmed strike (Unarmed Fighting)');
const sword = { inv: { id: 'ls', equipped: true }, data: { name: 'Longsword', type: 'M', weaponCategory: 'martial', property: ['V'], dmg1: '1d8', dmgType: 'S' } };
assert.equal(dmgExpr(punch(RU([uf], [sword])).dmg), '1d6+3', 'Unarmed Fighting with a weapon in hand: d6');
assert.equal(dmgExpr(punch(RU([uf, { key: 'feat:Tavern Brawler|PHB', name: 'Tavern Brawler', kind: 'feature', cls: 'feat' }], [sword])).dmg), '1d6+3', 'biggest die wins over Tavern Brawler d4');
// race natural weapons depend on the book
a = punch(RU([{ key: "race:Cat's Claws", name: "Cat's Claws", kind: 'feature', src: 'VGM' }]));
assert.equal(dmgExpr(a.dmg), '1d4+3'); assert.equal(a.dmgType, 'slashing');
assert.equal(dmgExpr(punch(RU([{ key: "race:Cat's Claws", name: "Cat's Claws", kind: 'feature', src: 'MPMM' }])).dmg), '1d6+3');
// Demon Armor: keeps its own +1 AC from the data and adds d8 slashing +1 unarmed strikes
const demon = { inv: { id: 'da', equipped: true, attuned: true }, data: { name: 'Demon Armor', type: 'HA', ac: 18, reqAttune: true, bonusAc: '+1', bonusWeapon: '+1' } };
const RD = RU([], [demon]), sd = computeCharacter(uc, RD, gatherEffects(uc, RD, P));
assert.equal(sd.stats.ac.total, 19);
a = punch(RD); assert.equal(dmgExpr(a.dmg), '1d8+4'); assert.equal(a.hit.total, 3 + 2 + 1); assert.equal(a.dmgType, 'slashing');
// Martial Arts: DEX and the martial arts die for unarmed strikes and monk weapons (quarterstaff d6 → d8 at 11th level)
const monkC = { name: 'Monk', hd: { faces: 8 }, proficiency: ['str', 'dex'], startingProficiencies: { weapons: ['simple', 'shortsword'] } };
const mcU = { ...uc, baseScores: { str: 10, dex: 18, con: 12, int: 10, wis: 14, cha: 8 } };
const RM = { ...RU([{ key: 'cf:Monk:Martial Arts:1', name: 'Martial Arts', kind: 'feature', cls: 'Monk', level: 1 }], [qs]), classes: [{ cls: monkC, level: 11 }] };
a = punch(RM, mcU); assert.equal(dmgExpr(a.dmg), '1d8+4'); assert.equal(a.hit.parts[0].label, 'DEX mod (Martial Arts)');
s = computeCharacter(mcU, RM, gatherEffects(mcU, RM, P));
assert.equal(dmgExpr(computeAction({ id: 21, kind: 'weapon', ref: 'q' }, { sheet: s, R: RM, c: mcU, data: qs.data }).dmg), '1d8+4', 'quarterstaff is a monk weapon');
assert.equal(dmgExpr(computeAction({ id: 22, kind: 'weapon', ref: 'ls' }, { sheet: s, R: RM, c: mcU, data: sword.data }).dmg), '1d8', 'longsword is not: STR, own die');

// --- rules text: tags show their display text, table cells keep their text (Circle Forms showed "challenge rating=[&0;&1]") ---
assert.equal(tags('{@filter 1|bestiary|challenge rating=[&0;&1]|type=beast}'), '1');
assert.equal(tags('{@quickref Cover||3||total cover}'), 'total cover');
assert.equal(tags('{@book chapter 10|PHB|10}'), 'chapter 10');
assert.equal(tags('{@card Balance|Deck of Many More Things|BMT}'), 'Balance');
const tbl = entries({ type: 'table', colLabels: ['d', 'Card'], colStyles: ['col-2 text-center', 'col-10'], rows: [[{ type: 'cell', roll: { exact: 1 } }, { type: 'cell', roll: { exact: 1 }, entry: 'Ace of hearts' }]] });
assert.match(tbl, /<td style="text-align:center">1<\/td><td style="">Ace of hearts<\/td>/); assert.match(tbl, /width:83\.3%/);

console.log('rules.test.mjs: all assertions passed');
