import { z } from 'zod';
import {
  identifier,
  inputAmount,
  instant,
  isoDate,
  nonempty,
  numericText,
  text,
} from './codecs.js';

// Two distinct, strict bodies: neither route accepts the other's fields.
export const correlateByMarkSchema = z.strictObject({ correlate_mark: nonempty });
export const correlateByFimSchema = z.strictObject({
  correlate_fim_number: nonempty,
  correlate_fim_aa: nonempty,
});
export const correlationNoticeSchema = z.object({ notice: nonempty });
// This family reports a refusal as one string under `errors`, not as the usual list.
export const correlationRefusalSchema = z.object({ errors: nonempty });

// An entry as the provider was observed to return it: JSON null where nothing is set and real
// booleans. The reference shows the same fields as strings and empty text; a flag that arrives
// as text is refused here, never read as true or false. Codes, dates and statuses are kept
// verbatim.
const value = text.nullable().exactOptional();
const flag = z.boolean().nullable().exactOptional();
export const clienteleSchema = z.object({
  id: identifier,
  iddcl: value,
  client_service_type: nonempty,
  creation_date_time: value,
  entity_vat_number: value,
  branch: value,
  recurring_service: flag,
  continuous_service: flag,
  continuous_lease_service: flag,
  from_agreed_period_date: value,
  to_agreed_period_date: value,
  mixed_service: flag,
  customer_vat_number: value,
  customer_country: value,
  status: nonempty,
  transmission_failure: flag,
  correlated_dc_id: value,
  comments: value,
  vehicle_registration_number: value,
  foreign_vehicle_registration_number: value,
  vehicle_category: value,
  vehicle_factory: value,
  vehicle_movement_purpose: value,
  is_diff_veh_pickup_location: flag,
  vehicle_pickup_location: value,
  periodicity: value,
  periodicity_other: value,
  entry_completion: flag,
  non_issue_invoice: flag,
  amount: numericText.nullable().exactOptional(),
  completion_date_time: value,
  is_diff_veh_return_location: flag,
  vehicle_return_location: value,
  provided_service_category: value,
  provided_service_category_other: value,
  invoice_kind: value,
  off_site_provided_service: value,
  exit_date_time: value,
  cooperating_vat_number: value,
  other_branch: value,
  reason_non_issue_type: value,
  invoice_counterparty: value,
  invoice_counterparty_country: value,
  updated_iddcl: value,
  cancellation_id: value,
});
const given = (field: unknown) => field !== undefined;
// The 24 create fields with the presence rules the reference states. A field the reference
// says applies only in one context is refused outside it; nothing is filled in.
export const clienteleCreateSchema = z
  .strictObject({
    client_service_type: z.enum(['rental', 'parkingcarwash', 'garage']),
    creation_date_time: instant.optional(),
    transmission_failure: z.boolean().optional(),
    entity_vat_number: nonempty.optional(),
    branch: nonempty,
    recurring_service: z.boolean().optional(),
    continuous_service: z.boolean().optional(),
    continuous_lease_service: z.boolean().optional(),
    from_agreed_period_date: isoDate.optional(),
    to_agreed_period_date: isoDate.optional(),
    periodicity: nonempty.optional(),
    periodicity_other: nonempty.optional(),
    mixed_service: z.boolean().optional(),
    customer_vat_number: nonempty.optional(),
    customer_country: nonempty.optional(),
    correlated_dc_id: nonempty.optional(),
    comments: text.optional(),
    vehicle_registration_number: nonempty.optional(),
    foreign_vehicle_registration_number: nonempty.optional(),
    vehicle_category: nonempty.optional(),
    vehicle_factory: nonempty.optional(),
    vehicle_movement_purpose: z.enum(['vmp_rental', 'vmp_self_use', 'vmp_free_service']).optional(),
    is_diff_veh_pickup_location: z.boolean().optional(),
    vehicle_pickup_location: nonempty.optional(),
  })
  .refine(
    (v) => given(v.vehicle_registration_number) || given(v.foreign_vehicle_registration_number),
  )
  .refine(
    (v) =>
      !given(v.foreign_vehicle_registration_number) ||
      (given(v.vehicle_category) && given(v.vehicle_factory)),
  )
  .refine((v) => v.client_service_type !== 'rental' || given(v.vehicle_movement_purpose))
  .refine(
    (v) =>
      v.continuous_service !== true ||
      (given(v.from_agreed_period_date) && given(v.to_agreed_period_date)),
  )
  .refine(
    (v) =>
      v.recurring_service !== true || (given(v.customer_vat_number) && given(v.customer_country)),
  )
  .refine((v) => !given(v.creation_date_time) || v.transmission_failure === true)
  .refine((v) => !given(v.mixed_service) || v.client_service_type === 'parkingcarwash')
  .refine(
    (v) =>
      v.client_service_type === 'rental' ||
      (!given(v.is_diff_veh_pickup_location) && !given(v.vehicle_pickup_location)),
  )
  .refine((v) => !given(v.vehicle_pickup_location) || v.is_diff_veh_pickup_location === true)
  .refine(
    (v) =>
      v.continuous_lease_service === true || (!given(v.periodicity) && !given(v.periodicity_other)),
  );
// Fourteen of the reference's fifteen update fields. off_site_provided_service is left out:
// the reference types it as an integer and tables it as text, and neither form is established.
// Rules that depend on the entry's service type are the provider's to apply: the entry is
// never read to learn it.
export const clienteleUpdateSchema = z
  .strictObject({
    entry_completion: z.boolean().optional(),
    non_issue_invoice: z.boolean().optional(),
    amount: inputAmount.optional(),
    is_diff_veh_return_location: z.boolean().optional(),
    vehicle_return_location: nonempty.optional(),
    provided_service_category: z
      .enum([
        'with_parts',
        'with_client_parts',
        'without_parts',
        'free_service',
        'other',
        'warranty_compensation',
        'by_price_list',
        'by_agreement',
        'self_use',
      ])
      .optional(),
    provided_service_category_other: nonempty.optional(),
    invoice_kind: z
      .enum(['retail_sales_receipt', 'receipt', 'invoice', 'sales_invoice'])
      .optional(),
    cooperating_vat_number: nonempty.optional(),
    other_branch: nonempty.optional(),
    reason_non_issue_type: z
      .enum(['no_invoice_free_service', 'no_invoice_self_use', 'no_invoice_compensation'])
      .optional(),
    comments: text.optional(),
    invoice_counterparty: nonempty.optional(),
    invoice_counterparty_country: nonempty.optional(),
  })
  .refine((patch) => Object.values(patch).some(given))
  .refine((v) => !given(v.vehicle_return_location) || v.is_diff_veh_return_location === true)
  .refine(
    (v) => !given(v.provided_service_category_other) || v.provided_service_category === 'other',
  );
// The cancellation answer: the notice and the id of the cancellation. A notice alone is the
// answer of a correlation and is not accepted here.
export const clienteleCancellationSchema = z.object({
  notice: nonempty,
  cancellation_id: nonempty,
});
