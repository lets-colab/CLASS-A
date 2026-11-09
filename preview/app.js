import { retrieve, selectSourcedAnswer } from './profile-logic.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const workDialog = $('#work-dialog'), chatDialog = $('#chat-dialog');
let profile; let selectedPerspective = 'strategist'; let selectedProject = 'party-lab';
let previousAnswerId = ''; let lastReply = ''; let aiWorker; let aiReady = false; let mode = 'guide'; let busy = false; let speaking = false; let aiLoadAttempt = 0; let abortAISetup;
const perspectiveCopy = {
  strategist: { number: '01', title: 'The strategist', description: 'Clarity before complexity.<br> A clear story, a useful offer,<br> a reason to care.', skills: ['Brand positioning', 'Creator ecosystems', 'Business development'], project: 'skinseoul' },
  'experience-builder': { number: '02', title: 'The experience builder', description: 'People remember how it felt.<br> Turn an audience into a community.<br> Make the moment matter.', skills: ['Live experiences', 'Ambassador communities', 'Guest journeys'], project: 'party-lab' },
  'systems-thinker': { number: '03', title: 'The systems thinker', description: 'Give good thinking continuity.<br> Connect context, decisions<br> and the next useful move.', skills: ['Second-brain design', 'AI-assisted workflows', 'Evidence-based review'], project: 'dr-x' }
};

function node(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
function updateNav(section) { $$('.nav-link').forEach((b, i) => b.classList.toggle('active', i === { profile: 0, work: 1, chat: 2 }[section])); }
function openDialog(dialog, section) { $$('dialog[open]').forEach(d => d.close()); dialog.showModal(); updateNav(section); document.body.style.overflow = 'hidden'; }
function closeDialogs() { $$('dialog[open]').forEach(d => d.close()); }
function openWork(id) { if (!profile) return; renderProject(id || selectedProject); openDialog(workDialog, 'work'); }
function openChat(question) { openDialog(chatDialog, 'chat'); if (question) ask(question); else $('#question').focus(); }

function renderPerspective(id) {
  selectedPerspective = id; document.body.dataset.perspective = id;
  const p = perspectiveCopy[id]; $('#perspective-number').textContent = p.number;
  $('#perspective-title').replaceChildren(document.createTextNode(p.title), node('span', 'blue', '.'));
  $('#perspective-description').innerHTML = p.description;
  $('#skill-list').replaceChildren(...p.skills.map(skill => { const b = node('button', '', skill); b.append(node('span', '', '→')); b.addEventListener('click', () => openChat(`What is Erfan's experience with ${skill.toLowerCase()}?`)); return b; }));
  $$('.perspective-tab[data-perspective]').forEach(button => { const selected = button.dataset.perspective === id; button.classList.toggle('selected', selected); button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; });
}

function renderProject(id) {
  const project = profile.projects.find(x => x.id === id) || profile.projects[0]; selectedProject = project.id;
  const tabs = $('#project-tabs'); tabs.replaceChildren(...profile.projects.map(p => {
    const b = node('button', '', p.id === 'last-bench' ? 'Last Bench' : p.title); b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(p.id === project.id)); b.tabIndex = p.id === project.id ? 0 : -1;
    b.addEventListener('click', () => renderProject(p.id)); b.addEventListener('keydown', e => { if (['ArrowLeft','ArrowRight'].includes(e.key)) { e.preventDefault(); const i = profile.projects.findIndex(x => x.id === p.id); renderProject(profile.projects[(i + (e.key === 'ArrowRight' ? 1 : 3)) % 4].id); $('#project-tabs [aria-selected="true"]').focus(); } }); return b;
  }));
  const content = node('div', 'case-content'); content.append(node('h3', 'case-title', project.title), node('p', 'case-category', project.category), node('div', 'case-date', project.date), node('p', 'case-summary', project.summary), node('div', 'contribution-label', 'MY CONTRIBUTION'), node('p', 'case-contribution', project.contribution));
  const skills = node('div', 'case-skills'); project.work.forEach(x => skills.append(node('span', '', x))); content.append(skills);
  const note = node('aside', 'case-note');
  if (project.metrics.length) { const metric = project.metrics[0]; note.append(node('div', 'metric', metric.value), node('strong', '', metric.label), node('p', '', 'Reported in supplied CV.')); }
  else {
    const label = { skinseoul: 'Before launch.', 'last-bench': 'In progress.', 'dr-x': 'Human-directed.' }[project.id];
    const copy = { skinseoul: 'Creator briefs, onboarding and affiliate pilot planning. This case represents prelaunch strategy.', 'last-bench': 'Brand direction, learning experiences and business innovation in an ongoing founder role.', 'dr-x': 'Knowledge, context, prompts and workflow prototypes, developed in collaboration with AI.' }[project.id];
    note.append(node('strong', '', label), node('p', '', copy));
  }
  const askButton = node('button', 'text-link', 'Ask Dr.X about this ↗'); askButton.addEventListener('click', () => openChat(`Tell me about ${project.title}.`)); note.append(askButton);
  $('#case-study').replaceChildren(content, note);
}

function renderCareer() {
  $('#career-list').replaceChildren(...profile.career.map(item => { const li = node('li'); const text = node('div'); text.append(node('h4', '', item.organization), node('p', '', item.role), node('p', '', item.summary)); li.append(node('time', '', item.date_display), text); return li; }));
}

function appendMessage(type, text, source = '') {
  const welcome = $('.welcome'); if (welcome) welcome.remove();
  const message = node('div', `message ${type}`); if (type === 'assistant') message.append(node('span', 'speaker', 'DR.X'));
  message.append(node('p', '', text)); if (source) message.append(node('p', 'message-source', source));
  $('#messages').append(message); $('#messages').scrollTop = $('#messages').scrollHeight;
  return message;
}

function sourceLabel(answer) {
  return ['second-brain', 'ai-collaboration', 'guide-identity', 'boundaries', 'unknown','proof-of-work','gateway-connection'].includes(answer.id) ? 'Source: curated professional profile · 30 Oct 2026' : 'Source: supplied CV · 21 Oct 2026';
}

async function ask(question) {
  question = question.trim().slice(0, 600); if (!question || busy) return;
  if (!profile) { $('#voice-note').textContent = 'The profile is still loading. Please try again in a moment.'; return; }
  busy = true; $('#send-question').disabled = true; $('#question').value = ''; $('#question').style.height = '';
  appendMessage('user', question);
  const answer = retrieve(question, profile.knowledge, previousAnswerId); previousAnswerId = answer.id;
  try {
    let text = answer.answer; let label = sourceLabel(answer);
    const protectedTopic = /\b(price|pricing|available|availability|salary|revenue|profit|valuation|married|wife|birthday|religion|politic|guarantee)\b/i.test(question);
    if (mode === 'ai' && aiReady && !protectedTopic && !['boundaries','guide-identity','contact','gateway-connection'].includes(answer.id)) {
      $('#mode-status').textContent = 'On-device AI · Finding a profile source…';
      const generated = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { aiWorker.terminate(); aiWorker = null; aiReady = false; mode = 'guide'; updateMode(); reject(new Error('generation timeout')); }, 90000);
        const handler = event => { if (event.data.type === 'answer') { clearTimeout(timer); aiWorker.removeEventListener('message', handler); resolve(event.data); } else if (event.data.type === 'error') { clearTimeout(timer); aiWorker.removeEventListener('message', handler); reject(new Error(event.data.message)); } };
        const candidates = answer.id === 'unknown' ? profile.knowledge.filter(item => !['boundaries','unknown','guide-identity','contact'].includes(item.id)) : [answer];
        aiWorker.addEventListener('message', handler); aiWorker.postMessage({ type: 'generate', question, candidates });
      });
      const matched = selectSourcedAnswer(generated, profile.knowledge);
      if (matched) { text = matched.answer; label = sourceLabel(matched) + ' · Selected by on-device AI'; previousAnswerId = matched.id; }
      else label += ' · Curated response retained';
    }
    lastReply = text; appendMessage('assistant', text, label);
  } catch (error) {
    lastReply = answer.answer; appendMessage('assistant', answer.answer, sourceLabel(answer) + ' · Profile guide fallback');
    $('#voice-note').textContent = 'On-device generation was unavailable. The sourced profile answer is shown.';
  } finally { busy = false; $('#send-question').disabled = false; updateMode(); $('#question').focus(); }
}

function updateMode() { const ai = mode === 'ai'; $('#guide-mode').classList.toggle('selected', !ai); $('#guide-mode').setAttribute('aria-pressed', String(!ai)); $('#ai-mode').classList.toggle('selected', ai); $('#ai-mode').setAttribute('aria-pressed', String(ai)); $('#mode-status').textContent = ai ? 'On-device AI · Sourced profile answers · No messages stored' : 'Profile guide · Curated answers · No messages stored'; }
function useGuide() { mode = 'guide'; $('#ai-setup').hidden = true; updateMode(); }

async function loadAI() {
  const attempt = ++aiLoadAttempt;
  const button = $('#load-ai'); button.disabled = true; $('#ai-progress').textContent = 'Preparing local AI…';
  try {
    if (!('Worker' in window) || !('WebAssembly' in window)) throw new Error('This browser does not support local model execution.');
    if (!aiWorker) aiWorker = new Worker('/CLASS-A/preview/ai-worker.js', { type: 'module' });
    await new Promise((resolve, reject) => {
      const worker = aiWorker;
      const timer = setTimeout(() => { worker.terminate(); if (aiWorker === worker) aiWorker = null; reject(new Error('Download timed out. Check your connection and try again.')); }, 180000);
      abortAISetup = () => { clearTimeout(timer); worker.terminate(); if (aiWorker === worker) aiWorker = null; reject(new Error('cancelled')); };
      const handler = event => {
        const data = event.data;
        if (data.type === 'progress') $('#ai-progress').textContent = data.message;
        if (data.type === 'ready') { clearTimeout(timer); worker.removeEventListener('message', handler); resolve(); }
        if (data.type === 'error') { clearTimeout(timer); worker.removeEventListener('message', handler); reject(new Error(data.message)); }
      };
      worker.addEventListener('message', handler); worker.onerror = () => { clearTimeout(timer); reject(new Error('The model could not be loaded on this browser.')); };
      worker.postMessage({ type: 'load' });
    });
    aiReady = true; mode = 'ai'; $('#ai-setup').hidden = true; $('#voice-note').textContent = 'On-device AI is ready. It selects from profile sources; it cannot invent new profile text.'; updateMode();
  } catch (error) { if (attempt !== aiLoadAttempt) return; console.warn('Local model setup:', error.message); $('#ai-progress').textContent = 'Local AI could not load on this browser. Check your connection or use the profile guide.'; aiReady = false; mode = 'guide'; updateMode(); }
  finally { if (attempt === aiLoadAttempt) { button.disabled = false; abortAISetup = null; } }
}

function stopSpeech() { if ('speechSynthesis' in window) speechSynthesis.cancel(); speaking = false; $('#listen').textContent = 'Listen ◖'; }
function listen() {
  if (!('speechSynthesis' in window)) { $('#voice-note').textContent = 'Read-aloud is unavailable in this browser.'; return; }
  if (speaking) { stopSpeech(); return; }
  const text = lastReply || 'Meet Erfan Uddin. Brand strategist, experience builder and systems thinker. Ask Dr. X about the work, the thinking, or what we could build together.';
  const speech = new SpeechSynthesisUtterance(text); speech.lang = 'en-GB'; speech.rate = .97;
  speech.onstart = () => { speaking = true; $('#listen').textContent = 'Stop ◼'; $('#voice-note').textContent = 'Reading with your device voice.'; };
  speech.onend = stopSpeech; speech.onerror = () => { stopSpeech(); $('#voice-note').textContent = 'Your browser could not start read-aloud. The text remains available.'; }; speechSynthesis.speak(speech);
}

$$('[data-work]').forEach(button => button.addEventListener('click', () => openWork()));
$$('[data-chat]').forEach(button => button.addEventListener('click', () => openChat()));
$$('[data-home]').forEach(button => button.addEventListener('click', closeDialogs));
$$('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$$('[data-sources]').forEach(button => button.addEventListener('click', () => openDialog($('#sources-dialog'), 'profile')));
$$('dialog').forEach(dialog => { dialog.addEventListener('close', () => { if (!$('dialog[open]')) { document.body.style.overflow = ''; updateNav('profile'); } stopSpeech(); }); dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } }); });
$$('[data-perspective]').forEach((button, index, all) => { button.addEventListener('click', () => renderPerspective(button.dataset.perspective)); button.addEventListener('keydown', event => { if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3; renderPerspective(all[next].dataset.perspective); all[next].focus(); } }); });
$('#skill-list').addEventListener('click', event => { const b = event.target.closest('[data-skill]'); if (b) openChat(`What is Erfan's experience with ${b.dataset.skill}?`); });
$('[data-related]').addEventListener('click', () => openWork(perspectiveCopy[selectedPerspective].project));
$$('[data-question]').forEach(button => button.addEventListener('click', () => ask(button.dataset.question)));
$('#chat-form').addEventListener('submit', event => { event.preventDefault(); ask($('#question').value); });
$('#question').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!busy) ask(event.target.value); } });
$('#question').addEventListener('input', event => { event.target.style.height = 'auto'; event.target.style.height = Math.min(event.target.scrollHeight, 110) + 'px'; });
$('#guide-mode').addEventListener('click', useGuide); $('#cancel-ai').addEventListener('click', () => { if (aiWorker && !aiReady) { aiLoadAttempt++; if (abortAISetup) abortAISetup(); abortAISetup = null; $('#load-ai').disabled = false; } useGuide(); });
$('#ai-mode').addEventListener('click', () => { if (aiReady) { mode = 'ai'; updateMode(); } else { $('#ai-setup').hidden = false; $('#load-ai').focus(); } });
$('#load-ai').addEventListener('click', loadAI); $('#listen').addEventListener('click', listen);
$('#clear-chat').addEventListener('click', () => { stopSpeech(); previousAnswerId = ''; lastReply = ''; $('#messages').replaceChildren(); appendMessage('assistant', 'A fresh conversation. Ask about Erfan’s work, experience or approach.'); $('#voice-note').textContent = ''; $('#question').focus(); });
const motionButton = $('#motion-toggle');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let motionPaused = reduceMotion.matches;
function updateMotion() {
  document.documentElement.dataset.motion = motionPaused || document.hidden ? 'paused' : 'running';
  motionButton.disabled = reduceMotion.matches;
  motionButton.setAttribute('aria-label', reduceMotion.matches ? 'Avatar motion reduced by device preference' : motionPaused ? 'Play avatar motion' : 'Pause avatar motion');
  motionButton.setAttribute('aria-pressed', String(!motionPaused));
  motionButton.textContent = reduceMotion.matches ? 'Motion reduced' : motionPaused ? 'Play motion' : 'Pause motion';
}
motionButton.addEventListener('click', () => { motionPaused = !motionPaused; updateMotion(); });
reduceMotion.addEventListener('change', event => { motionPaused = event.matches; updateMotion(); });
document.addEventListener('visibilitychange', updateMotion);
$$('[data-portraits]').forEach(button => button.addEventListener('click', () => openDialog($('#portraits-dialog'), 'profile')));
updateMotion();
if (matchMedia('(pointer:fine) and (prefers-reduced-motion:no-preference)').matches) {
  $('.hero').addEventListener('pointermove', event => {
    if (motionPaused) return;
    const rect = $('.hero').getBoundingClientRect();
    $('.avatar-tilt').style.setProperty('--ry', ((event.clientX - rect.left) / rect.width - .5) * 5 + 'deg');
    $('.avatar-tilt').style.setProperty('--rx', -((event.clientY - rect.top) / rect.height - .5) * 2 + 'deg');
  });
  $('.hero').addEventListener('pointerleave', () => { $('.avatar-tilt').style.setProperty('--ry', '0deg'); $('.avatar-tilt').style.setProperty('--rx', '0deg'); });
}

try { const response = await fetch('/CLASS-A/preview/profile-data.json'); if (!response.ok) throw new Error('Profile unavailable'); profile = await response.json(); renderCareer(); renderProject('party-lab'); document.documentElement.dataset.ready = 'true'; if (location.hash === '#drx') openChat(); }
catch (error) { $('#voice-note').textContent = 'The profile could not be loaded. Please reload or contact Erfan by email.'; $$('[data-work]').forEach(b => b.addEventListener('click', () => { location.href = '/CLASS-A/preview/cv.html'; })); }
