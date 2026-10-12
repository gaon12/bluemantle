import { useMemo, useState } from 'react';
import { gameStore } from '../game-store.mjs';
import { projectConnections } from '../connection-map.mjs';

const tone = score => score >= 50 ? 'close' : score > 10 ? 'related' : score >= -10 ? 'neutral' : 'distant';

export default function ExplorationMap({ guesses, connections, error }) {
  const [selection, setSelection] = useState(null);
  const projection = useMemo(() => connections ? projectConnections(connections.similarities) : null, [connections]);
  if (guesses.length < 2) return <p className="map-invitation">단어를 두 개 이상 입력하면 탐색 지도가 열려요.</p>;
  if (!connections) return <div className="map-invitation">{error ? <><span>탐색 지도를 불러오지 못했어요. 추측 기록은 저장됐어요.</span><button className="plain-button" onClick={() => gameStore.loadConnections()}>지도 다시 불러오기</button></> : '단어 사이의 연결을 확인하고 있어요.'}</div>;
  const guessesById = new Map(guesses.map((guess, index) => [guess.id, { ...guess, attempt: index + 1 }]));
  const words = connections.ids.map(id => guessesById.get(id));
  const selected = Math.max(0, connections.ids.indexOf(connections.ids.includes(selection) ? selection : connections.ids.at(-1)));
  const current = words[selected];
  const peers = words.map((guess, i) => ({ ...guess, i, connection: connections.similarities[selected][i] })).filter(g => g.i !== selected).sort((a, b) => b.connection - a.connection || a.attempt - b.attempt);
  const neighbors = peers.slice(0, 3);
  const alternate = [...peers].filter(g => Math.abs(g.similarity - current.similarity) <= 5 && g.connection < 20).sort((a, b) => a.connection - b.connection)[0];
  const positions = projection.points.map(([x, y]) => [50 + 39 * x, 50 + 39 * y]);
  return <section className="exploration-section" aria-label="탐색 지도">
    <div className="section-heading"><h2><span className="small-square" />탐색 지도 <span className="number-badge">{words.length}</span></h2><span className="map-eyebrow">WORD CONNECTIONS</span></div>
    <p className="map-description">점수는 정답과의 가까움, 위치는 추측한 단어끼리의 관계예요.</p>
    <div className="exploration-body">
      <div className="map-canvas" role="group" aria-label="추측한 단어의 관계 지도">
        <div className="map-plane">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path className="map-grid" d="M25 0V100M50 0V100M75 0V100M0 25H100M0 50H100M0 75H100" />{neighbors.filter(g => g.connection > 0).map(g => <line className="map-link" key={g.id} x1={positions[selected][0]} y1={positions[selected][1]} x2={positions[g.i][0]} y2={positions[g.i][1]} />)}</svg>
        {words.map((word, i) => <button type="button" key={word.id} className={`map-node ${tone(word.similarity)} ${i === selected ? 'selected' : ''}`} style={{ left: `${positions[i][0]}%`, top: `${positions[i][1]}%` }} aria-label={`${word.attempt}번 ${word.word}, 정답 유사도 ${word.similarity.toFixed(2)}`} aria-pressed={i === selected} title={`${word.word} · ${word.similarity.toFixed(2)}`} onClick={() => setSelection(word.id)}>{word.attempt}</button>)}
        </div>
        <span className="map-watermark" aria-hidden="true">SCHALE / EXPLORATION</span>
      </div>
      <div className="map-details">
        <label htmlFor="connection-word">비교할 추측</label><select id="connection-word" value={current.id} onChange={event => setSelection(event.target.value)}>{words.map(word => <option key={word.id} value={word.id}>{word.attempt}. {word.word}</option>)}</select>
        <div className="map-selected-score"><span>정답 유사도</span><strong>{current.similarity.toFixed(2)}</strong><small>{current.rank.toLocaleString('ko-KR')}위</small></div>
        <h3>이 추측과 연결된 단어</h3><ul className="connection-peers">{neighbors.map(word => <li key={word.id}><button onClick={() => setSelection(word.id)}><span>{word.word}</span><strong>{word.connection.toFixed(2)}</strong></button></li>)}</ul>
        <p className="peer-caption">오른쪽 수치는 선택한 추측과의 유사도예요. 음수는 반의어를 뜻하지 않아요.</p>
      </div>
    </div>
    {alternate && <p className="alternate-connection"><strong>비슷한 점수, 다른 연결</strong><span>{current.word}({current.similarity.toFixed(2)}) · {alternate.word}({alternate.similarity.toFixed(2)})</span><small>두 추측 간 유사도 {alternate.connection.toFixed(2)}. 서로 다른 연결을 탐색해 보세요.</small></p>}
    <div className="map-legend"><span className="distant">낮음</span><span className="neutral">0 근처</span><span className="related">10 초과</span><span className="close">50 이상</span><small>색 = 정답 유사도</small></div>
    <p className="map-footnote">입력한 단어만 2차원으로 펼친 참고 지도예요. 새 추측에 따라 배치가 바뀌고, 실제 관계의 일부만 보여줘요(분산 {Math.round(projection.coverage * 100)}% 반영). 정답 위치는 표시하지 않아요.{guesses.length > words.length && ' 최근 16개와 가까운 추측을 합쳐 최대 32개를 표시해요.'}</p>
  </section>;
}
