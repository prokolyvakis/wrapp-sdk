import { createHmac } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { verifyWebhook, WrappError } from '../../src/index.js';
import { enrichedPending, fullObservation, observation } from '../fixtures/provider.js';

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
    ).toMatchObject({ kind: 'pdf', eventTypeHint: 'invoice-pdf' });
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
    ).toMatchObject({ kind: 'pdf', eventTypeHint: 'invoice-pdf' });
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
    expect(result).toMatchObject({
      kind: 'invoice-observation',
      eventTypeHint: 'issued-invoice',
      eventTypeAuthenticated: false,
    });
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
      kind: 'pdf',
      invoiceId: 'invoice-one',
      downloadUrl: 'https://example.invalid/pdf',
      eventTypeHint: 'invoice-pdf',
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
    for (const eventType of ['issued-invoice', 'invoice-pdf', 'thermal-print-pdf', 'pos-payment']) {
      expect(() =>
        verifyWebhook({ body: dual, signature: sign(dual), keys: [key], eventType }),
      ).toThrow(WrappError);
    }
  });
  it.each(['issued-invoice', 'pos-payment', 'unknown', '', 'Invoice-PDF', 'invoice-pdf '])(
    'should reject the mismatched or unsupported hint %j for a PDF body',
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

// Synthetic bodies in the four documented webhook shapes of the Wrapp reference v1.18.0.
const posMessage = 'Η συναλλαγή ακυρώθηκε από τον χρήστη (0000)';
const bodies = {
  'issued-invoice': () => fullObservation(),
  'invoice-pdf': () => ({ invoice_id: 'invoice-one', download_url: 'https://example.invalid/pdf' }),
  'thermal-print-pdf': () => ({
    invoice_id: 'invoice-one',
    download_url: 'https://example.invalid/pdf',
  }),
  'pos-payment': () => ({ errors: posMessage, invoice_id: 'invoice-one' }),
} as const;
type Hint = keyof typeof bodies;
const hints = ['issued-invoice', 'invoice-pdf', 'thermal-print-pdf', 'pos-payment'] as const;
function verify(value: unknown, eventType: string) {
  const body = Buffer.from(JSON.stringify(value));
  return verifyWebhook({ body, signature: sign(body), keys: [key], eventType });
}
function refuses(value: unknown, eventType: string) {
  try {
    verify(value, eventType);
  } catch (error) {
    expect(error).toMatchObject({ name: 'WrappError', code: 'WEBHOOK_INVALID' });
    return;
  }
  throw new Error('Expected ' + eventType + ' to refuse the body');
}
function omit(record: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}
describe('webhook event families', () => {
  it('should normalize the issued-invoice body to an invoice observation', () => {
    expect(verify(bodies['issued-invoice'](), 'issued-invoice')).toEqual({
      kind: 'invoice-observation',
      invoice: {
        id: 'invoice-one',
        external_id: 'reference-one',
        my_data_mark: '90071992547409931234',
        my_data_uid: 'uid-one',
        my_data_qr_url: 'https://example.invalid/qr',
        series: 'S',
        num: '1',
        issued_at: '2026-09-21',
        cancelled_by_mark: null,
        transmission_failure: null,
        wrapp_invoice_url: 'https://example.invalid/el',
        wrapp_invoice_url_en: 'https://example.invalid/en',
        catering_table_id: null,
        authentication_code: 'SYNTHETIC-AUTHENTICATION-CODE',
        card_type: 'SYNTHETIC',
        card_number: 'XXXX-XXXX-XXXX-0000',
        transaction_id: 'transaction-one',
      },
      eventTypeHint: 'issued-invoice',
      eventTypeAuthenticated: false,
    });
  });
  it('should normalize the pos-payment body to a POS payment error with the provider text as data', () => {
    expect(verify(bodies['pos-payment'](), 'pos-payment')).toEqual({
      kind: 'pos-payment-error',
      invoiceId: 'invoice-one',
      providerMessage: posMessage,
      eventTypeHint: 'pos-payment',
      eventTypeAuthenticated: false,
    });
  });
  it.each(['invoice-pdf', 'thermal-print-pdf'] as const)(
    'should normalize the %s body to a PDF notice',
    (hint) => {
      expect(verify(bodies[hint](), hint)).toEqual({
        kind: 'pdf',
        invoiceId: 'invoice-one',
        downloadUrl: 'https://example.invalid/pdf',
        eventTypeHint: hint,
        eventTypeAuthenticated: false,
      });
    },
  );
  it('should let the PDF header change nothing but the unauthenticated hint', () => {
    const normal = verify(bodies['invoice-pdf'](), 'invoice-pdf');
    const thermal = verify(bodies['invoice-pdf'](), 'thermal-print-pdf');
    expect(normal.eventTypeHint).toBe('invoice-pdf');
    expect(thermal.eventTypeHint).toBe('thermal-print-pdf');
    expect(omit(thermal, 'eventTypeHint')).toEqual(omit(normal, 'eventTypeHint'));
    expect(normal.eventTypeAuthenticated).toBe(false);
    expect(thermal.eventTypeAuthenticated).toBe(false);
  });
  it.each(hints)('should return a deeply frozen %s result without touching the network', (hint) => {
    const fetched = vi.spyOn(globalThis, 'fetch');
    const result = verify(bodies[hint](), hint);
    expect(Object.isFrozen(result)).toBe(true);
    if (result.kind === 'invoice-observation') expect(Object.isFrozen(result.invoice)).toBe(true);
    expect(result.eventTypeAuthenticated).toBe(false);
    expect(fetched).not.toHaveBeenCalled();
    fetched.mockRestore();
  });
  it.each(hints)(
    'should tolerate unrelated additive fields on a %s body without copying them',
    (hint) => {
      const result = verify(
        { ...bodies[hint](), future_field: { nested: [1] }, another: 'x' },
        hint,
      );
      expect(result).toEqual(verify(bodies[hint](), hint));
      expect(JSON.stringify(result)).not.toContain('future_field');
    },
  );
  it.each(hints)('should reject a %s body under every other event family', (hint) => {
    const family = (name: Hint) => (name === 'thermal-print-pdf' ? 'invoice-pdf' : name);
    for (const other of hints) if (family(other) !== family(hint)) refuses(bodies[hint](), other);
    for (const unknown of ['unknown', '', hint.toUpperCase(), hint + ' ', 'issued_invoice'])
      refuses(bodies[hint](), unknown);
  });
  it.each(hints)('should still authenticate the raw bytes first for %s', (hint) => {
    const body = Buffer.from(JSON.stringify(bodies[hint]()));
    const signature = sign(body);
    const attempt = (changed: Partial<Parameters<typeof verifyWebhook>[0]>) => () =>
      verifyWebhook({ body, signature, keys: [key], eventType: hint, ...changed });
    expect(attempt({})).not.toThrow();
    expect(attempt({ body: Buffer.concat([body, Buffer.from(' ')]) })).toThrow(WrappError);
    expect(attempt({ keys: ['another-key'] })).toThrow(WrappError);
    expect(attempt({ signature: signature + ', ' + signature })).toThrow(WrappError);
    expect(attempt({ signature: signature.slice(1) })).toThrow(WrappError);
    expect(attempt({ maxBodyBytes: body.byteLength - 1 })).toThrow(WrappError);
  });
  it.each(hints)(
    'should reject a correctly signed %s body with a duplicate key or invalid UTF-8',
    (hint) => {
      const text = JSON.stringify(bodies[hint]());
      const duplicated = Buffer.from(text.replace('"invoice_id"', '"invoice_id":"x","invoice_id"'));
      const duplicatedId = Buffer.from(text.replace('"id"', '"id":"x","id"'));
      for (const body of [hint === 'issued-invoice' ? duplicatedId : duplicated])
        expect(() =>
          verifyWebhook({ body, signature: sign(body), keys: [key], eventType: hint }),
        ).toThrow(WrappError);
      const broken = Buffer.concat([
        Buffer.from(text.slice(0, -1)),
        Buffer.from([0xff]),
        Buffer.from('}'),
      ]);
      expect(() =>
        verifyWebhook({ body: broken, signature: sign(broken), keys: [key], eventType: hint }),
      ).toThrow(WrappError);
    },
  );
  it('should reject bodies that mix two event families under every hint', () => {
    const observed = bodies['issued-invoice']();
    const pdf = bodies['invoice-pdf']();
    const pos = bodies['pos-payment']();
    const mixed = [
      { ...observed, download_url: pdf.download_url },
      { ...observed, invoice_id: 'invoice-one', download_url: pdf.download_url },
      { ...observed, errors: posMessage },
      { ...observed, errors: posMessage, invoice_id: 'invoice-one' },
      { ...pos, download_url: pdf.download_url },
      { ...pdf, errors: posMessage },
      { ...pdf, series: 'S' },
      { ...pdf, num: 1 },
      { ...pos, series: 'S' },
      { ...pos, num: 1 },
    ];
    for (const body of mixed) for (const hint of hints) refuses(body, hint);
  });
  it('should drop a stray non-defining field instead of treating it as another family', () => {
    const stray = { id: 'invoice-one', external_id: 'reference-one', my_data_mark: 'mark-one' };
    for (const hint of ['invoice-pdf', 'thermal-print-pdf', 'pos-payment'] as const) {
      const result = verify({ ...bodies[hint](), ...stray }, hint);
      expect(result).toEqual(verify(bodies[hint](), hint));
      // The same bytes still cannot verify as an observation.
      refuses({ ...bodies[hint](), ...stray }, 'issued-invoice');
    }
  });
  it('should never verify one signed body as two kinds, whatever fields it combines', () => {
    const pool: Record<string, unknown> = {
      ...bodies['issued-invoice'](),
      ...bodies['invoice-pdf'](),
      ...bodies['pos-payment'](),
      status: 'pending',
      error: 'x',
    };
    const reached = new Set<string>();
    fc.assert(
      fc.property(fc.subarray(Object.keys(pool)), (keys) => {
        const body = Buffer.from(JSON.stringify(Object.fromEntries(keys.map((k) => [k, pool[k]]))));
        const kinds = new Set<string>();
        for (const eventType of hints) {
          try {
            kinds.add(verifyWebhook({ body, signature: sign(body), keys: [key], eventType }).kind);
          } catch {
            // Refused under this hint.
          }
        }
        for (const kind of kinds) reached.add(kind);
        expect(kinds.size).toBeLessThanOrEqual(1);
      }),
      {
        seed: 40917,
        numRuns: 2000,
        // The three complete families, so the property is exercised on bodies that do verify.
        examples: [
          [Object.keys(bodies['issued-invoice']())],
          [Object.keys(bodies['invoice-pdf']())],
          [Object.keys(bodies['pos-payment']())],
        ],
      },
    );
    expect([...reached].sort()).toEqual(['invoice-observation', 'pdf', 'pos-payment-error']);
  });
  it('should reject rejection and status envelopes instead of reading them as an event', () => {
    for (const hint of hints) {
      const base = bodies[hint]();
      refuses({ ...base, status: 'pending' }, hint);
      refuses({ ...base, error: 'x' }, hint);
      if (hint !== 'pos-payment') refuses({ ...base, errors: [{ title: 'x' }] }, hint);
    }
    // The HTTP rejection shape is not the POS error shape.
    refuses({ errors: [{ title: 'x' }], invoice_id: 'invoice-one' }, 'pos-payment');
    refuses({ errors: { message: 'x' }, invoice_id: 'invoice-one' }, 'pos-payment');
  });
  it('should keep refusing a pending envelope on the issued-invoice event', () => {
    // The reference documents no status or invoice_id on this webhook; nothing is assumed.
    refuses(enrichedPending(), 'issued-invoice');
    refuses({ ...observation(), invoice_id: 'invoice-one' }, 'issued-invoice');
    refuses({ status: 'pending', invoice_id: 'invoice-one' }, 'issued-invoice');
  });
  it('should report a transmission-failure observation with no MARK as an observation only', () => {
    const result = verify(
      fullObservation({ my_data_mark: null, authentication_code: null, transmission_failure: 2 }),
      'issued-invoice',
    );
    expect(result).toMatchObject({
      kind: 'invoice-observation',
      invoice: {
        my_data_mark: null,
        authentication_code: null,
        transmission_failure: '2',
        my_data_uid: 'uid-one',
      },
      eventTypeAuthenticated: false,
    });
    // Nothing on the result states that issuance completed.
    expect(Object.keys(result).sort()).toEqual(
      ['eventTypeAuthenticated', 'eventTypeHint', 'invoice', 'kind'].sort(),
    );
  });
  it.each([
    { label: 'an empty message', errors: '', kept: '' },
    { label: 'a multi-line message', errors: 'line one\nline two', kept: 'line one\nline two' },
    { label: 'a 4096-unit message', errors: 'x'.repeat(4096), kept: 'x'.repeat(4096) },
  ])('should keep $label of a POS error exactly', ({ errors, kept }) => {
    expect(verify({ errors, invoice_id: 'invoice-one' }, 'pos-payment')).toMatchObject({
      kind: 'pos-payment-error',
      providerMessage: kept,
    });
  });
  it.each([
    { label: 'an overlong message', body: { errors: 'x'.repeat(4097), invoice_id: 'invoice-one' } },
    { label: 'a numeric message', body: { errors: 1000, invoice_id: 'invoice-one' } },
    { label: 'a null message', body: { errors: null, invoice_id: 'invoice-one' } },
    { label: 'a missing message', body: { invoice_id: 'invoice-one' } },
    { label: 'a missing invoice id', body: { errors: posMessage } },
    { label: 'an empty invoice id', body: { errors: posMessage, invoice_id: '' } },
    { label: 'a path-like invoice id', body: { errors: posMessage, invoice_id: '../x' } },
    { label: 'a numeric invoice id', body: { errors: posMessage, invoice_id: 42 } },
  ])('should reject a POS error with $label', ({ body }) => {
    refuses(body, 'pos-payment');
  });
  it.each([null, 42, 'text', [], [bodies['invoice-pdf']()]])(
    'should reject the non-object body %j under every hint',
    (value) => {
      for (const hint of hints) refuses(value, hint);
    },
  );
});
