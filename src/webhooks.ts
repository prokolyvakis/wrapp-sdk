import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  decode,
  observationSchema,
  parseJson,
  webhookPdfSchema,
  webhookPosErrorSchema,
} from './codecs.js';
import { WrappError } from './errors.js';
import { freeze } from './values.js';
import type { VerifiedWebhook } from './types.js';

/** Raw webhook material. Verification consumes the untouched bytes; never re-serialize. */
export interface WebhookInput {
  /** The request body exactly as received; any transformation invalidates the signature. */
  readonly body: Uint8Array;
  /** Pass the single raw header value; it must be exactly 64 hex characters, so a comma-joined multi-header value fails verification. */
  readonly signature: string;
  /**
   * The Event-Type header as received: issued-invoice, invoice-pdf, thermal-print-pdf or
   * pos-payment. It is an unauthenticated routing hint, not part of the signed body.
   */
  readonly eventType: string;
  /** One to five verification keys, allowing bounded rotation. Order is irrelevant. */
  readonly keys: readonly string[];
  /** Must be between 1 byte and 8 MiB or verification fails; defaults to 2 MiB. Bodies over the limit are rejected before hashing. */
  readonly maxBodyBytes?: number;
}
/**
 * Authenticates bytes, not freshness, event type or tenant identity. Performs no I/O.
 * Verifies a hex HMAC-SHA256 signature in constant time before any parsing, then decodes the
 * body with the codec the header hint selects and refuses a body that mixes event families.
 * @throws WrappError WEBHOOK_INVALID on any failure, without distinguishing the cause.
 */
export function verifyWebhook(input: WebhookInput): VerifiedWebhook {
  try {
    const limit = input.maxBodyBytes ?? 2_097_152;
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 8_388_608 ||
      !(input.body instanceof Uint8Array) ||
      input.body.byteLength > limit ||
      typeof input.signature !== 'string' ||
      !/^[a-fA-F0-9]{64}$/.test(input.signature) ||
      !Array.isArray(input.keys) ||
      input.keys.length < 1 ||
      input.keys.length > 5
    )
      throw new Error();
    const signature = Buffer.from(input.signature, 'hex');
    let matches = 0;
    for (const key of input.keys) {
      if (typeof key !== 'string' || key.length < 1 || key.length > 16_384) throw new Error();
      const expected = createHmac('sha256', key).update(input.body).digest();
      matches += Number(timingSafeEqual(signature, expected));
    }
    if (matches === 0) throw new Error();
    const value = parseJson(new TextDecoder('utf-8', { fatal: true }).decode(input.body));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const carries = (...keys: string[]) => keys.some((key) => key in value);
    // Only the bytes are authenticated; the header merely selects a codec. Each family
    // therefore refuses a body carrying another family's defining fields instead of trimming
    // it to fit. With each codec's own required fields, that leaves no signed body able to
    // verify as two kinds; other additive fields are dropped as usual.
    switch (input.eventType) {
      case 'issued-invoice':
        // A status or invoice_id here would be a pending envelope, which the provider does not
        // document for this event; it is refused rather than assumed.
        if (carries('errors', 'error', 'status', 'invoice_id', 'download_url')) throw new Error();
        return freeze({
          kind: 'invoice-observation',
          invoice: decode(observationSchema, value, 'webhook'),
          eventTypeHint: input.eventType,
          eventTypeAuthenticated: false,
        });
      case 'invoice-pdf':
      case 'thermal-print-pdf': {
        if (carries('errors', 'error', 'status', 'series', 'num')) throw new Error();
        const data = decode(webhookPdfSchema, value, 'webhook');
        return freeze({
          kind: 'pdf',
          invoiceId: data.invoice_id,
          downloadUrl: data.download_url,
          eventTypeHint: input.eventType,
          eventTypeAuthenticated: false,
        });
      }
      case 'pos-payment': {
        if (carries('error', 'status', 'download_url', 'series', 'num')) throw new Error();
        const data = decode(webhookPosErrorSchema, value, 'webhook');
        return freeze({
          kind: 'pos-payment-error',
          invoiceId: data.invoice_id,
          providerMessage: data.errors,
          eventTypeHint: input.eventType,
          eventTypeAuthenticated: false,
        });
      }
      default:
        throw new Error();
    }
  } catch {
    throw new WrappError('WEBHOOK_INVALID', 'webhook');
  }
}
