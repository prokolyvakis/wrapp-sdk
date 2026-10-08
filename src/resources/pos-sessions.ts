import { decode, identifier, input } from '../codecs.js';
import { WrappError } from '../errors.js';
import type { AcknowledgementOutcome } from '../invoice-lifecycle-types.js';
import { posSessionAbortSchema } from '../pos-codecs.js';
import type { PosSessionResource } from '../pos-types.js';
import { refused } from '../runtime.js';
import type { Report, Runtime } from '../runtime.js';
import type { RequestOptions } from '../types.js';
import { freeze } from '../values.js';

function aborted(value: unknown, report: Report): AcknowledgementOutcome {
  const keyed = value !== null && typeof value === 'object' ? value : {};
  // The message identifies the success answer. Beside an error field, or a status, the
  // answer cannot say what happened and is neither a rejection nor a success.
  if ('message' in keyed && ('errors' in keyed || 'error' in keyed || 'status' in keyed))
    throw new WrappError('PROTOCOL_ERROR', 'posSessionAbort');
  const outcome = refused(value, report);
  if (outcome !== undefined) return outcome;
  decode(posSessionAbortSchema, value, 'posSessionAbort');
  return freeze({ kind: 'acknowledged' });
}

export function posSessionResource(runtime: Runtime): PosSessionResource {
  return {
    abort: async (invoiceId: string, opts?: RequestOptions) => {
      const valid = input(identifier, invoiceId, 'posSessionAbort');
      return runtime.run(
        'posSessionAbort',
        '/pos_sessions/' + encodeURIComponent(valid) + '/abort_session',
        aborted,
        opts,
      );
    },
  };
}
