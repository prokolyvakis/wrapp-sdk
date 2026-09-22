import { WrappError } from './errors.js';
import type { EffectCertainty } from './errors.js';
import { parseJson } from './codecs.js';

export const operations = Object.freeze({
  login: { method: 'POST', effectful: false },
  tenant: { method: 'GET', effectful: false },
  vat: { method: 'GET', effectful: false },
  exemptions: { method: 'GET', effectful: false },
  branches: { method: 'GET', effectful: false },
  billingBooks: { method: 'GET', effectful: false },
  status: { method: 'GET', effectful: false },
  details: { method: 'GET', effectful: false },
  list: { method: 'GET', effectful: false },
  create: { method: 'POST', effectful: true },
  pdf: { method: 'GET', effectful: true },
} as const);
export type Operation = keyof typeof operations;
export function scope(
  timeoutMs: number,
  parent?: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abort = () => {
    controller.abort('ABORTED');
  };
  if (parent?.aborted) abort();
  else parent?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    controller.abort('TIMEOUT');
  }, timeoutMs);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', abort);
    },
  };
}
function interrupted(signal: AbortSignal, operation: string, effect: EffectCertainty) {
  return new WrappError(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'ABORTED', operation, effect);
}
export function assertActive(
  signal: AbortSignal,
  operation: string,
  effect: EffectCertainty,
): void {
  if (signal.aborted) throw interrupted(signal, operation, effect);
}
export function waitFor<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  operation: string,
  effect: EffectCertainty,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      reject(interrupted(signal, operation, effect));
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort);
    });
  });
}
export class Transport {
  constructor(
    private readonly origin: string,
    private readonly fetcher: typeof globalThis.fetch,
    private readonly maxBytes: number,
  ) {}
  async send(
    operation: Operation,
    path: string,
    signal: AbortSignal,
    token?: string,
    body?: string,
  ): Promise<unknown> {
    assertActive(signal, operation, 'not-sent');
    const effect = operations[operation].effectful ? 'unknown' : 'not-sent';
    let response: Response | undefined;
    try {
      const pending = this.fetcher(this.origin + path, {
        method: operations[operation].method,
        redirect: 'error',
        signal,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
        },
        ...(body === undefined ? {} : { body }),
      });
      response = await waitFor(pending, signal, operation, effect);
      if (!response.ok)
        throw new WrappError(
          response.status === 401 ? 'AUTH_ERROR' : 'HTTP_ERROR',
          operation,
          effect,
          response.status,
        );
      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
      if (
        contentType !== 'application/json' &&
        !(contentType?.startsWith('application/') && contentType.endsWith('+json'))
      ) {
        throw new WrappError('PROTOCOL_ERROR', operation, effect);
      }
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > this.maxBytes)) {
        throw new WrappError('RESPONSE_TOO_LARGE', operation, effect);
      }
      if (!response.body) throw new WrappError('PROTOCOL_ERROR', operation, effect);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const chunk = await waitFor(reader.read(), signal, operation, effect);
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > this.maxBytes) throw new WrappError('RESPONSE_TOO_LARGE', operation, effect);
          chunks.push(chunk.value);
        }
      } finally {
        void reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      return parseJson(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    } catch (error) {
      if (response?.body && !response.body.locked)
        void response.body.cancel().catch(() => undefined);
      if (error instanceof WrappError) throw error;
      assertActive(signal, operation, effect);
      throw new WrappError(
        response === undefined ? 'NETWORK_ERROR' : 'PROTOCOL_ERROR',
        operation,
        effect,
      );
    }
  }
}
