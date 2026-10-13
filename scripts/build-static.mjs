import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { loadPacks } from '../src/pack.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = process.argv.find(arg => arg.startsWith('--base='))?.slice(7) ?? process.env.PAGES_BASE_PATH ?? '/';
if (!/^\/(?:[a-zA-Z0-9._~-]+\/)*$/.test(base)) throw new Error('Base must be a path starting and ending with /, such as /bluemantle/');
const packRoot = path.resolve(process.env.BLUEMANTLE_PACKS_DIR ?? path.join(root, 'data/packs'));
const { packs, unavailable } = await loadPacks(packRoot);
if (unavailable.length || !packs.size) throw new Error('Every published pack must pass validation; rebuild missing or stale embeddings');
const sources = new Map();
for (const directory of await readdir(packRoot, { withFileTypes: true })) {
  if (!directory.isDirectory()) continue;
  const source = path.join(packRoot, directory.name);
  const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
  sources.set(manifest.id, source);
}

process.env.VITE_STATIC_GAME = 'true';
await build({ root: path.join(root, 'web'), base, build: { outDir: path.join(root, 'dist'), emptyOutDir: true } });
const catalog = { schemaVersion: 1, packs: [] };
for (const pack of packs.values()) {
  const manifest = pack.manifest, source = sources.get(manifest.id);
  const index = JSON.parse(await readFile(path.join(source, manifest.embeddings), 'utf8'));
  const directory = `packs/${manifest.id}-${pack.fingerprint.slice(0, 16)}`;
  const target = path.join(root, 'dist', directory);
  await mkdir(target, { recursive: true });
  // Publish only the current, verified terms and vector file, never the source tree.
  await copyFile(path.join(source, manifest.terms), path.join(target, 'terms.json'));
  await copyFile(path.join(source, index.file), path.join(target, index.file));
  catalog.packs.push({ manifest, info: pack.publicInfo(), fingerprint: pack.fingerprint,
    terms: `${directory}/terms.json`, termsSha256: index.termsSha256,
    vectors: `${directory}/${index.file}`, vectorsSha256: index.vectorsSha256 });
  console.log(`Published ${manifest.id}: ${pack.terms.length} terms, ${pack.dimensions} dimensions`);
}
await mkdir(path.join(root, 'dist/packs'), { recursive: true });
await writeFile(path.join(root, 'dist/packs/catalog.json'), JSON.stringify(catalog));
await writeFile(path.join(root, 'dist/.nojekyll'), '');
