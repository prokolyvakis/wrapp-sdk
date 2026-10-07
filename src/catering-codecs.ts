import { z } from 'zod';
import {
  httpsUrl,
  identifier,
  instant,
  integer,
  integerString,
  nonempty,
  numericText,
  text,
} from './codecs.js';

// A table's status is data about the table, kept verbatim. It is not the reserved envelope
// key of other answers, and a value outside the documented four is returned, not refused.
const summaryFields = {
  id: identifier,
  status: nonempty,
  // Either JSON form of a name is kept as its exact text.
  name: z.union([text, integerString]),
  total: numericText,
};
export const cateringTableSummariesSchema = z.array(z.object(summaryFields)).max(10_000);
export const cateringTableSchema = z.object({
  ...summaryFields,
  invoices: z.array(identifier).max(10_000).exactOptional(),
  error_message: text.nullable().exactOptional(),
});
// The provider answers a create without a name with HTTP 400, so the name is required here.
export const cateringTableCreateSchema = z.strictObject({ name: nonempty });
export const cateringTableUpdateSchema = z.strictObject({ name: nonempty });
// The reference requires one of the two and states no rule for both: both are sent as given.
export const cateringTableOpenSchema = z
  .strictObject({ id: identifier.optional(), name: nonempty.optional() })
  .refine((v) => v.id !== undefined || v.name !== undefined);
// Sent as query parameters. An empty marks list cannot be written in a query and would read
// as no marks at all, which moves every open note: it is refused, never reinterpreted.
export const cateringTableTransferSchema = z.strictObject({
  current_table: identifier,
  target_table: identifier,
  marks: z.array(nonempty).min(1).max(100).optional(),
});

export const openOrderNotesInputSchema = z.strictObject({
  page: z.number().int().min(1).max(1_000_000).optional(),
});
// Its own page: 20 summary records, and no total count in the reference.
export const openOrderNotesPageSchema = z.object({
  invoices: z
    .array(
      z.object({
        id: identifier,
        my_data_mark: nonempty.nullable(),
        issued_at: instant,
        catering_table_id: identifier.nullable(),
      }),
    )
    .max(20),
  total_pages: integer,
  current_page: integer,
});
export const orderNoteCancellationInputSchema = z.strictObject({
  billing_book_id: identifier,
  correlated_invoices: z.array(nonempty).min(1).max(100),
  catering_table_id: identifier.optional(),
});
// The receipt of the cancelling invoice. The reference documents no issue date and no
// external reference for it, so none is carried.
export const orderNoteCancellationSchema = z.object({
  id: identifier,
  my_data_mark: nonempty.nullable(),
  my_data_uid: nonempty.nullable(),
  my_data_qr_url: httpsUrl.nullable(),
  series: text,
  num: integerString,
  wrapp_invoice_url: httpsUrl,
  wrapp_invoice_url_en: httpsUrl,
});
