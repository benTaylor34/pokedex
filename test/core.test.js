import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTemplates, toPlainText } from '../src/wikitext.js';
import { tally, pokemonInText, resolveName } from '../src/matcher.js';
import { resultTexts } from '../src/reverseSearch.js';
import { parsePokemonPage } from '../src/bulbapedia.js';

test('toPlainText expands Bulbapedia inline templates and links', () => {
  assert.equal(
    toPlainText('When several of these {{OBP|Pokémon|species|{{ScPkmn}}}} gather, see [[Thunder Stone|stones]].'),
    'When several of these Pokémon gather, see stones.',
  );
  assert.equal(toPlainText("It roasts <sc>{{Berries}}</sc>.<small>''(note)''</small>"), 'It roasts Berries.');
  assert.equal(toPlainText('{{tt|Barrier|Mr. Mime}}'), 'Barrier');
});

test('findTemplates handles nested templates and named args', () => {
  const [t] = findTemplates('x {{Dex/Entry1|v=Red|entry=Hi {{p|Pichu}} [[a|b]]}} y', (n) => n === 'Dex/Entry1');
  assert.equal(t.named.v, 'Red');
  assert.equal(t.named.entry, 'Hi {{p|Pichu}} [[a|b]]');
});

test('pokemonInText respects word boundaries and prefers longer names', () => {
  assert.deepEqual(pokemonInText('Mewtwo plush toy').map((p) => p.name), ['Mewtwo']);
  assert.deepEqual(pokemonInText('Mr. Mime figure').map((p) => p.name), ['Mr. Mime']);
  assert.deepEqual(pokemonInText('flabebe fan art').map((p) => p.name), ['Flabébé']);
});

test('tally picks the most frequent, highest-ranked Pokémon', () => {
  const { best, candidates } = tally([
    { text: 'Pikachu plush 30cm', weight: 1 },
    { text: 'Pikachu and Raichu cards', weight: 0.9 },
    { text: 'Cute pikachu wallpaper', weight: 0.8 },
    { text: 'Raichu figure', weight: 0.7 },
  ]);
  assert.equal(best.name, 'Pikachu');
  assert.equal(candidates[1].name, 'Raichu');
});

test('resultTexts weights Lens results', () => {
  const texts = resultTexts({
    visual_matches: [{ title: 'Charmander', source: 'eBay' }],
    related_content: [{ query: 'Charmander pokemon' }],
  });
  assert.equal(texts.length, 2);
  const weightOf = (source) => texts.find((t) => t.source === source).weight;
  assert.ok(weightOf('related_content') > weightOf('visual_match'));
  assert.equal(texts.find((t) => t.source === 'visual_match').text, 'Charmander eBay');
});

test('resolveName is case and punctuation insensitive', () => {
  assert.equal(resolveName('PIKACHU'), 'Pikachu');
  assert.equal(resolveName('mr mime'), 'Mr. Mime');
  assert.equal(resolveName('notapokemon'), null);
});

test('parsePokemonPage extracts infobox, anime and game entries', () => {
  const page = `{{Pokémon Infobox
|name=Pikachu
|ndex=0025
|type1=Electric
|category=Mouse
|height-m=0.4
|weight-kg=6.0
|ability1=Static
}}
'''Pikachu''' (Japanese: ピカチュウ) is an {{type|Electric}} Pokémon introduced in [[Generation I]].

===Pokédex entries===
{{Dex/Entry1|v=Yellow|entry=It keeps its tail raised.}}
==In animation==
{{Animedexbody|DP002|Pikachu|Dawn's Pokédex|Pikachu, the Mouse Pokémon. It stores {{t|Electric}} power.}}
==In the manga==
{{Animedexbody|PS001|Pikachu|Manga dex|Should be ignored.}}`;
  const p = parsePokemonPage(page);
  assert.equal(p.name, 'Pikachu');
  assert.equal(p.ndex, 25);
  assert.deepEqual(p.types, ['Electric']);
  assert.equal(p.summary, 'Pikachu is an Electric Pokémon introduced in Generation I.');
  assert.equal(p.animeEntries.length, 1);
  assert.equal(p.speech, 'Pikachu, the Mouse Pokémon. It stores Electric power.');
  assert.equal(p.gameEntries[0].text, 'It keeps its tail raised.');
});

test('matcher handles possessives, plurals, hashtags and gendered names', () => {
  const names = (t) => pokemonInText(t).map((p) => p.name);
  assert.deepEqual(names("Pikachu's tail"), ['Pikachu']);
  assert.deepEqual(names('Pikachu’s tail'), ['Pikachu']);
  assert.deepEqual(names('two Charmanders'), ['Charmander']);
  assert.deepEqual(names('#TapuKoko #MrMime'), ['Tapu Koko', 'Mr. Mime']);
  assert.deepEqual(names('Nidoran♂ plush'), ['Nidoran♂']);
  assert.deepEqual(names('Nidoran F card'), ['Nidoran♀']);
  assert.deepEqual(names('Porygon-Z and Porygon'), ['Porygon-Z', 'Porygon']);
  assert.equal(resolveName('Nidoran♂'), 'Nidoran♂');
});

test('toPlainText decodes HTML entities', () => {
  assert.equal(toPlainText('Game data&rarr;Evolution&nbsp;data &#233;'), 'Game data→Evolution data é');
});

test('parsePokemonPage skips "No available data." anime lines', () => {
  const p = parsePokemonPage(`{{Pokémon Infobox
|name=Blaziken
|ndex=0257
|type1=Fire
|category=Blaze
}}
==In animation==
{{Animedexbody|EP265|Blaziken|Ash's Pokédex|No available data.}}
{{Animedexbody|EP271|Blaziken|Ash's Pokédex|Blaziken, the Blaze Pokémon. It leaps buildings.}}`);
  assert.equal(p.animeEntries.length, 1);
  assert.equal(p.speech, 'Blaziken, the Blaze Pokémon. It leaps buildings.');
});
