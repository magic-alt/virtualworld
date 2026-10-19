import { HttpError } from './store';

/** Reject excess work rather than growing another unbounded in-memory queue. */
export class OperationGate {
  private count = 0;
  constructor(
    private limit: number,
    private label: string,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid operation limit');
  }
  get active() {
    return this.count;
  }
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.count >= this.limit) throw new HttpError(429, `${this.label}繁忙，请稍后重试`);
    this.count++;
    try {
      return await work();
    } finally {
      this.count--;
    }
  }
}
