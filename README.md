# Vocab Player

YouTube 영상을 보면서 영어 자막의 단어를 눌러 뜻을 보고, 단어장·플래시카드·퀴즈로 복습하는 개인용 웹앱.

## 구성

- `index.html`, `style.css`, `app.js` — 화면 (정적 파일)
- `data/videos.json` — 영상 목록과 영상별 표현 (Claude가 "단어장 채워줘" 때 갱신)
- `api/transcript.js` — 영상의 영어 자막을 Supadata API로 받아 옴 (서버에 저장하지 않음)
- `data/books.json`, `data/books/<id>/<장>.json` — 기본 책(퍼블릭 도메인)과 장별 표현·복습 문제
- `vendor/jszip.min.js` — EPUB 읽기용 JSZip (MIT)
- `vendor/ts-fsrs.min.mjs` — FSRS 간격 반복 라이브러리 (ts-fsrs, MIT) 번들
- `data/dict/` — 단어를 눌렀을 때 보여주는 영→한 공개 사전 (cc-kedict·kengdic 기반, 라이선스는 `data/dict/LICENSE.md`)
- `api/books.js` — 불러온 EPUB 보관 (비밀번호 필요)
- `api/translate.js` — 밀어서 보는 자막 문장 한국어 번역 (PC 크롬은 기기 내장 번역을 먼저 시도)
- `api/define.js` — 단어의 한국어 뜻 (Claude 또는 DeepL)
- `api/progress.js` — 외웠음/이미 앎/저장한 단어/다음 주제를 Upstash Redis에 저장해 기기 간 동기화

## Vercel 환경 변수

| 이름 | 용도 |
|---|---|
| `APP_PASSCODE` | 사이트 비밀번호 (필수). 처음 접속할 때 한 번 입력 |
| `SUPADATA_API_KEY` | 자막 API 키 (supadata.ai, 무료 월 100회) |
| `ANTHROPIC_API_KEY` | (선택) 공개 사전에 없는 단어의 한국어 뜻을 문장 기준으로 보충. Claude API 키 |
| `DEEPL_API_KEY` | (선택) 자막 문장을 옆으로 밀었을 때 한국어 번역 (DeepL 무료 플랜 가능). 단어 뜻 보충에도 사용 |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis (Vercel Marketplace에서 연결하면 자동 입력). `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` 이름도 인식 |

Upstash를 연결하지 않으면 진도는 각 기기 브라우저에만 저장된다.

## 자막 캐시

받아 온 자막은 보는 기기의 브라우저에만 14일 동안 보관해서 같은 영상을 다시 열 때 API 횟수를 아낀다.

## 복습 (FSRS)

'복습' 탭은 FSRS로 잊기 직전인 표현부터 하루 최대 20개(새 표현은 하루 10개까지)를 낸다. 문제는 뜻 고르기 → 유의어 비교 → 빈칸 쓰기 → 듣고 쓰기 순으로 어려워지고, 정답 여부와 걸린 시간으로 자동 채점해 다음 복습 날짜를 정한다. 문제 데이터는 `data/videos.json`의 각 표현 `drill` 필드에 있다. 단어장에서 '외웠음'을 체크하면 복습 일정에 들어간다.

## 책

'책' 탭: 기본 책(The Great Gatsby, Siddhartha — 둘 다 Standard Ebooks의 퍼블릭 도메인·CC0 본문, Siddhartha는 2001년 퍼블릭 도메인으로 공개된 Gunther Olesch 외 영역본)과 사용자가 불러온 DRM 없는 EPUB을 페이지 넘김으로 읽는다. 단어 탭 → 뜻·발음·저장, 문장 번역, 단어장 표현 색 표시, 소리 내어 읽기(브라우저 음성, 문장 강조·자동 페이지 넘김), 읽던 위치 동기화. 불러온 EPUB은 기기 브라우저(IndexedDB)에 저장되고, 같은 비밀번호로 잠긴 Upstash 저장소에도 장별로 올라간다(`api/books.js`: 목록 키 `vocab-player:books`, 본문 키 `vocab-player:book:<id>:<장>`). 다른 기기는 서재에서 목록을 보고, 처음 열 때 본문을 받아 IndexedDB에 저장한다. 삭제는 두 번 눌러 확인하며 모든 기기에서 지워진다. 예전에 불러와 한 기기에만 있는 책은 서재의 '모든 기기에 올리기'로 올린다.

## 읽은 위치와 학습 달력

책마다 현재 위치와 가장 멀리 읽은 곳(장·문단·전체 %)이 저장되어 서재·읽기 화면에 표시된다. '복습 → 학습 달력'은 날짜별 독서 시간(책 화면에서 2분 안에 조작한 시간), 영상 재생 시간, 복습 문제 수를 기기별로 기록해 합산해 보여준다. 하루는 새벽 4시 기준.

## 쉐도잉과 영작 첨삭

- 쉐도잉: 영상 '🎤 따라 말하기' 또는 단어 창의 같은 버튼. 원문 듣기(영상 구간 재생 / 책은 브라우저 음성) → 녹음 → 내 목소리·이어 듣기. 채점 없음, 녹음은 저장하지 않음.
- 영작: 연습 → 영작. 문장은 비밀번호로 보호된 진도 저장소에만 저장된다. 사용자가 채팅에서 첨삭을 요청하면 Claude가 PC의 앱 브라우저에서 `vpPendingWriting()`으로 대기 문장을 읽고 `vpDeliverFeedback([{id, corrected, notes, better, used}])`로 결과를 넣는다. 잘못 쓴 표현(`used[id] === false`)은 복습 일정이 앞당겨진다.
