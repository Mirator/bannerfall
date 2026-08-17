// Allocation-free uniform grid used by the battle simulation broad phases.
// The grid owns its buckets and scratch query buffer. Callers rebuild it once
// per phase after the indexed collection has reached its current positions.
export class SpatialGrid {
  constructor(width, height, cellSize = 128) {
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
    this.items = [];
    this.queryItems = [];
    this.heapIds = new Int32Array(this.cells.length);
    this.heapBounds = new Float64Array(this.cells.length);
    this.count = 0;
    this.stats = { rebuilds: 0, candidateChecks: 0, queries: 0, pairs: 0, cellVisits: 0 };
  }

  clearStats() {
    this.stats.rebuilds = 0;
    this.stats.candidateChecks = 0;
    this.stats.queries = 0;
    this.stats.pairs = 0;
    this.stats.cellVisits = 0;
  }

  rebuild(items, count = items.length) {
    this.items = items;
    this.count = count;
    for (const cell of this.cells) cell.length = 0;
    for (let i = 0; i < count; i++) {
      const item = items[i];
      item._spatialOrder = i;
      const col = this.cellX(item.x), row = this.cellY(item.y);
      this.cells[row * this.cols + col].push(item);
    }
    this.stats.rebuilds++;
  }

  cellX(x) { return Math.max(0, Math.min(this.cols - 1, Math.floor(x / this.cellSize))); }
  cellY(y) { return Math.max(0, Math.min(this.rows - 1, Math.floor(y / this.cellSize))); }

  // Fills a reusable candidate array and returns its logical length. A radius
  // covering the arena deliberately takes the full ordered source list so an
  // unbounded query has the same candidate order as the old full scan.
  query(x, y, radius) {
    this.stats.queries++;
    const out = this.queryItems;
    out.length = 0;
    if (radius >= Math.max(this.width, this.height)) {
      for (let i = 0; i < this.count; i++) out.push(this.items[i]);
      return out.length;
    }
    const minCol = this.cellX(x - radius), maxCol = this.cellX(x + radius);
    const minRow = this.cellY(y - radius), maxRow = this.cellY(y + radius);
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const cell = this.cells[row * this.cols + col];
        for (const item of cell) out.push(item);
      }
    }
    return out.length;
  }

  queryOrdered(x, y, radius) {
    const count = this.query(x, y, radius);
    // Separation is intentionally applied in the legacy source order because
    // each push changes the next pair's distance. The candidate set is small
    // for a uniform distribution, so this local insertion sort is bounded by
    // cell occupancy rather than total army size.
    for (let i = 1; i < count; i++) {
      const value = this.queryItems[i];
      let j = i - 1;
      while (j >= 0 && this.queryItems[j]._spatialOrder > value._spatialOrder) {
        this.queryItems[j + 1] = this.queryItems[j]; j--;
      }
      this.queryItems[j + 1] = value;
    }
    return count;
  }

  cellDistance2(cellId, x, y) {
    const col = cellId % this.cols, row = Math.floor(cellId / this.cols);
    const left = col * this.cellSize, top = row * this.cellSize;
    const right = Math.min(this.width, left + this.cellSize);
    const bottom = Math.min(this.height, top + this.cellSize);
    const dx = x < left ? left - x : x > right ? x - right : 0;
    const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
    return dx * dx + dy * dy;
  }

  // Exact branch-and-bound nearest query. Every arena cell is put into a
  // reusable min-heap by its lower-bound distance. Once the next cell's bound
  // is greater than the best result, no unvisited entity can improve it. The
  // equality case is still visited so source-order ties remain exact.
  nearest(x, y, maxR = 1e9, predicate = null, initial = null, initialDistance = Infinity, initialOrder = Infinity) {
    this.stats.queries++;
    const limit2 = maxR * maxR;
    let best = initial;
    let bestD2 = Math.min(limit2, initial ? initialDistance : limit2);
    let bestOrder = initial ? initialOrder : Infinity;
    let heapSize = 0;
    const ids = this.heapIds, bounds = this.heapBounds;
    for (let cellId = 0; cellId < this.cells.length; cellId++) {
      const bound = this.cellDistance2(cellId, x, y);
      if (bound >= limit2 && !best) continue;
      let i = heapSize++;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (bounds[parent] <= bound) break;
        ids[i] = ids[parent]; bounds[i] = bounds[parent]; i = parent;
      }
      ids[i] = cellId; bounds[i] = bound;
    }
    while (heapSize > 0) {
      const cellId = ids[0], bound = bounds[0];
      heapSize--;
      if (heapSize > 0) {
        const lastId = ids[heapSize], lastBound = bounds[heapSize];
        let i = 0;
        while (i * 2 + 1 < heapSize) {
          let child = i * 2 + 1;
          if (child + 1 < heapSize && bounds[child + 1] < bounds[child]) child++;
          if (bounds[child] >= lastBound) break;
          ids[i] = ids[child]; bounds[i] = bounds[child]; i = child;
        }
        ids[i] = lastId; bounds[i] = lastBound;
      }
      if (bound > bestD2) break;
      this.stats.cellVisits++;
      const cell = this.cells[cellId];
      for (const candidate of cell) {
        this.stats.candidateChecks++;
        if (predicate && !predicate(candidate)) continue;
        const d2 = (x - candidate.x) ** 2 + (y - candidate.y) ** 2;
        if (d2 >= limit2) continue; // preserve the old strict max-radius check
        if (d2 < bestD2 || (best && d2 === bestD2 && candidate._spatialOrder < bestOrder)) {
          best = candidate; bestD2 = d2; bestOrder = candidate._spatialOrder;
        }
      }
    }
    return best;
  }

  noteCandidate() { this.stats.candidateChecks++; }
}

export function stableSortPrefix(entries, count, scratch, compare) {
  if (count < 2) return;
  let source = entries, target = scratch;
  for (let width = 1; width < count; width *= 2) {
    for (let left = 0; left < count; left += width * 2) {
      const mid = Math.min(left + width, count);
      const right = Math.min(left + width * 2, count);
      let a = left, b = mid, k = left;
      while (a < mid && b < right) {
        if (compare(source[a], source[b]) <= 0) target[k++] = source[a++];
        else target[k++] = source[b++];
      }
      while (a < mid) target[k++] = source[a++];
      while (b < right) target[k++] = source[b++];
    }
    const swap = source; source = target; target = swap;
  }
  if (source !== entries) {
    for (let i = 0; i < count; i++) entries[i] = source[i];
  }
}
