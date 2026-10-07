import {
  bookSchema,
  booksSchema,
  decode,
  encodeJson,
  identifier,
  input,
  rejection,
} from '../codecs.js';
import { WrappError } from '../errors.js';
import {
  billingBookCreateSchema,
  billingBookNumberSchema,
  billingBookReceiptSchema,
} from '../management-codecs.js';
import type {
  BillingBookCreateOutcome,
  BillingBookNumberOutcome,
  BillingBookResource,
  CreateBillingBookInput,
} from '../management-types.js';
import { readValue, refused } from '../runtime.js';
import type { Runtime } from '../runtime.js';
import type { RequestOptions } from '../types.js';
import { freeze } from '../values.js';

export function billingBookResource(runtime: Runtime): BillingBookResource {
  return {
    list: (opts?: RequestOptions) =>
      runtime.run(
        'billingBooks',
        '/billing_books',
        (v, report) => decode(booksSchema, readValue(v, report), 'billingBooks'),
        opts,
      ),
    create: async (book: CreateBillingBookInput, opts?: RequestOptions) => {
      const data = input(billingBookCreateSchema, book, 'billingBookCreate');
      return runtime.run(
        'billingBookCreate',
        '/billing_books',
        (value, report): BillingBookCreateOutcome => {
          const refusal = rejection(value);
          if (refusal !== undefined) {
            const outcome = freeze({
              kind: 'rejected',
              errorCount: refusal.errorCount,
              rejectionSource: refusal.source,
            } as const);
            report(outcome, value);
            return outcome;
          }
          // A rejection envelope may name its family in `status`; a success answer documents no
          // status, so one found here is refused, not ignored.
          if (value !== null && typeof value === 'object' && 'status' in value)
            throw new WrappError('PROTOCOL_ERROR', 'billingBookCreate');
          // The returned type is kept as the provider gives it: it may be the family of the
          // one requested, so it is not compared with the request.
          return freeze({
            kind: 'observed',
            billingBook: decode(billingBookReceiptSchema, value, 'billingBookCreate'),
          });
        },
        opts,
        encodeJson(data),
      );
    },
    updateNumber: async (
      billingBookId: string,
      change: Readonly<{ number: number }>,
      opts?: RequestOptions,
    ) => {
      const valid = input(identifier, billingBookId, 'billingBookUpdateNumber');
      const data = input(billingBookNumberSchema, change, 'billingBookUpdateNumber');
      return runtime.run(
        'billingBookUpdateNumber',
        '/billing_books/' + encodeURIComponent(valid),
        (value, report): BillingBookNumberOutcome => {
          const outcome = refused(value, report);
          if (outcome !== undefined) return outcome;
          if (value !== null && typeof value === 'object' && 'status' in value)
            throw new WrappError('PROTOCOL_ERROR', 'billingBookUpdateNumber');
          const billingBook = decode(bookSchema, value, 'billingBookUpdateNumber');
          // Another book's record says nothing about this one.
          if (billingBook.id !== valid)
            throw new WrappError('PROTOCOL_ERROR', 'billingBookUpdateNumber');
          return freeze({ kind: 'observed', billingBook });
        },
        opts,
        encodeJson(data),
      );
    },
  };
}
