// End-to-end browser test: serves the app, drives it in headless Chrome with a fresh profile, asserts on what the sheet shows.
// Run: RULES_REPO=https://github.com/owner/repo npm run test:e2e   (needs network for the one-time rules download, and Google Chrome; set E2E_CHANNEL= to use Playwright's chromium)
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

// ---------- static server ----------
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)), file = join(ROOT, p.endsWith('/') ? p + 'index.html' : p);
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const URL0 = `http://127.0.0.1:${server.address().port}/`;

// ---------- browser ----------
const profile = await mkdtemp(join(tmpdir(), 'dndcm-e2e-'));
const channel = process.env.E2E_CHANNEL ?? 'chrome';
const ctx = await chromium.launchPersistentContext(profile, { ...(channel && { channel }), headless: true, viewport: { width: 1400, height: 1000 } });
const page = ctx.pages()[0] || await ctx.newPage();
page.setDefaultTimeout(8000);
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
page.on('dialog', d => d.accept());

const failures = [];
async function check(name, fn) {
  try { await fn(); console.log('✓', name); } catch (e) {
    failures.push(name);
    console.log('✗', name, '\n   ', e.message.split('\n')[0]);
    await page.screenshot({ path: join(profile, `fail-${name.replace(/\W+/g, '_')}.png`), fullPage: true }).catch(() => {});
  }
}
const vit = async label => (await page.locator('.vitals > div', { hasText: label }).locator('b, .num').first().innerText()).trim();
const hpText = async () => (await page.locator('.hpbox').innerText()).replace(/\s+/g, ' ').trim();
const bdText = async k => {
  await page.locator(`.lbl[data-k="${k}"]`).first().click();
  const t = (await page.locator('#dlg').innerText()).replace(/\s+/g, ' ');
  await page.keyboard.press('Escape');
  return t;
};
const pick = async (q, re) => { await page.locator('#dlg input.search').fill(q); await page.locator('.prow button.grow', { hasText: re }).first().click(); };
const menu = blk => page.locator(`[data-blk=${blk}] details.menu > summary`).first().click(); // opens a section's ⋮ menu
const more = () => page.locator('.namewrap details.menu > summary').click(); // the ⋮ next to the character name
const addItem = async (q, re) => { await menu('inventory'); await page.locator('[data-act=pick][data-what=item]').click(); await pick(q, re); await page.keyboard.press('Escape'); };
const act = name => page.locator('.act', { hasText: name }).first();
const resLeft = async name => page.locator('.status .res', { hasText: name }).first().locator('.pip.on').count();
const open = async id => { await page.goto(`${URL0}#${id}`); await page.reload(); await page.locator('.status').waitFor(); };
const home = async () => { await page.goto(URL0); await page.locator('.card').first().waitFor(); };

// ---------- tests ----------
await home();
await check('rules data downloads into the browser', async () => {
  assert.ok(process.env.RULES_REPO, 'set RULES_REPO to the GitHub link of the rules data repository');
  await page.locator('#base').fill(process.env.RULES_REPO);
  await page.getByRole('button', { name: /Download rules data/ }).click();
  await page.getByText(/^Downloaded .*spells/).waitFor({ timeout: 120000 });
});

await check('lookup: every category is searchable, filter chips include/exclude, narrowed filters browse', async () => {
  await page.locator('[data-act=lookup]').first().click();
  await page.locator('#dlg input.search').fill('beholder');
  await page.locator('.prow', { hasText: /^Beholder\s*Creature · CR 13/ }).waitFor();
  await page.locator('[data-act=lookupf][data-g="Creatures"]').click();
  assert.equal(await page.locator('.prow', { hasText: 'Creature ·' }).count(), 0, 'Creatures switched off');
  assert.ok(await page.locator('.prow', { hasText: 'Item ·' }).count(), 'items still shown');
  await page.locator('#dlg input.search').fill('');
  await page.locator('[data-act=lookupf][data-g="-"]').click(); await page.locator('[data-act=lookupf][data-g="Deities & gifts"]').click();
  await page.locator('.prow', { hasText: 'Deity ·' }).first().waitFor(); // listed without typing
  await page.locator('[data-act=lookupf][data-g="*"]').click();
  await page.keyboard.press('Escape');
});

await check('new character: setup panel, standard array swap, point buy limits', async () => {
  await page.getByRole('button', { name: 'New character' }).click();
  await page.locator('.setup').waitFor();
  const score = a => page.locator('.abtable tr', { hasText: a }).locator('.lbl').innerText();
  assert.equal(await score('Strength'), '15');
  await page.locator('[data-act=assign][data-a=int]').selectOption({ index: 0 });
  assert.equal(await score('Intelligence'), '15'); assert.equal(await score('Strength'), '12');
  await page.locator('[data-act=method][data-m=pointbuy]').click();
  for (let i = 0; i < 7; i++) await page.locator('[data-act=pb][data-a=str][data-d="1"]').click();
  assert.ok(await page.locator('[data-act=pb][data-a=str][data-d="1"]').isDisabled(), '15 is the point-buy cap');
  assert.match(await page.locator('.setup p.small').first().innerText(), /18 of 27 points left/);
  await page.locator('[data-act=method][data-m=array]').click();
});

await check('setup: race, background and class grant proficiencies with their source', async () => {
  await page.locator('[data-act=pick][data-what=race]').click(); await pick('half-elf', /^Half-Elf PHB/);
  await page.locator('[data-act=pick][data-what=background]').click(); await pick('acolyte', /^Acolyte/);
  await page.locator('[data-act=pick][data-what=class]').click(); await pick('rogue', /Rogue/);
  await page.getByRole('button', { name: /Confirm level 1/ }).click();
  assert.match(await bdText('skill.insight'), /Proficiency \(Acolyte\)/);
  assert.match(await bdText('save.dex'), /Proficiency \(Rogue\)/);
  assert.equal(await page.locator('.setup select[data-path^="profChoices.skill:class"]').count(), 4, 'rogue picks 4 skills');
  await page.locator('select[data-path^="profChoices.expertise:"]').first().selectOption('insight');
  assert.match(await bdText('skill.insight'), /Expertise \(Rogue Expertise/);
  // background kit: items unpacked into single entries, pouch coins into the purse; swapping takes the old kit back
  const inv = () => page.locator('[data-blk=inventory]').innerText(), gp = () => page.locator('input[data-path="currency.gp"]').inputValue();
  assert.match(await inv(), /Sticks of incense\s*×5/); assert.match(await inv(), /Vestments/); assert.equal(await gp(), '15');
  await page.locator('.kit select[data-act=kitopt]').selectOption('b');
  await page.locator('details.item', { hasText: 'Prayer wheel' }).waitFor();
  assert.equal(await page.locator('details.item', { hasText: /^\s*Book/ }).count(), 0, 'option a swapped out');
  await page.locator('[data-act=pick][data-what=background]').click(); await pick('sage', /^Sage/);
  await page.locator('details.item', { hasText: 'Quill' }).waitFor();
  assert.doesNotMatch(await inv(), /incense/); assert.equal(await gp(), '10');
  await page.locator('[data-act=pick][data-what=background]').click(); await pick('acolyte', /^Acolyte/);
  await page.locator('details.item', { hasText: 'Vestments' }).waitFor(); assert.equal(await gp(), '15');
});

await check('setup confirm hides the panel; Edit character brings it back', async () => {
  await page.locator('[data-act=setupdone]').click();
  assert.equal(await page.locator('.setup').count(), 0);
  await more(); await page.locator('[data-act=editsetup]').click(); await page.locator('.setup').waitFor();
  await page.locator('[data-act=setupdone]').click();
});

await check('level up: chooser, ASI buttons, feat instead', async () => {
  for (let l = 2; l <= 4; l++) {
    await more(); await page.locator('[data-act=levelchooser]').click();
    await page.locator('[data-act=lvlup]').first().click();
    if (l === 4) { await page.locator('[data-act=asi][data-a=dex]').click(); await page.locator('[data-act=asi][data-a=dex]').click(); }
    await page.getByRole('button', { name: /Average/ }).click();
  }
  assert.match(await bdText('ability.dex'), /ASI \/ other \+2/);
  await menu('features'); await page.locator('[data-act=pick][data-what=feat]').click(); await pick('skilled', /^Skilled/); await page.keyboard.press('Escape');
  await page.locator('select[data-path^="profChoices.skill:feat:Skilled"]').first().selectOption('medicine');
  assert.match(await bdText('skill.medicine'), /Proficiency \(Skilled\)/);
  await page.locator('details.feat summary', { hasText: 'Skilled' }).click();
  await page.locator('details.feat[open] [data-act=delsource]').click();
  assert.doesNotMatch(await bdText('skill.medicine'), /Proficiency/, 'removing the feat removes its grant');
});

await check('items: packs unpack, attunement drives AC, potions become actions, armor proficiency warning', async () => {
  await addItem("explorer's pack", /^Explorer's Pack/);
  assert.match(await page.locator('details.item', { hasText: 'Torch' }).innerText(), /×10/);
  const ac0 = +(await vit('AC'));
  await addItem('ring of protection', /^Ring of Protection/);
  await page.locator('details.item', { hasText: 'Ring of Protection' }).locator('[data-act=attune]').click();
  assert.equal(+(await vit('AC')), ac0 + 1);
  await addItem('potion of healing', /^Potion of Healing/);
  await page.locator('details.item', { hasText: 'Potion of Healing' }).locator('summary').click(); // + Action sits in the expanded item
  await page.locator('details.item[open]', { hasText: 'Potion of Healing' }).locator('[data-act=itemaction]').click();
  assert.match(await act('Potion of Healing').innerText(), /2d4\+2/);
  await addItem('plate armor', /^Plate Armor/);
  await page.locator('details.item', { hasText: 'Plate Armor' }).locator('[data-act=equip]').click();
  assert.match(await bdText('ac'), /Not proficient with heavy armor/);
});

await check('magic variants: +1 Longsword is a proper weapon with its bonus', async () => {
  await menu('inventory'); await page.locator('[data-act=pick][data-what=item]').click(); await pick('+1 weapon', /^\+1 Weapon/); await pick('longsword', /^Longsword/);
  await page.keyboard.press('Escape');
  await page.locator('details.item', { hasText: '+1 Longsword' }).locator('summary').click(); // + Action sits in the expanded item
  await page.locator('details.item[open]', { hasText: '+1 Longsword' }).locator('[data-act=itemaction]').click();
  assert.match(await act('+1 Longsword').innerText(), /1d8\+\d/);
});

await check('example characters load with the expected numbers', async () => {
  await home();
  await page.getByRole('button', { name: 'Load example characters' }).click();
  await page.locator('.row', { hasText: 'Ember Kastor' }).waitFor();
  const expect = { barbarian: [14, 40, '59 / 59'], druid: [11, 40, '34 / 34'], monk: [17, 40, '38 / 38'], paladin: [19, 30, '44 / 44'], warlock: [13, 30, '38 / 38'],
    cleric: [18, 25, '48 / 48'], fighter: [16, 30, '49 / 49'], bard: [14, 25, '33 / 33'], sorcerer: [15, 30, '37 / 37'] };
  for (const [id, [ac, speed, hp]] of Object.entries(expect)) {
    await open(`example-${id}`);
    assert.deepEqual([+(await vit('AC')), +(await vit('Speed')), (await hpText()).slice(0, hp.length)], [ac, speed, hp], id);
  }
});

await check('barbarian: Rage spends a use, adds damage and turns on the Bear totem', async () => {
  await open('example-barbarian');
  assert.equal(await act('Greataxe').locator('[data-act=rdmg]').innerText(), '1d12+4');
  await act('Rage').locator('[data-act=useaction]').click();
  assert.equal(await act('Greataxe').locator('[data-act=rdmg]').innerText(), '1d12+6');
  assert.equal(await resLeft('Rage'), 3);
  assert.match(await bdText('ac'), /Bear totem: resistance/);
  assert.equal(await page.locator('details.feat [data-act=effects], details.item [data-act=effects], [data-act=trackuses], [data-act=itemuses]').count(), 0,
    'no Effects… / Track uses buttons on features and items');
});

await check('druid: beast HP absorbs damage, overflow reverts; Moon limits allow CR 2', async () => {
  await open('example-druid');
  assert.match(await page.locator('.status').getAttribute('style'), /classes\/PHB\/Druid\.webp/, 'druid art behind the top panel');
  assert.match(await hpText(), /^34 \/ 34 Brown Bear HP · yours 45\/45/);
  await page.locator('#hpamt').fill('40'); await page.locator('[data-act=hp][data-op=dmg]').click();
  assert.equal(await page.locator('.shape').count(), 0);
  assert.match(await hpText(), /^39 \/ 45/);
  await page.locator('.status [data-act=wildshape]').click();
  assert.match(await page.locator('#dlg h2').innerText(), /CR 2, no flying speed/);
  await pick('dire wolf', /^Dire Wolf/);
  assert.equal(+(await vit('AC')), 14);
  assert.equal(await resLeft('Wild Shape'), 0);
  assert.match(await act('Bite (Dire Wolf)').innerText(), /2d6\+3/);
});

await check('druid: Shillelagh turns the quarterstaff into WIS + d8, scimitar untouched', async () => {
  await open('example-druid');
  if (await page.locator('[data-act=revert]').count()) await page.locator('[data-act=revert]').click();
  const qs = () => act('Quarterstaff').locator('[data-act=rdmg]');
  assert.equal(await qs().innerText(), '1d6');
  await page.locator('.spell', { hasText: 'Shillelagh' }).locator('[data-act=toggle]').click();
  await act('Quarterstaff').locator('[data-act=rdmg]', { hasText: /^1d8\+4$/ }).waitFor();
  assert.equal(await act('Scimitar').locator('[data-act=rdmg]').innerText(), '1d6+3');
  await page.locator('.spell', { hasText: 'Shillelagh' }).locator('[data-act=toggle]').click();
  await act('Quarterstaff').locator('[data-act=rdmg]', { hasText: /^1d6$/ }).waitFor();
});

await check('monk: martial arts uses DEX and the d6 die; Flurry spends ki', async () => {
  await open('example-monk');
  assert.match(await act('Martial Arts strike').innerText(), /\+7[\s\S]*1d6\+4/);
  assert.equal(await act('Unarmed Strike').locator('[data-act=rdmg]').innerText(), '1d6+4', 'unarmed strike gets DEX and the martial arts die');
  await act('Flurry of Blows').locator('[data-act=useaction]').click();
  assert.equal(await resLeft('Ki'), 4);
});

await check('paladin: smite spends the chosen slot; lay on hands spends the pool', async () => {
  await open('example-paladin');
  await act('Divine Smite').locator('select').selectOption('2');
  await act('Divine Smite').locator('[data-act=rdmg]', { hasText: /^3d8$/ }).waitFor(); // re-render happens on the next frame
  await act('Divine Smite').locator('[data-act=useaction]').click();
  assert.equal(await page.locator('.slotrow').nth(1).locator('.pip.on').count(), 1);
  const loh = () => page.locator('.status .res', { hasText: 'Lay on Hands' }).innerText();
  await act('Lay on Hands').locator('[data-act=useaction]').click();
  assert.match(await loh(), /24\/25/, 'healing spends one point per press');
  await act('Lay on Hands: Cure').locator('[data-act=useaction]').click();
  assert.match(await loh(), /19\/25/, 'curing spends five');
  assert.ok(await page.locator('.spell.granted', { hasText: 'Sanctuary' }).count(), 'oath spells are always prepared');
});

await check('sorcerer: Font of Magic turns 2 points into a 1st-level slot', async () => {
  await open('example-sorcerer');
  assert.equal(await page.locator('.slotrow').nth(0).locator('.pip.on').count(), 3);
  await page.locator('[data-act=fontslot][data-l="0"]').click();
  assert.equal(await page.locator('.slotrow').nth(0).locator('.pip.on').count(), 4);
  assert.equal(await resLeft('Sorcery Points'), 3);
});

await check('warlock: Agonizing Blast, two beams at 5th level, imp familiar, innate spell', async () => {
  await open('example-warlock');
  const eb = await act('Eldritch Blast').innerText();
  assert.match(eb, /1d10\+4/); assert.match(eb, /2 beam/);
  assert.match(await page.locator('details.comp summary').innerText(), /Sizzle[\s\S]*HP 10\/10/);
  await page.locator('.spell', { hasText: 'Hellish Rebuke' }).locator('[data-act=cast]').click();
  assert.match((await page.locator('#dlg [data-act=castat]').allInnerTexts()).join('|'), /Innate \(1\/day\)/);
  await page.keyboard.press('Escape');
});

await check('fighter: extra attack, maneuver DC, great weapon fighting note', async () => {
  await open('example-fighter');
  assert.match(await page.locator('.blk[data-blk=actions]').innerText(), /makes 2 attacks/);
  assert.match(await act('Maneuver').innerText(), /DC 15/);
  assert.match(await act('Greatsword').innerText(), /Great Weapon Fighting/);
  const fist = () => act('Unarmed Strike').locator('[data-act=rdmg]');
  assert.match(await fist().innerText(), /^\d+$/, 'plain unarmed strike is 1 + STR');
  await page.locator('[data-blk=features] details.fold > summary').click(); // all picks made: folded behind "View selection…"
  await page.locator('select[data-path="featureChoices.of:Fighter:cls:Fighting Style.0"]').selectOption({ label: 'Unarmed Fighting' });
  await act('Unarmed Strike').locator('[data-act=rdmg]', { hasText: /^1d6\+\d$/ }).waitFor(); // greatsword equipped: d6
  await page.locator('details.item', { hasText: 'Greatsword' }).locator('[data-act=equip]').click();
  await act('Unarmed Strike').locator('[data-act=rdmg]', { hasText: /^1d8\+\d$/ }).waitFor(); // empty hands: d8
});

await check('cleric: Life Domain grants heavy armor; undo restores removals, 3 steps deep', async () => {
  await open('example-cleric');
  assert.doesNotMatch(await bdText('ac'), /Not proficient/);
  const n = await page.locator('.spell').count();
  for (let i = 0; i < 4; i++) { const row = page.locator('.spell:has([data-act=delspell])').first(); await row.locator('details.menu > summary').click(); await row.locator('[data-act=delspell]').click(); }
  for (let i = 0; i < 3; i++) await page.locator('[data-act=undo]').click();
  assert.equal(await page.locator('.spell').count(), n - 1, 'only the last 3 changes come back');
  assert.ok(await page.locator('[data-act=undo]').isDisabled());
});

await check('death saves: three successes hide them (stable); damage at 0 HP brings them back with a failure', async () => {
  await open('example-fighter');
  await page.locator('#hpamt').fill('999'); await page.locator('[data-act=hp][data-op=dmg]').click();
  await page.locator('[data-act=ds][data-w=s]').nth(2).click();
  assert.equal(await page.locator('[data-act=ds]').count(), 0, 'stable: no death saves');
  await page.locator('#hpamt').fill('1'); await page.locator('[data-act=hp][data-op=dmg]').click();
  assert.equal(await page.locator('[data-act=ds][data-w=s].on').count(), 0);
  assert.equal(await page.locator('[data-act=ds][data-w=f].on').count(), 1);
  await page.getByRole('button', { name: 'Long rest' }).click(); await page.locator('[data-act=finishlong]').click();
});

await check('layout adapts: 3 / 2 / 1 columns, no sideways scroll, ability boxes fit their panel', async () => {
  await open('example-cleric');
  const cols = () => page.locator('.grid > .col').count();
  assert.equal(await cols(), 3);
  for (const width of [1400, 1099, 860, 700, 560, 390]) { // panels sit in columns of very different widths
    await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(200);
    const over = await page.evaluate(() => { const r = document.querySelector('[data-blk=abilities] .card').getBoundingClientRect();
      return [...document.querySelectorAll('.abil')].some(a => a.getBoundingClientRect().right > r.right + 1); });
    assert.ok(!over, `ability boxes overflow at ${width}px`);
  }
  await page.setViewportSize({ width: 1400, height: 1000 }); await page.waitForTimeout(200);
  await page.setViewportSize({ width: 900, height: 1000 }); await page.waitForTimeout(200);
  assert.equal(await cols(), 2);
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(200);
  assert.equal(await cols(), 1);
  assert.ok(await page.locator('.jump').isVisible());
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390));
  await page.setViewportSize({ width: 1400, height: 1000 });
});

await check('works offline after the first visit', async () => {
  await page.waitForTimeout(1000); // let the service worker finish caching the shell
  await ctx.setOffline(true);
  await page.reload(); await page.locator('.status').waitFor();
  assert.equal(+(await vit('AC')), 18);
  const art = (await page.locator('.status').getAttribute('style')).match(/url\('([^']+)'\)/)[1];
  assert.ok(await page.evaluate(src => new Promise(ok => { const i = new Image(); i.onload = () => ok(true); i.onerror = () => ok(false); i.src = src; }), art), 'class art loads offline');
  await ctx.setOffline(false);
});

await check('no uncaught page errors', async () => assert.deepEqual(pageErrors, []));

await ctx.close();
server.close();
if (failures.length) {
  console.log(`\n${failures.length} failed — screenshots in ${profile}`);
  process.exit(1);
}
await rm(profile, { recursive: true, force: true });
console.log('\ne2e.test.mjs: all checks passed');
