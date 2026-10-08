import { z } from 'zod';
import { decode, identifier, nonempty, text } from './codecs.js';

const terminal_id = nonempty;
const merchant_id = nonempty;
// One strict shape per credential the reference documents; the other credential is an
// unknown key there and is refused.
export const posDeviceCreateSchema = z.discriminatedUnion('pos_type', [
  z.strictObject({ pos_type: z.literal('viva'), name: nonempty, terminal_id, merchant_id }),
  z.strictObject({
    pos_type: z.literal('worldline_softpos'),
    name: nonempty.optional(),
    terminal_id,
    merchant_id,
  }),
  z.strictObject({
    pos_type: z.enum([
      'epay',
      'worldline',
      'nbg',
      'cosmote',
      'jcc',
      'attica',
      'pancreta',
      'tora',
      'pbt',
      'mypos',
      'nexi-mellon',
      'nexi',
      'nbg_edps',
    ]),
    name: nonempty,
    terminal_id,
    authorization_code: nonempty,
  }),
]);
export const posDeviceSchema = z.object({
  id: identifier,
  name: text,
  terminal_id: text.nullable().exactOptional(),
  merchant_id: text.nullable().exactOptional(),
});
export const posDevicesSchema = z.array(posDeviceSchema).max(10_000);
export const posSessionAbortSchema = z.object({ message: nonempty });
const fieldErrorsSchema = z
  .record(text, z.array(text).min(1).max(100))
  .refine((fields) => Object.keys(fields).length > 0);
/**
 * Device registration reports a refusal as an object of field name to messages. It is
 * rewritten to the list form, one entry per message, so that the shared rejection rules and
 * the opt-in diagnostics apply to it unchanged. Any other answer is returned as it is.
 */
export function fieldErrors(value: unknown, operation: string): unknown {
  if (value === null || typeof value !== 'object' || !('errors' in value)) return value;
  const errors = value.errors;
  if (errors === null || typeof errors !== 'object' || Array.isArray(errors)) return value;
  const fields = decode(fieldErrorsSchema, errors, operation);
  return {
    ...value,
    errors: Object.entries(fields).flatMap(([title, messages]) =>
      messages.map((message) => ({ title, message })),
    ),
  };
}
