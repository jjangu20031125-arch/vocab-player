'use strict';
/* Vocab Player — YouTube + synced English subtitles + personal vocabulary. */

const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

const ICON_SPK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (sec) => { sec = Math.max(0, Math.floor(+sec || 0)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

const S = {
  videos: [],
  prog: { status: {}, saved: {}, topics: [] },
  pass: LS.get('vp-pass', ''),
  server: 'unknown', // unknown | ok | local (no sync store) | none (static hosting)
  kind: 'all',
  hideDone: false,
  autoNext: LS.get('vp-auto', true),
  translator: 'unknown',
  sheetSeq: 0,
  w: null, // watch state
  fc: { deck: null, i: 0, flip: false, scope: 'all' },
  quiz: { qs: null, i: 0, score: 0, ans: null },
};

/* ---------------- text helpers ---------------- */
const POSS = new Set(['my', 'your', 'his', 'her', 'their', 'our', 'its', "someone's", 'one\'s']);
const ARTICLES = new Set(['a', 'an', 'the']);
function norm(w) {
  return String(w).toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9'\-]/g, '').replace(/^'+|'+$/g, '').replace(/'s$/, '');
}
const IRREG = { went: 'go', gone: 'go', goes: 'go', had: 'have', has: 'have', took: 'take', taken: 'take', kept: 'keep', left: 'leave',
  brought: 'bring', got: 'get', gotten: 'get', made: 'make', felt: 'feel', said: 'say', did: 'do', done: 'do', does: 'do', was: 'be', were: 'be',
  is: 'be', are: 'be', been: 'be', ran: 'run', thought: 'think', came: 'come', gave: 'give', given: 'give', saw: 'see', seen: 'see', knew: 'know',
  known: 'know', stung: 'sting', slew: 'slay', slain: 'slay', bought: 'buy', caught: 'catch', taught: 'teach', told: 'tell', found: 'find',
  held: 'hold', lost: 'lose', met: 'meet', paid: 'pay', sent: 'send', spent: 'spend', stood: 'stand', understood: 'understand', won: 'win',
  wrote: 'write', written: 'write', broke: 'break', broken: 'break', chose: 'choose', chosen: 'choose', fell: 'fall', fallen: 'fall', grew: 'grow',
  grown: 'grow', drove: 'drive', driven: 'drive', ate: 'eat', eaten: 'eat', rose: 'rise', risen: 'rise', 'i\'d': 'i\'d' };
function stem(w) {
  w = norm(w);
  if (IRREG[w]) w = IRREG[w];
  if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
  else if (w.length > 4 && w.endsWith('ied')) w = w.slice(0, -3) + 'y';
  else if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith('es')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  if (w.length > 3 && /([b-df-hj-np-tv-z])\1$/.test(w)) w = w.slice(0, -1); // stopped -> stop
  return w;
}
// Expression -> pattern of tokens. '*' = optional gap (from "(someone)"), 'POSS' = any possessive.
function pattern(expr) {
  const out = [];
  String(expr).replace(/\(([^)]*)\)/g, ' * ').split(/[\s\-]+/).forEach((tok) => {
    if (tok === '*') { if (out.length && out[out.length - 1] !== '*') out.push('*'); return; }
    if (/^(one|someone)['’]s$/i.test(tok)) { out.push('POSS'); return; }
    const n = norm(tok);
    if (!n) return;
    if (POSS.has(n)) out.push('POSS');
    else out.push(stem(n));
  });
  while (out.length && (out[0] === '*' || ARTICLES.has(out[0]) || out[0] === 'be')) out.shift();
  while (out.length && out[out.length - 1] === '*') out.pop();
  return out;
}
function matchAt(tokens, i, pat, p) {
  if (p === pat.length) return i;
  if (pat[p] === '*') {
    for (let gap = 0; gap <= 2; gap++) {
      const r = i + gap <= tokens.length ? matchAt(tokens, i + gap, pat, p + 1) : -1;
      if (r >= 0) return r;
    }
    return -1;
  }
  if (i >= tokens.length) return -1;
  const t = tokens[i];
  if (pat[p] === 'POSS') return POSS.has(t.n) || t.n.endsWith("'s") ? matchAt(tokens, i + 1, pat, p + 1) : -1;
  if (t.s !== pat[p] && t.n !== pat[p]) return -1;
  return matchAt(tokens, i + 1, pat, p + 1);
}

/* ---------------- pronunciation (browser text-to-speech, free) ---------------- */
const spk = (text) => `<button class="spk" data-act="speak" data-text="${esc(text)}" aria-label="발음 듣기">${ICON_SPK}</button>`;
function speak(text) {
  if (!('speechSynthesis' in window)) { note('이 브라우저는 발음 듣기를 지원하지 않아요.'); return; }
  const t = String(text).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(t);
  u.lang = 'en-US'; u.rate = 0.9;
  const vs = speechSynthesis.getVoices();
  const pick = vs.find((v) => /en[-_]US/i.test(v.lang) && /Samantha|Google US|Aria|Jenny|Natural|Ava/i.test(v.name)) || vs.find((v) => /en[-_]US/i.test(v.lang)) || vs.find((v) => /^en/i.test(v.lang));
  if (pick) u.voice = pick;
  speechSynthesis.speak(u);
}
if ('speechSynthesis' in window) { try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices(); } catch (e) {} }

/* ---------------- activity log (what was read / watched / reviewed each day) ---------------- */
const DEV = (() => { let d = LS.get('vp-dev', ''); if (!d) { d = 'd' + Math.random().toString(36).slice(2, 8); LS.set('vp-dev', d); } return d; })();
let lastLogPush = 0;
function logAdd(field, amount, extra = {}) {
  const day = dayKeyLocal();
  S.prog.log = S.prog.log || {};
  const d = (S.prog.log[day] = S.prog.log[day] || {});
  const r = (d[DEV] = d[DEV] || { read: 0, watch: 0, rv: 0, books: [], vids: [] });
  r[field] = (r[field] || 0) + amount;
  if (extra.book && !r.books.includes(extra.book)) r.books.push(extra.book);
  if (extra.vid && !r.vids.includes(extra.vid)) r.vids.push(extra.vid);
  r.at = Date.now();
  if (Date.now() - lastLogPush > 60000) { lastLogPush = Date.now(); saveProg(); } else LS.set('vp-prog', S.prog);
}
function dayKeyLocal(t = Date.now()) { const d = new Date(t - 4 * 3600e3); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function dayTotals(day) {
  const out = { read: 0, watch: 0, rv: 0, sh: 0, wr: 0, books: new Set(), vids: new Set() };
  Object.values((S.prog.log || {})[day] || {}).forEach((r) => { out.read += r.read || 0; out.watch += r.watch || 0; out.rv += r.rv || 0; out.sh += r.sh || 0; out.wr += r.wr || 0; (r.books || []).forEach((x) => out.books.add(x)); (r.vids || []).forEach((x) => out.vids.add(x)); });
  return out;
}
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  if (S.rd && (S.rd.reading || Date.now() - (S.rd.lastAct || 0) < 120000)) logAdd('read', 15, { book: S.rd.book.id });
  try { if (S.w && S.w.player && S.w.player.getPlayerState && S.w.player.getPlayerState() === 1) logAdd('watch', 15, { vid: S.w.vid }); } catch (e) {}
}, 15000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { lastLogPush = Date.now(); saveProg(); } });

/* ---------------- progress & sync ---------------- */
const st = (id) => (S.prog.status[id] && S.prog.status[id].s) || null;
function mergeState(a, b) {
  const out = { status: { ...(a.status || {}) }, saved: { ...(a.saved || {}) }, topics: [] };
  for (const [k, v] of Object.entries(b.status || {})) if (!out.status[k] || (v.at || 0) > (out.status[k].at || 0)) out.status[k] = v;
  for (const [k, v] of Object.entries(b.saved || {})) if (!out.saved[k] || (v.at || 0) > (out.saved[k].at || 0)) out.saved[k] = v;
  const tm = {};
  for (const t of [...(a.topics || []), ...(b.topics || [])]) if (t && t.id && (!tm[t.id] || (t.at || 0) > (tm[t.id].at || 0))) tm[t.id] = t;
  out.topics = Object.values(tm).sort((x, y) => (x.created || 0) - (y.created || 0));
  out.books = { ...(a.books || {}) };
  for (const [k, v] of Object.entries(b.books || {})) {
    const o = out.books[k];
    if (!o) { out.books[k] = v; continue; }
    const newer = (v.at || 0) > (o.at || 0) ? v : o, far = (v.maxPct || 0) > (o.maxPct || 0) ? v : o;
    out.books[k] = { ...newer, maxCh: far.maxCh, maxP: far.maxP, maxPct: far.maxPct };
  }
  const wm = {};
  for (const x of [...(a.writing || []), ...(b.writing || [])]) if (x && x.id && (!wm[x.id] || (x.at || 0) > (wm[x.id].at || 0))) wm[x.id] = x;
  out.writing = Object.values(wm).sort((x, y) => (x.created || 0) - (y.created || 0));
  out.log = JSON.parse(JSON.stringify(a.log || {}));
  for (const [day, devs] of Object.entries(b.log || {})) {
    out.log[day] = out.log[day] || {};
    for (const [dev, rec] of Object.entries(devs || {})) if (!out.log[day][dev] || (rec.at || 0) > (out.log[day][dev].at || 0)) out.log[day][dev] = rec;
  }
  out.fsrs = { ...(a.fsrs || {}) };
  for (const [k, v] of Object.entries(b.fsrs || {})) if (!out.fsrs[k] || (v.at || 0) > (out.fsrs[k].at || 0)) out.fsrs[k] = v;
  const da = a.daily || {}, db = b.daily || {};
  if (da.date && da.date === db.date) out.daily = { date: da.date, ids: [...new Set([...(da.ids || []), ...(db.ids || [])])], newIds: [...new Set([...(da.newIds || []), ...(db.newIds || [])])] };
  else out.daily = (da.date || '') >= (db.date || '') ? da : db;
  return out;
}
async function api(path, opts = {}) {
  try {
    const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', 'x-app-pass': S.pass || '', ...(opts.headers || {}) } });
    let j = {};
    try { j = await r.json(); } catch (e) {}
    return { status: r.status, ok: r.ok, j };
  } catch (e) {
    return { status: 0, ok: false, j: {} };
  }
}
let pushTimer = null;
function saveProg() {
  LS.set('vp-prog', S.prog);
  if (S.server !== 'ok') return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    const r = await api('/api/progress', { method: 'PUT', body: JSON.stringify({ state: S.prog }) });
    if (!r.ok) note('진도를 서버에 저장하지 못했어요. 이 기기에는 저장돼 있어요.');
  }, 700);
}
async function pull() {
  const r = await api('/api/progress');
  if (r.status === 401) { S.server = 'unknown'; showGate(S.pass ? '비밀번호가 맞지 않아요.' : ''); return false; }
  if (r.ok) {
    S.server = 'ok';
    const merged = mergeState(S.prog, r.j.state || {});
    const changed = JSON.stringify(merged) !== JSON.stringify(r.j.state || {});
    S.prog = merged; LS.set('vp-prog', S.prog);
    if (changed) saveProg();
    return true;
  }
  if (r.status === 503 && r.j.error === 'no_store') { S.server = 'local'; note('진도 동기화 저장소가 아직 연결되지 않아서, 기록은 이 기기에만 저장돼요.'); return true; }
  if (r.status === 503 && r.j.error === 'no_passcode') { S.server = 'none'; note('서버에 APP_PASSCODE가 설정되지 않았어요.'); return true; }
  if (r.status === 404 || r.status === 0 || r.status === 405) { S.server = 'none'; return true; }
  S.server = 'local';
  return true;
}
function setStatus(id, s) {
  S.prog.status[id] = { s: s || null, at: Date.now() };
  saveProg();
  if (s === 'learned' && !(S.prog.fsrs || {})[id]) scheduleAs(id, 3).then(updateBadge); // counts as a first "good" review
  else updateBadge();
}
function note(t) { const n = $('#note'); if (!t) { n.hidden = true; return; } n.textContent = t; n.hidden = false; }

/* ---------------- data ---------------- */
function bookSources() {
  const out = [];
  (S.books || []).forEach((b) => (b.chapters || []).forEach((c) => {
    const words = (b.words || []).filter((w) => w.ch === c.n).map((w) => ({ ...w, t: w.p }));
    if (words.length) out.push({ vid: `book:${b.id}:${c.n}`, title: `${b.title} · ${c.n}장`, kind: 'book', book: b.id, ch: c.n, words, batchOrder: -1, order: c.n });
  }));
  return out;
}
const allSources = () => [...S.videos, ...bookSources()];
const vocab = () => allSources().flatMap((v) => (v.words || []).map((w) => ({ ...w, v })));
const savedList = () => Object.entries(S.prog.saved).filter(([, x]) => x && !x.del).map(([k, x]) => ({ key: k, ...x }));
function reviewSet() {
  const seen = {}, rev = {};
  allSources().sort((a, b) => (a.batchOrder || 0) - (b.batchOrder || 0) || (a.order || 0) - (b.order || 0))
    .forEach((v) => (v.words || []).forEach((w) => { const k = pattern(w.expr).join(' '); if (seen[k]) rev[w.id] = true; else seen[k] = 1; }));
  return rev;
}
const homeOrder = (a, b) => (b.batchOrder || 0) - (a.batchOrder || 0) || (a.order || 0) - (b.order || 0);
function ytAt(vid, t) {
  if (String(vid).startsWith('book:')) { const [, b, ch] = String(vid).split(':'); return `#/book/${encodeURIComponent(b)}?ch=${ch}${t != null ? '&p=' + t : ''}`; }
  return '#/v/' + encodeURIComponent(vid) + (t ? '?t=' + Math.floor(t) : '');
}
function srcA(vid, t, prefix = '') {
  if (!vid) return '';
  if (String(vid).startsWith('book:')) return `<a class="ts" href="${ytAt(vid, t)}">책 ${String(vid).split(':')[2]}장</a>`;
  return `<a class="ts" href="${ytAt(vid, t)}">${ICON_PLAY}${prefix}${fmt(t)}</a>`;
}

/* ---------------- routing ---------------- */
function route() {
  const h = location.hash || '#/';
  const navKey = h.startsWith('#/review') || h.startsWith('#/log') ? 'review' : h.startsWith('#/book') ? 'books' : h.startsWith('#/words') ? 'words' : h.startsWith('#/cards') || h.startsWith('#/quiz') || h.startsWith('#/write') ? 'practice' : 'home';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === navKey && !h.startsWith('#/v/')));
  closeSheet();
  const m = h.match(/^#\/v\/([\w-]{11})(?:\?t=(\d+))?/);
  if (m) { leaveReader(); return openWatch(m[1], m[2] ? +m[2] : 0); }
  leaveWatch();
  const bm = h.match(/^#\/book\/([\w-]+)(?:\?(.*))?/);
  if (bm) { const q = new URLSearchParams(bm[2] || ''); return openBook(bm[1], q.get('ch'), q.get('p')); }
  leaveReader();
  if (navKey === 'books') return renderLibrary();
  if (h.startsWith('#/log')) return renderLog();
  if (navKey === 'review') { S.rv = null; return renderReview(); }
  if (navKey === 'words') return renderWords();
  if (h.startsWith('#/cards')) { S.fc.deck = null; return renderCards(); }
  if (h.startsWith('#/quiz')) { S.quiz.qs = null; return renderQuiz(); }
  if (h.startsWith('#/write')) return renderWrite();
  renderHome();
}
function refresh() {
  const h = location.hash || '#/';
  if (h.startsWith('#/review')) return;
  if (h.startsWith('#/book/')) { rdRepaintWords(); return; }
  if (h.startsWith('#/books')) return renderLibrary();
  if (h.startsWith('#/v/')) { renderSubs(); renderVWords(); return; }
  if (h.startsWith('#/words')) return renderWords();
  if (h.startsWith('#/cards')) return renderCards();
  if (h.startsWith('#/quiz')) return renderQuiz();
  if (h.startsWith('#/write')) return renderWrite();
  renderHome();
}

/* ---------------- home ---------------- */
function renderHome() {
  const vs = S.videos.filter((v) => S.kind === 'all' || v.kind === S.kind).sort(homeOrder);
  const playLabel = S.kind === 'short' ? '쇼츠' : S.kind === 'long' ? '긴 영상' : '전체';
  let html = `<div class="chips">${[['all', '전체'], ['long', '긴 영상'], ['short', '쇼츠']].map(([k, l]) => `<button class="btn ${S.kind === k ? 'on' : ''}" data-kind="${k}">${l}</button>`).join('')}
    ${vs.length ? `<button class="btn primary" data-act="play-all">${ICON_PLAY}${playLabel} 연속 재생</button>` : ''}</div>`;
  let last = null, open = false;
  vs.forEach((v) => {
    if (v.batch !== last) { if (open) html += '</div>'; html += `<div class="batch">${esc(v.batch || '')}</div><div class="grid">`; open = true; last = v.batch; }
    const ws = v.words || [], done = ws.filter((w) => st(w.id)).length, pct = ws.length ? Math.round(done / ws.length * 100) : 0;
    html += `<a class="vc" href="${ytAt(v.vid)}">
      <div class="thumb" style="background-image:url('https://i.ytimg.com/vi/${esc(v.vid)}/mqdefault.jpg')"><span class="len">${fmt(v.lengthSec)}</span></div>
      <div class="body"><div class="t">${esc(v.title)}</div>
      <div class="m"><span class="pill ${v.kind === 'short' ? 'p-short' : 'p-long'}">${v.kind === 'short' ? '쇼츠' : '영상'}</span><span class="pill p-cat">${esc(v.category || '')}</span><span>${done}/${ws.length}</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div></div></a>`;
  });
  if (open) html += '</div>';
  if (!vs.length) html += '<p class="empty">아직 영상이 없어요.</p>';
  const kindLabel = { both: '긴 영상 + 쇼츠', long: '긴 영상', short: '쇼츠' };
  const tq = (S.prog.topics || []).filter((t) => !t.del && !t.done);
  html += `<div class="h2">다음에 볼 주제</div><div class="panel topics">
    <textarea id="topicText" placeholder="일상 대화가 많은 시트콤 장면, 테크 기업 CEO 인터뷰"></textarea>
    <div class="row"><select id="topicKind"><option value="both">긴 영상 + 쇼츠</option><option value="long">긴 영상만</option><option value="short">쇼츠만</option></select>
    <button class="btn primary" data-act="topic-save">주제 저장</button></div><div class="err" id="topicErr"></div>
    ${tq.map((t) => `<div class="tq"><span>${esc(t.text)} <span class="small">· ${esc(kindLabel[t.kind] || '')}</span></span><button class="x" data-act="topic-del" data-id="${esc(t.id)}" aria-label="주제 삭제">✕</button></div>`).join('')}
    <p class="small">Claude에게 "단어장 채워줘"라고 하면 이 주제로 새 영상을 찾아 넣어요.</p></div>`;
  $('#view').innerHTML = html;
}

/* ---------------- watch ---------------- */
let ytPromise = null;
function loadYT() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (ytPromise) return ytPromise;
  ytPromise = new Promise((resolve) => {
    const done = () => resolve(window.YT && window.YT.Player ? window.YT : null);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) try { prev(); } catch (e) {} done(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
    setTimeout(done, 10000);
  });
  return ytPromise;
}
function leaveWatch() {
  if (!S.w) return;
  clearInterval(S.w.timer);
  try { S.w.player && S.w.player.destroy(); } catch (e) {}
  S.w = null;
}
function wheadHTML(v, vid) {
  const short = v ? v.kind === 'short' : false;
  return `${v ? `<span class="pill ${short ? 'p-short' : 'p-long'}">${short ? '쇼츠' : '영상'}</span> <span class="pill p-cat">${esc(v.category || '')}</span>` : ''}
      <h1>${esc(v ? v.title : vid)}</h1>
      <div class="sub">${v ? `${esc(v.channel || '')} · ${fmt(v.lengthSec)} ${v.captions === 'manual' ? '<span class="pill p-cc">사람이 만든 자막</span>' : v.captions === 'auto' ? '<span class="pill p-auto">자동 자막</span>' : ''}` : ''}${listPosHTML(vid)}</div>
      ${v && v.summary ? `<p class="small sum" style="margin:6px 0 0;font-size:13px;color:var(--ink2)">${esc(v.summary)}</p>` : ''}`;
}
function playlist() {
  const k = S.w ? S.w.listKind : S.kind;
  return S.videos.filter((v) => k === 'all' || v.kind === k).sort(homeOrder);
}
function listPosHTML(vid) {
  const list = playlist(); const i = list.findIndex((v) => v.vid === vid);
  return i >= 0 && list.length > 1 ? ` <span class="small">· 재생목록 ${i + 1}/${list.length}</span>` : '';
}
function goNext(auto) {
  if (!S.w) return;
  const list = playlist(); const i = list.findIndex((v) => v.vid === S.w.vid);
  const n = list[i + 1];
  if (n) { S.autoplayNext = true; location.hash = ytAt(n.vid); }
  else note(auto ? '재생목록의 마지막 영상까지 다 봤어요.' : '재생목록의 마지막 영상이에요.');
}
const NOW_PH = '<span class="ph">재생하면 지금 나오는 문장이 여기에 크게 보여요.</span>';
async function openWatch(vid, startT) {
  const v = S.videos.find((x) => x.vid === vid);
  if (S.w && S.w.vid === vid) { // same video: just seek
    if (startT && S.w.player && S.w.player.seekTo) { S.w.player.seekTo(startT, true); S.w.player.playVideo && S.w.player.playVideo(); }
    return;
  }
  const short = v ? v.kind === 'short' : false;
  if (S.w && S.w.player && S.w.player.loadVideoById && $('#subs') && (S.w.v ? S.w.v.kind : '') === (v ? v.kind : '')) {
    // keep the same player so the next video keeps playing (phones block autoplay in a new player)
    Object.assign(S.w, { vid, v, lines: [], active: -1, status: '자막을 불러오는 중…', tab: 'subs', sel: null });
    note('');
    $('#whead').innerHTML = wheadHTML(v, vid);
    $('.pwrap').classList.toggle('short', short);
    $('#tabWords').textContent = '이 영상 표현 ' + (v ? (v.words || []).length : 0);
    $('#subs').hidden = false; $('#vwords').hidden = true;
    $('#tabSubs').classList.add('on'); $('#tabWords').classList.remove('on');
    $('#subs').innerHTML = '<div class="status">자막을 불러오는 중…</div>';
    $('#now').innerHTML = NOW_PH;
    renderVWords();
    try { S.w.player.loadVideoById({ videoId: vid, startSeconds: Math.floor(startT || 0) }); } catch (e) {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
    startSubs(vid, v);
    return;
  }
  const listKind = S.kind;
  leaveWatch();
  S.w = { vid, v, lines: [], active: -1, loop: false, rate: 1, follow: true, pauseFollowUntil: 0, player: null, timer: null, tab: 'subs', status: '자막을 불러오는 중…', sel: null, listKind };
  $('#view').innerHTML = `
    <div class="whead" id="whead">${wheadHTML(v, vid)}</div>
    <div class="watch">
      <div class="wleft">
        <div class="pwrap ${short ? 'short' : ''}"><div id="yt"><div class="ph">플레이어를 불러오는 중…</div></div></div>
        <div class="ctrl">
          <button class="btn sm" data-act="prev" aria-label="이전 문장">◀ 이전</button>
          <button class="btn sm" data-act="replay" aria-label="이 문장 다시">↺ 다시</button>
          <button class="btn sm" data-act="loop" id="loopBtn">반복 끔</button>
          <button class="btn sm" data-act="next" aria-label="다음 문장">다음 ▶</button>
          <select id="rate" aria-label="재생 속도"><option value="0.75">0.75x</option><option value="1" selected>1x</option><option value="1.25">1.25x</option></select>
          <button class="btn sm" data-act="shadow-line">🎤 따라 말하기</button>
          <button class="btn sm" data-act="next-video">다음 영상 ⏭</button>
          <button class="btn sm ${S.autoNext ? 'on' : ''}" data-act="auto" id="autoBtn">연속 재생 ${S.autoNext ? '켬' : '끔'}</button>
        </div>
        <div class="now" id="now">${NOW_PH}</div>
      </div>
      <div class="wright">
        <div class="wtabs"><button class="btn sm on" data-act="tab-subs" id="tabSubs">자막</button><button class="btn sm" data-act="tab-words" id="tabWords">이 영상 표현 ${v ? (v.words || []).length : 0}</button></div>
        <div class="subs" id="subs"><div class="status">자막을 불러오는 중…</div></div>
        <div id="vwords" hidden></div>
        <div class="legend"><span><i style="background:var(--hl-v)"></i>단어장 표현 (아직 안 외움)</span><span><i style="background:var(--hl-s)"></i>내가 저장한 단어</span><span>문장을 옆으로 밀면(PC는 '한' 버튼) 한국어 번역</span></div>
      </div>
    </div>`;
  renderVWords();
  const subsEl = $('#subs');
  const pauseFollow = () => { if (S.w) S.w.pauseFollowUntil = Date.now() + 4000; };
  ['wheel', 'touchmove'].forEach((ev) => { subsEl.addEventListener(ev, pauseFollow, { passive: true }); });
  startSubs(vid, v);
  const YT = await loadYT();
  if (!S.w || S.w.vid !== vid) return;
  if (!YT) { $('#yt').innerHTML = `<div class="ph">플레이어를 불러오지 못했어요.<br><a href="https://www.youtube.com/watch?v=${esc(vid)}" target="_blank" rel="noopener" style="color:#fff">YouTube에서 열기</a></div>`; return; }
  S.w.player = new YT.Player('yt', {
    videoId: vid,
    playerVars: { playsinline: 1, rel: 0, modestbranding: 1, cc_load_policy: short ? 1 : 0, cc_lang_pref: 'en', hl: 'en', autoplay: S.autoplayNext ? 1 : 0, start: Math.floor(startT || 0) },
    events: {
      onReady: () => { if (S.w) { try { S.w.player.setPlaybackRate(S.w.rate); } catch (e) {} } },
      onStateChange: (e) => { if (e.data === 0 && S.w && !S.w.loop && S.autoNext) goNext(true); },
    },
  });
  S.autoplayNext = false;
  S.w.timer = setInterval(tick, 200);
}
function curTime() { try { return S.w && S.w.player && S.w.player.getCurrentTime ? S.w.player.getCurrentTime() * 1000 : null; } catch (e) { return null; } }
function seekLine(i) {
  if (!S.w || !S.w.lines[i]) return;
  const p = S.w.player;
  if (p && p.seekTo) { p.seekTo(S.w.lines[i].t / 1000, true); p.playVideo && p.playVideo(); }
  S.w.pauseFollowUntil = 0;
  setActive(i);
}
function tick() {
  const w = S.w; if (!w || !w.lines.length) return;
  const t = curTime(); if (t == null) return;
  if (w.loop && w.active >= 0) {
    const L = w.lines[w.active];
    if (t >= L.end - 80 || t < L.t - 400) { w.player.seekTo(L.t / 1000, true); return; }
  }
  // binary search for the last line starting at or before t
  let lo = 0, hi = w.lines.length - 1, idx = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (w.lines[mid].t <= t + 150) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
  if (idx !== w.active) setActive(idx);
}
function setActive(i) {
  const w = S.w; if (!w) return;
  const old = document.querySelector('.ln.on'); if (old) old.classList.remove('on');
  w.active = i;
  const el = document.querySelector(`.ln[data-i="${i}"]`);
  if (el) {
    el.classList.add('on');
    if (w.follow && Date.now() > w.pauseFollowUntil && w.tab === 'subs') {
      const box = $('#subs');
      if (box && box.scrollHeight > box.clientHeight + 4 && getComputedStyle(box).overflowY !== 'visible') {
        box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' });
      } else {
        const sticky = document.querySelector('.wleft');
        const offset = (sticky ? sticky.getBoundingClientRect().bottom : 0) + 40;
        const y = el.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
      }
    }
  }
  const now = $('#now');
  if (now) now.innerHTML = i >= 0 && w.lines[i] ? lineHTML(w.lines[i], i, 'n') + krHTML(i) : NOW_PH;
}

/* transcript loading */
function setTab(tab) {
  if (!S.w) return;
  S.w.tab = tab;
  $('#subs').hidden = tab !== 'subs'; $('#vwords').hidden = tab !== 'words';
  $('#tabSubs').classList.toggle('on', tab === 'subs'); $('#tabWords').classList.toggle('on', tab === 'words');
}
function startSubs(vid, v) {
  const isShort = v && v.kind === 'short';
  const cached = LS.get('vp-tr-' + vid, null);
  if (!isShort || (cached && cached.segs && Date.now() - cached.at < 14 * 864e5)) { loadTranscript(vid); return; }
  // Shorts: free YouTube captions inside the player, no subtitle API call
  S.w.status = 'short';
  $('#subs').innerHTML = `<div class="status">쇼츠는 영상 안의 YouTube 자막(CC)으로 보여요. 자막 API를 쓰지 않아서 무료예요.<br>자막이 필요 없으면 플레이어의 CC 버튼으로 끄면 돼요.<br><br><button class="btn sm" data-act="fetch-subs">단어를 누를 수 있는 자막 불러오기 (자막 API 1회)</button></div>`;
  $('#now').innerHTML = '<span class="ph">이 쇼츠의 핵심 표현은 "이 영상 표현" 탭에 있어요.</span>';
  setTab('words');
}
function decodeEntities(s) { const t = document.createElement('textarea'); t.innerHTML = s; return t.value; }
async function loadTranscript(vid) {
  const cacheKey = 'vp-tr-' + vid;
  const cached = LS.get(cacheKey, null);
  if (cached && cached.segs && Date.now() - cached.at < 14 * 864e5) return showLines(vid, cached.segs);
  if (S.server === 'none') return subsStatus(vid, '자막 서버가 연결되지 않은 상태예요. 영상은 그대로 볼 수 있어요.');
  let r = await api('/api/transcript?v=' + encodeURIComponent(vid));
  let tries = 0;
  while (r.ok && r.j.pending && tries < 80) {
    if (!S.w || S.w.vid !== vid) return;
    subsStatus(vid, '긴 영상이라 자막을 준비하고 있어요… (최대 1~2분)');
    await new Promise((res) => setTimeout(res, 1500));
    r = await api('/api/transcript?job=' + encodeURIComponent(r.j.jobId));
    tries++;
  }
  if (!S.w || S.w.vid !== vid) return;
  if (r.ok && Array.isArray(r.j.segments) && r.j.segments.length) {
    rememberTranscript(cacheKey, r.j.segments);
    return showLines(vid, r.j.segments);
  }
  const msg = r.status === 401 ? '비밀번호를 다시 넣어 주세요.'
    : r.status === 404 || (r.ok && !(r.j.segments || []).length) ? '이 영상은 영어 자막이 없어요.'
    : r.status === 429 ? '자막 API의 이번 달 한도를 다 썼어요. 영상은 그대로 볼 수 있어요.'
    : r.status === 503 ? '자막 서버 설정(SUPADATA_API_KEY)이 아직 안 됐어요.'
    : r.status === 403 ? '이 영상은 자막을 가져올 수 없는 영상이에요.'
    : '자막을 불러오지 못했어요. 잠시 후 다시 열어 주세요.';
  if (r.status === 401) showGate('비밀번호가 맞지 않아요.');
  subsStatus(vid, msg);
}
function rememberTranscript(key, segs) {
  const idx = LS.get('vp-tr-index', []).filter((k) => k !== key);
  idx.push(key);
  while (idx.length > 25) LS.del(idx.shift());
  if (!LS.set(key, { at: Date.now(), segs })) { while (idx.length > 1) { LS.del(idx.shift()); if (LS.set(key, { at: Date.now(), segs })) break; } }
  LS.set('vp-tr-index', idx);
}
function subsStatus(vid, msg) { if (S.w && S.w.vid === vid) { S.w.status = msg; const el = $('#subs'); if (el) el.innerHTML = `<div class="status">${esc(msg)}</div>`; } }

// segments -> clean, non-duplicated lines
function buildLines(segs) {
  const words = [];
  let all = '';
  segs.forEach((sg) => {
    let text = decodeEntities(String(sg.text || '')).replace(/\s+/g, ' ').trim();
    if (!text) return;
    const t = +sg.t || 0, d = Math.max(+sg.d || 0, 300);
    // drop sound tags such as [Music] or *applause*
    text = text.replace(/\[[^\]]{1,30}\]|\*[^*]{1,30}\*|\([A-Za-z ]{1,20}\)$/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return;
    const toks = text.split(' ');
    // drop words that only repeat the end of the previous segment (rolling auto captions)
    let skip = 0;
    if (words.length) {
      const prevEnd = words[words.length - 1].t;
      if (t <= prevEnd + 1500) {
        for (let k = Math.min(10, toks.length, words.length); k >= 2; k--) {
          const tail = words.slice(-k).map((x) => norm(x.w)).join(' ');
          const head = toks.slice(0, k).map(norm).join(' ');
          if (tail === head) { skip = k; break; }
        }
      }
    }
    toks.slice(skip).forEach((w, i, arr) => words.push({ w, t: t + d * (i / Math.max(arr.length, 1)), seg: sg }));
    all += ' ' + text;
  });
  const wc = all.split(' ').length || 1;
  const punct = (all.match(/[.?!]/g) || []).length / wc > 0.03;
  const lines = [];
  let cur = [];
  const flush = () => { if (cur.length) { lines.push({ t: cur[0].t, words: cur.map((x) => ({ w: x.w, n: norm(x.w), s: stem(x.w) })) }); cur = []; } };
  words.forEach((x, i) => {
    const prev = words[i - 1];
    if (cur.length) {
      const gap = x.t - prev.t;
      const endSent = /[.?!]["')\]]?$/.test(prev.w);
      if (punct ? ((endSent && cur.length >= 3) || cur.length >= 20 || (gap > 1800 && cur.length >= 4))
                : (cur.length >= 12 || (gap > 1300 && cur.length >= 3))) flush();
    }
    cur.push(x);
  });
  flush();
  lines.forEach((L, i) => { L.end = i + 1 < lines.length ? Math.max(lines[i + 1].t, L.t + 600) : L.t + 5000; });
  return lines;
}
function showLines(vid, segs) {
  if (!S.w || S.w.vid !== vid) return;
  S.w.lines = buildLines(segs);
  S.w.status = '';
  renderSubs();
}
function highlights(line) {
  // returns per-word class + vocab id
  const marks = new Array(line.words.length).fill(null);
  if (line.tag) return marks;
  const toks = line.words;
  for (const w of vocab()) {
    const s = st(w.id); if (s === 'learned' || s === 'known') continue;
    const pat = pattern(w.expr); if (!pat.length) continue;
    for (let i = 0; i < toks.length; i++) {
      const end = matchAt(toks, i, pat, 0);
      if (end > i) { for (let k = i; k < end; k++) if (!marks[k] || marks[k].type !== 'v') marks[k] = { type: 'v', id: w.id }; i = end - 1; }
    }
  }
  const saved = S.prog.saved;
  toks.forEach((t, k) => { if (!marks[k] && t.s && saved[t.s] && !saved[t.s].del && saved[t.s].s !== 'learned') marks[k] = { type: 's', key: t.s }; });
  return marks;
}
function lineHTML(L, i, where) {
  const marks = highlights(L);
  return L.words.map((x, k) => {
    if (L.tag) return esc(x.w);
    const m = marks[k];
    const cls = 'w' + (m ? (m.type === 'v' ? ' hv' : ' hs') : '');
    return `<span class="${cls}" data-l="${i}" data-k="${k}"${m && m.id ? ` data-vid="${esc(m.id)}"` : ''}>${esc(x.w)}</span>`;
  }).join(' ');
}
/* ---------------- Korean sentence on swipe ---------------- */
const lineText = (L) => L.words.map((x) => x.w).join(' ');
const papagoURL = (t) => 'https://papago.naver.com/?sk=en&tk=ko&st=' + encodeURIComponent(t);
const krCache = {};
let onDevice = null; // Chrome's built-in translator (free, on the device) when available
async function translateKo(text) {
  if (krCache[text]) return { ko: krCache[text] };
  try {
    const within = (p, ms) => Promise.race([p, new Promise((res) => setTimeout(() => res(null), ms))]);
    if (onDevice === null && 'Translator' in self) {
      // use it only when the language pack is already on the device (no waiting for downloads)
      const av = await within(self.Translator.availability({ sourceLanguage: 'en', targetLanguage: 'ko' }), 2000);
      onDevice = av === 'available' ? (await within(self.Translator.create({ sourceLanguage: 'en', targetLanguage: 'ko' }), 3000)) || false : false;
    }
    if (onDevice) { const ko = await within(onDevice.translate(text), 4000); if (ko) { krCache[text] = ko; return { ko }; } }
  } catch (e) { onDevice = false; }
  if (S.translator === 'none') return { none: true };
  const r = await api('/api/translate', { method: 'POST', body: JSON.stringify({ text }) });
  if (r.status === 503 && r.j.error === 'no_translator') { S.translator = 'none'; return { none: true }; }
  if (r.ok && r.j.ko) { krCache[text] = r.j.ko; return { ko: r.j.ko }; }
  return null;
}
function krHTML(i) {
  const w = S.w; const k = w && w.kr && w.kr[i]; if (!k || !k.open) return '';
  const L = w.lines[i];
  if (k.state === 'loading') return '<div class="kr">번역 중…</div>';
  if (k.state === 'ok') return `<div class="kr">${esc(k.text)}</div>`;
  const why = k.state === 'none' ? '이 기기에서 문장 번역을 쓰려면 번역 키 설정이 필요해요.' : '번역을 가져오지 못했어요.';
  return `<div class="kr">${why} <a href="${papagoURL(lineText(L))}" target="_blank" rel="noopener">파파고에서 보기</a></div>`;
}
function lineRowHTML(L, i) {
  const w = S.w;
  return `<div class="ln ${L.tag ? 'tag' : ''} ${i === w.active ? 'on' : ''} ${w.kr && w.kr[i] && w.kr[i].open ? 'kr-open' : ''}" data-i="${i}"><button class="lt" data-act="seek" data-i="${i}">${fmt(L.t / 1000)}</button><div><p>${lineHTML(L, i)}</p>${krHTML(i)}</div><button class="kbtn" data-act="kr" data-i="${i}" aria-label="한국어 번역 보기">한</button></div>`;
}
function refreshLine(i) {
  const w = S.w; if (!w || !w.lines[i]) return;
  const el = document.querySelector(`.ln[data-i="${i}"]`);
  if (el) el.outerHTML = lineRowHTML(w.lines[i], i);
  if (i === w.active) { const now = $('#now'); if (now) now.innerHTML = lineHTML(w.lines[i], i, 'n') + krHTML(i); }
}
async function toggleKr(i) {
  const w = S.w; if (!w || !w.lines[i]) return;
  w.kr = w.kr || {};
  const k = w.kr[i];
  if (k && k.open) { k.open = false; refreshLine(i); return; }
  if (k && k.state === 'ok') { k.open = true; refreshLine(i); return; }
  w.kr[i] = { open: true, state: 'loading' }; refreshLine(i);
  const vid = w.vid;
  const res = await translateKo(lineText(w.lines[i]));
  if (!S.w || S.w.vid !== vid) return;
  S.w.kr[i] = { open: S.w.kr[i] ? S.w.kr[i].open : true, state: res && res.ko ? 'ok' : res && res.none ? 'none' : 'fail', text: res && res.ko };
  refreshLine(i);
}
// swipe a subtitle line (or the big current line) sideways to show / hide its Korean
let sw = null;
document.addEventListener('touchstart', (e) => {
  const el = e.target.closest('.ln, #now'); if (!el || !S.w || e.touches.length !== 1) { sw = null; return; }
  sw = { el, x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, horiz: null };
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (!sw) return;
  const dx = e.touches[0].clientX - sw.x, dy = e.touches[0].clientY - sw.y;
  if (sw.horiz === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) sw.horiz = Math.abs(dx) > Math.abs(dy);
  if (sw.horiz) { sw.dx = dx; sw.el.style.transform = `translateX(${Math.max(-60, Math.min(60, dx * 0.5))}px)`; }
}, { passive: true });
document.addEventListener('touchend', () => {
  if (!sw) return;
  const { el, dx, horiz } = sw; sw = null;
  el.style.transform = '';
  if (!horiz || Math.abs(dx) < 50 || !S.w) return;
  const i = el.id === 'now' ? S.w.active : +el.dataset.i;
  if (i >= 0) toggleKr(i);
}, { passive: true });

function renderSubs() {
  const w = S.w; const el = $('#subs'); if (!w || !el) return;
  if (!w.lines.length) { el.innerHTML = `<div class="status">${esc(w.status || '자막이 없어요.')}</div>`; return; }
  el.innerHTML = w.lines.map((L, i) => lineRowHTML(L, i)).join('');
  if (w.active >= 0) { const now = $('#now'); if (now && w.lines[w.active]) now.innerHTML = lineHTML(w.lines[w.active], w.active, 'n') + krHTML(w.active); }
}
function renderVWords() {
  const w = S.w; const el = $('#vwords'); if (!w || !el || !w.v) return;
  const rev = reviewSet();
  el.innerHTML = `<div class="vsec">${(w.v.words || []).map((x) => wordRow({ ...x, v: w.v }, rev, true)).join('') || '<p class="empty">표현이 없어요.</p>'}</div>`;
}

/* ---------------- word sheet ---------------- */
const dictCache = {};
async function lookup(word) {
  const n = norm(word); if (!n) return null;
  if (dictCache[n] !== undefined) return dictCache[n];
  const tries = [...new Set([n, stem(n), stem(n) + 'e'])];
  for (const q of tries) {
    try {
      const r = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(q));
      if (r.ok) {
        const j = await r.json();
        const defs = [];
        (j || []).forEach((e) => (e.meanings || []).forEach((m) => { if (defs.length < 3 && m.definitions && m.definitions[0]) defs.push({ pos: m.partOfSpeech, def: m.definitions[0].definition }); }));
        dictCache[n] = { word: (j[0] && j[0].word) || q, phon: j[0] && j[0].phonetic, defs };
        return dictCache[n];
      }
    } catch (e) { break; }
  }
  dictCache[n] = null;
  return null;
}
const dictShards = {};
async function shard(ch) {
  if (!/^[a-z]$/.test(ch)) return {};
  if (!dictShards[ch]) dictShards[ch] = fetch('data/dict/' + ch + '.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return dictShards[ch];
}
function lemmas(n) {
  const out = [n];
  const add = (x) => { if (x && x.length > 1 && !out.includes(x)) out.push(x); };
  add(IRREG[n]);
  const undouble = (x) => (/([b-df-hj-np-tv-z])\1$/.test(x) ? x.slice(0, -1) : x);
  if (n.endsWith('ies')) add(n.slice(0, -3) + 'y');
  if (n.endsWith('ied')) add(n.slice(0, -3) + 'y');
  if (n.endsWith('ier')) add(n.slice(0, -3) + 'y');
  if (n.endsWith('iest')) add(n.slice(0, -4) + 'y');
  if (n.endsWith('ily')) add(n.slice(0, -3) + 'y');
  for (const suf of ['ing', 'ed', 'est', 'er']) {
    if (n.endsWith(suf) && n.length > suf.length + 2) { const b = n.slice(0, -suf.length); add(b); add(b + 'e'); add(undouble(b)); }
  }
  if (n.endsWith('es')) add(n.slice(0, -2));
  if (n.endsWith('s') && !n.endsWith('ss')) add(n.slice(0, -1));
  if (n.endsWith('ly') && n.length > 4) add(n.slice(0, -2));
  return out;
}
// Korean meanings from the bundled open dictionary: the word itself, plus a phrase it may start or end.
async function dictKo(words, k) {
  const tok = (i) => (words[i] ? norm(words[i].w).replace(/'$/, '') : '');
  const look = async (q) => { const d = await shard(q[0]); const h = d[q]; return h && h.length > 1 ? { lemma: q, pos: h[0], ko: h.slice(1) } : null; };
  const w0 = tok(k), w1 = tok(k + 1), wm = tok(k - 1), w2 = tok(k + 2);
  let single = null;
  for (const l of lemmas(w0)) { single = await look(l); if (single) break; }
  const phraseTries = [];
  if (w1 && w2) phraseTries.push([w0, w1, w2].join(' '));
  if (w1) lemmas(w0).forEach((l) => phraseTries.push(l + ' ' + w1));
  if (wm) phraseTries.push(wm + ' ' + w0);
  let phrase = null;
  for (const q of phraseTries) { phrase = await look(q); if (phrase) break; }
  return single || phrase ? { single, phrase } : null;
}
const koCache = {};
// Fill a saved word's meanings in the background, so saving before the lookup finishes never leaves them empty.
async function fillMeaning(key, word, L, k) {
  const has = () => S.prog.saved[key] && !S.prog.saved[key].del;
  let ko = '', def = '';
  if (L && Number.isInteger(k)) { const dk = await dictKo(L.words, k); if (dk) ko = (dk.single || dk.phrase).ko.slice(0, 2).join(', '); }
  if (!ko) { const kr = await define(word, L ? lineText(L) : word); if (kr && kr.ko) ko = kr.ko; }
  const d = await lookup(word); if (d && d.defs.length) def = d.defs[0].def;
  if (!has()) return;
  const cur = S.prog.saved[key];
  const upd = { ...cur };
  if (!cur.ko && ko) upd.ko = ko;
  if (!cur.def && def) upd.def = def;
  if (upd.ko !== cur.ko || upd.def !== cur.def) { upd.at = Date.now(); S.prog.saved[key] = upd; saveProg(); refreshKeepSheet(); updateBadge(); }
  else if (!cur.ko) refreshKeepSheet(); // still missing: the popup and word list ask for it
}
function refreshKeepSheet() { const h = location.hash || ''; if (h.startsWith('#/v/')) { renderSubs(); renderVWords(); } else if (h.startsWith('#/book/')) { rdRepaintWords(); } else refresh(); }
function koInputHTML(key, extra = '') {
  return `<div class="koedit"><input id="koIn-${esc(key)}" placeholder="한국어 뜻을 직접 적어 주세요" maxlength="80"><button class="btn sm primary" data-act="ko-save" data-key="${esc(key)}" ${extra}>뜻 저장</button></div><div class="err" id="koErr-${esc(key)}"></div>`;
}
async function define(word, sentence) {
  if (S.translator === 'none') return { none: true };
  const key = norm(word) + '|' + sentence;
  if (koCache[key]) return koCache[key];
  const r = await api('/api/define', { method: 'POST', body: JSON.stringify({ word, sentence }) });
  if (r.status === 503 && r.j.error === 'no_translator') { S.translator = 'none'; return { none: true }; }
  if (r.ok && r.j.ko) { koCache[key] = r.j; return r.j; }
  return null;
}
function closeSheet() { if (typeof SH !== 'undefined' && SH.ctx) shadowStopAll(); const s = $('#sheet'); s.hidden = true; s.innerHTML = ''; document.querySelectorAll('.w.sel').forEach((x) => x.classList.remove('sel')); }
async function openWordSheet(li, k, span) {
  const inBook = !!(span && span.closest('#reader'));
  const lines = inBook ? (S.rd && S.rd.sents) : (S.w && S.w.lines);
  if (!lines || !lines[li]) return;
  document.querySelectorAll('.w.sel').forEach((x) => x.classList.remove('sel'));
  if (span) span.classList.add('sel');
  const L = lines[li], tok = L.words[k];
  if (inBook) rdTouch();
  S.sheetCtx = inBook ? { L, k, vid: `book:${S.rd.book.id}:${S.rd.ch}`, t: L.p, book: true } : { L, k, vid: S.w.vid, t: Math.floor(L.t / 1000) };
  const raw = tok.w.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, '');
  const vocabId = span && span.dataset.vid;
  const entry = vocabId ? vocab().find((x) => x.id === vocabId) : null;
  const sentence = L.words.map((x) => x.w).join(' ');
  const key = tok.s;
  const saved = S.prog.saved[key] && !S.prog.saved[key].del;
  const sheet = $('#sheet');
  const naver = 'https://en.dict.naver.com/#/search?query=' + encodeURIComponent(raw);
  const papago = 'https://papago.naver.com/?sk=en&tk=ko&st=' + encodeURIComponent(sentence);
  const vocabBlock = entry ? `<div class="def"><span class="pill p-review">단어장 표현</span> <b style="font-size:15px;color:var(--ink)">${esc(entry.expr)}</b> ${spk(entry.expr)}<div style="margin-top:4px">${esc(entry.ko)}</div>${entry.ex ? `<div class="ex">${esc(entry.ex)}</div><div class="exko">${esc(entry.exKo || '')}</div>` : ''}${entry.note ? `<div class="wnote">${esc(entry.note)}</div>` : ''}</div>
    <div class="row"><button class="btn sm ${st(entry.id) === 'learned' ? 'on' : ''}" data-act="sheet-learn" data-id="${esc(entry.id)}">${st(entry.id) === 'learned' ? '외웠음 ✓' : '외웠음'}</button><button class="btn sm" data-act="sheet-known" data-id="${esc(entry.id)}">이미 앎</button></div>` : '';
  sheet.innerHTML = `<button class="x close" data-act="sheet-close" aria-label="닫기">✕</button>
    <div class="sw">${esc(raw)} ${spk(raw)}</div><div class="ctx">${esc(sentence)}</div>
    ${vocabBlock}
    ${entry ? '' : '<div id="ko" class="def">한국어 뜻을 찾는 중…</div>'}
    <div id="dict" class="def small">영어 사전을 찾는 중…</div>
    <div class="row">
      <button class="btn sm ${saved ? 'on' : ''}" data-act="save-word" data-key="${esc(key)}" data-word="${esc(raw)}" data-l="${li}" data-k="${k}">${saved ? '저장됨 · 취소' : '모르는 단어로 저장'}</button>
      <a class="btn sm" href="${naver}" target="_blank" rel="noopener">네이버 사전</a>
      <button class="btn sm" data-act="sheet-kr">문장 번역</button>
      <button class="btn sm" data-act="shadow-sheet">🎤 따라 말하기</button>
      ${inBook ? `<button class="btn sm" data-act="say-line">이 문장 듣기</button>` : `<button class="btn sm" data-act="seek" data-i="${li}">이 문장 듣기</button>`}
    </div>
    <div id="sheetKr"></div>`;
  sheet.hidden = false;
  const seq = ++S.sheetSeq;
  delete sheet.dataset.ko; delete sheet.dataset.def;
  if (!entry) (async () => {
    const dk = await dictKo(L.words, k);
    const kb = $('#ko'); if (!kb || seq !== S.sheetSeq) return;
    if (dk) {
      const one = dk.single, ph = dk.phrase;
      kb.innerHTML = `${one ? `${norm(one.lemma) !== norm(raw) ? `<div class="small">기본형 <b style="color:var(--ink);font-size:13px">${esc(one.lemma)}</b></div>` : ''}${one.pos ? `<b>${esc(one.pos)}</b>` : ''}<span style="font-size:17px">${one.ko.map(esc).join(' · ')}</span>` : ''}
        ${ph ? `<div style="margin-top:${one ? 6 : 0}px"><span class="small">${one ? '혹시 표현이라면' : '표현'}</span> <b style="color:var(--ink);font-size:13px">${esc(ph.lemma)}</b> ${ph.ko.map(esc).join(' · ')}</div>` : ''}
        <div class="small" style="margin-top:2px">공개 사전 기준 · 문장 속 뜻과 다를 수 있어요</div>`;
      sheet.dataset.ko = (one || ph).ko.slice(0, 2).join(', ');
      return;
    }
    const kr = await define(raw, sentence);
    if (!$('#ko') || seq !== S.sheetSeq) return;
    if (kr && kr.ko) {
      kb.innerHTML = `${kr.pos ? `<b>${esc(kr.pos)}</b>` : ''}<span style="font-size:17px">${esc(kr.ko)}</span>${kr.other ? `<div class="small" style="margin-top:2px">다른 뜻: ${esc(kr.other)}</div>` : ''}`;
      sheet.dataset.ko = kr.ko;
    } else {
      kb.innerHTML = `<span class="small">공개 사전에 없는 단어예요. 네이버 사전에서 확인하고 뜻을 적어 두면 단어장·퀴즈·복습에 쓰여요.</span>${koInputHTML(key, `data-word="${esc(raw)}" data-l="${li}"`)}`;
    }
  })();
  const d = await lookup(raw);
  const box = $('#dict'); if (!box || sheet.hidden || seq !== S.sheetSeq) return;
  if (d && d.defs.length) {
    box.className = 'def';
    box.innerHTML = `${d.phon ? `<div class="small">${esc(d.phon)}</div>` : ''}${d.defs.map((x) => `<div><b>${esc(x.pos)}</b>${esc(x.def)}</div>`).join('')}`;
    sheet.dataset.def = d.defs[0].def;
  } else {
    box.innerHTML = '영어 사전에서 찾지 못했어요. 네이버 사전 버튼으로 확인해 보세요.';
  }
}

/* ---------------- words page ---------------- */
function statsHTML() {
  const ws = vocab(), sv = savedList();
  const total = ws.length + sv.length;
  const learned = ws.filter((w) => st(w.id) === 'learned').length + sv.filter((x) => x.s === 'learned').length;
  const known = ws.filter((w) => st(w.id) === 'known').length;
  return `<div class="stats"><div class="stat"><div class="k">모은 표현</div><div class="v">${total}</div></div><div class="stat"><div class="k">외웠음</div><div class="v">${learned}</div></div><div class="stat"><div class="k">이미 앎</div><div class="v">${known}</div></div><div class="stat"><div class="k">남은 표현</div><div class="v">${total - learned - known}</div></div></div>`;
}
function wordRow(w, rev, inWatch) {
  const s = st(w.id);
  return `<div class="word ${s === 'known' ? 'known' : ''}">
    <button class="chk ${s === 'learned' ? 'on' : ''}" data-act="learn" data-id="${esc(w.id)}" aria-label="외웠음 표시">${s === 'learned' ? ICON_CHECK : ''}</button>
    <div><div><span class="expr">${esc(w.expr)}</span> ${spk(w.expr)}<span class="pos">${esc(w.pos || '')}</span> ${rev[w.id] ? '<span class="pill p-review">복습</span>' : ''}</div>
      <div>${esc(w.ko)}</div>
      ${w.ex ? `<div class="ex">${esc(w.ex)}</div><div class="exko">${esc(w.exKo || '')}</div>` : ''}
      ${w.note ? `<div class="wnote">${esc(w.note)}</div>` : ''}${dueLabel(w.id)}</div>
    <div class="acts">${inWatch ? `<button class="ts" data-act="seek-t" data-t="${w.t}">${ICON_PLAY}${fmt(w.t)}</button>` : srcA(w.v.vid, w.t)}
      <button class="btn sm ${s === 'known' ? 'on' : ''}" data-act="known" data-id="${esc(w.id)}">${s === 'known' ? '앎 취소' : '이미 앎'}</button></div></div>`;
}
function prefillKo() { if (S.editKey) { const x = S.prog.saved[S.editKey], i = document.getElementById('koIn-' + S.editKey); if (x && i && !i.value) i.value = x.ko || ''; } }
function renderWords() {
  const rev = reviewSet();
  let html = statsHTML();
  html += `<div class="chips"><button class="btn ${S.hideDone ? 'on' : ''}" data-act="hide-done">외운 표현 숨기기</button></div>`;
  const vs = allSources().sort((a, b) => (b.batchOrder || 0) - (a.batchOrder || 0) || (a.order || 0) - (b.order || 0));
  vs.forEach((v) => {
    let ws = (v.words || []).map((w) => ({ ...w, v }));
    if (S.hideDone) ws = ws.filter((w) => !st(w.id));
    if (!ws.length) return;
    html += `<div class="vsec"><h3><a href="${ytAt(v.vid)}">${esc(v.title)}</a><span class="pill ${v.kind === 'short' ? 'p-short' : v.kind === 'book' ? 'p-cc' : 'p-long'}">${v.kind === 'short' ? '쇼츠' : v.kind === 'book' ? '책' : '영상'}</span></h3>${ws.map((w) => wordRow(w, rev, false)).join('')}</div>`;
  });
  let sv = savedList().sort((a, b) => (b.at || 0) - (a.at || 0));
  if (S.hideDone) sv = sv.filter((x) => x.s !== 'learned');
  html += `<div class="h2">자막에서 저장한 단어 ${sv.length}</div>`;
  html += sv.length ? `<div class="vsec">${sv.map((x) => `<div class="word">
      <button class="chk ${x.s === 'learned' ? 'on' : ''}" data-act="saved-learn" data-key="${esc(x.key)}" aria-label="외웠음 표시">${x.s === 'learned' ? ICON_CHECK : ''}</button>
      <div><span class="expr">${esc(x.word)}</span> ${spk(x.word)}${S.editKey === x.key || !x.ko ? `${!x.ko ? '<div><span class="pill p-review">뜻 입력 필요</span></div>' : ''}${koInputHTML(x.key)}${S.editKey === x.key ? '<button class="btn sm" data-act="ko-cancel" style="margin-top:4px">취소</button>' : ''}` : `<div><button class="kolink" data-act="ko-edit" data-key="${esc(x.key)}" title="뜻 고치기">${esc(x.ko)} <span class="small">✎</span></button></div>`}${x.def ? `<div class="small" style="font-size:13px;color:var(--ink2)">${esc(x.def)}</div>` : ''}${x.ctx ? `<div class="ex">${esc(x.ctx)}</div>` : ''}</div>
      <div class="acts">${srcA(x.vid, x.t)}<button class="btn sm" data-act="saved-del" data-key="${esc(x.key)}">삭제</button></div></div>`).join('')}</div>`
    : '<p class="small">영상 자막에서 단어를 눌러 "모르는 단어로 저장"하면 여기에 모여요.</p>';
  $('#view').innerHTML = html;
  prefillKo();
}

/* ---------------- flashcards ---------------- */
const reviewTabs = (on) => `<div class="ptabs"><a href="#/review" class="${on === 'review' ? 'on' : ''}">오늘 복습</a><a href="#/log" class="${on === 'log' ? 'on' : ''}">학습 달력</a></div>`;
const practiceTabs = (on) => `<div class="ptabs"><a href="#/cards" class="${on === 'cards' ? 'on' : ''}">플래시카드</a><a href="#/quiz" class="${on === 'quiz' ? 'on' : ''}">퀴즈</a><a href="#/write" class="${on === 'write' ? 'on' : ''}">영작${newFeedback() ? `<span class="nb">${newFeedback()}</span>` : ''}</a></div>`;
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function buildDeck() {
  const ws = vocab().filter((w) => !st(w.id)).map((w) => ({ kind: 'v', id: w.id, front: w.expr, ko: w.ko, ex: w.ex, exKo: w.exKo, from: w.v.title, vid: w.v.vid, t: w.t }));
  const sv = savedList().filter((x) => x.s !== 'learned').map((x) => ({ kind: 's', key: x.key, front: x.word, ko: x.ko || x.def || '', ex: x.ctx || '', from: '저장한 단어', vid: x.vid, t: x.t }));
  S.fc.deck = shuffle(S.fc.scope === 'saved' ? sv : S.fc.scope === 'vocab' ? ws : [...ws, ...sv]);
  S.fc.i = 0; S.fc.flip = false;
}
function renderCards() {
  if (!S.fc.deck) buildDeck();
  const d = S.fc.deck, c = d[S.fc.i];
  const scope = `${practiceTabs('cards')}<div class="chips" style="justify-content:center">${[['all', '전체'], ['vocab', '단어장 표현'], ['saved', '저장한 단어']].map(([k, l]) => `<button class="btn sm ${S.fc.scope === k ? 'on' : ''}" data-act="fc-scope" data-k="${k}">${l}</button>`).join('')}</div>`;
  if (!c) { $('#view').innerHTML = `<div class="center">${scope}<p class="empty">${d.length ? '한 바퀴 다 돌았어요.' : '남은 카드가 없어요.'}</p><div class="btns"><button class="btn primary" data-act="fc-restart">다시 섞기</button></div></div>`; return; }
  $('#view').innerHTML = `<div class="center">${scope}<div class="counter">${S.fc.i + 1} / ${d.length} · 연습용 (복습 일정은 '복습' 탭에서 관리돼요)</div>
    <div class="fc" data-act="fc-flip"><div class="big">${esc(c.front)} ${spk(c.front)}</div><div class="from">${esc(c.from)}</div>
      ${S.fc.flip ? `<div class="ko">${esc(c.ko)}</div>${c.ex ? `<div class="ex" style="margin-top:10px">${esc(c.ex)}</div><div class="exko">${esc(c.exKo || '')}</div>` : ''}` : '<div class="hint">눌러서 뜻 보기</div>'}</div>
    <div class="btns">${srcA(c.vid, c.t, '장면 ')}<button class="btn" data-act="fc-again">다음에 다시</button><button class="btn primary" data-act="fc-learn">외웠음</button></div></div>`;
}

/* ---------------- quiz ---------------- */
function quizItems() {
  const v = vocab().filter((w) => st(w.id) !== 'known').map((w) => ({ id: w.id, expr: w.expr, ko: w.ko, ex: w.ex || '', vid: w.v.vid, t: w.t, src: 'v' }));
  const sv = savedList().filter((x) => x.ko).map((x) => ({ id: 's:' + x.key, expr: x.word, ko: x.ko, ex: x.ctx || '', vid: x.vid, t: x.t, src: 's' }));
  return { v, sv, all: [...v, ...sv] };
}
function buildQuiz() {
  const it = quizItems();
  const all = it.all; // wrong options can come from anything
  const pick = S.quiz.scope === 'saved' ? it.sv : S.quiz.scope === 'vocab' ? it.v : it.all;
  const pool = shuffle([...pick]).slice(0, 10);
  S.quiz.qs = pool.map((w, k) => {
    const dir = k % 2 ? 'ko2en' : 'en2ko';
    const key = (x) => String((dir === 'en2ko' ? x.ko : x.expr) || '').trim().toLowerCase();
    const used = new Set([key(w)]);
    const others = shuffle(all.filter((x) => x.id !== w.id)).filter((x) => { const kk = key(x); if (used.has(kk)) return false; used.add(kk); return true; }).slice(0, 3);
    return { w, dir, opts: shuffle([w, ...others]) };
  });
  S.quiz.i = 0; S.quiz.score = 0; S.quiz.ans = null;
}
function renderQuiz() {
  const it = quizItems();
  const counts = { all: it.all.length, vocab: it.v.length, saved: it.sv.length };
  S.quiz.scope = S.quiz.scope || 'all';
  const scope = `${practiceTabs('quiz')}<div class="chips" style="justify-content:center">${[['all', '전체'], ['vocab', '기본 표현'], ['saved', '저장한 단어']].map(([k, l]) => `<button class="btn sm ${S.quiz.scope === k ? 'on' : ''}" data-act="q-scope" data-k="${k}">${l} ${counts[k]}</button>`).join('')}</div>`;
  const noKo = savedList().filter((x) => !x.ko).length;
  const noKoNote = noKo ? `<p class="small" style="text-align:center">뜻이 비어 있는 저장 단어 ${noKo}개는 빠져 있어요. <a href="#/words">단어장에서 뜻 채우기</a></p>` : '';
  if (it.all.length < 4 || !counts[S.quiz.scope]) { $('#view').innerHTML = `<div class="center">${scope}<p class="empty">${it.all.length < 4 ? '퀴즈는 뜻이 있는 단어가 4개 이상일 때 열려요.' : '이 범위에는 아직 퀴즈로 낼 단어가 없어요.'}</p>${noKoNote}</div>`; return; }
  if (!S.quiz.qs) buildQuiz();
  const Q = S.quiz, q = Q.qs[Q.i];
  if (!q) { $('#view').innerHTML = `<div class="center">${scope}<div class="qcard" style="text-align:center"><div class="counter">결과</div><div class="q">${Q.score} / ${Q.qs.length}</div><p class="fb">${Q.score === Q.qs.length ? '전부 맞혔어요.' : '틀린 표현은 카드로 한 번 더 보면 좋아요.'}</p><button class="btn primary" data-act="q-restart">새 퀴즈</button></div></div>`; return; }
  const label = (o) => esc(q.dir === 'en2ko' ? o.ko : o.expr);
  $('#view').innerHTML = `<div class="center">${scope}${noKoNote}<div class="counter">${Q.i + 1} / ${Q.qs.length} · 맞힌 수 ${Q.score}</div><div class="qcard">
    <div class="small">${q.dir === 'en2ko' ? '이 표현의 뜻은?' : '이 뜻에 맞는 표현은?'}</div>
    <div class="q">${esc(q.dir === 'en2ko' ? q.w.expr : q.w.ko)}</div>
    ${q.opts.map((o, k) => { let c = ''; if (Q.ans !== null) { if (o.id === q.w.id) c = 'right'; else if (k === Q.ans) c = 'wrong'; } return `<button class="opt ${c}" data-act="q-ans" data-k="${k}" ${Q.ans !== null ? 'disabled' : ''}>${label(o)}</button>`; }).join('')}
    ${Q.ans !== null ? `<div class="fb">${esc(q.w.expr)} ${spk(q.w.expr)} — ${esc(q.w.ko)}<br><span class="ex">${esc(q.w.ex || '')}</span></div><div class="btns" style="justify-content:flex-start">${srcA(q.w.vid, q.w.t, '장면 ')}<button class="btn primary" data-act="q-next">다음</button></div>` : ''}
  </div></div>`;
}

/* ---------------- gate ---------------- */
function showGate(msg) { $('#gate').hidden = false; $('#gateErr').textContent = msg || ''; setTimeout(() => $('#gatePass').focus(), 50); }
$('#gateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = $('#gatePass').value.trim();
  if (!v) { $('#gateErr').textContent = '비밀번호를 넣어 주세요.'; return; }
  S.pass = v;
  const r = await api('/api/progress');
  if (r.status === 401) { $('#gateErr').textContent = '비밀번호가 맞지 않아요.'; return; }
  LS.set('vp-pass', v);
  $('#gate').hidden = true;
  await pull();
  route();
});
$('#gatePass').addEventListener('input', () => { $('#gateErr').textContent = ''; });

/* ---------------- events ---------------- */
document.addEventListener('click', (e) => {
  const word = e.target.closest('.w');
  if (word && (S.w || word.closest('#reader'))) { openWordSheet(+word.dataset.l, +word.dataset.k, word); return; }
  const kindBtn = e.target.closest('[data-kind]');
  if (kindBtn) { S.kind = kindBtn.dataset.kind; renderHome(); return; }
  const b = e.target.closest('[data-act]');
  if (!b) {
    const sheet = $('#sheet');
    if (!sheet.hidden && !e.target.closest('#sheet')) closeSheet();
    return;
  }
  const a = b.dataset.act, id = b.dataset.id;
  const w = S.w;
  switch (a) {
    case 'seek': seekLine(+b.dataset.i); break;
    case 'kr': toggleKr(+b.dataset.i); break;
    case 'play-all': { const list = S.videos.filter((v) => S.kind === 'all' || v.kind === S.kind).sort(homeOrder); const first = list.find((v) => (v.words || []).some((x) => !st(x.id))) || list[0]; if (first) location.hash = ytAt(first.vid); break; }
    case 'next-video': goNext(false); break;
    case 'auto': S.autoNext = !S.autoNext; LS.set('vp-auto', S.autoNext); b.textContent = '연속 재생 ' + (S.autoNext ? '켬' : '끔'); b.classList.toggle('on', S.autoNext); break;
    case 'seek-t': if (w && w.player && w.player.seekTo) { w.player.seekTo(+b.dataset.t, true); w.player.playVideo(); } break;
    case 'prev': if (w) seekLine(Math.max(0, w.active - 1)); break;
    case 'next': if (w) seekLine(Math.min(w.lines.length - 1, w.active + 1)); break;
    case 'replay': if (w) seekLine(Math.max(0, w.active)); break;
    case 'loop': if (w) { w.loop = !w.loop; b.textContent = w.loop ? '반복 켬' : '반복 끔'; b.classList.toggle('on', w.loop); } break;
    case 'tab-subs': case 'tab-words': setTab(a === 'tab-subs' ? 'subs' : 'words'); break;
    case 'fetch-subs': if (w) { setTab('subs'); $('#subs').innerHTML = '<div class="status">자막을 불러오는 중…</div>'; loadTranscript(w.vid); } break;
    case 'speak': speak(b.dataset.text); e.stopPropagation(); break;
    case 'learn': setStatus(id, st(id) === 'learned' ? null : 'learned'); refresh(); break;
    case 'known': setStatus(id, st(id) === 'known' ? null : 'known'); refresh(); break;
    case 'sheet-learn': setStatus(id, st(id) === 'learned' ? null : 'learned'); closeSheet(); refresh(); break;
    case 'sheet-known': setStatus(id, 'known'); closeSheet(); refresh(); break;
    case 'sheet-close': closeSheet(); break;
    case 'say-line': if (S.sheetCtx) speak(lineText(S.sheetCtx.L)); break;
    case 'sheet-kr': {
      const C = S.sheetCtx; if (!C) break;
      const box = $('#sheetKr'); const text = lineText(C.L); const seq = S.sheetSeq;
      box.innerHTML = '<div class="kr">번역 중…</div>';
      translateKo(text).then((res) => {
        if (seq !== S.sheetSeq || !$('#sheetKr')) return;
        $('#sheetKr').innerHTML = res && res.ko ? `<div class="kr">${esc(res.ko)}</div>`
          : `<div class="kr">${res && res.none ? '문장 번역 키가 설정되지 않았어요.' : '번역을 가져오지 못했어요.'} <a href="${papagoURL(text)}" target="_blank" rel="noopener">파파고에서 보기</a></div>`;
      });
      break;
    }
    case 'save-word': {
      const key = b.dataset.key; if (!key) break;
      const cur = S.prog.saved[key];
      if (cur && !cur.del) { S.prog.saved[key] = { ...cur, del: true, at: Date.now() }; saveProg(); closeSheet(); refresh(); break; }
      const C = S.sheetCtx || {}, L = C.L;
      const sh = $('#sheet');
      S.prog.saved[key] = { word: b.dataset.word, ko: sh.dataset.ko || (cur && cur.ko) || '', def: sh.dataset.def || (cur && cur.def) || '', ctx: L ? L.words.map((x) => x.w).join(' ').slice(0, 140) : '', vid: C.vid || null, t: C.t || 0, at: Date.now(), del: false, s: null };
      saveProg();
      b.textContent = '저장됨 · 취소'; b.classList.add('on');
      if (L) fillMeaning(key, b.dataset.word, L, +b.dataset.k);
      refreshKeepSheet();
      break;
    }
    case 'ko-save': {
      const key = b.dataset.key, inp = document.getElementById('koIn-' + key);
      const val = inp ? inp.value.trim() : '';
      if (!val) { const er = document.getElementById('koErr-' + key); if (er) er.textContent = '뜻을 입력해 주세요.'; break; }
      const cur = S.prog.saved[key];
      if (cur && !cur.del) S.prog.saved[key] = { ...cur, ko: val.slice(0, 80), at: Date.now() };
      else if (b.dataset.word) { // typed in the popup before saving: save the word with it
        const C = S.sheetCtx || {}, L = C.L;
        S.prog.saved[key] = { word: b.dataset.word, ko: val.slice(0, 80), def: $('#sheet').dataset.def || '', ctx: L ? L.words.map((x) => x.w).join(' ').slice(0, 140) : '', vid: C.vid || null, t: C.t || 0, at: Date.now(), del: false, s: null };
      }
      S.editKey = null; saveProg();
      if (!$('#sheet').hidden) closeSheet();
      refresh(); updateBadge();
      break;
    }
    case 'ko-edit': S.editKey = b.dataset.key; renderWords(); { const i = document.getElementById('koIn-' + b.dataset.key); if (i) i.focus(); } break;
    case 'ko-cancel': S.editKey = null; renderWords(); break;
    case 'saved-learn': { const x = S.prog.saved[b.dataset.key]; if (x) { S.prog.saved[b.dataset.key] = { ...x, s: x.s === 'learned' ? null : 'learned', at: Date.now() }; saveProg(); renderWords(); } break; }
    case 'saved-del': { const x = S.prog.saved[b.dataset.key]; if (x) { S.prog.saved[b.dataset.key] = { ...x, del: true, at: Date.now() }; saveProg(); renderWords(); } break; }
    case 'hide-done': S.hideDone = !S.hideDone; renderWords(); break;
    case 'fc-flip': S.fc.flip = !S.fc.flip; renderCards(); break;
    case 'fc-again': { const d = S.fc.deck, c = d.splice(S.fc.i, 1)[0]; if (c) d.splice(Math.min(S.fc.i + 4, d.length), 0, c); S.fc.flip = false; renderCards(); break; }
    case 'fc-learn': {
      const c = S.fc.deck[S.fc.i];
      if (c && c.kind === 'v') setStatus(c.id, 'learned');
      if (c && c.kind === 's') { const x = S.prog.saved[c.key]; if (x) { S.prog.saved[c.key] = { ...x, s: 'learned', at: Date.now() }; saveProg(); } }
      S.fc.i++; S.fc.flip = false; renderCards(); break;
    }
    case 'fc-restart': buildDeck(); renderCards(); break;
    case 'fc-scope': S.fc.scope = b.dataset.k; buildDeck(); renderCards(); break;
    case 'q-ans': { if (S.quiz.ans !== null) break; const k = +b.dataset.k; S.quiz.ans = k; const q = S.quiz.qs[S.quiz.i]; if (q.opts[k].id === q.w.id) S.quiz.score++; renderQuiz(); break; }
    case 'q-next': S.quiz.i++; S.quiz.ans = null; renderQuiz(); break;
    case 'q-restart': buildQuiz(); renderQuiz(); break;
    case 'q-scope': S.quiz.scope = b.dataset.k; S.quiz.qs = null; renderQuiz(); break;
    case 'topic-save': {
      const ta = $('#topicText'), text = ta.value.trim();
      if (!text) { $('#topicErr').textContent = '주제를 먼저 적어 주세요.'; break; }
      const now = Date.now();
      S.prog.topics = [...(S.prog.topics || []), { id: 't' + now.toString(36), text: text.slice(0, 300), kind: $('#topicKind').value, created: now, at: now }];
      saveProg(); renderHome(); break;
    }
    case 'topic-del': S.prog.topics = (S.prog.topics || []).map((t) => (t.id === id ? { ...t, del: true, at: Date.now() } : t)); saveProg(); renderHome(); break;
  }
});
document.addEventListener('input', (e) => { if (e.target.id === 'topicText') $('#topicErr').textContent = ''; });
document.addEventListener('change', (e) => {
  if (e.target.id === 'rate' && S.w) { S.w.rate = +e.target.value; try { S.w.player.setPlaybackRate(S.w.rate); } catch (err) {} }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id && e.target.id.startsWith('koIn-')) { e.preventDefault(); const b = e.target.parentElement.querySelector('[data-act="ko-save"]'); if (b) b.click(); return; }
  if (e.key === 'Escape') closeSheet();
  if (!S.w || /input|textarea|select/i.test(e.target.tagName)) return;
  if (e.key === 'ArrowLeft' && e.shiftKey) { seekLine(Math.max(0, S.w.active - 1)); e.preventDefault(); }
  if (e.key === 'ArrowRight' && e.shiftKey) { seekLine(Math.min(S.w.lines.length - 1, S.w.active + 1)); e.preventDefault(); }
});
document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible') { if (S.server === 'ok') { await pull(); if (!S.w) refresh(); } updateBadge(); } });
window.addEventListener('hashchange', route);
['wheel', 'touchmove'].forEach((ev) => window.addEventListener(ev, () => { if (S.w) S.w.pauseFollowUntil = Date.now() + 4000; }, { passive: true }));

/* ---------------- start ---------------- */
(async function init() {
  S.prog = mergeState({ status: {}, saved: {}, topics: [] }, LS.get('vp-prog', {}));
  try {
    const r = await fetch('data/videos.json', { cache: 'no-cache' });
    const j = await r.json();
    S.videos = Array.isArray(j.videos) ? j.videos : [];
  } catch (e) { S.videos = []; note('영상 목록을 불러오지 못했어요.'); }
  try { const r = await fetch('data/books.json', { cache: 'no-cache' }); S.books = (await r.json()).books || []; } catch (e) { S.books = []; }
  await pull(); // shows the passcode screen itself when the server asks for one
  route();
  updateBadge();
})();


/* ================= spaced review (FSRS) with auto-graded questions ================= */
const DAILY_CAP = 20, NEW_PER_DAY = 10;
let FS = null;
async function fsrsLib() {
  if (!FS) {
    const m = await import('./vendor/ts-fsrs.min.mjs');
    FS = { ...m, f: m.fsrs(m.generatorParameters({ enable_fuzz: true, request_retention: 0.9 })) };
  }
  return FS;
}
const dayKey = (t = Date.now()) => { const d = new Date(t - 4 * 3600e3); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const toCard = (c) => ({ ...c, due: new Date(c.due), last_review: c.last_review ? new Date(c.last_review) : undefined });
const cardOf = (id) => { const x = (S.prog.fsrs || {})[id]; return x && x.c ? toCard(x.c) : null; };
function relTime(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return Math.max(1, m) + '분 뒤';
  const h = Math.round(m / 60); if (h < 24) return h + '시간 뒤';
  const d = Math.round(h / 24); if (d < 31) return d + '일 뒤';
  return Math.round(d / 30) + '개월 뒤';
}
function dueLabel(id) {
  const c = cardOf(id); if (!c || st(id) === 'known') return '';
  const ms = c.due - Date.now();
  return `<div class="small" style="margin-top:4px">${ms <= 0 ? '오늘 복습할 차례' : '다음 복습 ' + relTime(ms)}</div>`;
}
function reviewItems() {
  const items = [];
  allSources().sort((a, b) => (a.batchOrder || 0) - (b.batchOrder || 0) || (a.order || 0) - (b.order || 0)).forEach((v) => (v.words || []).forEach((w) => {
    if (st(w.id) !== 'known') items.push({ id: w.id, kind: 'v', w: { ...w, v } });
  }));
  savedList().forEach((x) => { if (x.ko && x.s !== 'known') items.push({ id: 's:' + x.key, kind: 's', x }); });
  return items;
}
function daily() {
  const today = dayKey();
  if (!S.prog.daily || S.prog.daily.date !== today) S.prog.daily = { date: today, ids: [], newIds: [] };
  return S.prog.daily;
}
function buildQueue() {
  const now = Date.now(), d = daily();
  const items = reviewItems();
  const due = [], fresh = [];
  items.forEach((it) => { const c = cardOf(it.id); if (!c) fresh.push(it); else if (c.due.getTime() <= now) due.push({ it, due: c.due.getTime() }); });
  due.sort((a, b) => a.due - b.due);
  const doneSet = new Set(d.ids);
  const again = due.filter((x) => doneSet.has(x.it.id)).map((x) => x.it); // failed earlier today, due again
  const slots = Math.max(0, DAILY_CAP - d.ids.length);
  const dueNew = due.filter((x) => !doneSet.has(x.it.id)).map((x) => x.it).slice(0, slots);
  const newSlots = Math.max(0, Math.min(slots - dueNew.length, NEW_PER_DAY - (d.newIds || []).length));
  return [...again, ...dueNew, ...fresh.slice(0, newSlots)];
}
function todayLeft() { try { return buildQueue().length; } catch (e) { return 0; } }
function updateBadge() {
  const n = todayLeft();
  const el = $('#rvBadge'); if (el) { el.textContent = n ? String(n) : ''; el.hidden = !n; }
  try { if (navigator.setAppBadge) { if (n) navigator.setAppBadge(n); else navigator.clearAppBadge(); } } catch (e) {}
}
async function scheduleAs(id, rating, isNew) {
  const L = await fsrsLib();
  const now = new Date();
  const card = cardOf(id) || L.createEmptyCard(now);
  const r = L.f.next(card, now, rating);
  S.prog.fsrs = S.prog.fsrs || {};
  S.prog.fsrs[id] = { c: JSON.parse(JSON.stringify(r.card)), at: Date.now() };
  saveProg();
  return r.card;
}

/* question building */
const normAns = (s) => String(s || '').toLowerCase().replace(/[’‘]/g, "'").replace(/-/g, ' ').replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();
function lev(a, b) {
  const m = a.length, n = b.length; if (Math.abs(m - n) > 3) return 9;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
function grade(input, accepted) {
  const x = normAns(input); if (!x) return 'wrong';
  const acc = accepted.map(normAns);
  if (acc.includes(x)) return 'right';
  const xs = x.split(' ').map(stem).join(' ');
  if (acc.some((a) => a.split(' ').map(stem).join(' ') === xs)) return 'near';
  if (acc.some((a) => lev(a, x) <= (a.length >= 12 ? 2 : 1))) return 'near';
  return 'wrong';
}
const cleanExpr = (e) => String(e).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
function pickType(it) {
  const c = cardOf(it.id), reps = c ? c.reps : 0;
  if (it.kind === 's') return 'mcq';
  const dr = it.w.drill || {};
  const has = { mcq: true, vs: !!dr.vs, cloze: !!(dr.cloze && dr.cloze.length), listen: !/\(/.test(it.w.expr) && it.w.expr.length <= 32 };
  const order = reps === 0 ? ['mcq'] : reps === 1 ? ['vs', 'cloze', 'mcq'] : reps === 2 ? ['cloze', 'vs', 'mcq'] : [['cloze', 'vs', 'listen', 'cloze', 'mcq'][reps % 5], 'cloze', 'vs', 'mcq'];
  return order.find((t) => has[t]) || 'mcq';
}
function makeQuestion(it) {
  const type = pickType(it), c = cardOf(it.id), reps = c ? c.reps : 0;
  const expr = it.kind === 'v' ? it.w.expr : it.x.word, ko = it.kind === 'v' ? it.w.ko : it.x.ko;
  const q = { it, type, expr, ko, t0: Date.now(), hint: false };
  if (type === 'mcq') {
    const pool = reviewItems().filter((o) => o.id !== it.id).map((o) => (o.kind === 'v' ? o.w.ko : o.x.ko)).filter(Boolean);
    const used = new Set([ko]); const others = shuffle(pool).filter((k) => !used.has(k) && used.add(k)).slice(0, 3);
    q.opts = shuffle([ko, ...others]); q.answer = ko;
  } else if (type === 'vs') {
    const v = it.w.drill.vs; q.s = v.s; q.opts = shuffle([...v.opts]); q.answer = v.a; q.why = v.why;
  } else if (type === 'cloze') {
    const cl = it.w.drill.cloze[reps % it.w.drill.cloze.length]; q.s = cl.s; q.accept = cl.a;
  } else { q.accept = [cleanExpr(expr)]; }
  return q;
}
function ratingFor(q, result) {
  const sec = (Date.now() - q.t0) / 1000, typed = q.type === 'cloze' || q.type === 'listen';
  if (result === 'wrong') return 1;
  if (result === 'near' || q.hint) return 2;
  if (typed) return sec > 30 ? 2 : sec < 8 && cardOf(q.it.id) ? 4 : 3;
  return sec > 15 ? 2 : sec < 4 && cardOf(q.it.id) ? 4 : 3;
}

/* review screen */
function renderReview() {
  if (!S.rv) S.rv = { queue: buildQueue(), done: 0, q: null, res: null };
  const R = S.rv, d = daily();
  const total = d.ids.length + R.queue.length;
  const head = `<div class="rvhead"><div><b>오늘의 복습</b> <span class="small">하루 최대 ${DAILY_CAP}개 · 잊기 직전인 것부터</span></div><div class="small">${d.ids.length} / ${Math.max(total, d.ids.length)}</div></div><div class="bar" style="margin-bottom:14px"><i style="width:${total ? Math.round(d.ids.length / total * 100) : 100}%"></i></div>`;
  if (!R.q) {
    const next = R.queue[0];
    if (!next) {
      const tomorrow = reviewItems().filter((it) => { const c = cardOf(it.id); return c && c.due.getTime() <= Date.now() + 864e5; }).length;
      $('#view').innerHTML = `<div class="center">${reviewTabs('review')}${head}<div class="qcard" style="text-align:center"><div class="q">오늘 복습 끝</div><p class="fb">${d.ids.length ? `오늘 ${d.ids.length}개를 복습했어요.` : '오늘 복습할 표현이 없어요.'} 내일 복습할 표현은 약 ${tomorrow}개예요.</p></div></div>`;
      updateBadge(); return;
    }
    R.q = makeQuestion(next); R.res = null;
  }
  const q = R.q, answered = R.res !== null;
  const blank = (s) => esc(s).replace('___', '<span class="blank">' + (answered && q.type !== 'mcq' ? esc(q.answer || q.accept[0]) : '_____') + '</span>');
  let body = '';
  if (q.type === 'mcq') body = `<div class="small">이 표현의 뜻은?</div><div class="q">${esc(q.expr)} ${spk(q.expr)}</div>`;
  if (q.type === 'vs') body = `<div class="small">빈칸에 가장 알맞은 것은?</div><div class="q qs">${blank(q.s)}</div>`;
  if (q.type === 'cloze') body = `<div class="small">빈칸에 들어갈 표현을 써 보세요</div><div class="q qs">${blank(q.s)}</div><div class="small" style="margin:-6px 0 10px">뜻: ${esc(q.ko)}${q.hint ? ` · 힌트: ${esc(q.accept[0].split(' ').map((x) => x[0] + '…').join(' '))}` : ''}</div>`;
  if (q.type === 'listen') body = `<div class="small">듣고 그대로 써 보세요</div><div class="q"><button class="btn" data-act="rv-play">${ICON_SPK} 듣기</button></div>`;
  let input = '';
  if (q.type === 'mcq' || q.type === 'vs') {
    input = q.opts.map((o, k) => { let c = ''; if (answered) { if (o === q.answer) c = 'right'; else if (k === R.pick) c = 'wrong'; } return `<button class="opt ${c}" data-act="rv-pick" data-k="${k}" ${answered ? 'disabled' : ''}>${esc(o)}</button>`; }).join('');
  } else {
    input = `<input id="rvIn" class="rvin" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="영어로 입력" ${answered ? 'disabled' : ''} value="${esc(R.typed || '')}">
      ${answered ? '' : `<div class="btns" style="justify-content:flex-start"><button class="btn" data-act="rv-hint">힌트</button><button class="btn" data-act="rv-giveup">모르겠어요</button><button class="btn primary" data-act="rv-check">확인</button></div><div class="err" id="rvErr"></div>`}`;
  }
  let fb = '';
  if (answered) {
    const it = q.it, w = it.kind === 'v' ? it.w : null;
    const verdict = R.res === 'right' ? '<b style="color:var(--green)">정답</b>' : R.res === 'near' ? '<b style="color:var(--amber)">거의 맞았어요</b>' : '<b style="color:var(--accent)">아쉬워요</b>';
    fb = `<div class="fb">${verdict} · ${esc(q.expr)} ${spk(q.expr)} — ${esc(q.ko)}
      ${q.why ? `<div class="wnote">${esc(q.why)}</div>` : ''}
      ${w && w.ex && q.type !== 'mcq' ? `<div class="ex">${esc(w.ex)}</div>` : ''}
      <div class="small" style="margin-top:6px">다음 복습: ${esc(R.nextIn || '')}</div></div>
      <div class="btns" style="justify-content:flex-start">${w ? srcA(w.v.vid, w.t, '장면 ') : ''}<button class="btn primary" data-act="rv-next">다음</button></div>`;
  }
  $('#view').innerHTML = `<div class="center">${reviewTabs('review')}${head}<div class="qcard">${body}${input}${fb}</div></div>`;
  const inp = $('#rvIn'); if (inp && !answered) inp.focus({ preventScroll: true });
  updateBadge();
}
async function finishQuestion(result) {
  const R = S.rv, q = R.q; if (!q || R.res !== null) return;
  R.res = result;
  const rating = ratingFor(q, result);
  const isNew = !cardOf(q.it.id);
  const card = await scheduleAs(q.it.id, rating);
  const d = daily();
  if (!d.ids.includes(q.it.id)) d.ids.push(q.it.id);
  if (isNew) { d.newIds = d.newIds || []; if (!d.newIds.includes(q.it.id)) d.newIds.push(q.it.id); }
  saveProg();
  R.nextIn = relTime(card.due - Date.now());
  R.queue.shift();
  logAdd('rv', 1);
  if (rating === 1) R.queue.push(q.it); // comes back later in this session
  renderReview();
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act^="rv-"]'); if (!b || !S.rv) return;
  const R = S.rv, q = R.q; if (!q) return;
  const a = b.dataset.act;
  if (a === 'rv-pick') { R.pick = +b.dataset.k; finishQuestion(q.opts[R.pick] === q.answer ? 'right' : 'wrong'); }
  if (a === 'rv-play') speak(cleanExpr(q.expr));
  if (a === 'rv-hint') { q.hint = true; R.typed = ($('#rvIn') || {}).value || ''; renderReview(); }
  if (a === 'rv-giveup') { R.typed = ($('#rvIn') || {}).value || ''; finishQuestion('wrong'); }
  if (a === 'rv-check') {
    const v = ($('#rvIn') || {}).value || '';
    if (!v.trim()) { $('#rvErr').textContent = '답을 먼저 입력해 주세요.'; return; }
    R.typed = v; finishQuestion(grade(v, q.accept));
  }
  if (a === 'rv-next') { R.q = null; R.res = null; R.pick = null; R.typed = ''; renderReview(); }
});
document.addEventListener('keydown', (e) => {
  if (!S.rv || !(location.hash || '').startsWith('#/review') || e.key !== 'Enter') return;
  if (S.rv.res !== null) { e.preventDefault(); S.rv.q = null; S.rv.res = null; S.rv.pick = null; S.rv.typed = ''; renderReview(); }
  else if (e.target.id === 'rvIn') { e.preventDefault(); const b = document.querySelector('[data-act="rv-check"]'); if (b) b.click(); }
});
document.addEventListener('input', (e) => { if (e.target.id === 'rvIn') { const er = $('#rvErr'); if (er) er.textContent = ''; } });

/* ================= books: library, paginated reader, read-aloud, EPUB import ================= */
// Imported EPUBs stay on this device only (IndexedDB); they are never uploaded.
const IDB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('vocab-player', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('books', { keyPath: 'id' });
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('books', mode); const st = t.objectStore('books'); const out = fn(st); t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out); t.onerror = () => rej(t.error); }); },
  all() { return this.tx('readonly', (st) => st.getAll()); },
  get(id) { return this.tx('readonly', (st) => st.get(id)); },
  put(b) { return this.tx('readwrite', (st) => st.put(b)); },
  del(id) { return this.tx('readwrite', (st) => st.delete(id)); },
};
const builtIn = (id) => (S.books || []).find((b) => b.id === id);
const userBookMeta = {}; // id -> {title, author, chapters:[{title}]}
// Imported books: a full copy on this device (IndexedDB) plus a private copy in the
// passcode-protected store, so other devices can download it.
async function loadUserBooks() {
  let local = [];
  try { local = await IDB.all(); } catch (e) { local = []; }
  local.forEach((b) => { userBookMeta[b.id] = { id: b.id, title: b.title, author: b.author, cover: b.cover || null, chapters: b.chapters.map((c, i) => ({ n: i + 1, title: c.title, paras: c.paras.length })), user: true, local: true, synced: !!b.synced }; });
  if (S.server === 'ok') {
    const r = await api('/api/books');
    if (r.ok && Array.isArray(r.j.books)) {
      S.bookStore = true;
      r.j.books.forEach((m) => {
        const loc = userBookMeta[m.id];
        userBookMeta[m.id] = { id: m.id, title: m.title, author: m.author, cover: m.cover || (loc && loc.cover) || null, chapters: m.chapters.map((c, i) => ({ n: i + 1, title: c.title, paras: c.paras })), user: true, local: !!(loc && loc.local), synced: true };
      });
      // local books that the server lost track of are not synced
      Object.values(userBookMeta).forEach((b) => { if (b.local && !r.j.books.some((m) => m.id === b.id)) b.synced = false; });
    } else S.bookStore = false;
  }
  return Object.values(userBookMeta);
}
async function uploadBook(id, onProgress) {
  const b = await IDB.get(id); if (!b) throw new Error('missing');
  for (let i = 0; i < b.chapters.length; i++) {
    const r = await api('/api/books', { method: 'PUT', body: JSON.stringify({ id, n: i + 1, chapter: b.chapters[i] }) });
    if (!r.ok) throw new Error(r.status === 413 ? 'too_large' : 'upload');
    if (onProgress) onProgress(i + 1, b.chapters.length);
  }
  const meta = { id, title: b.title, author: b.author, cover: b.cover || null, chapters: b.chapters.map((c) => ({ title: c.title, paras: c.paras.length })), added: b.added };
  const r = await api('/api/books', { method: 'PUT', body: JSON.stringify({ meta }) });
  if (!r.ok) throw new Error('upload');
  await IDB.put({ ...b, synced: true });
}
async function downloadBook(meta, onProgress) {
  const chapters = [];
  for (let n = 1; n <= meta.chapters.length; n++) {
    const r = await api(`/api/books?id=${encodeURIComponent(meta.id)}&ch=${n}`);
    if (!r.ok || !r.j.chapter) throw new Error('download');
    chapters.push(r.j.chapter);
    if (onProgress) onProgress(n, meta.chapters.length);
  }
  await IDB.put({ id: meta.id, title: meta.title, author: meta.author, cover: meta.cover || null, chapters, added: Date.now(), synced: true });
  userBookMeta[meta.id] = { ...userBookMeta[meta.id], local: true, synced: true };
}
// cover: the book's own cover image when there is one, otherwise a typeset cover with title and author
function coverHTML(b) {
  if (b.cover) return `<div class="bk-cover img" style="background-image:url('${String(b.cover).replace(/'/g, '%27')}')" role="img" aria-label="${esc(b.title)} 표지"></div>`;
  const hues = [12, 28, 160, 200, 220, 260, 330, 95];
  const h = hues[Math.abs([...(b.title || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 3)) % hues.length];
  return `<div class="bk-cover gen" style="--h:${h}"><span class="gt">${esc(b.title || '')}</span><span class="ga">${esc(b.author || '')}</span></div>`;
}
async function renderLibrary() {
  const users = await loadUserBooks();
  if (!(location.hash || '').startsWith('#/books')) return;
  const pos = S.prog.books || {};
  const card = (b, extra) => {
    const at = pos[b.id], n = (b.chapters || []).length;
    return `<div class="bk"><a class="bk-main" href="#/book/${esc(b.id)}${at ? `?ch=${at.ch}&p=${at.p}` : ''}">
      ${coverHTML(b)}
      <div><div class="bk-t">${esc(b.title)}</div><div class="small">${esc(b.author || '')}${b.year ? ' · ' + b.year : ''}</div>
      <div class="small" style="margin-top:4px">${at ? `${at.ch}장 읽는 중 · 전체 ${pctTxt((at.pct || 0) * 100)}%` : '아직 안 읽음'} · ${n}장${b.words ? ` · 장별 표현 ${b.words.length}개` : ''}</div>
      ${at ? `<div class="bar" style="max-width:220px"><i style="width:${Math.round((at.pct || 0) * 100)}%"></i></div><div class="small" style="margin-top:3px">${at.at ? '마지막으로 읽은 날 ' + new Date(at.at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' }) : ''}${at.maxCh && (at.maxCh !== at.ch || (at.maxPct || 0) > (at.pct || 0) + 0.01) ? ` · 가장 멀리 읽은 곳 ${at.maxCh}장` : ''}</div>` : ''}
      <div style="margin-top:6px"><span class="btn sm primary">${at ? '이어 읽기' : '읽기 시작'}</span></div></div></a>${extra || ''}</div>`;
  };
  $('#view').innerHTML = `
    <div class="h2" style="margin-top:4px">기본 책</div>
    ${(S.books || []).map((b) => card(b, `<div class="small bk-src">${esc(b.source || '')}${b.coverCredit ? '<br>' + esc(b.coverCredit) : ''}</div>`)).join('') || '<p class="small">없음</p>'}
    <div class="h2">내가 불러온 책 <span class="small">${S.bookStore ? '비밀번호로 잠긴 저장소에 보관돼 모든 기기에서 보여요' : '이 기기에만 저장돼요'}</span></div>
    ${users.map((b) => card(b, `<div class="bk-acts"><span class="small">${b.synced ? (b.local ? '모든 기기 · 이 기기에 받음' : '모든 기기 · 열면 이 기기로 받아요') : '이 기기에만 있음'}</span>
      ${!b.synced && S.bookStore ? `<button class="btn sm" data-act="bk-up" data-id="${esc(b.id)}">모든 기기에 올리기</button>` : ''}
      <button class="btn sm" data-act="bk-del" data-id="${esc(b.id)}" data-step="0">삭제</button></div>`)).join('') || '<p class="small">아직 없어요.</p>'}
    <div class="panel" style="margin-top:12px">
      <label class="btn primary" style="cursor:pointer">EPUB 불러오기<input type="file" id="epubIn" accept=".epub,application/epub+zip" hidden></label>
      <div class="err" id="epubErr"></div>
      <p class="small" style="margin:8px 0 0">DRM이 없는 EPUB만 열 수 있어요 (리디북스·교보·킨들 구매본은 안 돼요). 불러온 책은 공개 사이트가 아니라 사이트 비밀번호로 잠긴 개인 저장소에 올라가서, 다른 기기에서는 처음 열 때 한 번 받아 와요. 비밀번호를 아는 사람만 볼 수 있으니 비밀번호는 공유하지 마세요.</p>
    </div>`;
}

/* reader state */
const RD_PAD = 26, RD_GAP = 2 * RD_PAD;
function splitSentences(text) {
  const out = [];
  const re = /[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/g;
  let m, buf = '';
  while ((m = re.exec(text)) && m[0]) {
    buf += m[0];
    const tail = buf.trim().split(' ').pop() || '';
    if (/^(Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|etc|Mt|No)\.$/i.test(tail) || buf.trim().length < 2) continue;
    out.push(buf.trim()); buf = '';
  }
  if (buf.trim()) out.push(buf.trim());
  return out.length ? out : [text];
}
async function chapterText(book, n) {
  if (book.user) {
    let b = await IDB.get(book.id).catch(() => null);
    if (!b && book.synced) { // first time on this device: fetch the private copy once
      const v = $('#view'); if (v) v.innerHTML = '<p class="empty" id="dlMsg">이 기기로 책을 받는 중…</p>';
      try { await downloadBook(book, (i, n2) => { const m = $('#dlMsg'); if (m) m.textContent = `이 기기로 책을 받는 중… ${i}/${n2}장`; }); b = await IDB.get(book.id); } catch (e) { return null; }
    }
    return b ? b.chapters[n - 1] : null;
  }
  const r = await fetch(`data/books/${book.id}/${n}.json`); return r.ok ? r.json() : null;
}
function leaveReader() { rdStopReading(); rdHideKr(); document.documentElement.classList.remove('reading'); if (S.rd) { window.removeEventListener('resize', rdResize); if (window.visualViewport) visualViewport.removeEventListener('resize', rdResize); S.rd = null; } }
async function openBook(id, ch, p) {
  let book = builtIn(id) || userBookMeta[id];
  if (!book) { await loadUserBooks(); book = userBookMeta[id]; }
  if (!book) { $('#view').innerHTML = '<p class="empty">이 책을 찾을 수 없어요. 삭제됐거나, 불러온 기기에서 아직 "모든 기기에 올리기"를 하지 않은 책일 수 있어요.</p>'; return; }
  const saved = (S.prog.books || {})[id];
  ch = Math.min(Math.max(1, +ch || (saved ? saved.ch : 1)), book.chapters.length);
  p = p != null ? +p : (saved && saved.ch === ch ? saved.p : 0);
  if (S.rd && S.rd.book.id === id && S.rd.ch === ch) { rdGotoPara(p); return; }
  rdStopReading();
  const data = await chapterText(book, ch);
  if (!data) { $('#view').innerHTML = '<p class="empty">본문을 불러오지 못했어요.</p>'; return; }
  const sents = [];
  data.paras.forEach((para, pi) => splitSentences(para).forEach((sx) => sents.push({ p: pi, words: sx.split(/\s+/).filter(Boolean).map((w) => ({ w, n: norm(w), s: stem(w) })) })));
  S.rd = { book, ch, data, sents, page: 0, pages: 1, fs: LS.get('vp-fs', 19), reading: false, readI: -1, rate: LS.get('vp-rate', 1) };
  const chWords = (book.words || []).filter((w) => w.ch === ch);
  $('#view').innerHTML = `<div class="rd">
    <div class="rd-top"><a href="#/books" class="btn sm">← 서재</a>
      <select id="rdCh" aria-label="장 선택">${book.chapters.map((c) => { const far = (S.prog.books || {})[id]; const done = far && (far.maxCh > c.n || (far.maxCh === c.n && far.maxP >= (c.paras || 1) - 1)); return `<option value="${c.n}" ${c.n === ch ? 'selected' : ''}>${done ? '✓ ' : ''}${esc(c.title || c.n + '장')}</option>`; }).join('')}</select>
      ${chWords.length ? `<button class="btn sm" data-act="rd-words">이 장 표현 ${chWords.length}</button>` : ''}
    </div>
    <div class="rd-progress" title="책 전체 진행률 (점: 가장 멀리 읽은 곳)"><i id="rdProg"></i><b id="rdFar"></b></div>
    <div class="rd-view" id="rdView"><div class="rd-flow" id="reader"></div>
      <button class="rd-tap rd-l" data-act="rd-prev" aria-label="이전 쪽"></button><button class="rd-tap rd-r" data-act="rd-next" aria-label="다음 쪽"></button></div>
    <div class="rd-bar">
      <button class="btn sm" data-act="rd-prev" aria-label="이전 쪽">◀</button><span id="rdPage" class="small"></span><button class="btn sm" data-act="rd-next" aria-label="다음 쪽">▶</button>
      <button class="btn sm" data-act="rd-read" id="rdReadBtn">${ICON_SPK} 읽어주기</button>
      <button class="btn sm" data-act="rd-opts" aria-label="글자 크기와 읽기 속도">Aa</button>
      <div class="rd-opts" id="rdOpts" hidden>
        <button class="btn sm" data-act="rd-font" data-d="-1" aria-label="글자 작게">가-</button><button class="btn sm" data-act="rd-font" data-d="1" aria-label="글자 크게">가+</button>
        <select id="rdRate" aria-label="읽기 속도">${[0.8, 1, 1.2].map((r) => `<option value="${r}" ${r === S.rd.rate ? 'selected' : ''}>${r}x</option>`).join('')}</select>
      </div>
    </div>
    ${LS.get('vp-rdhint', 0) ? '' : '<div class="rd-hint small" id="rdHint">문장을 옆으로 밀면 한국어 번역 · 위아래로 밀거나 양옆 끝을 누르면 페이지 넘김 <button class="x" data-act="rd-hint-x" aria-label="닫기">✕</button></div>'}
    </div>`;
  document.documentElement.classList.add('reading');
  window.scrollTo(0, 0);
  S.rd.lastAct = Date.now();
  rdRender();
  window.removeEventListener('resize', rdResize);
  window.addEventListener('resize', rdResize);
  if (window.visualViewport) { visualViewport.removeEventListener('resize', rdResize); visualViewport.addEventListener('resize', rdResize); }
  if (document.fonts && document.fonts.ready) await document.fonts.ready; // page breaks depend on the font
  if (!S.rd || S.rd.ch !== ch) return;
  rdLayout();
  rdGotoPara(p);
}
function rdRender() {
  const R = S.rd, el = $('#reader'); if (!R || !el) return;
  let html = '', cur = -1;
  R.sents.forEach((L, i) => {
    if (L.p !== cur) { if (cur >= 0) html += '</p>'; html += `<p data-p="${L.p}">`; cur = L.p; }
    html += `<span class="s ${i === R.readI ? 'reading' : ''}" data-si="${i}">${lineHTML(L, i)}</span> `;
  });
  if (cur >= 0) html += '</p>';
  html += `<p class="rd-end small">— ${esc(R.book.chapters[R.ch - 1].title || R.ch + '장')} 끝 —</p>`;
  el.innerHTML = html;
  rdLayout();
}
function rdRepaintWords() { if (!S.rd) return; const p = rdCurrentPara(); rdRender(); rdGotoPara(p); }
function rdLayout() {
  const R = S.rd, view = $('#rdView'), flow = $('#reader'); if (!R || !view || !flow) return;
  const top = view.getBoundingClientRect().top, bar = document.querySelector('.rd-bar'), hint = $('#rdHint');
  const vh = window.visualViewport ? visualViewport.height : window.innerHeight;
  const h = Math.max(220, vh - top - (bar ? bar.offsetHeight : 44) - (hint ? hint.offsetHeight + 6 : 0) - 12);
  view.style.height = h + 'px';
  const W = view.clientWidth - 2 * RD_PAD;
  R.W = W;
  flow.style.cssText = `position:absolute;top:0;left:${RD_PAD}px;height:${h}px;width:${W}px;column-width:${W}px;column-gap:${RD_GAP}px;column-fill:auto;font-size:${R.fs}px`;
  R.pages = Math.max(1, Math.round((flow.scrollWidth + RD_GAP) / (W + RD_GAP)));
  rdShow();
}
function rdResize() { if (!S.rd) return; const p = rdCurrentPara(); rdLayout(); rdGotoPara(p); }
function rdShow() {
  const R = S.rd, flow = $('#reader'); if (!R || !flow) return;
  R.page = Math.max(0, Math.min(R.page, R.pages - 1));
  const view = $('#rdView'); if (view) view.scrollLeft = 0;
  flow.style.transform = `translateX(${-R.page * (R.W + RD_GAP)}px)`;
  const pos = (S.prog.books || {})[R.book.id];
  const pctRaw = bookPct(R.book, R.ch, rdCurrentPara()) * 100, pct = pctTxt(pctRaw);
  const pg = $('#rdPage'); if (pg) pg.textContent = `${R.page + 1}/${R.pages}쪽 · ${R.ch}장 · 전체 ${pct}%`;
  const fill = $('#rdProg'); if (fill) { fill.style.width = pctRaw + '%'; const far = pos && pos.maxPct ? pos.maxPct * 100 : pctRaw; const m = $('#rdFar'); if (m) m.style.left = far + '%'; }
}
function rdPageOf(el) {
  const R = S.rd, flow = $('#reader'); if (!el || !flow) return 0;
  const x = el.getBoundingClientRect().left - flow.getBoundingClientRect().left;
  return Math.max(0, Math.floor((x + 2) / (R.W + RD_GAP)));
}
function rdCurrentPara() {
  const R = S.rd; if (!R) return 0;
  const ps = [...document.querySelectorAll('#reader p[data-p]')];
  const hit = ps.find((p) => rdPageOf(p) >= R.page) || ps[ps.length - 1];
  return hit ? +hit.dataset.p : 0;
}
function rdGotoPara(p) {
  const R = S.rd; if (!R) return;
  const el = document.querySelector(`#reader p[data-p="${p}"]`);
  R.page = el ? rdPageOf(el) : (p > 0 ? R.pages - 1 : 0);
  rdShow(); rdSavePos();
}
let rdPosTimer = null;
const pctTxt = (x) => (x > 0 && x < 10 ? x.toFixed(1) : String(Math.round(x)));
function bookPct(book, ch, p) {
  const counts = (book.chapters || []).map((c) => c.paras || 0), total = counts.reduce((a, b) => a + b, 0);
  if (!total) return (ch - 1) / Math.max(1, (book.chapters || []).length);
  const before = counts.slice(0, ch - 1).reduce((a, b) => a + b, 0);
  return Math.min(1, (before + Math.min(p + 1, counts[ch - 1] || 0)) / total);
}
function rdSavePos() {
  clearTimeout(rdPosTimer);
  rdPosTimer = setTimeout(() => {
    const R = S.rd; if (!R) return;
    S.prog.books = S.prog.books || {};
    const old = S.prog.books[R.book.id] || {};
    const atEnd = R.page >= R.pages - 1;
    const p = atEnd ? Math.max(0, (R.data.paras || []).length - 1) : rdCurrentPara();
    const pct = bookPct(R.book, R.ch, p);
    const far = (old.maxPct || 0) >= pct ? { maxCh: old.maxCh, maxP: old.maxP, maxPct: old.maxPct } : { maxCh: R.ch, maxP: p, maxPct: pct };
    S.prog.books[R.book.id] = { ch: R.ch, p, pct, at: Date.now(), ...far };
    rdShow(true);
    saveProg();
  }, 600);
}
function rdTurn(d) {
  const R = S.rd; if (!R) return;
  closeSheet(); rdHideKr(); rdTouch();
  if (R.page + d >= R.pages) { if (R.ch < R.book.chapters.length) location.hash = `#/book/${R.book.id}?ch=${R.ch + 1}&p=0`; return; }
  if (R.page + d < 0) { if (R.ch > 1) location.hash = `#/book/${R.book.id}?ch=${R.ch - 1}&p=99999`; return; }
  R.page += d; rdShow(); rdSavePos();
}

/* read aloud: one sentence at a time, the current sentence highlighted, pages follow along */
function rdStopReading() {
  const R = S.rd; if (R) { R.reading = false; R.readI = -1; }
  try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (e) {}
  document.querySelectorAll('#reader .s.reading').forEach((x) => x.classList.remove('reading'));
  const b = $('#rdReadBtn'); if (b) { b.innerHTML = `${ICON_SPK} 읽어주기`; b.classList.remove('on'); }
}
function rdFirstSentOnPage() {
  const ss = [...document.querySelectorAll('#reader .s')];
  const hit = ss.find((x) => rdPageOf(x) >= S.rd.page);
  return hit ? +hit.dataset.si : 0;
}
function rdSpeakFrom(i) {
  const R = S.rd; if (!R || !R.reading) return;
  if (i >= R.sents.length) { rdStopReading(); if (R.ch < R.book.chapters.length) note('이 장을 다 읽었어요. ▶ 버튼으로 다음 장으로 넘어가세요.'); return; }
  document.querySelectorAll('#reader .s.reading').forEach((x) => x.classList.remove('reading'));
  const el = document.querySelector(`#reader .s[data-si="${i}"]`);
  if (el) { el.classList.add('reading'); const pg = rdPageOf(el); if (pg !== R.page) { R.page = pg; rdShow(); rdSavePos(); } }
  R.readI = i;
  const u = new SpeechSynthesisUtterance(lineText(R.sents[i]).replace(/[“”]/g, '"'));
  u.lang = 'en-US'; u.rate = R.rate;
  const vs = speechSynthesis.getVoices();
  const pick = vs.find((v) => /en[-_]US/i.test(v.lang) && /Samantha|Google US|Aria|Jenny|Natural|Ava/i.test(v.name)) || vs.find((v) => /en[-_]US/i.test(v.lang));
  if (pick) u.voice = pick;
  u.onend = () => { if (S.rd === R && R.reading && R.readI === i) rdSpeakFrom(i + 1); };
  u.onerror = () => { if (S.rd === R && R.reading && R.readI === i) rdSpeakFrom(i + 1); };
  speechSynthesis.speak(u);
}
function rdToggleRead() {
  const R = S.rd; if (!R) return;
  if (!('speechSynthesis' in window)) { note('이 브라우저는 소리 내어 읽기를 지원하지 않아요.'); return; }
  if (R.reading) { rdStopReading(); return; }
  speechSynthesis.cancel();
  R.reading = true;
  const b = $('#rdReadBtn'); if (b) { b.textContent = '■ 멈춤'; b.classList.add('on'); }
  rdSpeakFrom(rdFirstSentOnPage());
}

/* EPUB import (DRM-free only) */
let jszipP = null;
function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!jszipP) jszipP = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/jszip.min.js'; s.onload = () => res(window.JSZip); s.onerror = rej; document.head.appendChild(s); });
  return jszipP;
}
function shrinkImage(blob) {
  return new Promise((res) => {
    const url = URL.createObjectURL(blob), img = new Image();
    img.onload = () => { const sc = Math.min(1, 360 / img.width); const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.8)); };
    img.onerror = () => { URL.revokeObjectURL(url); res(null); };
    img.src = url;
  });
}
async function importEpub(file) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(file);
  const enc = zip.file('META-INF/encryption.xml');
  if (enc) {
    const x = await enc.async('string');
    const algos = [...x.matchAll(/Algorithm="([^"]+)"/g)].map((m) => m[1]);
    if (algos.some((a) => !/embedding|font|obfuscat/i.test(a))) throw new Error('drm');
  }
  const container = await zip.file('META-INF/container.xml').async('string');
  const opfPath = (container.match(/full-path="([^"]+)"/) || [])[1];
  if (!opfPath) throw new Error('bad');
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const opf = new DOMParser().parseFromString(await zip.file(opfPath).async('string'), 'application/xml');
  const title = (opf.getElementsByTagName('dc:title')[0] || {}).textContent || file.name.replace(/\.epub$/i, '');
  const author = (opf.getElementsByTagName('dc:creator')[0] || {}).textContent || '';
  const manifest = {};
  let coverHref = null;
  const coverMeta = [...opf.getElementsByTagName('meta')].find((m) => m.getAttribute('name') === 'cover');
  const coverId = coverMeta ? coverMeta.getAttribute('content') : null;
  [...opf.getElementsByTagName('item')].forEach((it) => {
    manifest[it.getAttribute('id')] = it.getAttribute('href');
    const props = it.getAttribute('properties') || '', type = it.getAttribute('media-type') || '';
    if (/image\/(jpe?g|png|gif|webp)/.test(type) && (props.includes('cover-image') || it.getAttribute('id') === coverId || /cover/i.test(it.getAttribute('href') || ''))) coverHref = coverHref || it.getAttribute('href');
  });
  let cover = null;
  if (coverHref) { try { cover = await shrinkImage(await zip.file(decodeURIComponent(base + coverHref)).async('blob')); } catch (e) { cover = null; } }
  const spine = [...opf.getElementsByTagName('itemref')].map((r) => manifest[r.getAttribute('idref')]).filter(Boolean);
  const chapters = [];
  for (const href of spine) {
    const path = decodeURIComponent(base + href.split('#')[0]);
    const f = zip.file(path); if (!f) continue;
    const doc = new DOMParser().parseFromString(await f.async('string'), 'text/html');
    const heads = doc.querySelector('h1,h2,h3');
    const paras = [...doc.querySelectorAll('p,li,blockquote')].map((el) => el.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t.length > 1);
    const words = paras.join(' ').split(' ').length;
    if (words < 60) continue; // cover, title page, table of contents
    chapters.push({ title: (heads && heads.textContent.trim().slice(0, 60)) || `Part ${chapters.length + 1}`, paras });
  }
  if (!chapters.length) throw new Error('empty');
  const id = 'u-' + Math.abs([...(title + author + file.size)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36);
  await IDB.put({ id, title: title.trim(), author: author.trim(), chapters, cover, added: Date.now() });
  return id;
}
document.addEventListener('change', async (e) => {
  if (e.target.id === 'rdCh' && S.rd) { location.hash = `#/book/${S.rd.book.id}?ch=${e.target.value}&p=0`; return; }
  if (e.target.id === 'rdRate' && S.rd) { S.rd.rate = +e.target.value; LS.set('vp-rate', S.rd.rate); return; }
  if (e.target.id !== 'epubIn' || !e.target.files[0]) return;
  const err = $('#epubErr'); err.textContent = '불러오는 중…';
  try {
    const id = await importEpub(e.target.files[0]);
    if (S.server === 'ok') {
      try { await uploadBook(id, (i, n) => { err.textContent = `모든 기기에서 보이게 올리는 중… ${i}/${n}장`; }); }
      catch (x) { note(x.message === 'too_large' ? '책의 한 장이 너무 커서 다른 기기용으로 올리지 못했어요. 이 기기에서는 읽을 수 있어요.' : '다른 기기용으로 올리지 못했어요. 서재에서 "모든 기기에 올리기"로 다시 시도해 주세요.'); }
    }
    err.textContent = ''; location.hash = `#/book/${id}`;
  }
  catch (x) { err.textContent = x.message === 'drm' ? 'DRM(복제 방지)이 걸린 책이라 열 수 없어요.' : x.message === 'empty' ? '본문을 찾지 못했어요. 다른 EPUB 파일로 시도해 주세요.' : 'EPUB 파일을 읽지 못했어요.'; }
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act^="rd-"],[data-act^="bk-"]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'rd-next') rdTurn(1);
  if (a === 'rd-prev') rdTurn(-1);
  if (a === 'rd-read') rdToggleRead();
  if (a === 'rd-opts') { const o = $('#rdOpts'); if (o) o.hidden = !o.hidden; }
  if (a === 'rd-hint-x') { LS.set('vp-rdhint', 1); const h = $('#rdHint'); if (h) h.remove(); rdResize(); }
  if (a === 'rd-font' && S.rd) { rdHideKr(); const p = rdCurrentPara(); S.rd.fs = Math.max(14, Math.min(28, S.rd.fs + 2 * +b.dataset.d)); LS.set('vp-fs', S.rd.fs); rdLayout(); rdGotoPara(p); }
  if (a === 'rd-words' && S.rd) {
    const ws = (S.rd.book.words || []).filter((w) => w.ch === S.rd.ch).map((w) => ({ ...w, t: w.p, v: { vid: `book:${S.rd.book.id}:${S.rd.ch}` } }));
    const sh = $('#sheet');
    sh.innerHTML = `<button class="x close" data-act="sheet-close" aria-label="닫기">✕</button><div class="sw" style="font-size:20px">${S.rd.ch}장 핵심 표현</div><div class="vsec" style="border:none;padding:0">${ws.map((w) => wordRow(w, {}, false)).join('')}</div>`;
    sh.hidden = false;
  }
  if (a === 'bk-del') {
    if (b.dataset.step === '0') { b.dataset.step = '1'; b.textContent = '한 번 더 누르면 모든 기기에서 삭제'; b.classList.add('on'); return; }
    const id = b.dataset.id;
    try { await IDB.del(id); } catch (x) {}
    if (S.bookStore) await api('/api/books?id=' + encodeURIComponent(id), { method: 'DELETE' });
    delete userBookMeta[id]; renderLibrary();
  }
  if (a === 'bk-up') {
    b.disabled = true; b.textContent = '올리는 중…';
    try { await uploadBook(b.dataset.id, (i, n) => { b.textContent = `올리는 중… ${i}/${n}`; }); renderLibrary(); }
    catch (x) { b.disabled = false; b.textContent = '다시 시도'; note('올리지 못했어요. 잠시 후 다시 시도해 주세요.'); }
  }
});
// swipe a sentence sideways for its Korean; swipe up/down (or tap the edges) to turn pages
let rdSw = null;
document.addEventListener('touchstart', (e) => {
  const v = e.target.closest('#rdView');
  rdSw = v && e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, s: e.target.closest('.s') } : null;
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (!rdSw || !rdSw.s) return;
  const dx = e.touches[0].clientX - rdSw.x, dy = e.touches[0].clientY - rdSw.y;
  if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) rdSw.s.style.transform = `translateX(${Math.max(-14, Math.min(14, dx * 0.15))}px)`;
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!rdSw || !S.rd) return;
  const t = e.changedTouches[0], dx = t.clientX - rdSw.x, dy = t.clientY - rdSw.y, sEl = rdSw.s; rdSw = null;
  if (sEl) sEl.style.transform = '';
  if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3 && sEl) { rdToggleKr(+sEl.dataset.si); return; }
  if (Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx) * 1.3) rdTurn(dy < 0 ? 1 : -1);
}, { passive: true });
function rdHideKr() { const b = $('#rdKr'); if (b) b.remove(); document.querySelectorAll('#reader .s.kr-on').forEach((x) => x.classList.remove('kr-on')); if (S.rd) S.rd.krI = -1; }
async function rdToggleKr(i) {
  const R = S.rd; if (!R || !R.sents[i]) return;
  if (R.krI === i) { rdHideKr(); return; }
  rdHideKr(); R.krI = i; rdTouch();
  const sEl = document.querySelector(`#reader .s[data-si="${i}"]`), view = $('#rdView'); if (!sEl || !view) return;
  sEl.classList.add('kr-on');
  const vr = view.getBoundingClientRect(), rects = [...sEl.getClientRects()].filter((r) => r.right > vr.left && r.left < vr.right);
  const last = rects.length ? rects[rects.length - 1] : sEl.getBoundingClientRect(), first = rects.length ? rects[0] : last;
  const box = document.createElement('div'); box.id = 'rdKr'; box.className = 'rd-kr'; box.innerHTML = '번역 중…';
  view.appendChild(box);
  const place = () => {
    const below = last.bottom - vr.top + 6, h = box.offsetHeight;
    box.style.top = (below + h < vr.height - 8 ? below : Math.max(6, first.top - vr.top - h - 6)) + 'px';
  };
  place();
  const text = lineText(R.sents[i]);
  const res = await translateKo(text);
  if (!S.rd || S.rd.krI !== i || !document.getElementById('rdKr')) return;
  box.innerHTML = res && res.ko ? esc(res.ko) : `${res && res.none ? '문장 번역 키가 설정되지 않았어요.' : '번역을 가져오지 못했어요.'} <a href="${papagoURL(text)}" target="_blank" rel="noopener">파파고에서 보기</a>`;
  place();
}
document.addEventListener('keydown', (e) => {
  if (!S.rd || /input|textarea|select/i.test(e.target.tagName)) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') { rdTurn(1); e.preventDefault(); }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') { rdTurn(-1); e.preventDefault(); }
});

document.addEventListener('click', (e) => { if ($('#rdKr') && !e.target.closest('#rdKr') && !e.target.closest('.s.kr-on')) rdHideKr(); }, true);
function rdTouch() { if (S.rd) S.rd.lastAct = Date.now(); }


/* ================= learning calendar ================= */
S.cal = { y: null, m: null, sel: null };
const mins = (sec) => Math.round(sec / 60);
function renderLog() {
  const now = new Date(Date.now() - 4 * 3600e3);
  if (S.cal.y === null) { S.cal.y = now.getFullYear(); S.cal.m = now.getMonth(); }
  const y = S.cal.y, m = S.cal.m, today = dayKeyLocal();
  const first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate();
  const key = (d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  let cells = '', tot = { read: 0, watch: 0, rv: 0, readDays: 0, watchDays: 0, active: 0 };
  for (let i = 0; i < first.getDay(); i++) cells += '<div class="cd empty"></div>';
  for (let d = 1; d <= days; d++) {
    const k = key(d), t = dayTotals(k);
    const any = t.read >= 60 || t.watch >= 60 || t.rv > 0 || t.sh > 0 || t.wr > 0;
    tot.read += t.read; tot.watch += t.watch; tot.rv += t.rv; if (t.read >= 60) tot.readDays++; if (t.watch >= 60) tot.watchDays++; if (any) tot.active++;
    const lvl = (sec) => (sec >= 1800 ? 3 : sec >= 600 ? 2 : sec >= 60 ? 1 : 0), rl = t.rv >= 15 ? 3 : t.rv >= 5 ? 2 : t.rv > 0 ? 1 : 0;
    cells += `<button class="cd ${k === today ? 'today' : ''} ${S.cal.sel === k ? 'sel' : ''} ${any ? 'on' : ''}" data-act="cal-day" data-k="${k}">
      <span class="dn">${d}</span>
      <span class="marks">${lvl(t.read) ? `<i class="mk mk-book l${lvl(t.read)}"></i>` : ''}${lvl(t.watch) ? `<i class="mk mk-vid l${lvl(t.watch)}"></i>` : ''}${rl ? `<i class="mk mk-rv l${rl}"></i>` : ''}${t.sh + t.wr ? `<i class="mk mk-sh l${t.sh + t.wr >= 10 ? 3 : t.sh + t.wr >= 4 ? 2 : 1}"></i>` : ''}</span></button>`;
  }
  // streak: consecutive active days ending today (or yesterday)
  let streak = 0; for (let i = 0; i < 400; i++) { const k = dayKeyLocal(Date.now() - i * 864e5), t = dayTotals(k); if (t.read >= 60 || t.watch >= 60 || t.rv > 0 || t.sh > 0 || t.wr > 0) streak++; else if (i > 0) break; }
  let detail = '';
  if (S.cal.sel) {
    const t = dayTotals(S.cal.sel);
    const bk = [...t.books].map((id) => (builtIn(id) || userBookMeta[id] || { title: id }).title);
    const vd = [...t.vids].map((id) => (S.videos.find((v) => v.vid === id) || { title: id }).title);
    const dt = new Date(S.cal.sel + 'T12:00:00');
    detail = `<div class="panel cal-detail"><b>${dt.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}</b>
      ${t.read >= 60 ? `<div><i class="mk mk-book l2"></i> 독서 ${mins(t.read)}분 · ${bk.map(esc).join(', ')}</div>` : ''}
      ${t.watch >= 60 ? `<div><i class="mk mk-vid l2"></i> 영상 ${mins(t.watch)}분 · ${vd.length}편<div class="small">${vd.map(esc).join('<br>')}</div></div>` : ''}
      ${t.rv ? `<div><i class="mk mk-rv l2"></i> 복습 ${t.rv}문제</div>` : ''}
      ${t.sh ? `<div><i class="mk mk-sh l2"></i> 쉐도잉 ${t.sh}문장</div>` : ''}
      ${t.wr ? `<div><i class="mk mk-sh l2"></i> 영작 ${t.wr}문장</div>` : ''}
      ${t.read < 60 && t.watch < 60 && !t.rv && !t.sh && !t.wr ? '<div class="small">이날은 기록이 없어요.</div>' : ''}</div>`;
  }
  $('#view').innerHTML = `<div class="center">${reviewTabs('log')}
    <div class="cal-head"><button class="btn sm" data-act="cal-mv" data-d="-1" aria-label="이전 달">◀</button><b>${y}년 ${m + 1}월</b><button class="btn sm" data-act="cal-mv" data-d="1" aria-label="다음 달">▶</button></div>
    <div class="cal-sum"><div><b>${streak}</b><span>연속 학습일</span></div><div><b>${mins(tot.read)}</b><span>독서 분 (${tot.readDays}일)</span></div><div><b>${mins(tot.watch)}</b><span>영상 분 (${tot.watchDays}일)</span></div><div><b>${tot.rv}</b><span>복습 문제</span></div></div>
    <div class="cal">${['일', '월', '화', '수', '목', '금', '토'].map((w) => `<div class="cw">${w}</div>`).join('')}${cells}</div>
    <div class="legend" style="justify-content:center"><span><i class="mk mk-book l2"></i>독서</span><span><i class="mk mk-vid l2"></i>영상</span><span><i class="mk mk-rv l2"></i>복습</span><span><i class="mk mk-sh l2"></i>쉐도잉·영작</span><span class="small">진할수록 오래</span></div>
    ${detail}
    <p class="small" style="text-align:center">독서는 책 화면에서 2분 안에 넘기거나 누른 시간, 영상은 실제로 재생된 시간만 셉니다. 1분 이상인 날만 표시돼요.</p></div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act="cal-day"],[data-act="cal-mv"]'); if (!b) return;
  if (b.dataset.act === 'cal-day') { S.cal.sel = S.cal.sel === b.dataset.k ? null : b.dataset.k; renderLog(); }
  else { let m = S.cal.m + +b.dataset.d, y = S.cal.y; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } S.cal.m = m; S.cal.y = y; S.cal.sel = null; renderLog(); }
});


/* ================= shadowing: listen → say it (recorded) → compare (no scoring) ================= */
const SH = { rec: null, chunks: [], url: null, stream: null, timer: null, ctx: null };
function shadowOpen(ctx) {
  // ctx: { text, kind: 'video' | 'book', line }
  SH.ctx = ctx; shadowClearRec();
  const sh = $('#sheet');
  sh.innerHTML = `<button class="x close" data-act="sh-close" aria-label="닫기">✕</button>
    <div class="small">따라 말하기 · 채점 없이 듣고 비교해요</div>
    <div class="sh-text">${esc(ctx.text)}</div>
    <div class="sh-steps">
      <button class="btn" data-act="sh-model">① 원문 듣기</button>
      <button class="btn primary" data-act="sh-rec" id="shRec">② 따라 말하기 (녹음)</button>
      <button class="btn" data-act="sh-mine" id="shMine" disabled>③ 내 목소리 듣기</button>
      <button class="btn" data-act="sh-both" id="shBoth" disabled>원문 → 내 목소리 이어 듣기</button>
    </div>
    <div class="small" id="shMsg">원문을 듣고, ②를 눌러 따라 말한 뒤 다시 누르면 녹음이 끝나요.</div>
    ${ctx.kind === 'video' ? '<div class="row"><button class="btn sm" data-act="sh-next">다음 문장으로 ▶</button></div>' : ''}`;
  sh.hidden = false;
}
function shadowClearRec() { if (SH.url) URL.revokeObjectURL(SH.url); SH.url = null; SH.chunks = []; }
function shadowModel() {
  return new Promise((resolve) => {
    const c = SH.ctx; if (!c) return resolve();
    if (c.kind === 'video' && S.w && S.w.player && S.w.player.seekTo) {
      const L = c.line, p = S.w.player;
      p.seekTo(L.t / 1000, true); p.playVideo();
      clearInterval(SH.timer);
      SH.timer = setInterval(() => { const t = curTime(); if (t == null || t >= L.end - 60) { clearInterval(SH.timer); try { p.pauseVideo(); } catch (e) {} resolve(); } }, 100);
      setTimeout(() => { clearInterval(SH.timer); resolve(); }, Math.max(2000, L.end - L.t + 2500));
    } else {
      if (!('speechSynthesis' in window)) return resolve();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(c.text.replace(/[“”]/g, '"')); u.lang = 'en-US'; u.rate = S.rd ? S.rd.rate : 0.95;
      const vs = speechSynthesis.getVoices(); const pick = vs.find((v) => /en[-_]US/i.test(v.lang)); if (pick) u.voice = pick;
      u.onend = resolve; u.onerror = resolve; speechSynthesis.speak(u);
    }
  });
}
async function shadowRecToggle() {
  const btn = $('#shRec'), msg = $('#shMsg');
  if (SH.rec && SH.rec.state === 'recording') { SH.rec.stop(); return; }
  if (!navigator.mediaDevices || !window.MediaRecorder) { msg.textContent = '이 브라우저는 녹음을 지원하지 않아요.'; return; }
  try {
    SH.stream = SH.stream || await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) { msg.textContent = '마이크 권한이 필요해요. 브라우저 설정에서 이 사이트의 마이크를 허용해 주세요.'; return; }
  shadowClearRec();
  try { if (S.w && S.w.player && S.w.player.pauseVideo) S.w.player.pauseVideo(); } catch (e) {}
  SH.rec = new MediaRecorder(SH.stream);
  SH.rec.ondataavailable = (e) => { if (e.data && e.data.size) SH.chunks.push(e.data); };
  SH.rec.onstop = () => {
    SH.url = URL.createObjectURL(new Blob(SH.chunks, { type: SH.rec.mimeType || 'audio/webm' }));
    if (btn) { btn.textContent = '② 다시 녹음'; btn.classList.remove('rec'); }
    const m = $('#shMine'), b2 = $('#shBoth'); if (m) m.disabled = false; if (b2) b2.disabled = false;
    if (msg) msg.textContent = '③으로 내 목소리를 들어 보거나, 이어 듣기로 원문과 바로 비교해 보세요.';
    logAdd('sh', 1);
  };
  SH.rec.start();
  btn.textContent = '■ 녹음 끝내기'; btn.classList.add('rec');
  msg.textContent = '녹음 중… 말한 뒤 다시 누르세요.';
  clearTimeout(SH.stopT); SH.stopT = setTimeout(() => { if (SH.rec && SH.rec.state === 'recording') SH.rec.stop(); }, 20000);
}
function shadowPlayMine() { return new Promise((res) => { if (!SH.url) return res(); const a = new Audio(SH.url); a.onended = res; a.onerror = res; a.play().catch(res); }); }
function shadowStopAll() {
  clearInterval(SH.timer); clearTimeout(SH.stopT);
  if (SH.rec && SH.rec.state === 'recording') SH.rec.stop();
  if (SH.stream) { SH.stream.getTracks().forEach((t) => t.stop()); SH.stream = null; }
  SH.ctx = null;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act^="sh-"],[data-act="shadow-line"],[data-act="shadow-sheet"]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'shadow-line') {
    if (!S.w || !S.w.lines.length) { note('자막이 있어야 따라 말하기를 할 수 있어요.'); return; }
    const i = Math.max(0, S.w.active), L = S.w.lines[i];
    shadowOpen({ kind: 'video', line: L, i, text: lineText(L) }); return;
  }
  if (a === 'shadow-sheet') {
    const C = S.sheetCtx; if (!C) return;
    if (C.book) shadowOpen({ kind: 'book', line: C.L, text: lineText(C.L) });
    else { const i = S.w ? S.w.lines.indexOf(C.L) : -1; shadowOpen({ kind: 'video', line: C.L, i, text: lineText(C.L) }); }
    return;
  }
  if (a === 'sh-close') { shadowStopAll(); closeSheet(); return; }
  if (a === 'sh-model') { await shadowModel(); return; }
  if (a === 'sh-rec') { shadowRecToggle(); return; }
  if (a === 'sh-mine') { shadowPlayMine(); return; }
  if (a === 'sh-both') { await shadowModel(); await new Promise((r) => setTimeout(r, 400)); await shadowPlayMine(); return; }
  if (a === 'sh-next' && S.w && SH.ctx) {
    const i = (SH.ctx.i >= 0 ? SH.ctx.i : S.w.active) + 1, L = S.w.lines[i];
    if (!L) { note('마지막 문장이에요.'); return; }
    shadowOpen({ kind: 'video', line: L, i, text: lineText(L) }); setActive(i); shadowModel();
  }
});

/* ================= writing with corrections delivered into the app ================= */
// Entries live in the synced (passcode-protected) progress store, never in public files.
// Claude fills `fb` on request through the app itself; the app then shows it here.
function writingList() { return (S.prog.writing || []).filter((x) => !x.del); }
const newFeedback = () => writingList().filter((x) => x.fb && !x.seen).length;
function todaysExprs() {
  const d = S.prog.daily || {};
  const all = vocab().filter((w) => st(w.id) !== 'known');
  const byId = Object.fromEntries(all.map((w) => [w.id, w]));
  let pick = (d.ids || []).map((id) => byId[id]).filter(Boolean);
  if (pick.length < 3) pick = pick.concat(all.filter((w) => (S.prog.fsrs || {})[w.id] && !pick.includes(w)));
  if (pick.length < 3) pick = pick.concat(all.filter((w) => !pick.includes(w)));
  const seed = dayKeyLocal().split('-').join('') | 0;
  return pick.slice(0, 12).sort((a, b) => ((a.id.length * seed) % 97) - ((b.id.length * seed) % 97)).slice(0, 3);
}
function wordDiff(a, b) {
  const A = a.split(/\s+/).filter(Boolean), B = b.split(/\s+/).filter(Boolean);
  const n = A.length, m = B.length, dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  const eq = (x, y) => x.replace(/[^\w']/g, '').toLowerCase() === y.replace(/[^\w']/g, '').toLowerCase() && x.slice(-1) === y.slice(-1);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = eq(A[i], B[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0, j = 0, out = [];
  while (i < n && j < m) {
    if (eq(A[i], B[j])) { out.push(esc(B[j])); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(`<del>${esc(A[i])}</del>`); i++; }
    else { out.push(`<ins>${esc(B[j])}</ins>`); j++; }
  }
  while (i < n) out.push(`<del>${esc(A[i++])}</del>`);
  while (j < m) out.push(`<ins>${esc(B[j++])}</ins>`);
  return out.join(' ');
}
async function applyFeedbackToReview() {
  // expressions used wrongly come back in review sooner (once per feedback)
  let changed = false;
  for (const x of writingList()) {
    if (!x.fb || x.fb.applied) continue;
    for (const [id, ok] of Object.entries(x.fb.used || {})) if (ok === false && vocab().some((w) => w.id === id)) await scheduleAs(id, 1);
    x.fb.applied = true; x.at = Date.now(); changed = true;
  }
  if (changed) saveProg();
}
function renderWrite() {
  let seenChanged = false;
  writingList().forEach((x) => { if (x.fb && !x.seen) { x.seen = true; x.justIn = true; x.at = Date.now(); seenChanged = true; } });
  if (seenChanged) saveProg();
  const ex = todaysExprs(), list = writingList().slice().reverse();
  const pending = list.filter((x) => !x.fb);
  const sel = new Set(S.wsel || []);
  $('#view').innerHTML = `<div class="center">${practiceTabs('write')}
    <div class="qcard">
      <div class="small">오늘의 표현으로 문장을 써 보세요 · 쓰고 싶은 표현을 눌러 고르세요</div>
      <div class="chips" style="margin:10px 0">${ex.map((w) => `<button class="btn sm ${sel.has(w.id) ? 'on' : ''}" data-act="w-pick" data-id="${esc(w.id)}" title="${esc(w.ko)}">${esc(w.expr)}</button>`).join('')}</div>
      <div class="small" style="margin:-4px 0 8px">${ex.map((w) => `<b>${esc(w.expr)}</b> ${esc(w.ko)}`).join(' · ')}</div>
      <textarea id="wText" class="rvin" rows="3" placeholder="예: I'm inclined to reserve judgment until I hear his side." maxlength="600"></textarea>
      <div class="err" id="wErr"></div>
      <div class="btns" style="justify-content:flex-start"><button class="btn primary" data-act="w-save">저장 (첨삭 대기)</button></div>
    </div>
    <div class="rvhead" style="margin-top:18px"><b>내 문장</b><span class="small">첨삭 대기 ${pending.length}개</span></div>
    <p class="small" style="margin:2px 0 10px">채팅에서 Claude에게 <b>"첨삭해줘"</b>라고 하면 대기 중인 문장이 첨삭돼서 여기에 들어와요 (PC의 Claude 앱이 켜져 있어야 해요). PC가 꺼져 있으면 <button class="kolink" data-act="w-copy" style="text-decoration:underline">대기 문장 복사</button>해서 채팅에 붙여 주세요.</p>
    ${list.map((x) => {
      const ws = (x.exprs || []).map((id) => vocab().find((w) => w.id === id)).filter(Boolean);
      const fb = x.fb;
      return `<div class="vsec wr">
        <div class="small">${new Date(x.created).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} · ${ws.map((w) => esc(w.expr)).join(', ') || '자유 영작'} · ${fb ? `<b style="color:var(--green)">첨삭 완료${x.justIn ? ' · 새로 도착' : ''}</b>` : '첨삭 대기'}</div>
        ${fb ? `<div class="wr-diff">${wordDiff(x.text, fb.corrected || x.text)}</div>
          ${(fb.notes || []).length ? `<ul class="wr-notes">${fb.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
          ${fb.better ? `<div class="wnote">더 자연스럽게: ${esc(fb.better)} ${spk(fb.better)}</div>` : ''}
          ${Object.keys(fb.used || {}).length ? `<div class="small" style="margin-top:6px">${Object.entries(fb.used).map(([id, ok]) => { const w = vocab().find((v) => v.id === id); return w ? `${ok ? '✓' : '✗'} ${esc(w.expr)}${ok ? '' : ' (복습에 다시 나와요)'}` : ''; }).join(' · ')}</div>` : ''}`
        : `<div class="wr-text">${esc(x.text)}</div>`}
        <div class="row" style="margin-top:6px"><button class="btn sm" data-act="w-del" data-id="${esc(x.id)}">삭제</button></div>
      </div>`;
    }).join('') || '<p class="small">아직 쓴 문장이 없어요.</p>'}
  </div>`;
  applyFeedbackToReview();
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act^="w-"]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'w-pick') { const s2 = new Set(S.wsel || []); s2.has(b.dataset.id) ? s2.delete(b.dataset.id) : s2.add(b.dataset.id); S.wsel = [...s2]; b.classList.toggle('on'); }
  if (a === 'w-save') {
    const t = ($('#wText').value || '').trim();
    if (!t) { $('#wErr').textContent = '문장을 먼저 써 주세요.'; return; }
    const now = Date.now();
    S.prog.writing = [...(S.prog.writing || []), { id: 'w' + now.toString(36), text: t, exprs: S.wsel || [], created: now, at: now }];
    S.wsel = []; logAdd('wr', 1); saveProg(); renderWrite();
  }
  if (a === 'w-del') { S.prog.writing = (S.prog.writing || []).map((x) => (x.id === b.dataset.id ? { ...x, del: true, at: Date.now() } : x)); saveProg(); renderWrite(); }
  if (a === 'w-copy') {
    const items = writingList().filter((x) => !x.fb);
    const txt = items.length ? '첨삭해줘\n' + items.map((x, i) => `${i + 1}. ${x.text}${(x.exprs || []).length ? `  [표현: ${x.exprs.map((id) => (vocab().find((w) => w.id === id) || {}).expr).filter(Boolean).join(', ')}]` : ''}`).join('\n') : '';
    if (!txt) { note('첨삭 대기 중인 문장이 없어요.'); return; }
    try { await navigator.clipboard.writeText(txt); note('복사했어요. Claude 채팅에 붙여 넣으세요.'); } catch (x) { note('복사하지 못했어요. 문장을 길게 눌러 직접 복사해 주세요.'); }
  }
});
document.addEventListener('input', (e) => { if (e.target.id === 'wText') { const er = $('#wErr'); if (er) er.textContent = ''; } });
// lets Claude deliver corrections through the app (used from the chat on request)
window.vpPendingWriting = () => writingList().filter((x) => !x.fb).map((x) => ({ id: x.id, text: x.text, exprs: (x.exprs || []).map((id) => { const w = vocab().find((v) => v.id === id); return w ? { id, expr: w.expr, ko: w.ko } : { id }; }) }));
window.vpDeliverFeedback = async (items) => {
  await pull();
  let n = 0;
  for (const it of items || []) {
    const x = (S.prog.writing || []).find((w) => w.id === it.id); if (!x || x.fb) continue;
    x.fb = { corrected: String(it.corrected || x.text), notes: (it.notes || []).map(String).slice(0, 8), better: it.better ? String(it.better) : '', used: it.used || {}, by: 'claude', at: Date.now() };
    x.at = Date.now(); n++;
  }
  S.prog.writing = [...S.prog.writing];
  await new Promise((r) => { saveProg(); setTimeout(r, 1500); });
  return n;
};

// Installable app: register the service worker (skipped on the local mock server's file previews).
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
