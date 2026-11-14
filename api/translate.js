import { checkPass } from './_auth.js';

// Korean translation of one subtitle sentence (only the sentences the user swipes).
//   POST /api/translate  { text } -> { ko, via }
// DeepL (DEEPL_API_KEY, free plan available) first, then Claude (ANTHROPIC_API_KEY).
async function viaDeepL(key, text) {
  const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const r = await fetch(`${host}/v2/translate`, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: [text], source_lang: 'EN', target_lang: 'KO' }),
  });
  if (!r.ok) throw new Error('deepl_' + r.status);
  const j = await r.json();
  return (j.translations && j.translations[0] && j.translations[0].text) || '';
}
async function viaClaude(key, text) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
      max_tokens: 300,
      messages: [{ role: 'user', content: `다음 영어 자막 한 줄을 자연스러운 한국어로 번역해. 번역문만 답해.\n\n${text}` }],
    }),
  });
  if (!r.ok) throw new Error('claude_' + r.status);
  const j = await r.json();
  return (j.content || []).map((c) => c.text || '').join('').trim();
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!checkPass(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const text = String((req.body && req.body.text) || '').trim().slice(0, 500);
  if (!text) return res.status(400).json({ error: 'empty' });
  const deepl = process.env.DEEPL_API_KEY, claude = process.env.ANTHROPIC_API_KEY;
  if (!deepl && !claude) return res.status(503).json({ error: 'no_translator' });
  try {
    const ko = deepl ? await viaDeepL(deepl, text) : await viaClaude(claude, text);
    return res.status(200).json({ ko, via: deepl ? 'deepl' : 'claude' });
  } catch (e) {
    return res.status(502).json({ error: 'translate_failed' });
  }
}
