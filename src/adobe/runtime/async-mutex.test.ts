import { describe, it, expect } from 'vitest';
import { AsyncMutex } from './async-mutex.js';

describe('AsyncMutex', () => {
  it('runs a single task normally', async () => {
    const mutex = new AsyncMutex();
    const result = await mutex.runExclusive(async () => 42);
    expect(result).toBe(42);
  });

  it('serializes two concurrent tasks — the second never starts before the first finishes', async () => {
    const mutex = new AsyncMutex();
    const events: string[] = [];

    const first = mutex.runExclusive(async () => {
      events.push('first:start');
      await new Promise((resolve) => setTimeout(resolve, 30));
      events.push('first:end');
    });

    const second = mutex.runExclusive(async () => {
      events.push('second:start');
      events.push('second:end');
    });

    await Promise.all([first, second]);

    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('releases the lock even if the task throws, so a later task still runs', async () => {
    const mutex = new AsyncMutex();

    await expect(
      mutex.runExclusive(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // If the lock were left held, this would hang forever — the test
    // itself timing out is the failure signal.
    const result = await mutex.runExclusive(async () => 'still works');
    expect(result).toBe('still works');
  });

  it('preserves FIFO order across three queued tasks', async () => {
    const mutex = new AsyncMutex();
    const order: number[] = [];

    const tasks = [1, 2, 3].map((n) =>
      mutex.runExclusive(async () => {
        order.push(n);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }),
    );

    await Promise.all(tasks);

    expect(order).toEqual([1, 2, 3]);
  });
});
