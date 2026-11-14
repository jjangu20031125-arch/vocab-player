import { checkPass } from './_auth.js';

// Korean meaning of a tapped word, in the sentence it came from.
//   POST /api/define  { word, sentence } -> { ko, pos, lemma, other, via }
// Uses Claude (ANTHROPIC_API_KEY) when set: meaning in context.
// Otherwise DeepL (DEEPL_API_KEY): a plain translation of the word.
async function viaClaude(key, word, sentence) {
  const prompt = `영어 학습자를 위한 사전이야. 아래 문장에서 쓰인 단어의 뜻을 알려줘.
문장: "${sentence}"
단어: "${word}"
JSON 한 줄만 답해: {"lemma":"사전 기본형","pos":"품사(한국어, 예: 동사)","ko":"이 문장에서의 뜻(한국어, 짧게)","other":"다른 주요 뜻 1~2개(한국어, 쉼표로 구분, 없으면 빈 문자열)"}`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!r.ok) throw new Error('claude_' + r.status);
  const j = await r.json();
  const text = (j.content || []).map((c) => c.text || '').join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('claude_parse');
  const o = JSON.parse(m[0]);
  return { ko: String(o.ko || ''), pos: String(o.pos || ''), lemma: String(o.lemma || word), other: String(o.other || ''), via: 'claude' };
}

async function viaDeepL(key, word, sentence) {
  const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const r = await fetch(`${host}/v2/translate`, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: [word], source_lang: 'EN', target_lang: 'KO', context: sentence }),
  });
  if (!r.ok) throw new Error('deepl_' + r.status);
  const j = await r.json();
  const ko = j.translations && j.translations[0] ? j.translations[0].text : '';
  return { ko, pos: '', lemma: word, other: '', via: 'deepl' };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!checkPass(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const word = String(body.word || '').trim().slice(0, 40);
  const sentence = String(body.sentence || '').replace(/["\\]/g, "'").trim().slice(0, 300);
  if (!word || !/^[A-Za-z][A-Za-z'\-]*$/.test(word)) return res.status(400).json({ error: 'bad_word' });

  const claudeKey = process.env.ANTHROPIC_API_KEY;
  const deeplKey = process.env.DEEPL_API_KEY;
  if (!claudeKey && !deeplKey) return res.status(503).json({ error: 'no_translator' });
  try {
    const out = claudeKey ? await viaClaude(claudeKey, word, sentence) : await viaDeepL(deeplKey, word, sentence);
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: 'translate_failed', detail: String(e.message || e).slice(0, 60) });
  }
}
