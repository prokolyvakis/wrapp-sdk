import { describe, expect, it } from 'vitest';
import { decimal, calendarDate, WrappError } from '../../src/index.js';
import { freeze } from '../../src/values.js';

describe('validated values', () => {
  it('should preserve the first calendar boundary and reject malformed near-matches', () => {
    expect(calendarDate('0001-01-01')).toBe('0001-01-01');
    expect(calendarDate('2026-01-01')).toBe('2026-01-01');
    for (const value of ['2026-01-1', '2026-01-01 ', '2026-01-01x', '2026-1-01']) {
      expect(() => calendarDate(value)).toThrow(WrappError);
    }
    // @ts-expect-error A coercible object must not masquerade as a validated date.
    expect(() => calendarDate({ toString: () => '2026-01-01' })).toThrow(WrappError);
  });
  it('should expose stable diagnostic codes without input values', () => {
    for (const [operation, call] of [
      ['decimal', () => decimal('private-invalid')],
      ['calendarDate', () => calendarDate('private-invalid')],
    ] as const) {
      try {
        call();
        throw new Error('Expected rejection');
      } catch (error) {
        expect(error).toMatchObject({ code: 'INVALID_INPUT', operation, effect: 'not-sent' });
        expect(JSON.stringify(error)).not.toContain('private-invalid');
      }
    }
  });
  it('should serialize bounded diagnostics including httpStatus', () => {
    const parsed = JSON.parse(
      JSON.stringify(new WrappError('HTTP_ERROR', 'create', 'unknown', 503)),
    ) as Record<string, unknown>;
    expect(parsed).toEqual({
      name: 'WrappError',
      code: 'HTTP_ERROR',
      operation: 'create',
      effect: 'unknown',
      httpStatus: 503,
    });
  });
  it('should freeze nested copies as well as their containers', () => {
    const result = freeze({ list: [{ value: 'synthetic' }] });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.list)).toBe(true);
    expect(Object.isFrozen(result.list[0])).toBe(true);
    expect(freeze(null)).toBeNull();
    expect(freeze(1)).toBe(1);
  });
  it('should preserve exact decimal bytes including values above IEEE precision', () => {
    expect(decimal('9007199254740993.12')).toBe('9007199254740993.12');
    expect(decimal('0.00')).toBe('0.00');
    expect(decimal('999999999999999999.99')).toBe('999999999999999999.99');
    expect(decimal('0.001')).toBe('0.001');
    expect(decimal('1.083412345678')).toBe('1.083412345678');
    expect(decimal('0')).toBe('0');
    expect(decimal('0.1')).toBe('0.1');
  });
  it.each([
    '01',
    '00',
    '-1',
    '+1',
    'NaN',
    '1e2',
    '.1',
    '0.',
    '',
    '0.0000000000001',
    '1234567890123456789',
    ' 1',
  ])('should reject %s', (value) => {
    expect(() => decimal(value)).toThrow(WrappError);
  });
  it('should validate leap days without local timezone conversion', () => {
    expect(calendarDate('2024-02-29')).toBe('2024-02-29');
    expect(calendarDate('2000-02-29')).toBe('2000-02-29');
    expect(() => calendarDate('1900-02-29')).toThrow(WrappError);
    expect(calendarDate('2026-12-31')).toBe('2026-12-31');
    expect(() => calendarDate('2026-13-01')).toThrow(WrappError);
    expect(() => calendarDate('2026-00-01')).toThrow(WrappError);
    expect(() => calendarDate('2026-01-00')).toThrow(WrappError);
    for (const value of ['2023-02-29', '2026-04-31', '01-01-2026', '0000-01-01']) {
      expect(() => calendarDate(value)).toThrow(WrappError);
    }
  });
  it('should reject runtime numeric amounts rather than silently coerce them', () => {
    // @ts-expect-error Runtime callers may bypass TypeScript.
    expect(() => decimal(10)).toThrow(WrappError);
  });
});
