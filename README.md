# Camera Pokédex

Point your camera at a Pokémon (a plush, a card, a screen, a figure) and press **SCAN**. 

The app:

1. **Reverse image searches** the photo with Google Lens (via [SerpApi](https://serpapi.com/google-lens-api)).
2. **Tallies every Pokémon name** that appears in the matching results. Higher-ranked results count for more, and the most common/highest-scoring name wins. The runners-up are shown as "Not right?" buttons.
3. **Looks the winner up on [Bulbapedia](https://bulbapedia.bulbagarden.net)** through its MediaWiki API, and pulls out the National Dex number, types, species, height, weight, abilities, and every Pokédex entry. That includes the lines spoken by the Pokédex in the animated series.
4. **Displays and reads it aloud** in anime style ("Pikachu, the Mouse Pokémon…"). The text types out in sync with the voice, and the big blue lens flashes as it talks.

## Setup

Requires Node 22+.

```bash
npm install
cp .env.example .env     # then put your SerpApi key in .env
npm start
```

Open http://localhost:3000.

- **SerpApi key:** sign up at https://serpapi.com. The free plan covers 250 searches/month, and each scan uses one. Without a key, name search still works and only camera scanning is disabled.
- **Camera access** only works on `localhost` or over HTTPS. To use your phone, serve the app over HTTPS, for example with `npx localtunnel --port 3000` or an ngrok tunnel. You can also use the **PHOTO** button to pick an existing picture.

## Controls

| Control | Action |
| --- | --- |
| SCAN | Capture and identify. Press again to return to the live camera |
| PHOTO | Identify from an image file |
| FLIP | Switch front/back camera |
| D-pad ◀ ▶ / PREV / NEXT | Cycle through Pokédex entries |
| D-pad ▲ ▼ | Scroll the entry text |
| ANIME / GAMES | Toggle between anime Pokédex lines and the video game entries |
| SPEAK / STOP / VOICE | Replay, stop, or mute the voice |

## Project layout

```
src/server.js         Express server: /api/identify, /api/pokemon/:name, /api/names
src/reverseSearch.js  Upload to SerpApi + Google Lens query, flattened into weighted text
src/matcher.js        Finds Pokémon names in result text and scores them
src/bulbapedia.js     Fetches + parses a Bulbapedia Pokémon page
src/wikitext.js       Small wikitext template parser / plain-text renderer
public/               Pokédex UI (camera, display, Web Speech API voice)
data/pokemon.json     All 1025 species names (regenerate with `npm run update-names`)
test/                 `npm test`
```

## Notes

- The voice uses your browser's built-in speech synthesis. It prefers a low-pitched English male voice when one is available. Chrome and Edge have the best voices.
- Bulbapedia responses are cached in memory for the lifetime of the server.
- Pokémon artwork comes from the PokeAPI sprite repository. Pokémon and all related names are trademarks of Nintendo, Game Freak, and The Pokémon Company.
