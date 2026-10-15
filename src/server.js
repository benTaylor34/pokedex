import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { reverseImageSearch } from './reverseSearch.js';
import { tally, resolveName } from './matcher.js';
import { getPokemon } from './bulbapedia.js';

const app = express();
const PORT = process.env.PORT || 3000;
const POKEMON = JSON.parse(readFileSync(new URL('../data/pokemon.json', import.meta.url), 'utf8'));

app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

// SerpApi's image upload accepts only these, up to 500 KB.
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Body is the raw image captured from the camera.
app.post('/api/identify', express.raw({ type: IMAGE_TYPES, limit: '500kb' }), async (req, res) => {
  try {
    const type = req.is(IMAGE_TYPES);
    if (!type) {
      return res.status(415).json({ error: 'Send a JPEG, PNG or WebP image.' });
    }
    if (!req.body?.length) return res.status(400).json({ error: 'No image received.' });

    const results = await reverseImageSearch(req.body, type, process.env.SERPAPI_KEY);
    const { best, candidates } = tally(results);
    if (!best) {
      return res.status(404).json({
        error: 'No Pokémon recognised in the search results. Try getting closer or improving the lighting.',
        sample: results.slice(0, 8).map((r) => r.text),
      });
    }

    const pokemon = await getPokemon(best.name);
    res.json({ match: best, candidates, pokemon });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

// Manual lookup by name, e.g. /api/pokemon/Pikachu
app.get('/api/pokemon/:name', async (req, res) => {
  try {
    const name = resolveName(req.params.name);
    if (!name) return res.status(404).json({ error: `Unknown Pokémon "${req.params.name.slice(0, 40)}"` });
    res.json({ pokemon: await getPokemon(name) });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/names', (_req, res) => res.json(POKEMON));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Body-parser and routing errors (oversized upload, malformed URL) as JSON, without stack traces.
app.use((err, _req, res, _next) => {
  const status = err.status ?? 500;
  const message = err.type === 'entity.too.large'
    ? 'Image is too large (max 500 KB).'
    : status < 500 ? err.message : 'Internal server error';
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`Pokédex running at http://localhost:${PORT}`);
  if (!process.env.SERPAPI_KEY) {
    console.warn('Warning: SERPAPI_KEY not set — camera identification is disabled, name search still works.');
  }
});
