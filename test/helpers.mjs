import { TopicPack, sha256 } from '../src/pack.mjs';

export function fixturePack(id = 'fruit') {
  return new TopicPack({
    schemaVersion: 1, id, name: id, version: '1', description: 'Test topic',
    timezone: 'Asia/Seoul', locale: 'ko-KR', categories: { fruit: '과일', food: '음식' },
    embedding: { dimensions: 3, model: 'test-only', prompt: 'SentenceSimilarity', inputMode: 'name-description' },
  }, [
    { id: 'apple', label: '사과', aliases: ['apple', '애플'], description: '붉은 과일', category: 'fruit' },
    { id: 'pear', label: '배', description: '달콤한 과일', category: 'fruit' },
    { id: 'bread', label: '빵', description: '곡물로 만든 음식', category: 'food' },
    { id: 'juice', label: '사과 주스', aliases: ['사과쥬스'], description: '과일 음료', category: 'food', answer: false },
  ], new Float32Array([1, 0, 0, .8, .6, 0, 0, 0, 1, .98, .2, 0]), sha256(id));
}
