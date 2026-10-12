# Bluemantle

React로 만든 의미 기반 단어 추측 게임입니다. 하늘색·흰색 화면과 샬레 메뉴, 헤일로를 모티프로 구성했습니다.
게임 엔진은 주제 데이터 팩을 읽으며 커피 예제 12개 용어로 플레이할 수 있습니다.

Node.js 22.12 이상에서 `npm install` 후 `npm start`를 실행하고 http://127.0.0.1:3000 을 엽니다.
`npm run dev`는 API 서버와 Vite를 실행합니다. 개발 화면은 http://127.0.0.1:5173 입니다.

일일/연습 모드, 가까운 단어 힌트, 정답 확인, 결과 공유와 브라우저 기록 복원을 제공합니다.
`npm test`, `npm run build`, `npm run validate`로 상태·API·빌드·실제 임베딩을 검증합니다.

주제 파일은 `data/packs/<주제>/`에 추가합니다. 서버 설정은 `BLUEMANTLE_PACKS_DIR`, `PORT`, `HOST`, `BLUEMANTLE_SECRET`으로 바꿉니다.
