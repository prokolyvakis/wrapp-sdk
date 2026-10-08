import { z } from 'zod';
import {
  httpsUrl,
  identifier,
  integerString,
  nonempty,
  returnedReference,
  text,
} from './codecs.js';

// The count is kept as exact integer text, up to 30 digits, so no JSON number is ever
// narrowed to a double on the way through.
export const issuedCountSchema = z.object({ issued_count: integerString });
// The cancellation response has its own, shorter field set than an invoice observation.
export const cancellationSchema = z.object({
  id: identifier,
  my_data_mark: nonempty.nullable(),
  my_data_uid: nonempty.nullable(),
  my_data_qr_url: httpsUrl.nullable(),
  series: text,
  num: integerString,
  cancelled_by_mark: nonempty.nullable(),
  wrapp_invoice_url: httpsUrl,
  wrapp_invoice_url_en: httpsUrl,
});
// For these operations a status text is the documented success answer, not an envelope to
// refuse. Its wording is validated as present and then dropped.
export const acknowledgementSchema = z.object({ status: nonempty });
// The provider documents a status and the echoed reference. An id is accepted when present
// so that it can be checked, but is not required.
export const externalIdAssignmentSchema = z.object({
  status: nonempty,
  external_id: returnedReference,
  id: identifier.exactOptional(),
});
export const externalIdInputSchema = z.strictObject({ external_id: identifier });
