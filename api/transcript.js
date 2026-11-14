import { checkPass } from './_auth.js';

// Fetches a video's existing (native) English captions through Supadata.
// Nothing is stored on the server; the browser asks again when it needs them.
//   GET /api/transcript?v=<videoId>      -> { segments } or { pending, jobId }
//   GET /api/transcript?job=<jobId>      -> same, for long videos handled as a job
const BASE = 'https://api.supadata.ai/v1/transcript';

function toSegments(data) {
  const content = Array.isArray(data?.content) ? data.content : [];
  return content
    .filter((s) => s && typeof s.text === 'string')
    .map((s) => ({ t: Number(s.offset) || 0, d: Number(s.duration) || 0, text: s.text }));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!checkPass(req, res)) return;
  const key = process.env.SUPADATA_API_KEY;
  if (!key) return res.status(503).json({ error: 'no_key', message: 'SUPADATA_API_KEY is not set.' });

  const { v, job } = req.query || {};
  let url;
  if (job) {
    if (!/^[\w-]{1,120}$/.test(String(job))) return res.status(400).json({ error: 'bad_job' });
    url = `${BASE}/${encodeURIComponent(job)}`;
  } else {
    if (!/^[\w-]{11}$/.test(String(v || ''))) return res.status(400).json({ error: 'bad_video' });
    const videoUrl = `https://www.youtube.com/watch?v=${v}`;
    url = `${BASE}?url=${encodeURIComponent(videoUrl)}&lang=en&mode=native`;
  }

  let r, body;
  try {
    r = await fetch(url, { headers: { 'x-api-key': key } });
    body = await r.json().catch(() => ({}));
  } catch (e) {
    return res.status(502).json({ error: 'upstream_unreachable' });
  }

  if (r.status === 202) return res.status(200).json({ pending: true, jobId: body.jobId });

  if (r.status === 200) {
    if (job && body.status && body.status !== 'completed') {
      if (body.status === 'failed') return res.status(502).json({ error: 'job_failed' });
      return res.status(200).json({ pending: true, jobId: job });
    }
    const data = body.result && Array.isArray(body.result.content) ? body.result : body;
    return res.status(200).json({ lang: data.lang || null, segments: toSegments(data) });
  }

  if (r.status === 206 || r.status === 404) return res.status(404).json({ error: 'no_transcript' });
  if (r.status === 403) return res.status(403).json({ error: 'restricted' });
  if (r.status === 429) return res.status(429).json({ error: 'limit' });
  return res.status(502).json({ error: 'upstream', status: r.status });
}
