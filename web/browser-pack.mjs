import { TopicPack } from '../src/topic-pack.mjs';
import { GameError } from '../src/puzzle.mjs';

export async function digest(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function download(url, fetcher) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`Data request failed: ${response.status}`);
  return response.arrayBuffer();
}

export async function loadBrowserPack(entry, base, fetcher = fetch) {
  try {
    const [rawTerms, rawVectors] = await Promise.all([
      download(new URL(entry.terms, base), fetcher), download(new URL(entry.vectors, base), fetcher),
    ]);
    if (await digest(rawTerms) !== entry.termsSha256 || await digest(rawVectors) !== entry.vectorsSha256) throw new Error('Pack checksum mismatch');
    const terms = JSON.parse(new TextDecoder().decode(rawTerms));
    if (rawVectors.byteLength !== terms.length * entry.manifest.embedding.dimensions * 4) throw new Error('Pack shape mismatch');
    const view = new DataView(rawVectors), vectors = new Float32Array(rawVectors.byteLength / 4);
    for (let i = 0; i < vectors.length; i++) vectors[i] = view.getFloat32(i * 4, true);
    const fingerprint = await digest(`${entry.manifest.id}:${entry.manifest.version}:${entry.termsSha256}:${entry.vectorsSha256}`);
    if (fingerprint !== entry.fingerprint) throw new Error('Pack fingerprint mismatch');
    return new TopicPack(entry.manifest, terms, vectors, fingerprint);
  } catch (error) {
    throw Object.assign(new GameError('PACK_LOAD_FAILED', '주제 데이터를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.'), { cause: error });
  }
}
