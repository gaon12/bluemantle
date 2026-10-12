# Bluemantle

React로 만든 의미 기반 단어 추측 게임입니다. 블루 아카이브의 하늘색·흰색, 샬레 메뉴, 헤일로와 임무 패널을 모티프로 사용합니다. 게임 엔진과 임베딩 모듈은 범용이며 주제별 데이터 팩을 교체할 수 있습니다.

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

제공된 기본 사전은 **2026-10-12에 수집한 3,886개 블루 아카이브 용어**입니다. 기본 수집 범위는 글로벌 서버 출시 기준이며, 학생·학원·동아리·아이템·장비·가구·스킬·고유무기·이벤트와 직접 작성한 세계관 용어를 포함합니다.

```powershell
npm run data:update
npm run embed
```

`data:update`는 운영 중인 서비스의 `*.min.json`을 새로 수집합니다. 2025년 보관 저장소를 기본으로 사용하지 않습니다. 원본 URL, 수집 시각과 해시는 `sources.json`에 저장됩니다. `catalog.json`에 최신 설명과 별명을 보관하고 `words.txt`에 새 용어를 추가하며, 직접 작성한 기존 TXT 단어는 보존합니다. 사전은 계속 확장할 수 있으며 게임의 모든 대사 속 단어까지 수집했다는 의미는 아닙니다.

네트워크 없이 이미 받은 수집 자료를 다시 처리하려면 `npm run data:update -- --offline`을 사용합니다. 이 경우 데이터 기준 날짜는 캐시의 실제 수집 시각을 사용합니다. 일본 서버 등 미출시 항목까지 수집하려면 `--include-unreleased`를 지정할 수 있습니다.

게임 텍스트와 데이터의 권리는 해당 권리자에게 있으며 엔진의 MIT 라이선스와 별개입니다.

## 구성

| 위치 | 역할 |
| --- | --- |
| `web/src/` | React 화면과 블루 아카이브를 모티프로 한 스타일 |
| `web/game-store.mjs` | 화면 상태, API 연결, 기록 복원 |
| `src/pack.mjs` | 주제에 독립적인 데이터 팩 및 벡터 검증 |
| `src/game.mjs` | 코사인 유사도, 순위, 일일/연습 문제, 힌트 |
| `src/server.mjs` | API와 빌드된 React 파일 제공 |
| `scripts/vocabulary.py` | TXT 정규화, 별명 통합, 중복 제거 |
| `scripts/build-embeddings.py` | 범용 TXT → 임베딩 생성 모듈 |
| `scripts/import-blue-archive.py` | 최신 블루 아카이브 데이터 수집기 |
| `data/packs/blue-archive/words.txt` | 직접 편집하는 용어 사전 |
| `examples/coffee/` | 다른 주제를 위한 완성 예시 팩 |

새 주제는 커피 팩을 복사해 이름과 TXT를 바꾸면 됩니다. 범주나 임베딩 모델도 팩에서 설정할 수 있습니다. 자세한 규격은 [데이터 팩 안내](docs/data-packs.md)에 있습니다.

## 검증

```powershell
npm run build
npm test
npm run test:data
npm run validate
```

React 빌드, 엔진/API/화면 상태 테스트, Python TXT 중복 제거 테스트, 실제 임베딩 무결성 검증을 제공합니다. TXT·설명·모델 설정이 바뀐 뒤 임베딩을 갱신하지 않으면 서버가 해당 팩을 거부합니다.

## 플레이와 운영

일일 문제, 무작위 연습, 가까운 단어 힌트, 정답 확인, 결과 공유, 주제별 브라우저 기록 저장을 지원합니다. 정확한 표준 이름 또는 별명만 정답으로 인정합니다.

기본 팩의 일일 문제는 `Asia/Seoul` 자정에 바뀌고, 같은 서버에서는 모든 사용자가 같은 문제를 풉니다. 서버 비밀값은 `.bluemantle/secret`에 보존합니다. 여러 서버에서 같은 일일 문제를 제공하려면 `BLUEMANTLE_SECRET`을 동일하게 설정합니다.

`BLUEMANTLE_PACKS_DIR`, `PORT`, `HOST`로 팩 루트와 주소를 변경할 수 있습니다. 용어·벡터·비밀값을 정적 파일로 공개하지 않습니다. 브라우저 기록은 개인 플레이용이며 경쟁 점수의 신뢰 근거로 사용하지 않습니다.

## 출처

- [현재 SchaleDB](https://schaledb.com/)
- [EmbeddingGemma 2 공식 모델 카드](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2?hl=en)
- [React](https://react.dev/) · [Vite](https://vite.dev/)
- [Semantle](https://legacy.semantle.com/)
