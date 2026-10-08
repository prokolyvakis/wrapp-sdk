import { decode, encodeJson, identifier, input, rejection } from '../codecs.js';
import {
  clienteleCancellationSchema,
  clienteleCreateSchema,
  clienteleSchema,
  clienteleUpdateSchema,
  correlateByFimSchema,
  correlateByMarkSchema,
  correlationNoticeSchema,
  correlationRefusalSchema,
} from '../digital-clientele-codecs.js';
import type {
  ClienteleCancellationOutcome,
  ClienteleCorrelationOutcome,
  CreateDigitalClienteleInput,
  DigitalClientele,
  DigitalClienteleOutcome,
  DigitalClienteleResource,
  UpdateDigitalClienteleInput,
} from '../digital-clientele-types.js';
import { WrappError } from '../errors.js';
import { rejected } from '../runtime.js';
import type { Report, Runtime } from '../runtime.js';
import type { RequestOptions } from '../types.js';
import { freeze } from '../values.js';

// This family reports a refusal either as the usual list or as one string under `errors`.
// The string form is rewritten to the single-`error` form so that the shared rejection rules
// apply to it unchanged: no identifying evidence beside it, and a status only when it names a
// known rejection family. `detail` is what diagnostics may retain.
function family(value: unknown, operation: string): { envelope: unknown; detail: unknown } {
  const keyed = value !== null && typeof value === 'object' ? value : {};
  // A notice identifies a success answer. Beside any error field, or a status, the answer
  // cannot say what happened and is neither a rejection nor a success.
  if ('notice' in keyed && ('errors' in keyed || 'error' in keyed || 'status' in keyed))
    throw new WrappError('PROTOCOL_ERROR', operation);
  if (!('errors' in keyed) || typeof keyed.errors !== 'string')
    return { envelope: value, detail: value };
  const text = decode(correlationRefusalSchema, value, operation).errors;
  const others = Object.entries(keyed).filter(([key]) => key !== 'errors' && key !== 'error');
  return { envelope: { ...Object.fromEntries(others), error: text }, detail: { error: text } };
}
function refusal(value: unknown, report: Report, operation: string) {
  const { envelope, detail } = family(value, operation);
  const found = rejection(envelope);
  if (found === undefined) return undefined;
  const outcome = freeze({
    kind: 'rejected',
    errorCount: found.errorCount,
    rejectionSource: found.source,
  } as const);
  report(outcome, detail);
  return outcome;
}
function correlation(
  value: unknown,
  report: Report,
  operation: string,
): ClienteleCorrelationOutcome {
  const outcome = refusal(value, report, operation);
  if (outcome !== undefined) return outcome;
  decode(correlationNoticeSchema, value, operation);
  return freeze({ kind: 'acknowledged' });
}
// `expected`, when given, is the id the returned entry must carry.
function entry(value: unknown, operation: string, expected?: string): DigitalClientele {
  const record = decode(clienteleSchema, value, operation);
  if (expected !== undefined && record.id !== expected)
    throw new WrappError('PROTOCOL_ERROR', operation);
  return record;
}
function written(
  value: unknown,
  report: Report,
  operation: string,
  expected?: string,
): DigitalClienteleOutcome {
  return (
    refusal(value, report, operation) ??
    freeze({ kind: 'observed', clientele: entry(value, operation, expected) })
  );
}

export function digitalClienteleResource(runtime: Runtime): DigitalClienteleResource {
  return {
    get: async (clienteleId: string, opts?: RequestOptions) => {
      const valid = input(identifier, clienteleId, 'clientele');
      return runtime.run(
        'clientele',
        '/digital_clienteles/' + encodeURIComponent(valid),
        (value, report) => {
          const { envelope, detail } = family(value, 'clientele');
          if (rejection(envelope) !== undefined) throw rejected('clientele', detail, report);
          return entry(value, 'clientele', valid);
        },
        opts,
      );
    },
    create: async (data: CreateDigitalClienteleInput, opts?: RequestOptions) => {
      const body = input(clienteleCreateSchema, data, 'clienteleCreate');
      return runtime.run(
        'clienteleCreate',
        '/digital_clienteles',
        (value, report) => written(value, report, 'clienteleCreate'),
        opts,
        encodeJson(body),
      );
    },
    update: async (
      clienteleId: string,
      patch: UpdateDigitalClienteleInput,
      opts?: RequestOptions,
    ) => {
      const valid = input(identifier, clienteleId, 'clienteleUpdate');
      const body = input(clienteleUpdateSchema, patch, 'clienteleUpdate');
      return runtime.run(
        'clienteleUpdate',
        '/digital_clienteles/' + encodeURIComponent(valid),
        (value, report) => written(value, report, 'clienteleUpdate', valid),
        opts,
        encodeJson(body),
      );
    },
    cancel: async (clienteleId: string, opts?: RequestOptions) => {
      const valid = input(identifier, clienteleId, 'clienteleCancel');
      return runtime.run(
        'clienteleCancel',
        '/digital_clienteles/' + encodeURIComponent(valid) + '/cancel',
        (value, report): ClienteleCancellationOutcome => {
          const outcome = refusal(value, report, 'clienteleCancel');
          if (outcome !== undefined) return outcome;
          const answer = decode(clienteleCancellationSchema, value, 'clienteleCancel');
          return freeze({ kind: 'acknowledged', cancellationId: answer.cancellation_id });
        },
        opts,
      );
    },
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
