'use strict';
/* Vocab Player — YouTube + synced English subtitles + personal vocabulary. */

const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

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
    const n = norm(tok);
    if (!n) return;
    if (POSS.has(n)) out.push('POSS');
    else out.push(stem(n));
  });
  while (out.length && (out[0] === '*' || ARTICLES.has(out[0]))) out.shift();
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

/* ---------------- progress & sync ---------------- */
const st = (id) => (S.prog.status[id] && S.prog.status[id].s) || null;
function mergeState(a, b) {
  const out = { status: { ...(a.status || {}) }, saved: { ...(a.saved || {}) }, topics: [] };
  for (const [k, v] of Object.entries(b.status || {})) if (!out.status[k] || (v.at || 0) > (out.status[k].at || 0)) out.status[k] = v;
  for (const [k, v] of Object.entries(b.saved || {})) if (!out.saved[k] || (v.at || 0) > (out.saved[k].at || 0)) out.saved[k] = v;
  const tm = {};
  for (const t of [...(a.topics || []), ...(b.topics || [])]) if (t && t.id && (!tm[t.id] || (t.at || 0) > (tm[t.id].at || 0))) tm[t.id] = t;
  out.topics = Object.values(tm).sort((x, y) => (x.created || 0) - (y.created || 0));
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
}
function note(t) { const n = $('#note'); if (!t) { n.hidden = true; return; } n.textContent = t; n.hidden = false; }

/* ---------------- data ---------------- */
const vocab = () => S.videos.flatMap((v) => (v.words || []).map((w) => ({ ...w, v })));
const savedList = () => Object.entries(S.prog.saved).filter(([, x]) => x && !x.del).map(([k, x]) => ({ key: k, ...x }));
function reviewSet() {
  const seen = {}, rev = {};
  [...S.videos].sort((a, b) => (a.batchOrder || 0) - (b.batchOrder || 0) || (a.order || 0) - (b.order || 0))
    .forEach((v) => (v.words || []).forEach((w) => { const k = pattern(w.expr).join(' '); if (seen[k]) rev[w.id] = true; else seen[k] = 1; }));
  return rev;
}
const homeOrder = (a, b) => (b.batchOrder || 0) - (a.batchOrder || 0) || (a.order || 0) - (b.order || 0);
function ytAt(vid, t) { return '#/v/' + encodeURIComponent(vid) + (t ? '?t=' + Math.floor(t) : ''); }

/* ---------------- routing ---------------- */
function route() {
  const h = location.hash || '#/';
  const navKey = h.startsWith('#/words') ? 'words' : h.startsWith('#/cards') ? 'cards' : h.startsWith('#/quiz') ? 'quiz' : 'home';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === navKey && !h.startsWith('#/v/')));
  closeSheet();
  const m = h.match(/^#\/v\/([\w-]{11})(?:\?t=(\d+))?/);
  if (m) return openWatch(m[1], m[2] ? +m[2] : 0);
  leaveWatch();
  if (navKey === 'words') return renderWords();
  if (navKey === 'cards') { S.fc.deck = null; return renderCards(); }
  if (navKey === 'quiz') { S.quiz.qs = null; return renderQuiz(); }
  renderHome();
}
function refresh() {
  const h = location.hash || '#/';
  if (h.startsWith('#/v/')) { renderSubs(); renderVWords(); return; }
  if (h.startsWith('#/words')) return renderWords();
  if (h.startsWith('#/cards')) return renderCards();
  if (h.startsWith('#/quiz')) return renderQuiz();
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
  if (n) location.hash = ytAt(n.vid);
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
  if (S.w && S.w.player && S.w.player.loadVideoById && $('#subs')) {
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
    loadTranscript(vid);
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
          <button class="btn sm" data-act="next-video">다음 영상 ⏭</button>
          <button class="btn sm ${S.autoNext ? 'on' : ''}" data-act="auto" id="autoBtn">연속 재생 ${S.autoNext ? '켬' : '끔'}</button>
        </div>
        <div class="now" id="now">${NOW_PH}</div>
      </div>
      <div class="wright">
        <div class="wtabs"><button class="btn sm on" data-act="tab-subs" id="tabSubs">자막</button><button class="btn sm" data-act="tab-words" id="tabWords">이 영상 표현 ${v ? (v.words || []).length : 0}</button></div>
        <div class="subs" id="subs"><div class="status">자막을 불러오는 중…</div></div>
        <div id="vwords" hidden></div>
        <div class="legend"><span><i style="background:var(--hl-v)"></i>단어장 표현 (아직 안 외움)</span><span><i style="background:var(--hl-s)"></i>내가 저장한 단어</span></div>
      </div>
    </div>`;
  renderVWords();
  const subsEl = $('#subs');
  const pauseFollow = () => { if (S.w) S.w.pauseFollowUntil = Date.now() + 4000; };
  ['wheel', 'touchmove'].forEach((ev) => { subsEl.addEventListener(ev, pauseFollow, { passive: true }); });
  loadTranscript(vid);
  const YT = await loadYT();
  if (!S.w || S.w.vid !== vid) return;
  if (!YT) { $('#yt').innerHTML = `<div class="ph">플레이어를 불러오지 못했어요.<br><a href="https://www.youtube.com/watch?v=${esc(vid)}" target="_blank" rel="noopener" style="color:#fff">YouTube에서 열기</a></div>`; return; }
  S.w.player = new YT.Player('yt', {
    videoId: vid,
    playerVars: { playsinline: 1, rel: 0, modestbranding: 1, cc_load_policy: 0, start: Math.floor(startT || 0) },
    events: {
      onReady: () => { if (S.w) { try { S.w.player.setPlaybackRate(S.w.rate); } catch (e) {} } },
      onStateChange: (e) => { if (e.data === 0 && S.w && !S.w.loop && S.autoNext) goNext(true); },
    },
  });
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
  if (now) now.innerHTML = i >= 0 && w.lines[i] ? lineHTML(w.lines[i], i, 'n') : NOW_PH;
}

/* transcript loading */
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
function renderSubs() {
  const w = S.w; const el = $('#subs'); if (!w || !el) return;
  if (!w.lines.length) { el.innerHTML = `<div class="status">${esc(w.status || '자막이 없어요.')}</div>`; return; }
  el.innerHTML = w.lines.map((L, i) => `<div class="ln ${L.tag ? 'tag' : ''} ${i === w.active ? 'on' : ''}" data-i="${i}"><button class="lt" data-act="seek" data-i="${i}">${fmt(L.t / 1000)}</button><p>${lineHTML(L, i)}</p></div>`).join('');
  if (w.active >= 0) { const now = $('#now'); if (now && w.lines[w.active]) now.innerHTML = lineHTML(w.lines[w.active], w.active, 'n'); }
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
async function define(word, sentence) {
  if (S.translator === 'none') return { none: true };
  const key = norm(word) + '|' + sentence;
  if (koCache[key]) return koCache[key];
  const r = await api('/api/define', { method: 'POST', body: JSON.stringify({ word, sentence }) });
  if (r.status === 503 && r.j.error === 'no_translator') { S.translator = 'none'; return { none: true }; }
  if (r.ok && r.j.ko) { koCache[key] = r.j; return r.j; }
  return null;
}
function closeSheet() { const s = $('#sheet'); s.hidden = true; s.innerHTML = ''; document.querySelectorAll('.w.sel').forEach((x) => x.classList.remove('sel')); }
async function openWordSheet(li, k, span) {
  const w = S.w; if (!w || !w.lines[li]) return;
  document.querySelectorAll('.w.sel').forEach((x) => x.classList.remove('sel'));
  if (span) span.classList.add('sel');
  const L = w.lines[li], tok = L.words[k];
  const raw = tok.w.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, '');
  const vocabId = span && span.dataset.vid;
  const entry = vocabId ? vocab().find((x) => x.id === vocabId) : null;
  const sentence = L.words.map((x) => x.w).join(' ');
  const key = tok.s;
  const saved = S.prog.saved[key] && !S.prog.saved[key].del;
  const sheet = $('#sheet');
  const naver = 'https://en.dict.naver.com/#/search?query=' + encodeURIComponent(raw);
  const papago = 'https://papago.naver.com/?sk=en&tk=ko&st=' + encodeURIComponent(sentence);
  const vocabBlock = entry ? `<div class="def"><span class="pill p-review">단어장 표현</span> <b style="font-size:15px;color:var(--ink)">${esc(entry.expr)}</b><div style="margin-top:4px">${esc(entry.ko)}</div>${entry.ex ? `<div class="ex">${esc(entry.ex)}</div><div class="exko">${esc(entry.exKo || '')}</div>` : ''}${entry.note ? `<div class="wnote">${esc(entry.note)}</div>` : ''}</div>
    <div class="row"><button class="btn sm ${st(entry.id) === 'learned' ? 'on' : ''}" data-act="sheet-learn" data-id="${esc(entry.id)}">${st(entry.id) === 'learned' ? '외웠음 ✓' : '외웠음'}</button><button class="btn sm" data-act="sheet-known" data-id="${esc(entry.id)}">이미 앎</button></div>` : '';
  sheet.innerHTML = `<button class="x close" data-act="sheet-close" aria-label="닫기">✕</button>
    <div class="sw">${esc(raw)}</div><div class="ctx">${esc(sentence)}</div>
    ${vocabBlock}
    ${entry ? '' : '<div id="ko" class="def">한국어 뜻을 찾는 중…</div>'}
    <div id="dict" class="def small">영어 사전을 찾는 중…</div>
    <div class="row">
      <button class="btn sm ${saved ? 'on' : ''}" data-act="save-word" data-key="${esc(key)}" data-word="${esc(raw)}" data-l="${li}">${saved ? '저장됨 · 취소' : '모르는 단어로 저장'}</button>
      <a class="btn sm" href="${naver}" target="_blank" rel="noopener">네이버 사전</a>
      <a class="btn sm" href="${papago}" target="_blank" rel="noopener">문장 번역</a>
      <button class="btn sm" data-act="seek" data-i="${li}">이 문장 듣기</button>
    </div>`;
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
      kb.innerHTML = '<span class="small">공개 사전에 없는 단어예요. 아래 영어 뜻이나 네이버 사전 버튼으로 확인해 보세요.</span>';
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
    <div><div><span class="expr">${esc(w.expr)}</span><span class="pos">${esc(w.pos || '')}</span> ${rev[w.id] ? '<span class="pill p-review">복습</span>' : ''}</div>
      <div>${esc(w.ko)}</div>
      ${w.ex ? `<div class="ex">${esc(w.ex)}</div><div class="exko">${esc(w.exKo || '')}</div>` : ''}
      ${w.note ? `<div class="wnote">${esc(w.note)}</div>` : ''}</div>
    <div class="acts">${inWatch ? `<button class="ts" data-act="seek-t" data-t="${w.t}">${ICON_PLAY}${fmt(w.t)}</button>` : `<a class="ts" href="${ytAt(w.v.vid, w.t)}">${ICON_PLAY}${fmt(w.t)}</a>`}
      <button class="btn sm ${s === 'known' ? 'on' : ''}" data-act="known" data-id="${esc(w.id)}">${s === 'known' ? '앎 취소' : '이미 앎'}</button></div></div>`;
}
function renderWords() {
  const rev = reviewSet();
  let html = statsHTML();
  html += `<div class="chips"><button class="btn ${S.hideDone ? 'on' : ''}" data-act="hide-done">외운 표현 숨기기</button></div>`;
  const vs = [...S.videos].sort((a, b) => (b.batchOrder || 0) - (a.batchOrder || 0) || (a.order || 0) - (b.order || 0));
  vs.forEach((v) => {
    let ws = (v.words || []).map((w) => ({ ...w, v }));
    if (S.hideDone) ws = ws.filter((w) => !st(w.id));
    if (!ws.length) return;
    html += `<div class="vsec"><h3><a href="${ytAt(v.vid)}">${esc(v.title)}</a><span class="pill ${v.kind === 'short' ? 'p-short' : 'p-long'}">${v.kind === 'short' ? '쇼츠' : '영상'}</span></h3>${ws.map((w) => wordRow(w, rev, false)).join('')}</div>`;
  });
  let sv = savedList().sort((a, b) => (b.at || 0) - (a.at || 0));
  if (S.hideDone) sv = sv.filter((x) => x.s !== 'learned');
  html += `<div class="h2">자막에서 저장한 단어 ${sv.length}</div>`;
  html += sv.length ? `<div class="vsec">${sv.map((x) => `<div class="word">
      <button class="chk ${x.s === 'learned' ? 'on' : ''}" data-act="saved-learn" data-key="${esc(x.key)}" aria-label="외웠음 표시">${x.s === 'learned' ? ICON_CHECK : ''}</button>
      <div><span class="expr">${esc(x.word)}</span>${x.ko ? `<div>${esc(x.ko)}</div>` : ''}${x.def ? `<div class="small" style="font-size:13px;color:var(--ink2)">${esc(x.def)}</div>` : ''}${x.ctx ? `<div class="ex">${esc(x.ctx)}</div>` : ''}</div>
      <div class="acts">${x.vid ? `<a class="ts" href="${ytAt(x.vid, x.t)}">${ICON_PLAY}${fmt(x.t)}</a>` : ''}<button class="btn sm" data-act="saved-del" data-key="${esc(x.key)}">삭제</button></div></div>`).join('')}</div>`
    : '<p class="small">영상 자막에서 단어를 눌러 "모르는 단어로 저장"하면 여기에 모여요.</p>';
  $('#view').innerHTML = html;
}

/* ---------------- flashcards ---------------- */
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
  const scope = `<div class="chips" style="justify-content:center">${[['all', '전체'], ['vocab', '단어장 표현'], ['saved', '저장한 단어']].map(([k, l]) => `<button class="btn sm ${S.fc.scope === k ? 'on' : ''}" data-act="fc-scope" data-k="${k}">${l}</button>`).join('')}</div>`;
  if (!c) { $('#view').innerHTML = `<div class="center">${scope}<p class="empty">${d.length ? '한 바퀴 다 돌았어요.' : '남은 카드가 없어요.'}</p><div class="btns"><button class="btn primary" data-act="fc-restart">다시 섞기</button></div></div>`; return; }
  $('#view').innerHTML = `<div class="center">${scope}<div class="counter">${S.fc.i + 1} / ${d.length}</div>
    <div class="fc" data-act="fc-flip"><div class="big">${esc(c.front)}</div><div class="from">${esc(c.from)}</div>
      ${S.fc.flip ? `<div class="ko">${esc(c.ko)}</div>${c.ex ? `<div class="ex" style="margin-top:10px">${esc(c.ex)}</div><div class="exko">${esc(c.exKo || '')}</div>` : ''}` : '<div class="hint">눌러서 뜻 보기</div>'}</div>
    <div class="btns">${c.vid ? `<a class="ts" href="${ytAt(c.vid, c.t)}">${ICON_PLAY}장면 ${fmt(c.t)}</a>` : ''}<button class="btn" data-act="fc-again">다음에 다시</button><button class="btn primary" data-act="fc-learn">외웠음</button></div></div>`;
}

/* ---------------- quiz ---------------- */
function buildQuiz() {
  const all = vocab();
  const pool = shuffle(all.filter((w) => st(w.id) !== 'known')).slice(0, 10);
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
  if (vocab().length < 4) { $('#view').innerHTML = '<p class="empty">퀴즈는 표현이 4개 이상일 때 열려요.</p>'; return; }
  if (!S.quiz.qs) buildQuiz();
  const Q = S.quiz, q = Q.qs[Q.i];
  if (!q) { $('#view').innerHTML = `<div class="center"><div class="qcard" style="text-align:center"><div class="counter">결과</div><div class="q">${Q.score} / ${Q.qs.length}</div><p class="fb">${Q.score === Q.qs.length ? '전부 맞혔어요.' : '틀린 표현은 카드로 한 번 더 보면 좋아요.'}</p><button class="btn primary" data-act="q-restart">새 퀴즈</button></div></div>`; return; }
  const label = (o) => esc(q.dir === 'en2ko' ? o.ko : o.expr);
  $('#view').innerHTML = `<div class="center"><div class="counter">${Q.i + 1} / ${Q.qs.length} · 맞힌 수 ${Q.score}</div><div class="qcard">
    <div class="small">${q.dir === 'en2ko' ? '이 표현의 뜻은?' : '이 뜻에 맞는 표현은?'}</div>
    <div class="q">${esc(q.dir === 'en2ko' ? q.w.expr : q.w.ko)}</div>
    ${q.opts.map((o, k) => { let c = ''; if (Q.ans !== null) { if (o.id === q.w.id) c = 'right'; else if (k === Q.ans) c = 'wrong'; } return `<button class="opt ${c}" data-act="q-ans" data-k="${k}" ${Q.ans !== null ? 'disabled' : ''}>${label(o)}</button>`; }).join('')}
    ${Q.ans !== null ? `<div class="fb">${esc(q.w.expr)} — ${esc(q.w.ko)}<br><span class="ex">${esc(q.w.ex || '')}</span></div><div class="btns" style="justify-content:flex-start"><a class="ts" href="${ytAt(q.w.v.vid, q.w.t)}">${ICON_PLAY}장면 ${fmt(q.w.t)}</a><button class="btn primary" data-act="q-next">다음</button></div>` : ''}
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
  if (word && S.w) { openWordSheet(+word.dataset.l, +word.dataset.k, word); return; }
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
    case 'play-all': { const list = S.videos.filter((v) => S.kind === 'all' || v.kind === S.kind).sort(homeOrder); const first = list.find((v) => (v.words || []).some((x) => !st(x.id))) || list[0]; if (first) location.hash = ytAt(first.vid); break; }
    case 'next-video': goNext(false); break;
    case 'auto': S.autoNext = !S.autoNext; LS.set('vp-auto', S.autoNext); b.textContent = '연속 재생 ' + (S.autoNext ? '켬' : '끔'); b.classList.toggle('on', S.autoNext); break;
    case 'seek-t': if (w && w.player && w.player.seekTo) { w.player.seekTo(+b.dataset.t, true); w.player.playVideo(); } break;
    case 'prev': if (w) seekLine(Math.max(0, w.active - 1)); break;
    case 'next': if (w) seekLine(Math.min(w.lines.length - 1, w.active + 1)); break;
    case 'replay': if (w) seekLine(Math.max(0, w.active)); break;
    case 'loop': if (w) { w.loop = !w.loop; b.textContent = w.loop ? '반복 켬' : '반복 끔'; b.classList.toggle('on', w.loop); } break;
    case 'tab-subs': case 'tab-words':
      if (!w) break; w.tab = a === 'tab-subs' ? 'subs' : 'words';
      $('#subs').hidden = w.tab !== 'subs'; $('#vwords').hidden = w.tab !== 'words';
      $('#tabSubs').classList.toggle('on', w.tab === 'subs'); $('#tabWords').classList.toggle('on', w.tab === 'words');
      break;
    case 'learn': setStatus(id, st(id) === 'learned' ? null : 'learned'); refresh(); break;
    case 'known': setStatus(id, st(id) === 'known' ? null : 'known'); refresh(); break;
    case 'sheet-learn': setStatus(id, st(id) === 'learned' ? null : 'learned'); closeSheet(); refresh(); break;
    case 'sheet-known': setStatus(id, 'known'); closeSheet(); refresh(); break;
    case 'sheet-close': closeSheet(); break;
    case 'save-word': {
      const key = b.dataset.key; if (!key) break;
      const cur = S.prog.saved[key];
      if (cur && !cur.del) S.prog.saved[key] = { ...cur, del: true, at: Date.now() };
      else {
        const L = w && w.lines[+b.dataset.l];
        S.prog.saved[key] = { word: b.dataset.word, ko: $('#sheet').dataset.ko || '', def: $('#sheet').dataset.def || '', ctx: L ? L.words.map((x) => x.w).join(' ').slice(0, 140) : '', vid: w ? w.vid : null, t: L ? Math.floor(L.t / 1000) : 0, at: Date.now(), del: false, s: null };
      }
      saveProg(); closeSheet(); refresh();
      break;
    }
    case 'saved-learn': { const x = S.prog.saved[b.dataset.key]; if (x) { S.prog.saved[b.dataset.key] = { ...x, s: x.s === 'learned' ? null : 'learned', at: Date.now() }; saveProg(); renderWords(); } break; }
    case 'saved-del': { const x = S.prog.saved[b.dataset.key]; if (x) { S.prog.saved[b.dataset.key] = { ...x, del: true, at: Date.now() }; saveProg(); renderWords(); } break; }
    case 'hide-done': S.hideDone = !S.hideDone; renderWords(); break;
    case 'fc-flip': S.fc.flip = !S.fc.flip; renderCards(); break;
    case 'fc-again': S.fc.i++; S.fc.flip = false; renderCards(); break;
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
  if (e.key === 'Escape') closeSheet();
  if (!S.w || /input|textarea|select/i.test(e.target.tagName)) return;
  if (e.key === 'ArrowLeft' && e.shiftKey) { seekLine(Math.max(0, S.w.active - 1)); e.preventDefault(); }
  if (e.key === 'ArrowRight' && e.shiftKey) { seekLine(Math.min(S.w.lines.length - 1, S.w.active + 1)); e.preventDefault(); }
});
document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && S.server === 'ok') { await pull(); if (!S.w) refresh(); } });
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
  await pull(); // shows the passcode screen itself when the server asks for one
  route();
})();
