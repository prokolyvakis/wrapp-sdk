import { z } from 'zod';
import { identifier, instant, integer, nonempty, text } from './codecs.js';

const member = (values: readonly number[]) => z.number().refine((v) => values.includes(v));
const legFields = {
  vehicle_number: nonempty,
  transport_type: member([1, 2, 3, 4, 5, 6, 7]),
  carrier_vat_number: nonempty,
};
export const transportLegSchema = z.strictObject(legFields);
export const transportCreateSchema = z.strictObject({ invoice_id: identifier, ...legFields });
export const transportListSchema = z.strictObject({
  category: z.enum(['shipping', 'receiving']).optional(),
  page: z.number().int().min(1).max(1_000_000).optional(),
});
export const transportRejectSchema = z.strictObject({ reject_reason: text.optional() });
export const confirmDeliverySchema = z.strictObject({
  outcome: z.enum(['FULL', 'PARTIAL', 'NONE']),
  delivered_packaging: z
    .array(
      z.strictObject({
        packaging_type: member([1, 2, 3, 4, 5, 6]),
        quantity: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        // Optional for every type: the reference says it applies to type 6 and states no
        // rule that requires it there or forbids it elsewhere.
        other_packaging_title: text.optional(),
      }),
    )
    .max(100)
    .optional(),
});
// Status and category are the provider's text, kept verbatim. my_data_response is read from
// the raw value and mapped separately, so it is not part of this shape.
export const transportSchema = z.object({
  id: identifier,
  category: nonempty,
  status: nonempty,
  invoice_id: identifier.nullable().exactOptional(),
  invoice_issued_at: instant.nullable().exactOptional(),
  invoice_code: text.nullable().exactOptional(),
  last_status_update_at: instant.nullable().exactOptional(),
});
export const transportWrapperSchema = z.object({ digital_transport: z.unknown() });
// Its own page: 10 records, and no total count in the reference.
export const transportPageSchema = z.object({
  digital_transports: z.array(z.unknown()).max(10),
  total_pages: integer,
  current_page: integer,
});
