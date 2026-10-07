import { LosslessNumber } from 'lossless-json';
import { WrappError } from './errors.js';
import { freeze } from './values.js';

/**
 * A JSON value the provider returned and this SDK does not interpret: structural evidence
 * only. Every JSON kind stays distinct. A number keeps the exact text of its token and is
 * never converted to a JavaScript number, so `1`, `1.0` and `"1"` remain three different
 * values. An object is an ordered list of entries, not a JavaScript object, so no key can
 * collide with an object member. The tree is deeply frozen.
 *
 * The SDK bounds it at 20 levels of nesting, 10 000 nodes and 4096 UTF-16 code units for
 * each string, key and number token; a larger value fails the read. Nothing in it is used to
 * decide whether an operation succeeded.
 */
export type ProviderJson =
  | Readonly<{ kind: 'null' }>
  | Readonly<{ kind: 'boolean'; value: boolean }>
  | Readonly<{ kind: 'string'; value: string }>
  | Readonly<{ kind: 'number'; text: string }>
  | Readonly<{ kind: 'array'; items: readonly ProviderJson[] }>
  | Readonly<{
      kind: 'object';
      entries: readonly Readonly<{ key: string; value: ProviderJson }>[];
    }>;

const maxDepth = 20;
const maxNodes = 10_000;
const maxText = 4096;
// The full JSON number grammar: sign, fraction and exponent included.
const numberSyntax = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function fail(): never {
  throw new WrappError('PROTOCOL_ERROR', 'decode');
}
function node(value: unknown, depth: number, budget: { nodes: number }): ProviderJson {
  budget.nodes += 1;
  if (budget.nodes > maxNodes) fail();
  if (value === null) return { kind: 'null' };
  if (typeof value === 'boolean') return { kind: 'boolean', value };
  if (typeof value === 'string') return value.length > maxText ? fail() : { kind: 'string', value };
  if (value instanceof LosslessNumber) {
    const text = value.value;
    return text.length > maxText || !numberSyntax.test(text) ? fail() : { kind: 'number', text };
  }
  if (typeof value !== 'object' || depth === maxDepth) fail();
  if (Array.isArray(value))
    return { kind: 'array', items: value.map((item) => node(item, depth + 1, budget)) };
  // Anything but a plain parsed object is not JSON.
  if (Object.getPrototypeOf(value) !== Object.prototype) fail();
  return {
    kind: 'object',
    entries: Object.entries(value).map(([key, child]) =>
      key.length > maxText ? fail() : { key, value: node(child, depth + 1, budget) },
    ),
  };
}
/** Maps a value from the lossless parser to its opaque tree, or fails the decode. */
export function providerJson(value: unknown): ProviderJson {
  return freeze(node(value, 0, { nodes: 0 }));
}
