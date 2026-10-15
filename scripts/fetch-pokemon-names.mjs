// Regenerates data/pokemon.json (National Dex number + English name) from PokeAPI.
// Run with: npm run update-names
import { writeFile } from 'node:fs/promises';

const query = `{ pokemonspecies(order_by:{id:asc}) {
  id pokemonspeciesnames(where:{language:{name:{_eq:"en"}}}) { name } } }`;

const res = await fetch('https://graphql.pokeapi.co/v1beta2', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
});
if (!res.ok) throw new Error(`PokeAPI responded ${res.status}`);
const { data } = await res.json();

const list = data.pokemonspecies
  .filter((s) => s.pokemonspeciesnames.length)
  .map((s) => ({ id: s.id, name: s.pokemonspeciesnames[0].name }));

await writeFile(new URL('../data/pokemon.json', import.meta.url), JSON.stringify(list));
console.log(`Saved ${list.length} Pokémon names.`);
