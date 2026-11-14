import { checkPass } from './_auth.js';

// Private, passcode-protected copies of EPUBs the user imported, so every device sees them.
// Never written to the public site files.
//   GET    /api/books               -> { books: [meta] }
//   GET    /api/books?id=X&ch=N     -> { chapter }
//   PUT    /api/books  { id, n, chapter }   (one chapter, 1-based)
//   PUT    /api/books  { meta }             (after all chapters)
//   DELETE /api/books?id=X
const INDEX = 'vocab-player:books';
const chKey = (id, n) => `vocab-player:book:${id}:${n}`;

function store() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}
async function rget(s, key) {
  const r = await fetch(`${s.url}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${s.token}` } });
  const j = await r.json();
  return j.result ? JSON.parse(j.result) : null;
}
async function rset(s, key, value) {
  const r = await fetch(`${s.url}/set/${encodeURIComponent(key)}`, { method: 'POST', headers: { Authorization: `Bearer ${s.token}` }, body: JSON.stringify(value) });
  if (!r.ok) throw new Error('set_failed');
}
async function rdel(s, key) {
  await fetch(`${s.url}/del/${encodeURIComponent(key)}`, { method: 'POST', headers: { Authorization: `Bearer ${s.token}` } });
}
const okId = (id) => /^u-[a-z0-9]{1,20}$/.test(String(id || ''));

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!checkPass(req, res)) return;
  const s = store();
  if (!s) return res.status(503).json({ error: 'no_store' });
  try {
    const q = req.query || {};
    if (req.method === 'GET') {
      if (q.id) {
        if (!okId(q.id) || !/^\d{1,4}$/.test(String(q.ch || ''))) return res.status(400).json({ error: 'bad_request' });
        const chapter = await rget(s, chKey(q.id, +q.ch));
        return chapter ? res.status(200).json({ chapter }) : res.status(404).json({ error: 'not_found' });
      }
      return res.status(200).json({ books: (await rget(s, INDEX)) || [] });
    }
    if (req.method === 'PUT') {
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      if (b.meta) {
        const m = b.meta;
        if (!okId(m.id) || !Array.isArray(m.chapters) || m.chapters.length > 500) return res.status(400).json({ error: 'bad_meta' });
        const meta = { id: m.id, title: String(m.title || '').slice(0, 200), author: String(m.author || '').slice(0, 200), cover: typeof m.cover === 'string' && m.cover.length < 300000 ? m.cover : null,
          chapters: m.chapters.map((c) => ({ title: String(c.title || '').slice(0, 120), paras: +c.paras || 0 })), added: +m.added || Date.now() };
        const list = ((await rget(s, INDEX)) || []).filter((x) => x.id !== meta.id);
        list.push(meta);
        await rset(s, INDEX, list);
        return res.status(200).json({ ok: true });
      }
      if (!okId(b.id) || !Number.isInteger(b.n) || b.n < 1 || !b.chapter || !Array.isArray(b.chapter.paras)) return res.status(400).json({ error: 'bad_chapter' });
      const chapter = { title: String(b.chapter.title || '').slice(0, 120), paras: b.chapter.paras.map(String) };
      if (JSON.stringify(chapter).length > 3500000) return res.status(413).json({ error: 'too_large' });
      await rset(s, chKey(b.id, b.n), chapter);
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE') {
      if (!okId(q.id)) return res.status(400).json({ error: 'bad_request' });
      const list = (await rget(s, INDEX)) || [];
      const meta = list.find((x) => x.id === q.id);
      if (meta) for (let n = 1; n <= meta.chapters.length; n++) await rdel(s, chKey(q.id, n));
      await rset(s, INDEX, list.filter((x) => x.id !== q.id));
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'method' });
  } catch (e) {
    return res.status(502).json({ error: 'store_unreachable' });
  }
}
