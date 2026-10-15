// Minimal MediaWiki wikitext helpers: just enough to pull templates out of a
// Bulbapedia page and turn their contents into plain, speakable text.

/**
 * Find top-level templates whose name passes `match` and return their arguments.
 * Handles nested {{templates}} and [[links|with pipes]] inside arguments.
 */
export function findTemplates(text, match) {
  const found = [];
  let i = 0;
  while ((i = text.indexOf('{{', i)) !== -1) {
    const end = matchingClose(text, i);
    if (end === -1) break;
    const body = text.slice(i + 2, end);
    const parts = splitTopLevel(body);
    const name = parts[0].trim();
    if (match(name)) {
      const positional = [];
      const named = {};
      for (const part of parts.slice(1)) {
        const eq = topLevelEquals(part);
        if (eq === -1) positional.push(part.trim());
        else named[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
      }
      found.push({ name, positional, named, index: i, end: end + 2 });
      i = end + 2;
    } else {
      // Skip just the opening braces so templates nested inside this one are still visited.
      i += 2;
    }
  }
  return found;
}

/** Index of the "}}" that closes the "{{" at `start`, or -1. */
function matchingClose(text, start) {
  let depth = 0;
  for (let i = start; i < text.length - 1; i++) {
    if (text[i] === '{' && text[i + 1] === '{') { depth++; i++; }
    else if (text[i] === '}' && text[i + 1] === '}') {
      depth--;
      if (depth === 0) return i;
      i++;
    }
  }
  return -1;
}

/** Split on "|" characters that are not inside nested templates or links. */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === '{{' || two === '[[') { depth++; i++; }
    else if (two === '}}' || two === ']]') { depth--; i++; }
    else if (body[i] === '|' && depth === 0) { parts.push(body.slice(last, i)); last = i + 1; }
  }
  parts.push(body.slice(last));
  return parts;
}

function topLevelEquals(part) {
  let depth = 0;
  for (let i = 0; i < part.length; i++) {
    const two = part.slice(i, i + 2);
    if (two === '{{' || two === '[[') { depth++; i++; }
    else if (two === '}}' || two === ']]') { depth--; i++; }
    else if (part[i] === '=' && depth === 0) return i;
  }
  return -1;
}

// How to render the inline templates that commonly appear in Pokédex text.
// Anything not listed renders as its first positional argument.
const INLINE = {
  ScPkmn: () => 'Pokémon',
  Berries: () => 'Berries',
  Berry: () => 'Berry',
  pkmn: (a) => (a[0] ? `Pokémon ${a[0]}` : 'Pokémon'),
  pkmn2: (a) => (a[0] ? `${a[0]} Pokémon` : 'Pokémon'),
  OBP: (a) => a[2] || a[0],
  DL: (a) => a[1] || a[0],
  color2: (a) => a[2] || a[1],
  tt: (a) => a[0],
  wp: (a) => a[1] || a[0],
  gen: (a) => `Generation ${a[0]}`,
};

const ENTITIES = {
  nbsp: ' ', rarr: '→', larr: '←', mdash: '—', ndash: '–', hellip: '…', times: '×', eacute: 'é', amp: '&',
};

/** Convert a wikitext fragment to plain text. */
export function toPlainText(text) {
  let out = text
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[\s\S]*?<\/ref>/gi, '')
    .replace(/<small>[\s\S]*?<\/small>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '');

  // Links: [[File:...]] dropped, [[target|label]] -> label, [[target]] -> target.
  out = out.replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '');
  out = out.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1');

  // Expand templates innermost-first until none remain.
  const innermost = /\{\{([^{}]*)\}\}/;
  let guard = 0;
  while (innermost.test(out) && guard++ < 500) {
    out = out.replace(innermost, (_, inner) => {
      const [name, ...rest] = inner.split('|');
      const args = rest.filter((a) => !/^[\w-]+=/.test(a)).map((a) => a.trim());
      const render = INLINE[name.trim()];
      return render ? render(args) ?? '' : args[0] ?? '';
    });
  }

  return out
    .replace(/'{2,}/g, '')
    .replace(/&(nbsp|rarr|larr|mdash|ndash|hellip|times|eacute|amp|#\d+);/g, (_, e) => ENTITIES[e] ?? String.fromCodePoint(Number(e.slice(1))))
    .replace(/\s+/g, ' ')
    .trim();
}
