import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const normalize = (value) => value.normalize('NFKC').toLowerCase().replace(/[\s·・._-]+/gu, '');

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

async function readPackFile(directory, filename) {
  requireValue(typeof filename === 'string' && filename === path.basename(filename) && !filename.includes('\\'), 'Pack files must be direct children of the pack directory');
  const root = await realpath(directory);
  const target = await realpath(path.join(directory, filename));
  requireValue(path.dirname(target) === root, 'Pack file resolves outside its directory');
  return readFile(target);
}

/** Generic, immutable corpus. No game-specific categories or model providers. */
export class TopicPack {
  constructor(manifest, terms, vectors, fingerprint) {
    this.manifest = manifest;
    this.terms = terms;
    this.vectors = vectors;
    this.fingerprint = fingerprint;
    this.dimensions = manifest.embedding.dimensions;
    this.byId = new Map();
    this.byName = new Map();
    this.answerIndices = [];
    requireValue(Array.isArray(terms) && terms.length >= 2, 'A pack needs at least two terms');
    requireValue(vectors.length === terms.length * this.dimensions, 'Embedding matrix shape mismatch');
    terms.forEach((term, index) => {
      requireValue(typeof term.id === 'string' && term.id.length > 0 && !this.byId.has(term.id), 'Term IDs must be unique, nonempty strings');
      requireValue(typeof term.label === 'string' && normalize(term.label).length > 0 && term.label.length <= 120, 'Invalid term label');
      requireValue(typeof term.description === 'string' && term.description.length > 0, `Missing description: ${term.id}`);
      requireValue(typeof term.category === 'string' && Object.hasOwn(manifest.categories, term.category), `Undeclared category: ${term.category}`);
      requireValue(term.aliases === undefined || (Array.isArray(term.aliases) && term.aliases.every(a => typeof a === 'string' && normalize(a).length > 0)), `Invalid aliases: ${term.id}`);
      requireValue(term.answer === undefined || typeof term.answer === 'boolean', `Invalid answer flag: ${term.id}`);
      this.byId.set(term.id, index);
      for (const name of [term.label, ...(term.aliases ?? [])]) {
        const key = normalize(name);
        requireValue(!this.byName.has(key) || this.byName.get(key) === index, `Ambiguous label/alias: ${name}`);
        this.byName.set(key, index);
      }
      if (term.answer !== false) this.answerIndices.push(index);
      let magnitude = 0;
      for (let j = 0; j < this.dimensions; j++) {
        const component = vectors[index * this.dimensions + j];
        requireValue(Number.isFinite(component), `Nonfinite vector: ${term.id}`);
        magnitude += component * component;
      }
      requireValue(magnitude > 1e-12, `Zero vector: ${term.id}`);
      const norm = Math.sqrt(magnitude);
      for (let j = 0; j < this.dimensions; j++) vectors[index * this.dimensions + j] /= norm;
    });
    requireValue(this.answerIndices.length >= 2, 'A pack needs at least two answer-eligible terms');
  }

  resolve(word) { return this.byName.get(normalize(word)); }

  publicInfo() {
    const categoryCounts = {};
    for (const term of this.terms) categoryCounts[term.category] = (categoryCounts[term.category] ?? 0) + 1;
    return {
      id: this.manifest.id, name: this.manifest.name, version: this.manifest.version,
      description: this.manifest.description, timezone: this.manifest.timezone,
      accent: this.manifest.theme?.accent ?? '#2563eb',
      termCount: this.terms.length, categories: this.manifest.categories, categoryCounts,
      examples: this.manifest.examples ?? [], ready: true,
      dataAsOf: this.manifest.dataAsOf ?? null,
    };
  }
}

export async function loadPack(directory) {
  const manifest = JSON.parse(await readPackFile(directory, 'manifest.json'));
  requireValue(manifest.schemaVersion === 1, 'Unsupported pack schema version');
  requireValue(typeof manifest.id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id), 'Invalid pack ID');
  for (const key of ['name', 'version', 'description', 'locale', 'timezone']) requireValue(typeof manifest[key] === 'string' && manifest[key].length > 0, `Missing manifest ${key}`);
  new Intl.DateTimeFormat(manifest.locale, { timeZone: manifest.timezone });
  requireValue(manifest.categories && typeof manifest.categories === 'object' && !Array.isArray(manifest.categories) && Object.values(manifest.categories).every(v => typeof v === 'string'), 'Invalid categories');
  const embedding = manifest.embedding;
  requireValue(embedding && Number.isInteger(embedding.dimensions) && embedding.dimensions > 0 && embedding.dimensions <= 16384, 'Invalid embedding dimensions');
  requireValue(['name', 'name-description'].includes(embedding.inputMode), 'Invalid embedding input mode');
  requireValue(typeof embedding.model === 'string' && typeof embedding.prompt === 'string', 'Missing embedding model/prompt');
  requireValue(!manifest.theme?.accent || /^#[0-9a-f]{6}$/i.test(manifest.theme.accent), 'Accent must be a six-digit hex color');
  requireValue(!manifest.examples || (Array.isArray(manifest.examples) && manifest.examples.every(v => typeof v === 'string')), 'Invalid examples');
  const rawTerms = await readPackFile(directory, manifest.terms);
  const terms = JSON.parse(rawTerms);
  const index = JSON.parse(await readPackFile(directory, manifest.embeddings));
  requireValue(index.schemaVersion === 1 && index.dtype === 'float32-le', 'Unsupported embedding format');
  requireValue(index.termsSha256 === sha256(rawTerms), 'Terms changed; rebuild embeddings');
  if (manifest.vocabulary) requireValue(index.vocabularySha256 === sha256(await readPackFile(directory, manifest.vocabulary)), 'TXT vocabulary changed; rebuild embeddings');
  for (const key of ['model', 'prompt', 'inputMode', 'dimensions']) requireValue(index[key] === embedding[key], `Embedding configuration changed (${key}); rebuild embeddings`);
  requireValue((index.revision ?? null) === (embedding.revision ?? null), 'Embedding model revision changed; rebuild embeddings');
  requireValue(index.maxTokens === (embedding.maxTokens ?? 512), 'Embedding context configuration changed; rebuild embeddings');
  requireValue(Array.isArray(terms) && Array.isArray(index.ids) && index.ids.length === terms.length && index.ids.every((id, i) => id === terms[i].id), 'Embedding row order does not match terms');
  const bytes = await readPackFile(directory, index.file);
  requireValue(bytes.length === terms.length * index.dimensions * 4, 'Embedding byte length mismatch');
  requireValue(index.vectorsSha256 === sha256(bytes), 'Embedding file checksum mismatch');
  const vectors = new Float32Array(bytes.length / 4);
  for (let i = 0; i < vectors.length; i++) vectors[i] = bytes.readFloatLE(i * 4);
  return new TopicPack(manifest, terms, vectors, sha256(`${manifest.id}:${manifest.version}:${index.termsSha256}:${index.vectorsSha256}`));
}

export async function loadPacks(root, log = console.error) {
  const packs = new Map();
  const unavailable = [];
  const directories = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  for (const directory of directories) {
    try {
      const pack = await loadPack(path.join(root, directory.name));
      requireValue(!packs.has(pack.manifest.id), 'Duplicate pack ID');
      packs.set(pack.manifest.id, pack);
    } catch (error) {
      log(`Pack ${directory.name}: ${error.message}`);
      unavailable.push({ id: directory.name, name: directory.name, ready: false });
    }
  }
  return { packs, unavailable };
}
