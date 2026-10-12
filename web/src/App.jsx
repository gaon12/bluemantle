import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { gameStore, isFinished } from '../game-store.mjs';

const iconPaths = {
  home: 'M3 10 12 3l9 7M5 9v11h5v-6h4v6h5V9',
  target: 'M21 12a9 9 0 1 1-9-9M21 3l-9 9m9-9v6m0-6h-6M16 12a4 4 0 1 1-4-4',
  book: 'M3 4h7a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H3V4Zm18 0h-5a3 3 0 0 0-3 3m0 14a4 4 0 0 1 4-3h4V4Z',
  help: 'M9 8a3 3 0 1 1 4 3c-1 .5-1 1-1 3m0 3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  arrow: 'M4 12h15m-6-6 6 6-6 6',
  spark: 'm12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z',
  layers: 'm12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5',
  flag: 'M5 21V3m0 0h14l-3 5 3 5H5',
  check: 'm5 12 4 4L19 6',
};
function Icon({ name, size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPaths[name] ?? iconPaths.spark} /></svg>;
}
function HaloMark() {
  return <svg className="halo-mark" viewBox="0 0 80 80" aria-hidden="true"><ellipse cx="40" cy="17" rx="25" ry="8" fill="none" stroke="currentColor" strokeWidth="3" /><path d="M22 59V34l18 12 18-12v25M40 46v20" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" /><path d="m8 48 5 3m54 0 5-3" stroke="currentColor" strokeWidth="2" /></svg>;
}
function SkyScene() {
  return <div className="sky-scene" aria-hidden="true"><div className="sky-halo" /><div className="sky-cloud cloud-one" /><div className="sky-cloud cloud-two" /><svg className="skyline" viewBox="0 0 1400 300" preserveAspectRatio="none"><path fill="currentColor" d="M0 300V186h40v-36h20v36h54v-72h25V88h17v26h26v82h51v-55h55v20h31v-42h52v-31h16v31h55v62h55V134h30v-65h8v-25h6v25h8v65h31v83h54v-43h59V87h14V51h8v36h15v139h30v-54h91v27h25V155h37v-43h16v43h48v-27h29v-23h20v23h33v85h49v-47h31V93h28V75h15v18h35v149h32V156h49v-27h62v71h32v-85h19V55h6V17h5v38h8v60h20v151h33v-75h43v-44h33v44h26v-77h40v67h31v-32h35v67h50V300Z" /></svg><div className="scene-grid" /></div>;
}
function Modal({ open, onClose, title, eyebrow, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (open && !ref.current.open) ref.current.showModal();
    if (!open && ref.current.open) ref.current.close();
  }, [open]);
  return <dialog ref={ref} className="modal" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="modal-heading"><span className="micro-label">{eyebrow}</span><button type="button" className="icon-button" aria-label="닫기" onClick={onClose}>×</button></div>
    <h2>{title}</h2>{children}
  </dialog>;
}
function History({ guesses, sort }) {
  const rows = useMemo(() => guesses.map((guess, index) => ({ ...guess, attempt: index + 1 })).sort(sort === 'rank' ? (a, b) => a.rank - b.rank : (a, b) => b.attempt - a.attempt), [guesses, sort]);
  return <section className="history-section" aria-label="추측 기록">
    <div className="section-heading"><h2><span className="small-square" />추측 기록 <span className="number-badge">{guesses.length}</span></h2><button className="plain-button sort-button" onClick={() => gameStore.toggleSort()}>{sort === 'rank' ? '가까운 순서' : '최근 추측 순서'} <span aria-hidden="true">↓</span></button></div>
    {rows.length ? <div className="table-scroll"><table><caption className="sr-only">추측한 단어와 유사도, 가까운 순위</caption><thead><tr><th>시도</th><th>단어</th><th>유사도</th><th>가까운 순위</th></tr></thead><tbody>{rows.map(guess => <tr key={guess.id} className={guess.correct ? 'correct-row' : guess.attempt === guesses.length ? 'latest-row' : ''}>
      <td className="attempt-cell">{String(guess.attempt).padStart(2, '0')}</td>
      <td className="word-cell">{guess.word}{guess.hint && <span className="hint-badge">힌트</span>}</td>
      <td><div className={`similarity ${guess.rank <= 10 ? 'hot' : guess.rank <= 100 ? 'warm' : ''}`}><strong>{guess.similarity.toFixed(2)}</strong><span className="similarity-track" aria-hidden="true"><span style={{ width: `${Math.max(0, guess.similarity)}%` }} /></span></div></td>
      <td className="rank-cell">{guess.correct && <Icon name="check" size={13} />}{guess.rank.toLocaleString('ko-KR')}<small>위</small></td>
    </tr>)}</tbody></table></div> : <div className="empty-history"><div className="empty-halo"><Icon name="spark" size={34} /></div><h3>첫 번째 연결을 기다리고 있어요.</h3><p>아는 단어에서 시작해, 새로운 연결을 찾아보세요.</p><span className="empty-dots" aria-hidden="true">· · ·</span></div>}
  </section>;
}

export default function App() {
  const state = useSyncExternalStore(gameStore.subscribe, gameStore.getSnapshot);
  const [guess, setGuess] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [revealOpen, setRevealOpen] = useState(false);
  const input = useRef(null);
  const { game, guesses, busy, answer } = state;
  const pack = game?.pack;
  const finished = isFinished(state);
  const disabled = busy || !game || finished || state.expired;
  const best = useMemo(() => guesses.reduce((result, item) => !result || item.rank < result.rank ? item : result, null), [guesses]);
  const mode = game?.mode ?? 'daily';
  useEffect(() => { gameStore.initialize(); const timer = setInterval(() => gameStore.tick(), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (pack) document.title = `Bluemantle · ${pack.name}`; setGuess(''); }, [game?.puzzleId]);
  async function submit(event) { event.preventDefault(); if (await gameStore.submit(guess)) setGuess(''); input.current?.focus(); }
  function changeMode(next) { if (!busy && pack && mode !== next) gameStore.begin(pack.id, next); }
  async function share() {
    try { await navigator.clipboard.writeText(gameStore.shareText(location.origin)); gameStore.message('정답을 숨긴 결과를 복사했어요.', 'success'); }
    catch { gameStore.message('이 브라우저에서는 결과를 복사할 수 없어요.', 'error'); }
  }

  return <div className="app-shell" style={{ '--pack-accent': pack?.accent ?? '#00a8e8' }}>
    <SkyScene />
    <header className="top-hud">
      <a className="brand" href="/" aria-label="Bluemantle 처음으로"><HaloMark /><div><strong>Blue<span>mantle</span><span className="brand-cross">✦</span></strong><small>WORDS CONNECT US.</small></div></a>
      <div className="hud-items"><div className="hud-chip vocabulary-chip"><span className="hud-icon"><Icon name="layers" size={19} /></span><div><small>등록된 용어</small><strong>{pack ? pack.termCount.toLocaleString('ko-KR') : '—'}</strong></div></div><div className="hud-chip countdown-chip"><span className="hud-icon"><Icon name="clock" size={19} /></span><div><small>{mode === 'daily' ? '다음 문제까지' : '연습 모드'}</small><strong>{state.countdown}</strong></div></div><button className="help-button" type="button" onClick={() => setHelpOpen(true)} aria-label="게임 방법"><Icon name="help" size={22} /></button></div>
    </header>
    <main className="workspace">
      <aside className="navigation">
        <div className="network-label"><span />SCHALE NETWORK</div>
        <nav aria-label="게임 모드"><button type="button" className={`nav-tab ${mode === 'daily' ? 'selected' : ''}`} onClick={() => changeMode('daily')} disabled={busy} aria-pressed={mode === 'daily'}><Icon name="home" /><span>오늘의 문제<small>DAILY CHALLENGE</small></span><span className="nav-arrow">›</span></button><button type="button" className={`nav-tab ${mode === 'practice' ? 'selected' : ''}`} onClick={() => changeMode('practice')} disabled={busy} aria-pressed={mode === 'practice'}><Icon name="target" /><span>연습 모드<small>FREE PRACTICE</small></span><span className="nav-arrow">›</span></button><button type="button" className="nav-tab" onClick={() => setHelpOpen(true)}><Icon name="book" /><span>게임 가이드<small>HOW TO PLAY</small></span><span className="nav-arrow">›</span></button></nav>
        <div className="topic-selector"><label htmlFor="topic">연결할 세계</label><select id="topic" aria-label="게임 주제" value={pack?.id ?? ''} disabled={busy || !state.packs.length} onChange={event => gameStore.begin(event.target.value, mode)}>{state.packs.length ? state.packs.map(item => <option key={item.id} value={item.id}>{item.name}</option>) : <option value="">불러오는 중</option>}</select><span className="topic-selector-caption">한 단어에서, 하나의 세계로.</span></div>
        <div className="nav-decoration" aria-hidden="true"><HaloMark /><span>S.C.H.A.L.E</span><small>CONNECTION TERMINAL / 01</small></div>
        {pack?.dataAsOf && <span className="data-date">데이터 기준 {pack.dataAsOf.replaceAll('-', '.')}</span>}
      </aside>

      <section className="game-column">
        <div className="page-heading"><div><span className="eyebrow"><span className="cyan-diamond" />{mode === 'daily' ? 'DAILY WORD CONNECTION' : 'PRACTICE WORD CONNECTION'}</span><h1>{mode === 'daily' ? '오늘의 단어 추측' : '새로운 연결 찾기'}<span className="title-square" /></h1><p>{pack?.name ?? '새로운 세계'}의 연결을 따라, 숨겨진 단어를 찾아보세요.</p></div><span className="heading-date">{game?.date.replaceAll('-', '.')}<small>{mode === 'daily' ? 'DAILY MISSION' : 'FREE MISSION'}</small></span></div>
        <section className="mission-panel" aria-label="단어 추측 게임">
          <div className="panel-heading"><span className="mission-badge">{mode === 'daily' ? 'DAILY' : 'PRACTICE'}</span><span>단어 연결 작전</span><span className="panel-status"><span />{finished ? 'COMPLETE' : 'IN PROGRESS'}</span></div>
          <div className="mission-content">
            <div className="stats-row"><div className="stat-box"><span className="stat-symbol"><Icon name="flag" size={23} /></span><div><span className="stat-label">나의 추측</span><strong>{guesses.length}<small>회</small></strong></div></div><div className="stat-box"><span className="stat-symbol"><Icon name="target" size={23} /></span><div><span className="stat-label">가장 가까운 순위</span><strong>{best ? best.rank.toLocaleString('ko-KR') : '—'}{best && <small>위</small>}</strong></div></div><div className="best-connection"><span className="stat-label">가장 가까운 연결</span><strong>{best?.word ?? '첫 추측을 기다려요'}</strong>{best && <small>유사도 {best.similarity.toFixed(2)}</small>}</div></div>
            <form id="guess-form" onSubmit={submit}><label htmlFor="guess">선생님, 어떤 단어가 떠오르나요?</label><div className="guess-input-row"><span className="input-icon"><Icon name="spark" size={20} /></span><input ref={input} id="guess" value={guess} onChange={event => setGuess(event.target.value)} maxLength={120} placeholder="떠오르는 단어를 입력하세요" autoComplete="off" spellCheck="false" disabled={disabled} /><button type="submit" className="action-button primary" disabled={disabled}><span>{busy ? '확인 중' : '추측하기'}</span><Icon name="arrow" size={19} /></button></div></form>
            <p className={`status-message ${state.statusKind}`} role="status" aria-live="polite">{state.statusKind === 'success' ? <Icon name="check" size={15} /> : <span className="message-dot" />}{state.status}</p>
            {state.fatal && <button className="action-button secondary" onClick={() => gameStore.initialize()}>다시 연결하기</button>}
            {state.expired && <button className="action-button primary new-day" onClick={() => gameStore.begin(pack.id, 'daily')} disabled={busy}>오늘의 새 문제 시작하기<Icon name="arrow" size={18} /></button>}
            {answer && <div className="result-panel"><div className="result-top"><Icon name={state.gaveUp ? 'book' : 'check'} size={20} /><span>{state.gaveUp ? 'CONNECTION REVEALED' : 'MISSION COMPLETE'}</span></div><h2>{answer.word}{!state.gaveUp && <span>, 찾았어요!</span>}</h2><p>{answer.description}</p><div className="result-actions"><button className="action-button primary" onClick={share}>결과 공유하기<Icon name="arrow" size={17} /></button><button className="action-button secondary" disabled={busy} onClick={() => gameStore.begin(pack.id, 'practice', true)}>{mode === 'daily' ? '연습 문제 풀기' : '다른 문제 풀기'}</button></div></div>}
            {guesses.length === 0 && !finished && pack?.examples.length > 0 && <div className="starter-words"><span>이런 단어로 시작해 보세요</span>{pack.examples.map(word => <button key={word} type="button" disabled={disabled} onClick={() => { setGuess(word); input.current?.focus(); }}>{word}<span>+</span></button>)}</div>}
            <History guesses={guesses} sort={state.sort} />
            <div className="panel-actions"><button type="button" className="action-button hint-button" disabled={disabled} onClick={() => gameStore.hint()}><Icon name="spark" size={17} />가까운 단어 힌트{guesses.some(g => g.hint) && <span className="hint-count">{guesses.filter(g => g.hint).length}</span>}</button><button type="button" className="plain-button reveal-button" disabled={disabled} onClick={() => setRevealOpen(true)}>정답 확인<span aria-hidden="true">›</span></button></div>
          </div>
        </section>
      </section>

      <aside className="support-column">
        <div className="assistant-card"><div className="assistant-heading"><span className="assistant-status" /><span>CONNECTION GUIDE</span><Icon name="spark" size={16} /></div><div className="assistant-art" aria-hidden="true"><div className="assistant-orbit" /><HaloMark /><div className="art-lines" /><span className="art-cross">✦</span><span className="art-coordinate">NO LIMIT TO CONNECTIONS.</span></div><div className="speech-box"><strong>선생님, 준비되셨나요?</strong><p>단어와 단어 사이에 숨어 있는<br />연결을 함께 찾아봐요!</p></div></div>
        <section className="guide-panel"><div className="section-heading"><h2><span className="small-square" />작전 안내</h2><span className="guide-number">01</span></div><ol><li><span>1</span><div><strong>단어를 추측해요</strong><p>이름, 장소, 사물, 개념까지.<br />주제에 속한 단어를 입력하세요.</p></div></li><li><span>2</span><div><strong>유사도와 순위를 확인해요</strong><p>유사도가 높고 순위가 낮을수록<br />정답과 의미가 가까워요.</p></div></li><li><span>3</span><div><strong>새로운 연결을 찾아요</strong><p>가까운 단어에서 연상을 이어가면<br />정답에 다가갈 수 있어요.</p></div></li></ol></section>
        <section className="world-panel"><div className="section-heading"><h2><span className="small-square" />{pack?.name ?? '오늘의 세계'}</h2><Icon name="layers" size={17} /></div><div className="category-tags">{pack && Object.entries(pack.categories).filter(([id]) => pack.categoryCounts[id]).map(([id, label]) => <span key={id}>{label}</span>)}</div><p>매일 같은 문제를 함께 풀어요.<br />나만의 연결을 발견해 보세요.</p></section>
      </aside>
    </main>
    <footer><span><span className="footer-dot" />ALL CONNECTIONS ARE POSSIBLE.</span><small>Bluemantle · Inspired by Semantle</small></footer>

    <Modal open={helpOpen} onClose={() => setHelpOpen(false)} eyebrow="OPERATION GUIDE" title="의미로 찾는 오늘의 단어"><p>숨겨진 정답 하나를 찾는 게임이에요. 단어를 입력하면 정답과의 유사도와 사전 안에서의 순위를 알려줘요.</p><p><strong>유사도</strong>는 −100부터 100 사이의 의미적 가까움이에요. 확률을 뜻하지 않아요. <strong>순위</strong>는 낮을수록 가깝고, 정답은 1위예요.</p><p>등록된 별명과 띄어쓰기 변형도 사용할 수 있어요. 힌트는 지금까지의 추측보다 가까운 단어를 보여줘요.</p><p>오늘의 문제는 주제의 시간대 자정에 바뀌어요. 기록은 이 브라우저에 저장되고 주제와 모드마다 따로 이어서 풀 수 있어요.</p><button className="action-button primary" onClick={() => setHelpOpen(false)}>작전 시작<Icon name="arrow" size={18} /></button></Modal>
    <Modal open={revealOpen} onClose={() => setRevealOpen(false)} eyebrow="REVEAL CONNECTION" title="정답을 확인할까요?"><p>이번 문제를 마치고 정답과 설명을 볼 수 있어요.</p><div className="modal-actions"><button className="action-button secondary" onClick={() => setRevealOpen(false)}>계속 풀기</button><button className="action-button primary" onClick={() => { setRevealOpen(false); gameStore.reveal(); }}>정답 확인하기<Icon name="arrow" size={18} /></button></div></Modal>
  </div>;
}
