# Bluemantle

주제를 바꿀 수 있는 의미 기반 단어 추측 게임 API입니다. 사전과 임베딩은 데이터 팩에서 읽습니다.

Node.js 22.12 이상에서 `npm start`로 실행합니다. 기본 주소는 http://127.0.0.1:3000 입니다.
커피 용어 12개의 실제 임베딩이 포함되어 있어 Python이나 모델을 실행하지 않아도 API를 사용할 수 있습니다.

`GET /api/packs`로 주제를 확인하고 `POST /api/games`에 `packId: coffee`와 `mode: daily` 또는 `practice`를 보냅니다.
받은 게임 토큰을 `/api/guess`, `/api/hint`, `/api/restore`, `/api/reveal`에 사용합니다.
일일 문제, 정확한 이름과 별명 판정, 유사도 순위, 힌트와 기록 복원을 지원합니다.

`npm test`로 엔진과 API를 검사하고 `npm run validate`로 데이터 팩의 체크섬을 검증합니다.
`BLUEMANTLE_PACKS_DIR`, `PORT`, `HOST`, `BLUEMANTLE_SECRET`으로 서버를 설정할 수 있습니다.
서버 비밀값은 `.bluemantle/secret`에 보존합니다. 데이터 팩의 모델 설정과 벡터 무결성이 바뀌면 이전 토큰을 거부합니다.
