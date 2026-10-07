import { z } from 'zod';
import { nonempty } from './codecs.js';

// Two distinct, strict bodies: neither route accepts the other's fields.
export const correlateByMarkSchema = z.strictObject({ correlate_mark: nonempty });
export const correlateByFimSchema = z.strictObject({
  correlate_fim_number: nonempty,
  correlate_fim_aa: nonempty,
});
export const correlationNoticeSchema = z.object({ notice: nonempty });
// This family reports a refusal as one string under `errors`, not as the usual list.
export const correlationRefusalSchema = z.object({ errors: nonempty });
