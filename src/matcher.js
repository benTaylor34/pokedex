// Tallies which Pokémon names appear across reverse image search results and
// picks the most likely one.
import { readFileSync } from 'node:fs';

const POKEMON = JSON.parse(readFileSync(new URL('../data/pokemon.json', import.meta.url), 'utf8'));

/**
 * Lowercase, strip accents/punctuation so "Flabébé" ~ "flabebe", "Mr. Mime" ~ "mr mime".
 * Gender symbols become words so Nidoran♀ and Nidoran♂ stay distinct.
 */
export function normalize(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/♀/g, ' female ')
    .replace(/♂/g, ' male ')
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Every spelling a name might appear as in a result title. */
function keysFor(name) {
  const key = normalize(name);
  const keys = [key];
  if (key.includes(' ')) keys.push(key.replace(/ /g, '')); // hashtags: "#TapuKoko"
  const gendered = key.match(/^(.*) (female|male)$/);
  if (gendered) keys.push(`${gendered[1]} ${gendered[2][0]}`); // "Nidoran F"
  return keys;
}

const NAMES = POKEMON.map((p) => ({ ...p, keys: keysFor(p.name) }));

// Spelling -> Pokémon. A trailing "s" is also accepted, which covers plurals and,
// since apostrophes are stripped, possessives: "Pikachu's" -> "pikachus".
const SPELLINGS = new Map();
for (const p of NAMES) {
  for (const key of p.keys) {
    SPELLINGS.set(key, p);
    SPELLINGS.set(`${key}s`, p);
  }
}
const MAX_WORDS = Math.max(...[...SPELLINGS.keys()].map((k) => k.split(' ').length));

/** Pokémon whose names appear in `text`, each counted once. */
export function pokemonInText(text) {
  const words = normalize(text).split(' ');
  const hits = new Set();
  for (let i = 0; i < words.length; i++) {
    // Try the longest phrase first so "Porygon-Z" wins over "Porygon".
    for (let n = Math.min(MAX_WORDS, words.length - i); n >= 1; n--) {
      const p = SPELLINGS.get(words.slice(i, i + n).join(' '));
      if (p) {
        hits.add(p);
        i += n - 1;
        break;
      }
    }
  }
  return [...hits];
}

/**
 * @param {{text: string, weight: number}[]} results  search result texts, best first
 * @returns {{ best: object|null, candidates: object[] }}
 */
export function tally(results) {
  const scores = new Map();
  for (const { text, weight } of results) {
    for (const p of pokemonInText(text)) {
      const entry = scores.get(p.id) ?? { id: p.id, name: p.name, score: 0, hits: 0 };
      entry.score += weight;
      entry.hits += 1;
      scores.set(p.id, entry);
    }
  }

  const candidates = [...scores.values()].sort((a, b) => b.score - a.score);
  const total = candidates.reduce((sum, c) => sum + c.score, 0);
  for (const c of candidates) {
    c.score = Math.round(c.score * 100) / 100;
    c.confidence = total ? Math.round((c.score / total) * 100) : 0;
  }
  return { best: candidates[0] ?? null, candidates: candidates.slice(0, 5) };
}

/** Resolve user-typed text ("mr mime", "PIKACHU") to the canonical name, or null. */
export function resolveName(input) {
  const key = normalize(input);
  return NAMES.find((p) => p.keys.includes(key))?.name ?? null;
}
