import { SemanticSpace } from './geometry.mjs';

export const normalize = (value) => value.normalize('NFKC').toLowerCase().replace(/[\s·・._-]+/gu, '');

export function requireValue(condition, message) {
  if (!condition) throw new Error(message);
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
    this.geometry = new SemanticSpace(vectors, this.dimensions);
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

