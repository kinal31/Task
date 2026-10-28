/**
 * Undo/redo history built on the command pattern and two stacks.
 *
 * Rules:
 * - Every *successful* operation pushes one command. Failed operations never
 *   reach `push`, because validation happens before the push.
 * - `push` (a new user action) **clears the redo stack**: a new action after
 *   an undo discards the redo branch. This is a deliberate design decision.
 * - The undo stack is capped at `limit`, dropping the oldest entry.
 * - Undo/redo move commands between stacks with the dedicated
 *   `returnToUndo` / `returnToRedo` methods, which do NOT clear the other
 *   stack and do NOT apply the cap (sizes merely shift by one).
 */

/**
 * @typedef {object} Command
 * @property {string} type
 * @property {string} label - human-readable, shown in history/ tooltips
 * @property {() => void} apply - re-apply the operation (redo)
 * @property {() => void} revert - reverse the operation (undo)
 */

/**
 * @param {number} [limit=100] maximum number of undo entries
 */
export function createHistory(limit = 100) {
  /** @type {Command[]} */
  const undoStack = [];
  /** @type {Command[]} */
  const redoStack = [];

  return {
    /**
     * Records a new user action. Clears the redo stack and enforces the cap.
     * @param {Command} command
     */
    push(command) {
      undoStack.push(command);
      redoStack.length = 0; // a new action after undo discards the redo branch
      if (undoStack.length > limit) {
        undoStack.shift(); // drop the oldest
      }
    },

    /**
     * Pops the most recent undoable command, or null.
     * @returns {Command|null}
     */
    takeForUndo() {
      return undoStack.pop() ?? null;
    },

    /**
     * Pops the most recent redoable command, or null.
     * @returns {Command|null}
     */
    takeForRedo() {
      return redoStack.pop() ?? null;
    },

    /**
     * Pushes a command back onto the undo stack (used after a redo).
     * @param {Command} command
     */
    returnToUndo(command) {
      undoStack.push(command);
    },

    /**
     * Pushes a command back onto the redo stack (used after an undo).
     * @param {Command} command
     */
    returnToRedo(command) {
      redoStack.push(command);
    },

    /** @returns {boolean} */
    canUndo() {
      return undoStack.length > 0;
    },

    /** @returns {boolean} */
    canRedo() {
      return redoStack.length > 0;
    },

    /** Empties both stacks. */
    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
    },

    /**
     * Label snapshots for display. `undo` is most-recent-first.
     * @returns {{ undo: string[], redo: string[] }}
     */
    labels() {
      return {
        undo: undoStack.map((c) => c.label).reverse(),
        redo: redoStack.map((c) => c.label).reverse(),
      };
    },
  };
}
