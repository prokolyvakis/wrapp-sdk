/** Stable failure classification; the only machine-readable dimension besides effect. */
export type ErrorCode =
  | 'INVALID_INPUT'
  | 'PROTOCOL_ERROR'
  | 'HTTP_ERROR'
  | 'AUTH_ERROR'
  | 'PROVIDER_REJECTED'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'RESPONSE_TOO_LARGE'
  | 'PAGINATION_LIMIT'
  | 'WEBHOOK_INVALID';
/**
 * Whether the failed operation can have taken effect: 'not-sent' means nothing was
 * dispatched; 'unknown' means the request may have been applied and the caller must
 * reconcile through its durable record before considering any repeat.
 */
export type EffectCertainty = 'not-sent' | 'unknown' | 'provider-observed';

/**
 * Safe diagnostics: never retains provider payloads, credentials, URLs or raw causes.
 * All fields, including the JSON serialization, are bounded and loggable.
 */
export class WrappError extends Error {
  override readonly name = 'WrappError';
  constructor(
    readonly code: ErrorCode,
    readonly operation: string,
    readonly effect: EffectCertainty = 'not-sent',
    readonly httpStatus?: number,
  ) {
    super(`Wrapp SDK: ${code}`);
  }
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      operation: this.operation,
      effect: this.effect,
      ...(this.httpStatus === undefined ? {} : { httpStatus: this.httpStatus }),
    };
  }
}
