export interface HeapEntry {
  f: number;
  g: number;
  seq: number;
  index: number;
}

export interface Heap {
  readonly size: number;
  push(entry: HeapEntry): void;
  pop(): HeapEntry | undefined;
}

export function createHeap(): Heap {
  const data: HeapEntry[] = [];

  const before = (left: HeapEntry, right: HeapEntry): boolean => {
    if (left.f !== right.f) return left.f < right.f;
    if (left.g !== right.g) return left.g > right.g;
    return left.seq < right.seq;
  };

  const swap = (i: number, j: number) => {
    const tmp = data[i]!;
    data[i] = data[j]!;
    data[j] = tmp;
  };

  const siftUp = (index: number) => {
    let cursor = index;
    while (cursor > 0) {
      const parent = (cursor - 1) >> 1;
      if (!before(data[cursor]!, data[parent]!)) break;
      swap(cursor, parent);
      cursor = parent;
    }
  };

  const siftDown = (index: number) => {
    let cursor = index;
    for (;;) {
      let best = cursor;
      const left = cursor * 2 + 1;
      const right = left + 1;
      if (left < data.length && before(data[left]!, data[best]!)) best = left;
      if (right < data.length && before(data[right]!, data[best]!)) best = right;
      if (best === cursor) break;
      swap(cursor, best);
      cursor = best;
    }
  };

  return {
    get size() {
      return data.length;
    },
    push(entry: HeapEntry) {
      data.push(entry);
      siftUp(data.length - 1);
    },
    pop(): HeapEntry | undefined {
      if (data.length === 0) return undefined;
      const top = data[0]!;
      const last = data.pop()!;
      if (data.length > 0) {
        data[0] = last;
        siftDown(0);
      }
      return top;
    },
  };
}
