import { decode, encodeJson, identifier, input, rejection } from '../codecs.js';
import {
  correlateByFimSchema,
  correlateByMarkSchema,
  correlationNoticeSchema,
  correlationRefusalSchema,
} from '../digital-clientele-codecs.js';
import type {
  ClienteleCorrelationOutcome,
  DigitalClienteleResource,
} from '../digital-clientele-types.js';
import { WrappError } from '../errors.js';
import type { Report, Runtime } from '../runtime.js';
import type { RequestOptions } from '../types.js';
import { freeze } from '../values.js';

function correlation(
  value: unknown,
  report: Report,
  operation: string,
): ClienteleCorrelationOutcome {
  const keyed = value !== null && typeof value === 'object' ? value : {};
  // A notice identifies the success answer. Beside any error field, or a status, the answer
  // cannot say what happened and is neither a rejection nor a success.
  if ('notice' in keyed && ('errors' in keyed || 'error' in keyed || 'status' in keyed))
    throw new WrappError('PROTOCOL_ERROR', operation);
  // This family reports a refusal as one string under `errors`. It is rewritten to the
  // single-`error` form so that the shared rejection rules apply to it unchanged: no
  // identifying evidence beside it, and a status only when it names a known rejection family.
  let envelope: unknown = value;
  let detail: unknown = value;
  if ('errors' in keyed && typeof keyed.errors === 'string') {
    const text = decode(correlationRefusalSchema, value, operation).errors;
    const others = Object.entries(keyed).filter(([key]) => key !== 'errors' && key !== 'error');
    envelope = { ...Object.fromEntries(others), error: text };
    detail = { error: text };
  }
  const refusal = rejection(envelope);
  if (refusal !== undefined) {
    const outcome = freeze({
      kind: 'rejected',
      errorCount: refusal.errorCount,
      rejectionSource: refusal.source,
    } as const);
    report(outcome, detail);
    return outcome;
  }
  decode(correlationNoticeSchema, value, operation);
  return freeze({ kind: 'acknowledged' });
}

export function digitalClienteleResource(runtime: Runtime): DigitalClienteleResource {
  return {
    correlateByMark: async (
      clienteleId: string,
      body: Readonly<{ correlate_mark: string }>,
      opts?: RequestOptions,
    ) => {
      const valid = input(identifier, clienteleId, 'clienteleCorrelateByMark');
      const data = input(correlateByMarkSchema, body, 'clienteleCorrelateByMark');
      return runtime.run(
        'clienteleCorrelateByMark',
        '/digital_clienteles/' + encodeURIComponent(valid) + '/correlate_by_mark',
        (value, report) => correlation(value, report, 'clienteleCorrelateByMark'),
        opts,
        encodeJson(data),
      );
    },
    correlateByFim: async (
      clienteleId: string,
      body: Readonly<{ correlate_fim_number: string; correlate_fim_aa: string }>,
      opts?: RequestOptions,
    ) => {
      const valid = input(identifier, clienteleId, 'clienteleCorrelateByFim');
      const data = input(correlateByFimSchema, body, 'clienteleCorrelateByFim');
      return runtime.run(
        'clienteleCorrelateByFim',
        '/digital_clienteles/' + encodeURIComponent(valid) + '/correlate_by_fim',
        (value, report) => correlation(value, report, 'clienteleCorrelateByFim'),
        opts,
        encodeJson(data),
      );
    },
  };
}
