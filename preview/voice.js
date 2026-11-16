// Turn-based voice layer for the existing "Talk to Dr.X" dialog.
//
// Additive only: it never changes app.js. A recognised utterance is placed in
// the existing #question box and submitted through the existing #chat-form, so
// answers keep coming from the same curated, source-labelled profile pipeline.
// The next assistant message that pipeline appends is read aloud with the
// visitor's device voice. Nothing is recorded, stored or sent anywhere by this
// script; speech-to-text runs in the browser's own speech service.

const ANSWER_TIMEOUT_MS = 95000; // app.js allows on-device generation up to 90 s
const MAX_NOTES = 20;
const VOICE_BASE = '/CLASS-A/preview/voice/';
// The site's existing cut-out portrait (already loaded by the home page).
// Erfan's Dr.X portrait (owner-supplied cut-out, proportionally scaled to 640 px, pixels otherwise unchanged).
const LIKENESS_SRC = VOICE_BASE + 'drx-likeness.webp';

const $ = (selector, root = document) => root.querySelector(selector);
const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

const STATUS = {
  idle: 'Tap the orb and speak. One question per tap.',
  unsupported: 'Voice input is not supported in this browser. Type your question below.',
  listening: 'Listening… speak now.',
  thinking: 'Finding a sourced answer…',
  speaking: 'Speaking…',
  speakingRecorded: "Speaking with Erfan's AI-generated voice.",
  speakingDevice: 'Speaking with your device voice.',
  muted: 'Answer shown. Spoken replies are muted.',
  noSpeech: "I didn't hear anything. Tap the orb to try again.",
  denied: 'Microphone access was blocked. Allow it in your browser settings, or type below.',
  offline: 'The speech service could not be reached. Check your connection, or type below.',
  timeout: 'No answer arrived in time. Please try again or type your question.',
  busy: 'Dr.X is still answering. Try again in a moment.',
  error: 'Voice input stopped unexpectedly. Tap the orb to try again, or type below.',
};

const panel = document.createElement('section');
panel.className = 'voice-panel';
panel.setAttribute('aria-label', 'Voice conversation');
panel.innerHTML = `
  <div class="voice-stage">
    <div class="voice-holo" aria-hidden="true">
      <div class="voice-holo-figure">
        <img class="voice-holo-base" src="${LIKENESS_SRC}" alt="">
        <span class="voice-holo-mouth"></span>
        <img class="voice-holo-jaw" src="${LIKENESS_SRC}" alt="">
        <span class="voice-holo-scan"></span>
      </div>
      <span class="voice-holo-label">AI likeness</span>
    </div>
    <button type="button" class="voice-orb" id="voice-orb" aria-pressed="false" aria-describedby="voice-consent">
      <span class="voice-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
      <span class="voice-orb-label">Talk to Dr.X</span>
    </button>
    <div class="voice-side">
      <p class="voice-status" id="voice-status" role="status"></p>
      <div class="voice-controls">
        <label class="voice-lang">Speak in
          <select id="voice-lang"><option value="en-GB">English</option><option value="bn-BD">বাংলা</option></select>
        </label>
        <button type="button" class="quiet-button" id="voice-stop" disabled>Stop</button>
        <button type="button" class="quiet-button" id="voice-mute" aria-pressed="false">Mute replies</button>
        <button type="button" class="quiet-button" id="voice-replay" disabled>Replay</button>
        <button type="button" class="quiet-button" id="voice-live" aria-pressed="false" hidden>Live conversation: off</button>
      </div>
    </div>
  </div>
  <p class="voice-transcript" id="voice-transcript" aria-live="polite"></p>
  <details class="voice-notes" id="voice-notes-box">
    <summary>Conversation notes · this tab only (<span id="voice-note-count">0</span>)</summary>
    <ol id="voice-notes"></ol>
  </details>
  <p class="voice-brief">AI-generated voice and likeness. Nothing is recorded or stored.</p>
  <details class="voice-more"><summary>How voice works</summary><p class="voice-consent" id="voice-consent">Turn-based voice: tap, ask one question, then hear the answer. Your browser converts speech to text (in Chrome, Google's speech service). This site does not record or store audio, transcripts or notes. Replies are read by an AI-generated voice that is not a recording of Erfan, or by your device voice if that audio is unavailable. The hologram is Erfan's Dr.X portrait; its mouth follows the loudness of the reply, not exact lip-sync. Answers are in English.</p></details>`;

const dialog = $('#chat-dialog');
const anchor = $('#chat-dialog .conversation-controls');
if (dialog && anchor) anchor.after(panel);

const orb = $('#voice-orb');
const statusEl = $('#voice-status');
const transcriptEl = $('#voice-transcript');
const notesEl = $('#voice-notes');
const noteCount = $('#voice-note-count');
const stopBtn = $('#voice-stop');
const muteBtn = $('#voice-mute');
const replayBtn = $('#voice-replay');
const langSelect = $('#voice-lang');
const liveBtn = $('#voice-live');

// Live mode: a hands-free conversation. Replies are spoken sentence by sentence, the visitor can
// interrupt by speaking, and listening restarts after each reply. Without a proxy the replies are
// the site's own curated answers; when the page names a proxy (a worker that answers only from
// approved public profile text), replies are written live and streamed.
const LIVE_URL = (document.querySelector('meta[name="drx-live-proxy"]')?.content || window.DRX_LIVE_PROXY || '').replace(/\/$/, '');
let liveOn = false;
let liveAbort = null;
let liveSpeech = { pending: 0, done: true, token: 0, spoken: '' };
let bargeRec = null;

let state = 'idle';
let recognition = null;
let muted = false;
let lastSpoken = '';
let answerWait = null;
let session = 0;

function setState(next, message = STATUS[next] || '') {
  state = next;
  panel.dataset.state = next;
  orb.setAttribute('aria-pressed', String(next === 'listening'));
  orb.querySelector('.voice-orb-label').textContent =
    next === 'listening' ? 'Listening…' : next === 'speaking' ? 'Speaking…' : next === 'thinking' ? 'Thinking…' : 'Talk to Dr.X';
  stopBtn.disabled = !['listening', 'thinking', 'speaking'].includes(next);
  statusEl.textContent = message;
}

function addNote(question, answerSource) {
  const item = document.createElement('li');
  const q = document.createElement('span');
  q.textContent = `You asked: “${question}”`;
  item.append(q);
  if (answerSource) {
    const s = document.createElement('small');
    s.textContent = answerSource;
    item.append(s);
  }
  notesEl.append(item);
  while (notesEl.children.length > MAX_NOTES) notesEl.firstElementChild.remove();
  noteCount.textContent = String(notesEl.children.length);
}

function clearNotes() {
  notesEl.replaceChildren();
  noteCount.textContent = '0';
  transcriptEl.textContent = '';
}

// Pre-rendered answers in Erfan's AI-generated voice, keyed by sha256 of the exact
// curated answer text. Absent or failing files fall back to the device voice.
let recordedVoice = null;
let levelFrame = 0;
let audioGraph = null;
// One shared player, unlocked on the orb tap so later playback (after the answer
// arrives) is allowed on mobile browsers that require a user gesture.
const player = new Audio();
player.preload = 'auto';
let playerUnlocked = false;
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
const recordedReady = fetch(VOICE_BASE + 'voice-manifest.json', { cache: 'no-cache' })
  .then(r => (r.ok ? r.json() : null))
  .then(manifest => { recordedVoice = manifest && manifest.answers ? manifest.answers : null; })
  .catch(() => { recordedVoice = null; });

async function recordedFileFor(text) {
  await recordedReady;
  if (!recordedVoice || !window.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const key = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  const entry = recordedVoice[key];
  return entry && entry.passed_gate !== false ? entry.file : null;
}

// Called inside the orb tap: unlock the shared player and the level meter.
function unlockAudio() {
  if (!playerUnlocked) {
    playerUnlocked = true;
    player.src = SILENT_WAV;
    player.play().catch(() => {});
  }
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx && !audioGraph) {
      const ctx = new AudioCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      ctx.createMediaElementSource(player).connect(analyser);
      analyser.connect(ctx.destination);
      audioGraph = { ctx, analyser, data: new Uint8Array(analyser.frequencyBinCount) };
    }
    audioGraph?.ctx.resume();
  } catch {
    audioGraph = null; // level meter is optional; playback still works without it
  }
}

function stopLevels() {
  cancelAnimationFrame(levelFrame);
  clearTimeout(wordPulseTimer);
  setJaw(0);
  panel.querySelectorAll('.voice-bars i').forEach(bar => { bar.style.scale = ''; });
  panel.classList.remove('voice-live-levels');
}

// Drive the bars from the real audio level of the playing recording.
// Jaw opening 0..1 drives the hologram's mouth. It follows measured loudness of the
// recorded reply (not phonemes); with the device voice it pulses on word boundaries.
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
let jaw = 0;
let wordPulseTimer = 0;
function setJaw(value) {
  jaw = reduceMotion ? 0 : Math.max(0, Math.min(1, value));
  panel.style.setProperty('--jaw', jaw.toFixed(3));
}
function pulseJaw() {
  setJaw(0.85);
  clearTimeout(wordPulseTimer);
  wordPulseTimer = setTimeout(() => setJaw(0.15), 140);
}

function startLevels() {
  if (!audioGraph) return;
  const bars = [...panel.querySelectorAll('.voice-bars i')];
  const wave = audioGraph.wave || (audioGraph.wave = new Uint8Array(audioGraph.analyser.fftSize));
  panel.classList.add('voice-live-levels');
  const tick = () => {
    audioGraph.analyser.getByteFrequencyData(audioGraph.data);
    for (let i = 0; i < bars.length; i++) bars[i].style.scale = `1 ${(6 + (audioGraph.data[i + 1] / 255) * 16) / 22}`;
    audioGraph.analyser.getByteTimeDomainData(wave);
    let sum = 0;
    for (let i = 0; i < wave.length; i++) { const v = (wave[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / wave.length);
    setJaw(jaw * 0.55 + Math.min(1, Math.max(0, (rms - 0.015) * 9)) * 0.45);
    levelFrame = requestAnimationFrame(tick);
  };
  tick();
}

function cancelSpeech() {
  liveSpeech = { pending: 0, done: true, token: 0, spoken: '' };
  stopBarge();
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  player.onplay = player.onended = player.onerror = null;
  player.pause();
  stopLevels();
}

function speakWithDevice(text, token) {
  if (!('speechSynthesis' in window)) {
    setState('idle', 'Answer shown. Read-aloud is unavailable in this browser.');
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-GB';
  utterance.rate = 0.97;
  utterance.onstart = () => { if (token === session) setState('speaking', STATUS.speakingDevice); };
  utterance.onboundary = () => { panel.classList.toggle('voice-beat'); pulseJaw(); };
  utterance.onend = () => { if (token === session) { setJaw(0); setState('idle'); } };
  utterance.onerror = () => { if (token === session) setState('idle', 'Answer shown. Your browser could not read it aloud.'); };
  window.speechSynthesis.speak(utterance);
}

async function speak(text, token) {
  lastSpoken = text;
  replayBtn.disabled = !text;
  if (muted) { setState('idle', STATUS.muted); return; }
  cancelSpeech();
  const file = await recordedFileFor(text);
  if (token !== session) return;
  if (!file) { speakWithDevice(text, token); return; }
  let fellBack = false;
  const fallback = () => {
    if (fellBack || token !== session) return;
    fellBack = true;
    cancelSpeech();
    speakWithDevice(text, token);
  };
  player.onplay = () => { if (token === session) { setState('speaking', STATUS.speakingRecorded); startLevels(); } };
  player.onended = () => { if (token === session) { stopLevels(); setState('idle'); } };
  player.onerror = fallback;
  player.src = VOICE_BASE + file;
  player.play().catch(fallback);
}

function waitForAnswer(token) {
  const messages = $('#messages');
  const before = messages.querySelectorAll('.message.assistant').length;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('timeout')); }, ANSWER_TIMEOUT_MS);
    const observer = new MutationObserver(() => {
      const replies = messages.querySelectorAll('.message.assistant');
      if (replies.length > before) {
        clearTimeout(timer);
        observer.disconnect();
        const reply = replies[replies.length - 1];
        const paragraphs = reply.querySelectorAll('p');
        resolve({
          text: paragraphs[0] ? paragraphs[0].textContent : '',
          source: reply.querySelector('.message-source')?.textContent || '',
        });
      }
    });
    observer.observe(messages, { childList: true, subtree: true });
    answerWait = { cancel: () => { clearTimeout(timer); observer.disconnect(); reject(new Error('cancelled')); }, token };
  });
}

async function submitQuestion(question, token) {
  const sendButton = $('#send-question');
  if (sendButton && sendButton.disabled) { setState('idle', STATUS.busy); return; }
  if (liveOn && LIVE_URL && await liveTurn(question, token)) return;
  if (token !== session) return;
  setState('thinking');
  const pending = waitForAnswer(token);
  $('#question').value = question;
  $('#chat-form').requestSubmit();
  try {
    const answer = await pending;
    if (token !== session) return;
    addNote(question, answer.source);
    if (liveOn) speakLive(answer.text, token); else speak(answer.text, token);
  } catch (error) {
    if (token === session && error.message === 'timeout') setState('idle', STATUS.timeout);
  } finally {
    answerWait = null;
  }
}

function startListening(seed = '') {
  const token = ++session;
  cancelSpeech();
  transcriptEl.textContent = '';
  const rec = new SpeechRecognitionImpl();
  recognition = rec;
  recognition.lang = langSelect.value;
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;
  let finalText = seed ? `${seed} ` : '';
  let failed = false;
  recognition.onstart = () => { if (token === session) setState('listening'); };
  recognition.onresult = event => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const piece = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += piece; else interim += piece;
    }
    transcriptEl.textContent = (finalText + interim).trim();
  };
  recognition.onerror = event => {
    if (token !== session) return;
    failed = true;
    const kind = event.error;
    if (kind === 'no-speech') setState('idle', STATUS.noSpeech);
    else if (kind === 'not-allowed' || kind === 'service-not-allowed') setState('idle', STATUS.denied);
    else if (kind === 'network') setState('idle', STATUS.offline);
    else if (kind === 'aborted') setState('idle');
    else setState('idle', STATUS.error);
  };
  recognition.onend = () => {
    if (recognition === rec) recognition = null;
    if (token !== session || failed) return;
    const question = finalText.trim().slice(0, 600);
    if (!question) { setState('idle', STATUS.noSpeech); return; }
    transcriptEl.textContent = question;
    submitQuestion(question, token);
  };
  try {
    recognition.start();
  } catch {
    setState('idle', STATUS.error);
  }
}


function addChat(type, text) {
  const box = $('#messages');
  box.querySelector('.welcome')?.remove();
  const message = document.createElement('div');
  message.className = `message ${type}`;
  if (type === 'assistant') {
    const who = document.createElement('span');
    who.className = 'speaker';
    who.textContent = 'DR.X';
    message.append(who);
  }
  const p = document.createElement('p');
  p.textContent = text;
  message.append(p);
  box.append(message);
  box.scrollTop = box.scrollHeight;
  return { message, p };
}

function liveHistory() {
  return [...$('#messages').querySelectorAll('.message')].slice(-6).map(m => ({
    role: m.classList.contains('user') ? 'user' : 'assistant',
    text: m.querySelector('p')?.textContent || '',
  })).filter(t => t.text);
}

async function readEvents(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i;
    while ((i = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      const [eventLine, dataLine] = block.split('\n');
      if (!dataLine) continue;
      onEvent(eventLine.replace('event: ', ''), JSON.parse(dataLine.replace('data: ', '')));
    }
  }
}

function stopBarge() {
  if (bargeRec) { const r = bargeRec; bargeRec = null; r.onresult = r.onend = r.onerror = null; try { r.abort(); } catch { /* already stopped */ } }
}

// While the reply is being spoken, keep listening. Three or more new words that are not just the
// reply echoing back through the speakers interrupt it: speech stops and the request is cancelled.
function startBarge(token) {
  if (bargeRec || !SpeechRecognitionImpl) return;
  const r = new SpeechRecognitionImpl();
  bargeRec = r;
  r.lang = langSelect.value;
  r.interimResults = true;
  r.continuous = true;
  r.onresult = event => {
    if (token !== session) return;
    let heard = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) heard += event.results[i][0].transcript;
    const words = heard.toLowerCase().match(/[a-z\u0980-\u09ff']+/g) || [];
    const spoken = liveSpeech.spoken.toLowerCase();
    const fresh = words.filter(w => !spoken.includes(w));
    if (words.length < 3 || fresh.length / words.length < 0.5) return;
    const seed = heard.trim();
    if (liveAbort) { liveAbort.abort(); liveAbort = null; }
    session += 1;
    cancelSpeech();
    setState('listening');
    setTimeout(() => { if (state === 'listening') startListening(seed); }, 120);
  };
  r.onend = r.onerror = () => { if (bargeRec === r) bargeRec = null; };
  try { r.start(); } catch { bargeRec = null; }
}

function finishLive(token) {
  if (token !== session || !liveSpeech.done || liveSpeech.pending > 0) return;
  stopBarge();
  setJaw(0);
  setState('idle');
  if (liveOn) setTimeout(() => { if (token === session && state === 'idle') startListening(); }, 250);
}

function speakLiveSentence(text, token) {
  lastSpoken = `${lastSpoken ? lastSpoken + ' ' : ''}${text}`;
  replayBtn.disabled = false;
  if (muted || !('speechSynthesis' in window)) return;
  liveSpeech.spoken += ` ${text}`;
  liveSpeech.pending += 1;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-GB';
  u.rate = 1;
  u.onstart = () => { if (token === session) { setState('speaking', STATUS.speakingDevice); startBarge(token); } };
  u.onboundary = () => { panel.classList.toggle('voice-beat'); pulseJaw(); };
  u.onend = u.onerror = () => { liveSpeech.pending -= 1; finishLive(token); };
  window.speechSynthesis.speak(u);
}

// Split an answer into sentences without breaking after titles such as "Dr." or inside "co.lab".
const TITLE_END = /\b(?:Dr|Mr|Mrs|Ms|St|No|vs)\.$/;
function splitSentences(text) {
  const out = [];
  const boundary = /[.!?]+["')\]]*\s+(?=[A-Z0-9"'(\[])/g;
  let start = 0;
  let m;
  while ((m = boundary.exec(text))) {
    const end = m.index + m[0].length;
    const piece = text.slice(start, end).trim();
    if (TITLE_END.test(piece)) continue;
    out.push(piece);
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

// Speak a complete curated answer the live way: sentence by sentence, interruptible, then listen again.
function speakLive(text, token) {
  cancelSpeech();
  liveSpeech = { pending: 0, done: false, token, spoken: '' };
  lastSpoken = '';
  if (muted) {
    lastSpoken = text;
    replayBtn.disabled = !text;
    liveSpeech.done = true;
    setState('idle', STATUS.muted);
    return;
  }
  for (const sentence of splitSentences(text)) speakLiveSentence(sentence, token);
  liveSpeech.done = true;
  if (liveSpeech.pending === 0) finishLive(token);
}

// Returns true when the live proxy produced an answer, false to fall back to the curated guide.
async function liveTurn(question, token) {
  setState('thinking');
  const history = liveHistory();
  const abort = new AbortController();
  liveAbort = abort;
  cancelSpeech();
  liveSpeech = { pending: 0, done: false, token, spoken: '' };
  lastSpoken = '';
  const timer = setTimeout(() => abort.abort(), ANSWER_TIMEOUT_MS);
  let user = null;
  let reply = null;
  let got = 0;
  try {
    const res = await fetch(`${LIVE_URL}/v1/live/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, history }), signal: abort.signal });
    if (!res.ok || !res.body) throw new Error('proxy');
    user = addChat('user', question);
    reply = addChat('assistant', '');
    await readEvents(res.body, (event, data) => {
      if (token !== session) return;
      if (event === 'sentence') {
        got += 1;
        reply.p.textContent += `${reply.p.textContent ? ' ' : ''}${data.text}`;
        speakLiveSentence(data.text, token);
      } else if (event === 'error' && !got) {
        throw new Error('model');
      }
    });
    if (token !== session) return true;
    if (!got) throw new Error('empty');
    const src = document.createElement('p');
    src.className = 'message-source';
    src.textContent = 'Live answer · built only from approved profile text';
    reply.message.append(src);
    addNote(question, 'Live answer · approved profile text');
    liveSpeech.done = true;
    if (muted) { setState('idle', STATUS.muted); return true; }
    if (liveSpeech.pending === 0) finishLive(token);
    return true;
  } catch (error) {
    if (token !== session || error.name === 'AbortError') return true;
    if (!got) { user?.message.remove(); reply?.message.remove(); liveSpeech.done = true; return false; }
    liveSpeech.done = true;
    return true;
  } finally {
    clearTimeout(timer);
    if (liveAbort === abort) liveAbort = null;
  }
}

function stopAll() {
  session += 1;
  if (liveAbort) { liveAbort.abort(); liveAbort = null; }
  if (recognition) { try { recognition.abort(); } catch { /* already stopped */ } recognition = null; }
  if (answerWait) answerWait.cancel();
  cancelSpeech();
  setState('idle');
}

if (dialog && anchor) {
  if (!SpeechRecognitionImpl) {
    orb.disabled = true;
    langSelect.disabled = true;
    setState('unsupported');
  } else {
    setState('idle');
  }
  orb.addEventListener('click', () => {
    if (state === 'listening' || state === 'speaking' || state === 'thinking') { stopAll(); return; }
    unlockAudio();
    startListening();
  });
  stopBtn.addEventListener('click', stopAll);
  if (SpeechRecognitionImpl) {
    liveBtn.hidden = false;
    $('#voice-consent').append(LIVE_URL
      ? ' Live conversation (optional, off by default) keeps listening after each reply and lets you interrupt by speaking. It sends the text of your question to Dr. X\u2019s proxy and an AI model run by Cloudflare, which writes the reply from Erfan\u2019s approved public profile text only. This site does not store it. Use headphones so Dr. X does not hear itself.'
      : ' Live conversation (optional, off by default) keeps listening after each reply and lets you interrupt by speaking. The answers are the same curated ones. Use headphones so Dr. X does not hear itself.');
    liveBtn.addEventListener('click', () => {
      liveOn = !liveOn;
      liveBtn.setAttribute('aria-pressed', String(liveOn));
      liveBtn.textContent = `Live conversation: ${liveOn ? 'on (hands-free)' : 'off'}`;
      if (!liveOn) { if (state !== 'idle') stopAll(); return; }
      if (state === 'idle') { unlockAudio(); startListening(); }
    });
  }
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    muteBtn.setAttribute('aria-pressed', String(muted));
    muteBtn.textContent = muted ? 'Unmute replies' : 'Mute replies';
    if (muted && state === 'speaking') { cancelSpeech(); setState('idle', STATUS.muted); }
  });
  replayBtn.addEventListener('click', () => { if (lastSpoken && !muted) { unlockAudio(); speak(lastSpoken, ++session); } });
  $('#clear-chat')?.addEventListener('click', () => { stopAll(); clearNotes(); lastSpoken = ''; replayBtn.disabled = true; });
  dialog.addEventListener('close', stopAll);
  window.addEventListener('pagehide', stopAll);
}
