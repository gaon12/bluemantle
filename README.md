# Bluemantle

React로 만든 의미 기반 단어 추측 게임입니다. 하늘색·흰색 화면과 샬레 메뉴, 헤일로를 모티프로 구성했습니다.
게임 엔진은 주제 데이터 팩을 읽으며 커피 예제 12개 용어로 플레이할 수 있습니다.

Node.js 22.12 이상에서 `npm install` 후 `npm start`를 실행하고 http://127.0.0.1:3000 을 엽니다.
`npm run dev`는 API 서버와 Vite를 실행합니다. 개발 화면은 http://127.0.0.1:5173 입니다.

일일/연습 모드, 가까운 단어 힌트, 정답 확인, 결과 공유와 브라우저 기록 복원을 제공합니다.
`npm test`, `npm run build`, `npm run validate`로 상태·API·빌드·실제 임베딩을 검증합니다.

주제 파일은 `data/packs/<주제>/`에 추가합니다. 서버 설정은 `BLUEMANTLE_PACKS_DIR`, `PORT`, `HOST`, `BLUEMANTLE_SECRET`으로 바꿉니다.

## TXT 사전과 임베딩

`data/packs/coffee/words.txt`에 용어를 한 줄에 하나씩 입력하고 `npm run embed`를 실행합니다.
중복과 등록된 별명을 정리하고 실제 EmbeddingGemma 2 벡터와 체크섬을 저장합니다.
Python 3.11 이상에서 `.venv`를 만들고 `pip install -r requirements-embeddings.txt`로 준비합니다.
`npm run data:dedupe`는 모델 없이 중복만 제거합니다. 변경한 데이터는 서버 재시작 후 반영됩니다.

`examples/coffee/`를 새 팩으로 복사할 수 있습니다. `npm run embed -- examples/coffee`처럼 대상도 지정할 수 있습니다.
`npm run test:data`로 UTF-8 BOM, 띄어쓰기, 별명, 의상 표기와 카탈로그 갱신을 검사합니다.
자세한 형식은 [데이터 팩 안내](docs/data-packs.md)를 참고하세요.
