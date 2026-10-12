import path from 'node:path';
import { loadPack } from '../src/pack.mjs';

const pack = await loadPack(path.resolve(process.argv[2] ?? 'data/packs/blue-archive'));
const raw = [], centered = [];
let seed = 42;
const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return Math.floor(seed / 4294967296 * pack.terms.length); };
for (let i = 0; i < 30000; i++) {
  const a = next(), b = next();
  if (a === b) continue;
  let cosine = 0;
  for (let j = 0; j < pack.dimensions; j++) cosine += pack.vectors[a * pack.dimensions + j] * pack.vectors[b * pack.dimensions + j];
  raw.push(cosine * 100); centered.push(pack.geometry.cosine(a, b) * 100);
}
const quantiles = values => {
  values.sort((a, b) => a - b);
  return Object.fromEntries([10, 25, 50, 75, 90, 99].map(p => [`p${p}`, Number(values[Math.floor((values.length - 1) * p / 100)].toFixed(2))]));
};
console.log(JSON.stringify({ pack: pack.manifest.id, pairs: raw.length, seed: 42, raw: quantiles(raw), centered: quantiles(centered) }, null, 2));
