import { z } from 'zod';
import { Session } from './auth.js';
import { decode, input, rejection } from './codecs.js';
import { attach, transfer } from './diagnostics.js';
import { WrappError } from './errors.js';
import { acknowledgementSchema } from './invoice-lifecycle-codecs.js';
import type { AcknowledgementOutcome } from './invoice-lifecycle-types.js';
import { operations, assertActive, scope, Transport } from './transport.js';
import type { Operation } from './transport.js';
import type { ClientOptions, RequestOptions } from './types.js';
import { freeze } from './values.js';

const limit = z.number().int().min(1).max(120_000);
const optionsSchema = z.strictObject({
  environment: z.enum(['staging', 'production']),
  credentials: z.strictObject({
    apiKey: z.string().min(1).max(16_384),
    tenant: z.strictObject({
      kind: z.enum(['email', 'userId']),
      value: z.string().min(1).max(320),
    }),
  }),
  timeoutMs: limit.optional(),
  maxResponseBytes: z.number().int().min(1).max(8_388_608).optional(),
  maxRequestBytes: z.number().int().min(1).max(8_388_608).optional(),
  advanced: z
    .strictObject({
      testBaseUrl: z.string().optional(),
      fetch: z.custom<typeof globalThis.fetch>((v) => typeof v === 'function').optional(),
      now: z.custom<() => number>((v) => typeof v === 'function').optional(),
    })
    .optional(),
});
export const requestSchema = z.strictObject({
  timeoutMs: limit.optional(),
  signal: z.instanceof(AbortSignal).optional(),
  diagnostics: z.literal('provider-issues').optional(),
});
/** Retains the provider's issues for a result or error when the call opted in; otherwise a no-op. */
export type Report = (target: object, body: unknown) => void;
export function rejected(operation: string, body: unknown, report: Report): WrappError {
  const error = new WrappError('PROVIDER_REJECTED', operation);
  report(error, body);
  return error;
}
/** For reads whose only envelopes are a rejection or the resource itself. */
export function readValue(value: unknown, report: Report): unknown {
  if (rejection(value) !== undefined) throw rejected('decode', value, report);
  if (value !== null && typeof value === 'object' && 'status' in value)
    throw new WrappError('PROTOCOL_ERROR', 'decode');
  return value;
}
/** A rejection envelope as the result of a management operation, with opt-in diagnostics. */
export function refused(value: unknown, report: Report) {
  const refusal = rejection(value);
  if (refusal === undefined) return undefined;
  const outcome = freeze({
    kind: 'rejected',
    errorCount: refusal.errorCount,
    rejectionSource: refusal.source,
  } as const);
  report(outcome, value);
  return outcome;
}
/** For operations whose documented success is a status text and nothing else. */
export function acknowledgement(
  value: unknown,
  report: Report,
  operation: string,
): AcknowledgementOutcome {
  const outcome = refused(value, report);
  if (outcome !== undefined) return outcome;
  // Only the status is required. Other fields, an echoed id included, are additive and are
  // dropped; they are never read as evidence of the effect.
  decode(acknowledgementSchema, value, operation);
  // An artifact link here would be another operation's answer.
  if (value !== null && typeof value === 'object' && 'download_url' in value)
    throw new WrappError('PROTOCOL_ERROR', operation);
  return freeze({ kind: 'acknowledged' });
}
/**
 * The one capability a resource module receives: run a registered operation on a path
 * relative to the client's fixed origin. It exposes no credential, no session and no way to
 * reach another URL: the origin is a fixed prefix and a path that is not a plain relative
 * route is refused. Input validation and serialization finish before run() is called.
 */
export interface Runtime {
  run<T>(
    operation: Operation,
    path: string,
    decoder: (value: unknown, report: Report) => T,
    options?: RequestOptions,
    body?: string,
    /** Request values to redact from retained provider text, beside the credentials. */
    redact?: readonly string[],
  ): Promise<T>;
}
// Resource code passes paths it has already encoded. A path that is not a plain relative
// route on the fixed origin is an internal defect and is refused rather than sent: no empty,
// dot or encoded-dot segment, no fragment, no whitespace or control character.
function isRoute(path: string): boolean {
  const [route = ''] = path.split('?', 1);
  return (
    /^\/[\x21-\x7e]*$/.test(path) &&
    !path.includes('#') &&
    route
      .slice(1)
      .split('/')
      .every((segment) => segment !== '' && !/^(?:\.|%2e){1,2}$/i.test(segment))
  );
}
/** Builds the single tenant-isolated runtime of one client. Performs no I/O. */
export function createRuntime(options: ClientOptions): Runtime {
  const config = input(optionsSchema, options, 'configure');
  let origin =
    config.environment === 'staging'
      ? 'https://staging.wrapp.ai/api/v1'
      : 'https://wrapp.ai/api/v1';
  if (config.advanced?.testBaseUrl !== undefined) {
    try {
      const url = new URL(config.advanced.testBaseUrl);
      // The canonical comparison also rejects bare '?'/'#' separators, which leave
      // url.search/url.hash empty yet survive serialization and misroute every path.
      if (
        url.protocol !== 'http:' ||
        !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
        url.pathname !== '/api/v1' ||
        url.toString() !== url.origin + '/api/v1'
      )
        throw new Error();
      origin = url.toString();
    } catch {
      throw new WrappError('INVALID_INPUT', 'configure');
    }
  }
  const timeout = config.timeoutMs ?? 30_000;
  const maxRequestBytes = config.maxRequestBytes ?? 2_097_152;
  const apiKey = config.credentials.apiKey;
  const transport = new Transport(
    origin,
    config.advanced?.fetch ?? globalThis.fetch,
    config.maxResponseBytes ?? 2_097_152,
  );
  const session = new Session(
    transport,
    apiKey,
    config.credentials.tenant,
    timeout,
    config.advanced?.now ?? (() => performance.now()),
  );
  return Object.freeze({
    async run<T>(
      operation: Operation,
      path: string,
      decoder: (value: unknown, report: Report) => T,
      requestOptions: RequestOptions = {},
      body?: string,
      redact: readonly string[] = [],
    ): Promise<T> {
      const request = input(requestSchema, requestOptions, operation);
      if (!isRoute(path)) throw new WrappError('INVALID_INPUT', operation);
      // Every body-bearing operation is bounded here, in UTF-8 bytes, before authentication.
      if (body !== undefined && Buffer.byteLength(body) > maxRequestBytes)
        throw new WrappError('INVALID_INPUT', operation);
      const deadline = scope(request.timeoutMs ?? timeout, request.signal);
      let dispatched = false;
      let token: string | undefined;
      const optedIn = request.diagnostics !== undefined;
      const report: Report = (target, value) => {
        if (optedIn) attach(target, value, [apiKey, token ?? '', ...redact]);
      };
      try {
        assertActive(deadline.signal, operation, 'not-sent');
        token = await session.get(deadline.signal);
        assertActive(deadline.signal, operation, 'not-sent');
        dispatched = true;
        return decoder(
          await transport.send(
            operation,
            path,
            deadline.signal,
            token,
            body,
            optedIn ? report : undefined,
          ),
          report,
        );
      } catch (error) {
        if (error instanceof WrappError) {
          if (error.code === 'AUTH_ERROR' && token !== undefined) session.invalidate(token);
          const failure = new WrappError(
            error.code,
            operation,
            dispatched && operations[operation].effectful ? 'unknown' : 'not-sent',
            error.httpStatus,
          );
          // The caller only ever sees this replacement, so retained detail must follow it.
          transfer(error, failure);
          throw failure;
        }
        throw new WrappError(
          'PROTOCOL_ERROR',
          operation,
          dispatched && operations[operation].effectful ? 'unknown' : 'not-sent',
        );
      } finally {
        deadline.dispose();
      }
    },
  });
}
