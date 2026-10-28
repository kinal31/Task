import { describe, it, expect, vi } from 'vitest';
import { createEmitter } from '../../src/sdk/emitter.js';

describe('emitter', () => {
  it('delivers events to subscribed listeners', () => {
    const emitter = createEmitter();
    const received = [];
    emitter.subscribe((event) => received.push(event));

    emitter.emit({ type: 'test' });

    expect(received).toEqual([{ type: 'test' }]);
  });

  it('stops delivering after unsubscribe', () => {
    const emitter = createEmitter();
    const received = [];
    const unsubscribe = emitter.subscribe((event) => received.push(event));

    emitter.emit({ n: 1 });
    unsubscribe();
    emitter.emit({ n: 2 });

    expect(received).toEqual([{ n: 1 }]);
    expect(emitter.listenerCount()).toBe(0);
  });

  it('is safe to call unsubscribe twice', () => {
    const emitter = createEmitter();
    const listener = vi.fn();
    const unsubscribe = emitter.subscribe(listener);

    unsubscribe();
    unsubscribe();

    expect(emitter.listenerCount()).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it('a throwing listener does not stop the others', () => {
    const emitter = createEmitter();
    const good = vi.fn();
    emitter.subscribe(() => {
      throw new Error('boom');
    });
    emitter.subscribe(good);

    emitter.emit({ type: 'event' });

    expect(good).toHaveBeenCalledTimes(1);
  });

  it('supports unsubscribing during emit without breaking iteration', () => {
    const emitter = createEmitter();
    const later = vi.fn();
    const first = vi.fn(() => {
      unsubLater();
    });
    const unsubLater = emitter.subscribe(later);
    emitter.subscribe(first);

    emitter.emit({ type: 'event' });

    expect(first).toHaveBeenCalledTimes(1);
    // `later` was unsubscribed mid-emit; it was in the snapshot so it ran once.
    expect(later).toHaveBeenCalledTimes(1);

    emitter.emit({ type: 'again' });
    expect(first).toHaveBeenCalledTimes(2);
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('deduplicates the same listener function reference', () => {
    const emitter = createEmitter();
    const listener = vi.fn();
    emitter.subscribe(listener);
    emitter.subscribe(listener);

    expect(emitter.listenerCount()).toBe(1);

    emitter.emit({});
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('listenerCount tracks multiple listeners', () => {
    const emitter = createEmitter();
    const unsubs = [
      emitter.subscribe(() => {}),
      emitter.subscribe(() => {}),
      emitter.subscribe(() => {}),
    ];
    expect(emitter.listenerCount()).toBe(3);
    unsubs[1]();
    expect(emitter.listenerCount()).toBe(2);
  });

  it('rejects non-function listeners', () => {
    const emitter = createEmitter();
    expect(() => emitter.subscribe(null)).toThrow(TypeError);
  });
});
