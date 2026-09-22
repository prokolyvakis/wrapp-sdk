import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyWebhook, WrappError } from '../../src/index.js';
import { observation } from '../fixtures/provider.js';

const key = 'synthetic-webhook-key';
function sign(body: Uint8Array, secret = key) {
  return createHmac('sha256', secret).update(body).digest('hex');
}
const pdf = () =>
  Buffer.from(
    JSON.stringify({ invoice_id: 'invoice-one', download_url: 'https://example.invalid/pdf' }),
  );
describe('webhooks', () => {
  it('should reject invalid UTF-8 even when replacement decoding would leave valid JSON', () => {
    const body = Buffer.concat([
      Buffer.from('{"invoice_id":"invoice-'),
      Buffer.from([0xff]),
      Buffer.from('","download_url":"https://example.invalid/pdf"}'),
    ]);
    expect(() =>
      verifyWebhook({ body, signature: sign(body), keys: [key], eventType: 'invoice-pdf' }),
    ).toThrow(WrappError);
  });
  it('should validate key and signature forms independently of MAC correctness', () => {
    const body = pdf();
    expect(() =>
      verifyWebhook({ body, signature: sign(body, ''), keys: [''], eventType: 'invoice-pdf' }),
    ).toThrow(WrappError);
    expect(() =>
      verifyWebhook({ body, signature: sign(body) + 'x', keys: [key], eventType: 'invoice-pdf' }),
    ).toThrow(WrappError);
    expect(() =>
      verifyWebhook({
        body,
        signature: sign(body),
        // @ts-expect-error The runtime API refuses binary verification keys.
        keys: [Buffer.from(key)],
        eventType: 'invoice-pdf',
      }),
    ).toThrow(WrappError);
    expect(
      verifyWebhook({
        body,
        signature: sign(body, 'a'),
        keys: ['a'],
        eventType: 'invoice-pdf',
        maxBodyBytes: 8_388_608,
      }),
    ).toMatchObject({ kind: 'invoice-pdf' });
  });
  it('should accept exact size/key boundaries and uppercase hex', () => {
    const body = pdf();
    const longKey = 'a'.repeat(16_384);
    expect(
      verifyWebhook({
        body,
        signature: sign(body, longKey).toUpperCase(),
        keys: ['k1', 'k2', 'k3', 'k4', longKey],
        eventType: 'invoice-pdf',
        maxBodyBytes: body.byteLength,
      }),
    ).toMatchObject({ kind: 'invoice-pdf' });
  });
  it('should reject valid MACs when input limits are exceeded', () => {
    const body = pdf();
    const longKey = 'a'.repeat(16_385);
    expect(() =>
      verifyWebhook({
        body,
        signature: sign(body, longKey),
        keys: [longKey],
        eventType: 'invoice-pdf',
      }),
    ).toThrow(WrappError);
    expect(() =>
      verifyWebhook({
        body,
        signature: sign(body),
        keys: [key],
        eventType: 'invoice-pdf',
        maxBodyBytes: 1000.5,
      }),
    ).toThrow(WrappError);
    const large = Buffer.from(
      JSON.stringify({
        invoice_id: 'invoice',
        download_url: 'https://example.invalid/pdf',
        padding: 'x'.repeat(2_097_152),
      }),
    );
    expect(() =>
      verifyWebhook({ body: large, signature: sign(large), keys: [key], eventType: 'invoice-pdf' }),
    ).toThrow(WrappError);
  });
  it.each(['errors', 'error', 'status'])(
    'should reject contradictory %s evidence even alongside a valid shape',
    (field) => {
      const body = Buffer.from(JSON.stringify({ ...observation(), [field]: 'contradiction' }));
      try {
        verifyWebhook({ body, signature: sign(body), keys: [key], eventType: 'issued-invoice' });
        throw new Error('Expected rejection');
      } catch (error) {
        expect(error).toMatchObject({ code: 'WEBHOOK_INVALID', operation: 'webhook' });
      }
    },
  );
  it('should verify original Greek UTF-8 bytes and keep the unsigned event type untrusted', () => {
    const body = Buffer.from(JSON.stringify(observation({ series: 'ΣΕΙΡΑ' })));
    const result = verifyWebhook({
      body,
      signature: sign(body),
      keys: [key],
      eventType: 'issued-invoice',
    });
    expect(result).toMatchObject({ kind: 'issued-invoice', eventTypeAuthenticated: false });
    expect(Object.isFrozen(result)).toBe(true);
  });
  it('should support bounded key rotation and reject retired keys', () => {
    const body = pdf();
    expect(
      verifyWebhook({
        body,
        signature: sign(body),
        keys: ['new-key', key],
        eventType: 'invoice-pdf',
      }),
    ).toEqual({
      kind: 'invoice-pdf',
      invoiceId: 'invoice-one',
      downloadUrl: 'https://example.invalid/pdf',
      eventTypeAuthenticated: false,
    });
    expect(() =>
      verifyWebhook({ body, signature: sign(body), keys: ['new-key'], eventType: 'invoice-pdf' }),
    ).toThrow(WrappError);
  });
  it.each([
    '',
    'ff',
    'z'.repeat(64),
    '0'.repeat(64),
    'a'.repeat(64) + ', ' + 'b'.repeat(64),
    'sha256=' + 'a'.repeat(64),
  ])('should reject malformed, multiple or incorrect signatures', (signature) => {
    expect(() =>
      verifyWebhook({ body: pdf(), signature, keys: [key], eventType: 'invoice-pdf' }),
    ).toThrow(WrappError);
  });
  it('should reject tampering including otherwise insignificant whitespace', () => {
    const body = pdf();
    expect(() =>
      verifyWebhook({
        body: Buffer.concat([body, Buffer.from(' ')]),
        signature: sign(body),
        keys: [key],
        eventType: 'invoice-pdf',
      }),
    ).toThrow(WrappError);
  });
  it.each([
    Buffer.from('{'),
    Buffer.from([0xff]),
    Buffer.from('{"a":1,"a":2}'),
    Buffer.from(
      '{"invoice_id":"invoice-one","invoice_id":"invoice-two","download_url":"https://example.invalid/pdf"}',
    ),
    Buffer.from('{"errors":[]}'),
    Buffer.from('{"__proto__":{"invoice_id":"forged","download_url":"https://example.invalid/x"}}'),
  ])('should reject correctly signed malformed evidence', (body) => {
    expect(() =>
      verifyWebhook({ body, signature: sign(body), keys: [key], eventType: 'invoice-pdf' }),
    ).toThrow(WrappError);
  });
  it('should refuse to relabel one signed body across event kinds via the unsigned header', () => {
    const dual = Buffer.from(
      JSON.stringify({
        ...observation(),
        invoice_id: 'invoice-one',
        download_url: 'https://example.invalid/pdf',
      }),
    );
    for (const eventType of ['issued-invoice', 'invoice-pdf']) {
      expect(() =>
        verifyWebhook({ body: dual, signature: sign(dual), keys: [key], eventType }),
      ).toThrow(WrappError);
    }
  });
  it.each(['issued-invoice', 'unknown', 'thermal-print-pdf'])(
    'should reject mismatched or unsupported hints',
    (eventType) => {
      const body = pdf();
      expect(() => verifyWebhook({ body, signature: sign(body), keys: [key], eventType })).toThrow(
        WrappError,
      );
    },
  );
  it.each([[], [''], Array<string>(6).fill(key), ['a'.repeat(16_385)]].map((keys) => ({ keys })))(
    'should bound verification keys',
    ({ keys }) => {
      const body = pdf();
      expect(() =>
        verifyWebhook({ body, signature: sign(body), keys, eventType: 'invoice-pdf' }),
      ).toThrow(WrappError);
    },
  );
  it.each([0, 1, 8_388_609, 1.5])(
    'should bound body size without leaking input',
    (maxBodyBytes) => {
      const body = pdf();
      expect(() =>
        verifyWebhook({
          body,
          signature: sign(body),
          keys: [key],
          eventType: 'invoice-pdf',
          maxBodyBytes,
        }),
      ).toThrow('Wrapp SDK: WEBHOOK_INVALID');
    },
  );
});
