export const SCORING_VERSION = 'corpus-centered-v1';
export const MAX_CONNECTION_WORDS = 32;

/** Remove the corpus mean before measuring angles. Raw model vectors stay intact. */
export class SemanticSpace {
  constructor(vectors, dimensions) {
    this.dimensions = dimensions;
    const count = vectors.length / dimensions;
    const mean = new Float64Array(dimensions);
    for (let i = 0; i < vectors.length; i++) mean[i % dimensions] += vectors[i] / count;
    this.vectors = new Float32Array(vectors.length);
    for (let row = 0; row < count; row++) {
      const offset = row * dimensions;
      let magnitude = 0;
      for (let j = 0; j < dimensions; j++) {
        const value = vectors[offset + j] - mean[j];
        this.vectors[offset + j] = value;
        magnitude += value * value;
      }
      // Identical/centroid vectors contain no distinguishing direction.
      const norm = magnitude > 1e-12 ? Math.sqrt(magnitude) : Infinity;
      for (let j = 0; j < dimensions; j++) this.vectors[offset + j] /= norm;
    }
  }

  cosine(a, b) {
    let value = 0;
    const first = a * this.dimensions, second = b * this.dimensions;
    for (let j = 0; j < this.dimensions; j++) value += this.vectors[first + j] * this.vectors[second + j];
    return Math.max(-1, Math.min(1, value));
  }
}
