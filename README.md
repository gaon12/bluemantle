# Bluemantle

React로 만든 의미 기반 단어 추측 게임입니다. 블루 아카이브의 하늘색·흰색, 샬레 메뉴, 헤일로와 임무 패널을 모티프로 사용합니다. 게임 엔진과 임베딩 모듈은 범용이며 주제별 데이터 팩을 교체할 수 있습니다.

## GitHub Pages와 서버 없는 실행

GitHub Pages 버전은 사전을 다운로드한 뒤 **브라우저의 Web Worker에서** 점수·순위·힌트·탐색 지도와 정답을 계산합니다. 별도 API 서버나 임베딩 모델 실행이 필요하지 않습니다. 첫 접속에는 약 12MB의 벡터와 용어 설명을 내려받습니다.

```powershell
npm ci
npm run build:static -- --base=/bluemantle/
npm run preview:static -- --base=/bluemantle/
```

[http://127.0.0.1:4173/bluemantle/](http://127.0.0.1:4173/bluemantle/)에서 확인합니다. 루트 주소에 배포할 때는 `--base=/`를 사용합니다. `dist/`만 정적 호스팅에 올리면 됩니다. 빌드 전에 모든 팩의 체크섬과 TXT를 검증하고, 현재 사용 중인 용어와 벡터만 포함합니다. Python 환경·캐시·서버 비밀값은 포함하지 않습니다.

일일 문제는 기기의 시각과 팩의 시간대(기본 `Asia/Seoul`)를 사용합니다. 같은 데이터 버전에서는 모두 같은 문제를 풀며, 모든 출제 가능 용어를 한 번씩 사용한 뒤 순환합니다. 연습 문제와 추측 기록은 새로고침 후에도 복원됩니다. Node 서버 버전과 일일 문제·기록 식별자는 별개입니다.

정적 버전에서는 용어·벡터와 정답 계산 방식이 공개됩니다. 개인 플레이용으로 설계되어 있으며 서버가 기록을 인증하지 않습니다. 기존 Node 서버 실행도 계속 사용할 수 있습니다.

GitHub 저장소의 **Settings → Pages → Source를 GitHub Actions**로 설정하면 `.github/workflows/pages.yml`이 `main` 푸시마다 테스트·팩 검증·정적 빌드 후 자동 배포합니다. 경로는 Pages 설정에서 자동으로 읽습니다. 사전을 변경한 경우에는 임베딩 생성 결과까지 커밋·푸시하면 배포에 반영됩니다. GitHub Pages를 지원하는 저장소 공개 범위와 요금제가 필요합니다.

## 바로 실행

Node.js 22.12 이상을 사용합니다. 완성된 임베딩이 포함되어 있으므로 플레이할 때 Python이나 모델 실행은 필요하지 않습니다.

```powershell
npm install
npm start
```

[http://127.0.0.1:3000](http://127.0.0.1:3000)에서 엽니다. `npm start`는 React 화면을 빌드한 뒤 서버를 실행합니다.

개발 시에는 `npm run dev`로 API 서버와 Vite를 함께 실행합니다. 화면은 [http://127.0.0.1:5173](http://127.0.0.1:5173), API는 3000번 포트입니다. 이미 실행 중인 서버가 있으면 먼저 종료하세요.

## TXT에 한 줄씩 입력 → 임베딩 생성

편집할 파일은 **`data/packs/blue-archive/words.txt`**입니다. JSON을 직접 작성할 필요가 없습니다.

```text
아로나
프라나
싯딤의 상자
아로나
```

저장한 다음 아래 명령 하나를 실행합니다.

```powershell
npm run embed
```

중복 제거 → 용어 목록 생성 → 실제 EmbeddingGemma 2 임베딩 생성 → 체크섬이 포함된 인덱스 저장까지 처리합니다. 변경한 데이터는 서버를 재시작하면 반영됩니다.

- 빈 줄은 제거합니다. UTF-8 BOM과 Windows 줄바꿈을 지원합니다.
- 공백·대소문자·유니코드 전각 표기 등을 정규화하여 중복을 제거합니다.
- 등록된 별명은 표준 이름으로 통합합니다. 예: `Arona`, `아로나` → `아로나`.
- `시로코`, `시로코(수영복)`, `시로코(라이딩)` 및 `스킬`, `스킬+`는 별개로 유지합니다.
- 알려진 용어는 수집된 최신 설명·범주·별명을 자동으로 사용합니다. 직접 추가한 용어는 이름만으로도 임베딩할 수 있습니다.
- 정리된 TXT를 같은 파일에 저장합니다. 미리 중복만 제거하려면 `npm run data:dedupe`를 실행합니다.

다른 주제나 특정 파일을 지정할 수도 있습니다.

```powershell
npm run embed -- examples/coffee
npm run embed -- data/packs/blue-archive/words.txt
npm run data:dedupe -- data/packs/blue-archive/words.txt
```

임베딩 도구의 첫 사용에는 Python 3.11 이상과 의존성이 필요합니다.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-embeddings.txt
npm run embed
```

npm 도구가 프로젝트의 `.venv`를 자동으로 사용합니다. 모델을 처음 실행할 때만 다운로드합니다. 기본은 CPU/fp32이고 CUDA에서는 `npm run embed -- --device cuda`를 사용할 수 있습니다. 중간 벡터 캐시를 재사용하므로 변경된 입력만 계산합니다.

## 최신 블루 아카이브 데이터 갱신

제공된 기본 사전은 **2026-10-12에 현재 운영 중인 SchaleDB 한국어 데이터를 수집하고 직접 작성한 밈·음악 설명을 더한 3,903개 용어**입니다. 기본 수집 범위는 글로벌 서버 출시 기준이며, 학생·학원·동아리·아이템·장비·가구·스킬·고유무기·이벤트와 직접 작성한 세계관 용어를 포함합니다.

```powershell
npm run data:update
npm run embed
```

`data:update`는 운영 중인 서비스의 `*.min.json`을 새로 수집합니다. 2025년 보관 저장소를 기본으로 사용하지 않습니다. 원본 URL, 수집 시각과 해시는 `sources.json`에 저장됩니다. `catalog.json`에 최신 설명과 별명을 보관하고 `words.txt`에 새 용어를 추가하며, 직접 작성한 기존 TXT 단어는 보존합니다. 사전은 계속 확장할 수 있으며 게임의 모든 대사 속 단어까지 수집했다는 의미는 아닙니다.

네트워크 없이 이미 받은 수집 자료를 다시 처리하려면 `npm run data:update -- --offline`을 사용합니다. 이 경우 데이터 기준 날짜는 캐시의 실제 수집 시각을 사용합니다. 일본 서버 등 미출시 항목까지 수집하려면 `--include-unreleased`를 지정할 수 있습니다.

`data/packs/blue-archive/memes.json`에는 밈 14개와 관련 음악 3개의 설명·별명·참고 자료를 보관합니다. `몰?루`/`몰루`, `아리스 댄스`/`Arisu Dance` 같은 표기는 한 용어로 묶고, `아!루`와 학생 이름 `아루`는 별개로 유지합니다. 밈도 정답과 추측에 포함됩니다. 설명에는 관련 인물과 상황을 넣어 낯선 표현을 이름만으로 임베딩하는 문제를 줄였습니다. 이후 원본 데이터를 갱신할 때도 이 파일을 함께 읽습니다.

밈 설명을 직접 바꾼 경우에는 `npm run data:update -- --offline` 다음 `npm run embed`를 실행하고 서버를 다시 시작합니다. 일반적인 용어 추가는 기존처럼 TXT 한 줄 입력과 임베딩 명령으로 처리할 수 있습니다.

게임 텍스트와 데이터의 권리는 해당 권리자에게 있으며 엔진의 MIT 라이선스와 별개입니다.

## 구성

| 위치 | 역할 |
| --- | --- |
| `web/src/` | React 화면과 블루 아카이브를 모티프로 한 스타일 |
| `web/game-store.mjs` | 화면 상태, API 연결, 기록 복원 |
| `src/topic-pack.mjs` · `src/pack.mjs` | 공통 데이터 팩과 Node 파일·체크섬 검증 |
| `src/puzzle.mjs` | 브라우저·서버가 공유하는 점수·순위·힌트 계산 |
| `src/geometry.mjs` | 사전 평균 벡터 제거, 보정된 코사인 유사도 |
| `src/game.mjs` | 보정 점수, 순위, 일일/연습 문제, 힌트, 추측 간 비교 |
| `web/connection-map.mjs` | 입력한 추측의 관계를 2차원으로 투영 |
| `src/server.mjs` | API와 빌드된 React 파일 제공 |
| `web/browser-game.mjs` · `web/game-worker.mjs` | 서버 없는 일일/연습 게임과 백그라운드 계산 |
| `scripts/build-static.mjs` | 팩을 검증한 후 정적 배포 결과 생성 |
| `scripts/vocabulary.py` | TXT 정규화, 별명 통합, 중복 제거 |
| `scripts/build-embeddings.py` | 범용 TXT → 임베딩 생성 모듈 |
| `scripts/import-blue-archive.py` | 최신 블루 아카이브 데이터 수집기 |
| `data/packs/blue-archive/words.txt` | 직접 편집하는 용어 사전 |
| `data/packs/blue-archive/memes.json` | 밈·관련 음악의 설명, 별명, 참고 자료 |
| `examples/coffee/` | 다른 주제를 위한 완성 예시 팩 |

새 주제는 커피 팩을 복사해 이름과 TXT를 바꾸면 됩니다. 범주나 임베딩 모델도 팩에서 설정할 수 있습니다. 자세한 규격은 [데이터 팩 안내](docs/data-packs.md)에 있습니다.

## 검증

```powershell
npm run build
npm run build:static -- --base=/bluemantle/
npm test
npm run test:data
npm run validate
```

React 빌드, 엔진/API/화면 상태 테스트, Python TXT 중복 제거 테스트, 실제 임베딩 무결성 검증을 제공합니다. TXT·설명·모델 설정이 바뀐 뒤 임베딩을 갱신하지 않으면 서버가 해당 팩을 거부합니다.

## 플레이와 운영

일일 문제, 무작위 연습, 가까운 단어 힌트, 탐색 지도, 정답 확인, 결과 공유, 주제별 브라우저 기록 저장을 지원합니다. 정확한 표준 이름 또는 별명만 정답으로 인정합니다.

같은 작품의 용어에 공통으로 들어 있는 성분 때문에 원본 코사인 점수가 70~80점에 몰리는 문제를 줄이기 위해 **팩 전체의 평균 벡터를 뺀 뒤 다시 정규화**합니다. 유사도는 이 보정 벡터의 코사인 × 100(−100~100)이며, 순위와 힌트도 동일한 보정 공간에서 계산합니다. 0 근처는 보정 후 겹치는 성분이 적다는 뜻입니다. 음수가 반의어를 뜻하지 않으며 점수는 확률이 아닙니다. 정답만 100점이고 다른 용어는 최대 99.99점입니다. 점수 방식 변경 시 이전 기록은 다른 문제 식별자로 분리합니다.

탐색 지도는 **입력한 단어끼리**의 유사도로 PCA 투영을 계산합니다. 점수는 정답과의 가까움, 지도 위치는 추측 간 관계를 나타내므로 같은 점수여도 서로 다른 연결을 비교할 수 있습니다. 단어를 선택하면 다른 추측과의 실제 보정 유사도를 보여줍니다. 지도에는 정답 위치를 표시하지 않습니다. 2차원 투영은 근사이며 반영하는 분산 비율을 화면에 표시합니다. 새 추측에 따라 배치가 바뀌고, 32개를 넘으면 최근 16개와 가까운 추측을 합쳐 표시합니다.

다른 주제의 점수 분포도 확인할 수 있습니다. 이 명령은 고정 시드로 단어 쌍 약 3만 개를 표본 추출하여 원본과 보정 점수의 분위수를 출력합니다.

```powershell
node scripts/analyze-scores.mjs
node scripts/analyze-scores.mjs examples/coffee
```

평균 제거는 사전 구성에 영향을 받으며 모델의 의미 이해를 완벽하게 만들지는 않습니다. 설명이 비슷한 스킬·가구 등의 관계는 여전히 강할 수 있습니다. 다른 주제도 같은 절차를 자동 적용하며 모델 재추론은 필요하지 않습니다.

기본 팩의 일일 문제는 `Asia/Seoul` 자정에 바뀝니다. Node 서버 버전에서는 같은 서버의 모든 사용자가 같은 문제를 풀며, 서버 비밀값은 `.bluemantle/secret`에 보존합니다. 여러 서버에서 같은 일일 문제를 제공하려면 `BLUEMANTLE_SECRET`을 동일하게 설정합니다.

`BLUEMANTLE_PACKS_DIR`, `PORT`, `HOST`로 Node 서버의 팩 루트와 주소를 변경할 수 있습니다. Node 서버는 용어·벡터·비밀값을 정적 파일로 공개하지 않습니다. `build:static`은 용어·벡터를 의도적으로 포함하고 비밀값은 사용하지 않습니다. 브라우저 기록은 개인 플레이용이며 경쟁 점수의 신뢰 근거로 사용하지 않습니다.

## 출처

- [현재 SchaleDB](https://schaledb.com/)
- [EmbeddingGemma 2 공식 모델 카드](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2?hl=en)
- [React](https://react.dev/) · [Vite](https://vite.dev/)
- [Semantle](https://legacy.semantle.com/)
- [All-but-the-Top: 공통 평균 벡터 제거를 다루는 연구](https://arxiv.org/abs/1702.01417) — 여기서는 평균 제거만 적용하며 상위 주성분을 제거하지 않습니다.
