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
  thermalPdf: { method: 'GET', effectful: true },
  issuedCount: { method: 'GET', effectful: false },
  cancelDeliveryNote: { method: 'DELETE', effectful: true },
  setExternalId: { method: 'PUT', effectful: true },
  // A GET that changes provider state: classified by effect, never by verb.
  markAsPaid: { method: 'GET', effectful: true },
  deleteDraft: { method: 'DELETE', effectful: true },
  createDraft: { method: 'POST', effectful: true },
  issueDraft: { method: 'POST', effectful: true },
  listDrafts: { method: 'GET', effectful: false },
  branchCreate: { method: 'POST', effectful: true },
  branchUpdate: { method: 'PUT', effectful: true },
  billingBookCreate: { method: 'POST', effectful: true },
  billingBookUpdateNumber: { method: 'PUT', effectful: true },
  clienteleCorrelateByMark: { method: 'POST', effectful: true },
  clienteleCorrelateByFim: { method: 'POST', effectful: true },
  clientele: { method: 'GET', effectful: false },
  clienteleCreate: { method: 'POST', effectful: true },
  // The provider updates an entry with a POST on the entry's own route.
  clienteleUpdate: { method: 'POST', effectful: true },
  clienteleCancel: { method: 'POST', effectful: true },
  posDevices: { method: 'GET', effectful: false },
  posDeviceCreate: { method: 'POST', effectful: true },
  posDeviceDelete: { method: 'DELETE', effectful: true },
  posSessionAbort: { method: 'POST', effectful: true },
  cateringTables: { method: 'GET', effectful: false },
  cateringTable: { method: 'GET', effectful: false },
  cateringTableCreate: { method: 'POST', effectful: true },
  cateringTableUpdate: { method: 'PATCH', effectful: true },
  cateringTableOpen: { method: 'POST', effectful: true },
  cateringTableClose: { method: 'POST', effectful: true },
  cateringTableDelete: { method: 'DELETE', effectful: true },
  // A GET that moves order notes between tables.
  cateringTableTransfer: { method: 'GET', effectful: true },
  openCateringOrderNotes: { method: 'GET', effectful: false },
  // Issues a cancelling 8.6 invoice: a fiscal creation, not a state update.
  cancelCateringOrderNotes: { method: 'POST', effectful: true },
  digitalTransports: { method: 'GET', effectful: false },
  digitalTransport: { method: 'GET', effectful: false },
  digitalTransportCreate: { method: 'POST', effectful: true },
  // Re-fetches the status and updates the provider's record: not a read.
  digitalTransportRefresh: { method: 'POST', effectful: true },
  digitalTransportReject: { method: 'POST', effectful: true },
  digitalTransportConfirmDelivery: { method: 'POST', effectful: true },
  digitalTransportConfirmReturn: { method: 'POST', effectful: true },
  digitalTransportTransfer: { method: 'POST', effectful: true },
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
  /**
   * `diagnose`, when given, receives the decoded JSON body of a non-2xx response together
   * with the failure about to be thrown. It is optional detail: the HTTP failure, its status
   * and its effect stay primary whatever reading that body does.
   */
  async send(
    operation: Operation,
    path: string,
    signal: AbortSignal,
    token?: string,
    body?: string,
    diagnose?: (failure: WrappError, value: unknown) => void,
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
      if (!response.ok) {
        const failure = new WrappError(
          response.status === 401 ? 'AUTH_ERROR' : 'HTTP_ERROR',
          operation,
          effect,
          response.status,
        );
        if (diagnose !== undefined) {
          try {
            diagnose(failure, await this.read(response, signal, operation, effect));
          } catch {
            // An unreadable, oversized, malformed or interrupted error body yields no detail.
          }
        }
        throw failure;
      }
      return await this.read(response, signal, operation, effect);
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
  // Reads a JSON body under the caller's deadline and the byte cap, never unbounded.
  private async read(
    response: Response,
    signal: AbortSignal,
    operation: Operation,
    effect: EffectCertainty,
  ): Promise<unknown> {
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
  }
}
