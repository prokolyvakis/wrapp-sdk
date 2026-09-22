import { createHmac } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decimal, verifyWebhook, WrappError } from '../../src/index.js';
import {
  encodeJson,
  createSchema,
  input,
  parseJson,
  numericText,
  decode,
} from '../../src/codecs.js';
import { invoice, provider, json, login, tenant, details } from '../fixtures/provider.js';

describe('safety properties', () => {
  it('should obey an isolated authentication model across expiry and 401 sequences', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom('read', 'expire', 'unauthorized'), {
          minLength: 1,
          maxLength: 15,
        }),
        async (events) => {
          let now = 0,
            logins = 0,
            reject = false,
            cached = false,
            expectedLogins = 0;
          const { client } = provider(
            ({ url }) => {
              if (url.pathname.endsWith('/login')) {
                logins++;
                return login('token.' + String(logins));
              }
              return json(tenant(), reject ? 401 : 200);
            },
            { advanced: { now: () => now } },
          );
          for (const event of events) {
            if (event === 'expire') {
              now += 86_400_000;
              cached = false;
            }
            reject = event === 'unauthorized';
            if (!cached) expectedLogins++;
            if (reject)
              await expect(client.tenant.get()).rejects.toMatchObject({ code: 'AUTH_ERROR' });
            else await client.tenant.get();
            cached = !reject;
            expect(logins).toBe(expectedLogins);
          }
        },
      ),
      { seed: 43111, numRuns: 30 },
    );
  });
  it('should either exhaust the bounded inventory or report truncation explicitly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 6 }),
        async (pages, maxPages) => {
          let reads = 0;
          const { client } = provider(({ url }) => {
            if (url.pathname.endsWith('/login')) return login();
            const page = Number(url.searchParams.get('page'));
            reads++;
            return json({
              invoices: [details({ id: 'invoice-' + String(page) })],
              total_count: pages,
              total_pages: pages,
              current_page: page,
            });
          });
          const records = [];
          try {
            for await (const record of client.invoices.iterate({}, { maxPages }))
              records.push(record);
            expect(maxPages).toBeGreaterThanOrEqual(pages);
          } catch (error) {
            expect(error).toMatchObject({ code: 'PAGINATION_LIMIT' });
            expect(maxPages).toBeLessThan(pages);
          }
          expect(reads).toBe(Math.min(pages, maxPages));
          expect(records).toHaveLength(Math.min(pages, maxPages));
        },
      ),
      { seed: 70121, numRuns: 30 },
    );
  });
  it('should round-trip exact amounts without binary-number coercion', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 99999999999999999999n }), (minor) => {
        const amount = `${String(minor / 100n)}.${String(minor % 100n).padStart(2, '0')}`;
        const value = { ...invoice(), total_amount: decimal(amount) };
        const encoded = encodeJson(input(createSchema, value, 'create'));
        expect(encoded).toContain(`"total_amount":${amount}`);
        expect(decode(numericText, parseJson(amount), 'property')).toBe(amount);
      }),
      { seed: 214031, numRuns: 150 },
    );
  });
  it('should reject every single-byte body mutation with the original signature', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 63 }), (index) => {
        const body = Buffer.from('{"invoice_id":"i","download_url":"https://example.invalid/pdf"}');
        const signature = createHmac('sha256', 'synthetic-key').update(body).digest('hex');
        const offset = index % body.length;
        body[offset] = (body[offset] ?? 0) ^ 1;
        expect(() =>
          verifyWebhook({ body, signature, keys: ['synthetic-key'], eventType: 'invoice-pdf' }),
        ).toThrow(WrappError);
      }),
      { seed: 90041, numRuns: 100 },
    );
  });
});
