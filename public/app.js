const $ = (id) => document.getElementById(id);

const els = {
  video: $('video'), still: $('still'), canvas: $('canvas'), cameraMsg: $('cameraMsg'),
  scanline: $('scanline'), scanBtn: $('scanBtn'), flipBtn: $('flipBtn'), fileInput: $('fileInput'),
  status: $('status'), lens: $('lens'),
  ledRed: $('ledRed'), ledYellow: $('ledYellow'), ledGreen: $('ledGreen'),
  placeholder: $('placeholder'), entry: $('entry'),
  dexNo: $('dexNo'), pkName: $('pkName'), pkArt: $('pkArt'), pkTypes: $('pkTypes'),
  pkCategory: $('pkCategory'), pkHeight: $('pkHeight'), pkWeight: $('pkWeight'), pkAbilities: $('pkAbilities'),
  entryMeta: $('entryMeta'), dexText: $('dexText'), dexScreen: document.querySelector('.dex-text-screen'),
  modeBtn: $('modeBtn'), muteBtn: $('muteBtn'), candidates: $('candidates'),
  searchForm: $('searchForm'), searchInput: $('searchInput'), names: $('names'), sourceLink: $('sourceLink'),
};

const state = {
  pokemon: null,
  mode: 'anime',      // 'anime' | 'game'
  index: 0,
  voiceOn: true,
  facingMode: 'environment',
  stream: null,
  busy: false,
};

const MAX_UPLOAD_BYTES = 480 * 1024; // SerpApi's image upload limit is 500 KB
const MAX_DIMENSION = 1024;

/* ------------------------------------------------------------------ */
/* Status lights + sounds                                              */
/* ------------------------------------------------------------------ */

function setStatus(text, led = null) {
  els.status.textContent = text.toUpperCase();
  for (const l of [els.ledRed, els.ledYellow, els.ledGreen]) l.classList.remove('on');
  if (led) els[`led${led[0].toUpperCase()}${led.slice(1)}`].classList.add('on');
}

let audioCtx;
function beep(freq = 880, duration = 0.08, delay = 0) {
  try {
    audioCtx ??= new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.value = 0.05;
    osc.connect(gain).connect(audioCtx.destination);
    const t = audioCtx.currentTime + delay;
    osc.start(t);
    osc.stop(t + duration);
  } catch { /* audio is a nice-to-have */ }
}
const chirpFound = () => { beep(660, 0.07); beep(990, 0.07, 0.09); beep(1320, 0.12, 0.18); };
const chirpError = () => { beep(300, 0.15); beep(200, 0.25, 0.17); };

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */

async function startCamera() {
  state.stream?.getTracks().forEach((t) => t.stop());
  if (!navigator.mediaDevices?.getUserMedia) {
    els.cameraMsg.textContent = window.isSecureContext
      ? 'No camera available. Use PHOTO instead.'
      : 'Camera needs HTTPS or localhost. Use PHOTO instead.';
    return;
  }
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: state.facingMode }, width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    });
    els.video.srcObject = state.stream;
    els.cameraMsg.textContent = '';
    els.scanBtn.disabled = false;
  } catch (err) {
    els.cameraMsg.textContent = `Camera unavailable (${err.name}). Use PHOTO instead.`;
  }
}

function showLive() {
  els.still.hidden = true;
  els.video.hidden = false;
}

function showStill(src) {
  els.still.src = src;
  els.still.hidden = false;
  els.video.hidden = true;
}

/** Draw a video frame or image to the canvas, scaled down, and return a JPEG under the size limit. */
async function toUploadBlob(source, width, height) {
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  const canvas = els.canvas;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);

  let quality = 0.9;
  let blob;
  do {
    blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    quality -= 0.15;
  } while (blob.size > MAX_UPLOAD_BYTES && quality > 0.2);
  return blob;
}

/* ------------------------------------------------------------------ */
/* Identify                                                            */
/* ------------------------------------------------------------------ */

// Each lookup takes a ticket; a response is ignored if a newer lookup started meanwhile.
let latestRequest = 0;

/** fetch + JSON, with a readable error even when the response isn't JSON. */
async function getJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data;
}

async function identify(blob) {
  const ticket = ++latestRequest;
  state.busy = true;
  stopSpeaking();
  els.scanBtn.disabled = true;
  els.scanline.hidden = false;
  els.candidates.hidden = true;
  setStatus('Scanning…', 'yellow');
  beep(1200, 0.05);

  try {
    const data = await getJson('/api/identify', {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'image/jpeg' },
      body: blob,
    });
    if (ticket !== latestRequest) return;

    chirpFound();
    setStatus(`Match: ${data.match.name} (${data.match.confidence}% of hits)`, 'green');
    renderCandidates(data.candidates);
    showPokemon(data.pokemon);
  } catch (err) {
    if (ticket !== latestRequest) return;
    chirpError();
    setStatus(err.message, 'red');
    showLive();
  } finally {
    els.scanline.hidden = true;
    els.scanBtn.disabled = !state.stream;
    state.busy = false;
  }
}

async function scanFromCamera() {
  const { videoWidth: w, videoHeight: h } = els.video;
  if (!w || state.busy) return;
  const blob = await toUploadBlob(els.video, w, h);
  showStill(els.canvas.toDataURL('image/jpeg', 0.8));
  identify(blob);
}

async function scanFromFile(file) {
  if (state.busy) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    chirpError();
    setStatus("Can't read that image file", 'red');
    return;
  }
  const blob = await toUploadBlob(img, img.naturalWidth, img.naturalHeight);
  if (!els.still.src.startsWith('data:')) URL.revokeObjectURL(els.still.src);
  showStill(url);
  identify(blob);
}

async function lookupByName(name) {
  const ticket = ++latestRequest;
  stopSpeaking();
  setStatus(`Looking up ${name}…`, 'yellow');
  try {
    const data = await getJson(`/api/pokemon/${encodeURIComponent(name)}`);
    if (ticket !== latestRequest) return;
    chirpFound();
    setStatus(`Loaded ${data.pokemon.name}`, 'green');
    showPokemon(data.pokemon);
  } catch (err) {
    if (ticket !== latestRequest) return;
    chirpError();
    setStatus(err.message, 'red');
  }
}

function renderCandidates(candidates) {
  const others = candidates.slice(1);
  els.candidates.replaceChildren();
  if (!others.length) { els.candidates.hidden = true; return; }
  els.candidates.append('Not right? ');
  for (const c of others) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${c.name} ${c.confidence}%`;
    b.addEventListener('click', () => lookupByName(c.name));
    els.candidates.append(b);
  }
  els.candidates.hidden = false;
}

/* ------------------------------------------------------------------ */
/* Display                                                             */
/* ------------------------------------------------------------------ */

function showPokemon(p) {
  state.pokemon = p;
  state.mode = p.animeEntries.length ? 'anime' : 'game';
  state.index = state.mode === 'game' ? p.gameEntries.length - 1 : 0;

  els.placeholder.hidden = true;
  els.entry.hidden = false;
  els.dexNo.textContent = `No.${String(p.ndex).padStart(4, '0')}`;
  els.pkName.textContent = p.name;
  els.pkArt.classList.remove('appear');
  els.pkArt.src = p.image || '';
  els.pkArt.alt = p.name;
  void els.pkArt.offsetWidth; // restart the animation
  els.pkArt.classList.add('appear');

  els.pkTypes.replaceChildren(...p.types.map((t) => {
    const s = document.createElement('span');
    s.className = `type type-${t.toLowerCase()}`;
    s.textContent = t;
    return s;
  }));
  els.pkCategory.textContent = p.category ? `${p.category} Pokémon` : '—';
  els.pkHeight.textContent = [p.height.m && `${p.height.m} m`, p.height.ftin].filter(Boolean).join(' / ') || '—';
  els.pkWeight.textContent = [p.weight.kg && `${p.weight.kg} kg`, p.weight.lbs && `${p.weight.lbs} lbs`].filter(Boolean).join(' / ') || '—';
  els.pkAbilities.textContent = [...p.abilities, p.hiddenAbility && `${p.hiddenAbility} (hidden)`].filter(Boolean).join(', ') || '—';
  els.sourceLink.href = p.url;
  els.sourceLink.textContent = `Bulbapedia: ${p.name}`;

  showEntry(true);
}

function currentEntries() {
  const p = state.pokemon;
  if (!p) return [];
  if (state.mode === 'anime' && p.animeEntries.length) {
    return p.animeEntries.map((e) => ({ meta: `${e.device} · ${e.episode}`, text: e.text, speech: e.text }));
  }
  const intro = p.category ? `${p.name}, the ${p.category} Pokémon.` : `${p.name}.`;
  return p.gameEntries.map((e) => ({ meta: `Pokémon ${e.games.join(' / ')}`, text: e.text, speech: `${intro} ${e.text}` }));
}

function showEntry(speakIt) {
  if (!state.pokemon) return;
  const entries = currentEntries();
  els.modeBtn.textContent = state.mode === 'anime' ? 'ANIME' : 'GAMES';
  if (!entries.length) {
    els.entryMeta.textContent = '';
    els.dexText.textContent = state.pokemon?.summary || 'No Pokédex data.';
    return;
  }
  state.index = (state.index + entries.length) % entries.length;
  const e = entries[state.index];
  els.entryMeta.textContent = `${e.meta}  [${state.index + 1}/${entries.length}]`;
  if (speakIt && state.voiceOn) speak(e.speech);
  else els.dexText.textContent = e.speech;
}

/* ------------------------------------------------------------------ */
/* Voice: Web Speech API with text revealed in sync                    */
/* ------------------------------------------------------------------ */

let voice = null;
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  const prefs = [
    /Google UK English Male/i, /Microsoft (George|Ryan|Guy|David)/i, /Daniel/i,
    /en-GB/i, /Male/i, /^en/i,
  ];
  for (const re of prefs) {
    voice = voices.find((v) => re.test(v.name) || re.test(v.lang));
    if (voice) return;
  }
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.addEventListener('voiceschanged', pickVoice);
}

let revealTimer = null;
let currentText = '';
let blinkTimer = null;

function renderReveal(text, upTo) {
  currentText = text;
  const shown = document.createTextNode(text.slice(0, upTo));
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  els.dexText.replaceChildren(shown, ...(upTo < text.length ? [cursor] : []));
  els.dexScreen.scrollTop = els.dexScreen.scrollHeight;
}

function blinkLens() {
  els.lens.classList.add('blink');
  clearTimeout(blinkTimer);
  blinkTimer = setTimeout(() => els.lens.classList.remove('blink'), 110);
}

function stopSpeaking() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  clearInterval(revealTimer);
  els.lens.classList.remove('blink');
}

function speak(text) {
  stopSpeaking();
  if (!('speechSynthesis' in window)) { els.dexText.textContent = text; return; }

  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.rate = 0.95;
  u.pitch = 0.75;

  // Prefer word-boundary events to reveal text in step with the voice; some
  // voices don't fire them, so fall back to a steady typewriter.
  let gotBoundary = false;
  let revealed = 0;
  renderReveal(text, 0);
  u.onboundary = (ev) => {
    if (ev.name && ev.name !== 'word') return;
    gotBoundary = true;
    clearInterval(revealTimer);
    revealed = Math.max(revealed, ev.charIndex + (ev.charLength || text.slice(ev.charIndex).search(/\s|$/)));
    renderReveal(text, revealed);
    blinkLens();
  };
  u.onstart = () => {
    setTimeout(() => {
      if (gotBoundary) return;
      revealTimer = setInterval(() => {
        revealed += 1;
        renderReveal(text, revealed);
        if (revealed % 6 === 0) blinkLens();
        if (revealed >= text.length) clearInterval(revealTimer);
      }, 55);
    }, 400);
  };
  u.onend = u.onerror = () => {
    clearInterval(revealTimer);
    renderReveal(text, text.length);
  };
  speechSynthesis.speak(u);
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

els.scanBtn.addEventListener('click', () => {
  // A second press after a result returns to the live camera.
  if (!els.still.hidden && !state.busy) { showLive(); setStatus('Ready'); return; }
  scanFromCamera();
});

els.fileInput.addEventListener('change', () => {
  const [file] = els.fileInput.files;
  if (file) scanFromFile(file);
  els.fileInput.value = '';
});

els.flipBtn.addEventListener('click', () => {
  state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
  showLive();
  startCamera();
});

$('dLeft').addEventListener('click', () => { state.index--; showEntry(true); });
$('dRight').addEventListener('click', () => { state.index++; showEntry(true); });
$('dUp').addEventListener('click', () => { els.dexScreen.scrollTop -= 40; });
$('dDown').addEventListener('click', () => { els.dexScreen.scrollTop += 40; });

document.querySelector('.keypad').addEventListener('click', (ev) => {
  const action = ev.target.closest('button')?.dataset.action;
  if (!action) return;
  beep(1000, 0.03);
  switch (action) {
    case 'speak': if (state.pokemon) speak(currentEntries()[state.index]?.speech ?? ''); break;
    case 'stop': stopSpeaking(); renderReveal(currentText, Infinity); break;
    case 'prev': state.index--; showEntry(true); break;
    case 'next': state.index++; showEntry(true); break;
    case 'mode':
      if (!state.pokemon) break;
      state.mode = state.mode === 'anime' ? 'game' : 'anime';
      if (state.mode === 'anime' && !state.pokemon.animeEntries.length) {
        state.mode = 'game';
        setStatus(`No anime entries for ${state.pokemon.name}`, 'yellow');
        break;
      }
      state.index = state.mode === 'game' ? state.pokemon.gameEntries.length - 1 : 0;
      showEntry(true);
      break;
    case 'mute':
      state.voiceOn = !state.voiceOn;
      els.muteBtn.textContent = state.voiceOn ? 'VOICE ON' : 'VOICE OFF';
      if (!state.voiceOn) stopSpeaking();
      break;
  }
});

els.searchForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const name = els.searchInput.value.trim();
  if (name) lookupByName(name);
  els.searchInput.blur();
});

fetch('/api/names')
  .then((r) => r.json())
  .then((list) => {
    els.names.replaceChildren(...list.map((p) => {
      const o = document.createElement('option');
      o.value = p.name;
      return o;
    }));
  })
  .catch(() => {});

setStatus('Ready');
startCamera();
