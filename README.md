# Vocab Player

YouTube 영상을 보면서 영어 자막의 단어를 눌러 뜻을 보고, 단어장·플래시카드·퀴즈로 복습하는 개인용 웹앱.

## 구성

- `index.html`, `style.css`, `app.js` — 화면 (정적 파일)
- `data/videos.json` — 영상 목록과 영상별 표현 (Claude가 "단어장 채워줘" 때 갱신)
- `api/transcript.js` — 영상의 영어 자막을 Supadata API로 받아 옴 (서버에 저장하지 않음)
- `data/dict/` — 단어를 눌렀을 때 보여주는 영→한 공개 사전 (cc-kedict·kengdic 기반, 라이선스는 `data/dict/LICENSE.md`)
- `api/define.js` — 단어의 한국어 뜻 (Claude 또는 DeepL)
- `api/progress.js` — 외웠음/이미 앎/저장한 단어/다음 주제를 Upstash Redis에 저장해 기기 간 동기화

## Vercel 환경 변수

| 이름 | 용도 |
|---|---|
| `APP_PASSCODE` | 사이트 비밀번호 (필수). 처음 접속할 때 한 번 입력 |
| `SUPADATA_API_KEY` | 자막 API 키 (supadata.ai, 무료 월 100회) |
| `ANTHROPIC_API_KEY` | (선택) 공개 사전에 없는 단어의 한국어 뜻을 문장 기준으로 보충. Claude API 키 |
| `DEEPL_API_KEY` | (선택) Claude 키가 없을 때 대신 쓰는 DeepL 번역 키 |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis (Vercel Marketplace에서 연결하면 자동 입력). `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` 이름도 인식 |

Upstash를 연결하지 않으면 진도는 각 기기 브라우저에만 저장된다.

## 자막 캐시

받아 온 자막은 보는 기기의 브라우저에만 14일 동안 보관해서 같은 영상을 다시 열 때 API 횟수를 아낀다.
