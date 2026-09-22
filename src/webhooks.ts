import { createHmac, timingSafeEqual } from 'node:crypto';
import { decode, observationSchema, parseJson, webhookPdfSchema } from './codecs.js';
import { WrappError } from './errors.js';
import { freeze } from './values.js';
import type { VerifiedWebhook } from './types.js';

/** Raw webhook material. Verification consumes the untouched bytes; never re-serialize. */
export interface WebhookInput {
  /** The request body exactly as received; any transformation invalidates the signature. */
  readonly body: Uint8Array;
  /** Pass the single raw header value. Combined/duplicate header values are rejected. */
  readonly signature: string;
  /** Unauthenticated routing hint, not part of the signed body. */
  readonly eventType: string;
  /** One to five verification keys, allowing bounded rotation. Order is irrelevant. */
  readonly keys: readonly string[];
  /** Defaults to 2 MiB; hard-capped at 8 MiB. Larger bodies are rejected before hashing. */
  readonly maxBodyBytes?: number;
}
/**
 * Authenticates bytes, not freshness, event type or tenant identity. Performs no I/O.
 * Verifies a hex HMAC-SHA256 signature in constant time before any parsing.
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
    if (
      value !== null &&
      typeof value === 'object' &&
      ('errors' in value || 'error' in value || 'status' in value)
    )
      throw new Error();
    if (input.eventType === 'issued-invoice')
      return freeze({
        kind: 'issued-invoice',
        invoice: decode(observationSchema, value, 'webhook'),
        eventTypeAuthenticated: false,
      });
    if (input.eventType === 'invoice-pdf') {
      const data = decode(webhookPdfSchema, value, 'webhook');
      return freeze({
        kind: 'invoice-pdf',
        invoiceId: data.invoice_id,
        downloadUrl: data.download_url,
        eventTypeAuthenticated: false,
      });
    }
    throw new Error();
  } catch {
    throw new WrappError('WEBHOOK_INVALID', 'webhook');
  }
}
