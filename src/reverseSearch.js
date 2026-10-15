// Reverse image search via SerpApi's Google Lens engine.
// The photo is uploaded to SerpApi's Image API first (no public URL needed).

const SERPAPI = 'https://serpapi.com';
const TIMEOUT_MS = 30_000;

export async function reverseImageSearch(imageBuffer, mimeType, apiKey) {
  if (!apiKey) throw new Error('SERPAPI_KEY is not set. Copy .env.example to .env and add your key.');

  const imageId = await uploadImage(imageBuffer, mimeType, apiKey);

  const url = new URL('/search.json', SERPAPI);
  url.search = new URLSearchParams({
    engine: 'google_lens',
    image_id: imageId,
    hl: 'en',
    country: 'us',
    api_key: apiKey,
  });
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const json = await res.json().catch(() => ({ error: `unexpected response (HTTP ${res.status})` }));
  if (json.error) throw new Error(`Google Lens: ${json.error}`);

  return resultTexts(json);
}

async function uploadImage(buffer, mimeType, apiKey) {
  const form = new FormData();
  form.append('image', new Blob([buffer], { type: mimeType }), `capture.${mimeType.split('/')[1]}`);
  form.append('api_key', apiKey);

  const res = await fetch(`${SERPAPI}/image`, { method: 'POST', body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error || !json.image_id) {
    throw new Error(`Image upload failed: ${json.error ?? `HTTP ${res.status}`}`);
  }
  return json.image_id;
}

/**
 * Flatten the Lens response into weighted text snippets. Higher-ranked visual
 * matches count for more; Google's own label for the image counts most.
 */
export function resultTexts(json) {
  const texts = [];
  const kg = [json.knowledge_graph].flat().filter(Boolean);
  for (const k of kg) if (k.title) texts.push({ text: k.title, weight: 5, source: 'knowledge_graph' });

  for (const r of json.related_content ?? []) {
    if (r.query) texts.push({ text: r.query, weight: 2, source: 'related_content' });
  }

  (json.visual_matches ?? []).forEach((m, i) => {
    const text = [m.title, m.source].filter(Boolean).join(' ');
    texts.push({ text, weight: Math.max(0.3, 1 - i * 0.02), source: 'visual_match' });
  });

  (json.organic_results ?? []).forEach((r, i) => {
    texts.push({ text: r.title ?? '', weight: Math.max(0.3, 0.8 - i * 0.05), source: 'organic' });
  });

  return texts;
}
