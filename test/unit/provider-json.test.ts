import { describe, expect, it } from 'vitest';
import { parseJson } from '../../src/codecs.js';
import { WrappError } from '../../src/index.js';
import type { ProviderJson } from '../../src/index.js';
import { providerJson } from '../../src/provider-json.js';

// Synthetic JSON only. The limits exercised here are SDK policy, not provider maxima.
const tree = (text: string): ProviderJson => providerJson(parseJson(text));
const refused = (run: () => unknown) => {
  expect(run).toThrow(WrappError);
  try {
    run();
  } catch (error) {
    expect(error).toMatchObject({ code: 'PROTOCOL_ERROR' });
  }
};
const nested = (levels: number) => '['.repeat(levels) + ']'.repeat(levels);

describe('ProviderJson', () => {
  it('should keep every JSON kind apart, in document order', () => {
    expect(tree('{"n":null,"t":true,"f":false,"s":"text","d":1.50,"a":[1,"1"],"o":{}}')).toEqual({
      kind: 'object',
      entries: [
        { key: 'n', value: { kind: 'null' } },
        { key: 't', value: { kind: 'boolean', value: true } },
        { key: 'f', value: { kind: 'boolean', value: false } },
        { key: 's', value: { kind: 'string', value: 'text' } },
        { key: 'd', value: { kind: 'number', text: '1.50' } },
        {
          key: 'a',
          value: {
            kind: 'array',
            items: [
              { kind: 'number', text: '1' },
              { kind: 'string', value: '1' },
            ],
          },
        },
        { key: 'o', value: { kind: 'object', entries: [] } },
      ],
    });
  });
  it.each([
    '123456789012345678901234567890',
    '-1',
    '-0',
    '1e-30',
    '1E+5',
    '0.10',
    '9007199254740993.000000000001',
  ])('should keep the numeric token %s as its exact text, never as a number', (token) => {
    expect(tree(token)).toEqual({ kind: 'number', text: token });
    expect(tree('"' + token + '"')).toEqual({ kind: 'string', value: token });
  });
  it.each(['01', '1.', '.5', '+1', '1e', 'NaN', 'Infinity', '0x10', '1_000'])(
    'should refuse the malformed numeric token %s before any mapping',
    (token) => {
      expect(() => parseJson('{"value":' + token + '}')).toThrow();
    },
  );
  it('should accept scalars at the root and an explicit null as a null node', () => {
    expect(tree('null')).toEqual({ kind: 'null' });
    expect(tree('"x"')).toEqual({ kind: 'string', value: 'x' });
    expect(tree('[]')).toEqual({ kind: 'array', items: [] });
  });
  it('should accept 20 levels of nesting and refuse 21', () => {
    expect(tree(nested(20)).kind).toBe('array');
    refused(() => tree(nested(21)));
    const objects = (levels: number) => '{"k":'.repeat(levels) + '0' + '}'.repeat(levels);
    expect(tree(objects(20)).kind).toBe('object');
    refused(() => tree(objects(21)));
  });
  it('should accept 10000 nodes and refuse 10001', () => {
    const list = (items: number) => '[' + Array.from({ length: items }, () => '0').join(',') + ']';
    // The array itself is one node.
    expect(tree(list(9_999)).kind).toBe('array');
    refused(() => tree(list(10_000)));
  });
  it('should accept text of 4096 code units and refuse 4097, for strings, keys and number tokens', () => {
    const text = (length: number) => 'x'.repeat(length);
    expect(tree('"' + text(4096) + '"').kind).toBe('string');
    refused(() => tree('"' + text(4097) + '"'));
    expect(tree('{"' + text(4096) + '":1}').kind).toBe('object');
    refused(() => tree('{"' + text(4097) + '":1}'));
    expect(tree('1' + '0'.repeat(4095)).kind).toBe('number');
    refused(() => tree('1' + '0'.repeat(4096)));
  });
  it('should keep keys that name Object members as plain entries', () => {
    const keys = ['constructor', 'toString', 'hasOwnProperty', 'prototype', '', 'kind', 'entries'];
    const value = tree('{' + keys.map((key) => JSON.stringify(key) + ':1').join(',') + '}');
    expect(value.kind === 'object' && value.entries.map((entry) => entry.key)).toEqual(keys);
  });
  it.each([
    '{"__proto__":{"a":1}}',
    '{"__proto__":5}',
    '{"__proto__":null}',
    '{"outer":{"__proto__":"text"}}',
    '[{"\\u005f_proto__":1}]',
    '{"__pr\\u006fto__":[]}',
  ])('should refuse the body %s: a __proto__ key is never dropped or honored', (text) => {
    expect(() => parseJson(text)).toThrow();
  });
  it('should accept __proto__ as a string value, which is not a key', () => {
    expect(tree('{"key":"__proto__","escaped":"\\u005f_proto__"}')).toEqual({
      kind: 'object',
      entries: [
        { key: 'key', value: { kind: 'string', value: '__proto__' } },
        { key: 'escaped', value: { kind: 'string', value: '__proto__' } },
      ],
    });
  });
  it('should refuse a body nested more than 64 levels before either parser recurses into it', () => {
    expect(() => parseJson(nested(64))).not.toThrow();
    expect(() => parseJson(nested(65))).toThrow('JSON nested too deeply');
    expect(() => parseJson('{"k":'.repeat(65) + '0' + '}'.repeat(65))).toThrow(
      'JSON nested too deeply',
    );
    // Deep enough to exhaust the stack of a recursive parser; refused by the scan instead.
    expect(() => parseJson(nested(1_000_000))).toThrow('JSON nested too deeply');
    expect(() => parseJson('['.repeat(500_000) + '"\\u0041"' + ']'.repeat(500_000))).toThrow(
      'JSON nested too deeply',
    );
  });
  it('should not count brackets inside strings as nesting', () => {
    const brackets = '[{'.repeat(200);
    expect(tree(JSON.stringify(brackets))).toEqual({ kind: 'string', value: brackets });
    expect(tree(JSON.stringify({ ['quote"' + brackets]: 'a\\"' + brackets })).kind).toBe('object');
  });
  it('should freeze every node', () => {
    const value = tree('{"a":[{"b":1}]}');
    const frozen = (node: ProviderJson): boolean =>
      Object.isFrozen(node) &&
      (node.kind === 'array'
        ? Object.isFrozen(node.items) && node.items.every(frozen)
        : node.kind === 'object'
          ? Object.isFrozen(node.entries) &&
            node.entries.every((entry) => Object.isFrozen(entry) && frozen(entry.value))
          : true);
    expect(frozen(value)).toBe(true);
  });
  it.each([undefined, 5, () => 1, Symbol('x'), new Date(0), new Map()])(
    'should refuse a value that is not parsed JSON (%s)',
    (value) => {
      refused(() => providerJson(value));
    },
  );
});
