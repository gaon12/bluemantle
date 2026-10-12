import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPacks } from '../src/pack.mjs';

const root = process.argv[2] ?? fileURLToPath(new URL('../data/packs', import.meta.url));
const { packs, unavailable } = await loadPacks(path.resolve(root));
for (const pack of packs.values()) console.log(`${pack.manifest.id}: ${pack.terms.length} terms, ${pack.answerIndices.length} eligible answers, ${pack.dimensions} dimensions; verified`);
if (unavailable.length || !packs.size) process.exitCode = 1;
