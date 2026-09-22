/** Safe diagnostics: never retain provider payloads, credentials, URLs or raw causes. */
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
export type EffectCertainty = 'not-sent' | 'unknown' | 'provider-observed';

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
