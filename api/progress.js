import { checkPass } from './_auth.js';

// Keeps learning progress (외웠음 / 이미 앎 / 저장한 단어 / 다음 주제) in one
// Upstash Redis key so the phone and the PC see the same state.
//   GET /api/progress  -> { state }
//   PUT /api/progress  body { state } -> { ok: true }
const KEY = 'vocab-player:progress';

function store() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!checkPass(req, res)) return;
  const s = store();
  if (!s) return res.status(503).json({ error: 'no_store' });
  const auth = { Authorization: `Bearer ${s.token}` };

  try {
    if (req.method === 'GET') {
      const r = await fetch(`${s.url}/get/${encodeURIComponent(KEY)}`, { headers: auth });
      const j = await r.json();
      let state = {};
      try { state = j.result ? JSON.parse(j.result) : {}; } catch (e) { state = {}; }
      return res.status(200).json({ state });
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      const state = req.body && typeof req.body === 'object' ? req.body.state : null;
      if (!state || typeof state !== 'object') return res.status(400).json({ error: 'bad_body' });
      const text = JSON.stringify(state);
      if (text.length > 400000) return res.status(413).json({ error: 'too_large' });
      const r = await fetch(`${s.url}/set/${encodeURIComponent(KEY)}`, { method: 'POST', headers: auth, body: text });
      if (!r.ok) return res.status(502).json({ error: 'store_write_failed' });
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'method' });
  } catch (e) {
    return res.status(502).json({ error: 'store_unreachable' });
  }
}
