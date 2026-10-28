/**
 * A minimal pub/sub emitter built on a Set of listeners.
 *
 * Design notes:
 * - `subscribe` returns an unsubscribe function that is safe to call twice.
 * - `emit` iterates over a copy of the Set, so a listener that unsubscribes
 *   (or subscribes) during emission does not break iteration.
 * - Each listener is wrapped in try/catch, so one throwing listener never
 *   prevents the others from running.
 */

/**
 * @typedef {{ subscribe: (fn: (event: any) => void) => (() => void),
 *             emit: (event: any) => void,
 *             listenerCount: () => number }} Emitter
 */

/**
 * Creates a fresh emitter.
 *
 * @returns {Emitter}
 */
export function createEmitter() {
  /** @type {Set<(event: any) => void>} */
  const listeners = new Set();

  return {
    /**
     * Registers a listener. The same function reference is only stored once.
     *
     * @param {(event: any) => void} fn
     * @returns {() => void} an idempotent unsubscribe function
     */
    subscribe(fn) {
      if (typeof fn !== 'function') {
        throw new TypeError('listener must be a function');
      }
      listeners.add(fn);
      let active = true;
      return function unsubscribe() {
        if (!active) return;
        active = false;
        listeners.delete(fn);
      };
    },

    /**
     * Notifies every listener with the given event. Listener errors are
     * swallowed so they cannot break the emitter or other listeners.
     *
     * @param {any} event
     */
    emit(event) {
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch {
          // intentionally ignored: a broken listener must not break emit
        }
      }
    },

    /**
     * @returns {number} the number of currently registered listeners
     */
    listenerCount() {
      return listeners.size;
    },
  };
}
