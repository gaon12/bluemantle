const LIMIT = 32;

/** Preserve recent exploration and the best leads without growing a quadratic map. */
export function connectionIds(guesses) {
  if (guesses.length <= LIMIT) return guesses.map(g => g.id);
  const chosen = new Set(guesses.slice(-LIMIT / 2).map(g => g.id));
  for (const guess of [...guesses].sort((a, b) => a.rank - b.rank)) {
    if (chosen.size === LIMIT) break;
    chosen.add(guess.id);
  }
  return guesses.filter(g => chosen.has(g.id)).map(g => g.id);
}

/** PCA from the pairwise Gram matrix; uses guesses only, never the hidden answer. */
export function projectConnections(similarities) {
  const n = similarities.length;
  if (!n) return { points: [], coverage: 0 };
  const rowMeans = similarities.map(row => row.reduce((sum, value) => sum + value / 100, 0) / n);
  const mean = rowMeans.reduce((sum, value) => sum + value, 0) / n;
  const matrix = similarities.map((row, i) => row.map((value, j) => value / 100 - rowMeans[i] - rowMeans[j] + mean));
  const eigenvectors = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => Number(i === j)));
  // Cyclic Jacobi diagonalization also handles tied eigenvalues and collinear inputs.
  for (let sweep = 0; sweep < 40; sweep++) {
    let changed = false;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
      const off = matrix[p][q];
      if (Math.abs(off) < 1e-9) continue;
      changed = true;
      const tau = (matrix[q][q] - matrix[p][p]) / (2 * off);
      const tangent = (tau < 0 ? -1 : 1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
      const cosine = 1 / Math.sqrt(1 + tangent * tangent), sine = tangent * cosine;
      matrix[p][p] -= tangent * off; matrix[q][q] += tangent * off;
      matrix[p][q] = matrix[q][p] = 0;
      for (let k = 0; k < n; k++) {
        if (k !== p && k !== q) {
          const a = matrix[k][p], b = matrix[k][q];
          matrix[k][p] = matrix[p][k] = cosine * a - sine * b;
          matrix[k][q] = matrix[q][k] = sine * a + cosine * b;
        }
        const a = eigenvectors[k][p], b = eigenvectors[k][q];
        eigenvectors[k][p] = cosine * a - sine * b;
        eigenvectors[k][q] = sine * a + cosine * b;
      }
    }
    if (!changed) break;
  }
  const components = matrix.map((row, index) => ({ index, value: Math.max(0, row[index]) })).sort((a, b) => b.value - a.value || a.index - b.index);
  const axes = components.slice(0, 2).map(({ index, value }) => {
    const column = eigenvectors.map(row => row[index]);
    const pivot = column.reduce((best, v, i) => Math.abs(v) > Math.abs(column[best]) ? i : best, 0);
    const sign = column[pivot] < 0 ? -1 : 1;
    return column.map(v => v * Math.sqrt(value) * sign);
  });
  const points = Array.from({ length: n }, (_, i) => [axes[0]?.[i] ?? 0, axes[1]?.[i] ?? 0]);
  const extent = Math.max(1e-9, ...points.flat().map(Math.abs));
  const total = components.reduce((sum, c) => sum + c.value, 0);
  return { points: points.map(([x, y]) => [x / extent, y / extent]), coverage: total > 1e-9 ? Math.min(1, (components[0].value + (components[1]?.value ?? 0)) / total) : 0 };
}
