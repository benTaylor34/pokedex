// Fetches a Pokémon's page from Bulbapedia's MediaWiki API and extracts its
// Pokédex information.
import { findTemplates, toPlainText } from './wikitext.js';

const API = 'https://bulbapedia.bulbagarden.net/w/api.php';
const USER_AGENT = 'CameraPokedex/1.0 (personal hobby project)';
const ARTWORK = (id) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;

const cache = new Map();

export async function getPokemon(name) {
  const key = name.toLowerCase();
  if (!cache.has(key)) {
    // Cache the promise so concurrent lookups share one request; drop it on failure.
    const pending = fetchPokemon(name).catch((err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, pending);
  }
  return cache.get(key);
}

async function fetchPokemon(name) {
  const title = `${name.replace(/’/g, "'")} (Pokémon)`;
  const url = new URL(API);
  url.search = new URLSearchParams({
    action: 'parse',
    page: title,
    prop: 'wikitext',
    format: 'json',
    redirects: '1',
  });

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Bulbapedia responded ${res.status}`);
  // Under load Bulbapedia occasionally serves an HTML error page with a 200.
  const json = await res.json().catch(() => {
    throw new Error('Bulbapedia is temporarily unavailable. Try again in a moment.');
  });
  if (json.error) throw new Error(`Bulbapedia: ${json.error.info}`);

  const wikitext = json.parse.wikitext['*'];
  return {
    ...parsePokemonPage(wikitext),
    url: `https://bulbapedia.bulbagarden.net/wiki/${encodeURIComponent(json.parse.title.replace(/ /g, '_'))}`,
  };
}

export function parsePokemonPage(wikitext) {
  const [infobox] = findTemplates(wikitext, (n) => n === 'Pokémon Infobox');
  if (!infobox) throw new Error('No Pokémon infobox found on page');
  const info = infobox.named;
  const field = (k) => (info[k] ? toPlainText(info[k]) : null);

  const name = field('name');
  const ndex = Number.parseInt(info.ndex, 10);
  const types = [field('type1'), field('type2')].filter(Boolean);
  // Regional forms are listed after a <br>, e.g. "{{tt|Barrier|..}} Pokémon<br/>{{tt|Dancing|..}}".
  const category = info.category
    ? toPlainText(info.category.split(/<br\s*\/?>/i)[0]).replace(/\s*Pokémon$/, '')
    : null;

  // Anime entries live in the "In animation" section; the manga has its own
  // Animedexbody tables further down which we skip.
  const mangaStart = wikitext.search(/\n==\s*In the manga\s*==/);
  const animeText = mangaStart === -1 ? wikitext : wikitext.slice(0, mangaStart);
  const animeEntries = findTemplates(animeText, (n) => n === 'Animedexbody')
    .map(({ positional: [episode, subject, device, text] }) => ({
      episode,
      subject: subject && toPlainText(subject),
      device: device && toPlainText(device),
      text: text && toPlainText(text),
    }))
    // Skip entries about a move ("Solar Beam") rather than the Pokémon, and
    // scenes where the Pokédex had nothing to say ("No available data.").
    // Some entries have no subject recorded ("None"); keep those that open with the name.
    .filter((e) => e.text
      && (!e.subject || e.subject === name
        || (e.subject === 'None' && e.text.startsWith(name.replace(/[♀♂]$/, ''))))
      && !/^(no (available )?data[.!]?\s*)+$/i.test(e.text));

  const gameEntries = findTemplates(wikitext, (n) => /^Dex\/Entry\d$/.test(n))
    .map(({ named }) => ({
      games: [named.v, named.v2, named.v3].filter(Boolean).map(toPlainText),
      text: named.entry && toPlainText(named.entry),
    }))
    .filter((e) => e.text);

  return {
    name,
    ndex,
    category,
    types,
    height: { m: field('height-m'), ftin: field('height-ftin') },
    weight: { kg: field('weight-kg'), lbs: field('weight-lbs') },
    abilities: [field('ability1'), field('ability2')].filter(Boolean),
    hiddenAbility: field('abilityd'),
    generation: field('generation'),
    summary: leadSummary(wikitext, infobox),
    animeEntries,
    gameEntries,
    image: Number.isFinite(ndex) ? ARTWORK(ndex) : null,
    speech: speechFor({ name, category, animeEntries, gameEntries }),
  };
}

/** The first couple of paragraphs after the infobox. */
function leadSummary(wikitext, infobox) {
  const afterInfobox = wikitext.slice(infobox.end);
  const lead = afterInfobox.split(/\n==/)[0];
  return lead
    .split(/\n\s*\n/)
    .map((p) => toPlainText(p).replace(/\s*\(Japanese:[^)]*\)/, ''))
    .filter((p) => p.length > 20)
    .slice(0, 2)
    .join(' ');
}

/**
 * What the Pokédex says out loud. The anime's own Pokédex lines already have
 * the "<Name>, the <Category> Pokémon." intro, so prefer the earliest one.
 * Otherwise build that intro and append the most recent game entry.
 */
function speechFor({ name, category, animeEntries, gameEntries }) {
  if (animeEntries.length) return animeEntries[0].text;
  const intro = category ? `${name}, the ${category} Pokémon.` : `${name}.`;
  const latest = gameEntries.at(-1)?.text;
  return latest ? `${intro} ${latest}` : intro;
}
