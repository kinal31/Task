/**
 * Small pure utilities shared across the SDK. No DOM, no React.
 */

import { MAX_NAME_LENGTH } from './constants.js';

/**
 * Recursively freezes an object (and all nested plain objects/arrays) and
 * returns it. Used so any value handed out by the SDK is immutable.
 *
 * @template T
 * @param {T} value
 * @returns {T} the same value, deeply frozen
 */
export function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);
  }
  return value;
}

/**
 * Trims surrounding whitespace from a raw name value.
 * Returns an empty string for non-string input so validation can reject it.
 *
 * @param {*} raw
 * @returns {string}
 */
export function normalizeName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim();
}

/**
 * The uniqueness key for sibling names: trimmed + lowercased.
 *
 * @param {string} name
 * @returns {string}
 */
export function nameKey(name) {
  return normalizeName(name).toLowerCase();
}

/**
 * Default id generator. Injectable via the SDK's `idGenerator` option so
 * tests can be deterministic.
 *
 * @returns {string} a RFC 4122 v4 UUID
 */
export function generateId() {
  return crypto.randomUUID();
}

/**
 * Name length limit check used by validators.
 *
 * @param {string} name - already trimmed
 * @returns {boolean} true when the name is within the allowed length
 */
export function isNameLengthValid(name) {
  return name.length <= MAX_NAME_LENGTH;
}
