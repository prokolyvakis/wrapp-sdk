import { decode, encodeJson, identifier, input } from '../codecs.js';
import {
  confirmDeliverySchema,
  transportCreateSchema,
  transportLegSchema,
  transportListSchema,
  transportPageSchema,
  transportRejectSchema,
  transportSchema,
  transportWrapperSchema,
} from '../digital-transport-codecs.js';
import type {
  ConfirmDeliveryInput,
  CreateDigitalTransportInput,
  DigitalTransport,
  DigitalTransportOutcome,
  DigitalTransportResource,
  TransportLegInput,
} from '../digital-transport-types.js';
import { WrappError } from '../errors.js';
import { providerJson } from '../provider-json.js';
import { readValue, refused } from '../runtime.js';
import type { Report, Runtime } from '../runtime.js';
import type { RequestOptions } from '../types.js';
import { freeze } from '../values.js';

type Expected = Readonly<{ id?: string; invoiceId?: string }>;
// A record beside an error field cannot say what happened: it is neither a rejection nor an
// answer. This is checked before the shared rejection rules, which do not know the wrappers.
function consistent(value: unknown, operation: string): void {
  if (value === null || typeof value !== 'object') return;
  const wrapped = 'digital_transport' in value || 'digital_transports' in value;
  if (wrapped && ('errors' in value || 'error' in value))
    throw new WrappError('PROTOCOL_ERROR', operation);
}
function record(raw: unknown, operation: string, expected: Expected = {}): DigitalTransport {
  const known = decode(transportSchema, raw, operation);
  if (expected.id !== undefined && known.id !== expected.id)
    throw new WrappError('PROTOCOL_ERROR', operation);
  // An answer that names another invoice is not about this request; one that names none
  // cannot contradict it.
  if (
    expected.invoiceId !== undefined &&
    known.invoice_id !== undefined &&
    known.invoice_id !== null &&
    known.invoice_id !== expected.invoiceId
  )
    throw new WrappError('PROTOCOL_ERROR', operation);
  // The evidence is mapped as an opaque tree and never consulted for the outcome.
  if (raw === null || typeof raw !== 'object' || !Object.hasOwn(raw, 'my_data_response'))
    return known;
  const evidence: unknown = (raw as { my_data_response: unknown }).my_data_response;
  return freeze({ ...known, my_data_response: providerJson(evidence) });
}
function unwrapped(value: unknown, operation: string, expected?: Expected): DigitalTransport {
  return record(
    decode(transportWrapperSchema, value, operation).digital_transport,
    operation,
    expected,
  );
}

export function digitalTransportResource(runtime: Runtime): DigitalTransportResource {
  const write = (
    operation:
      | 'digitalTransportCreate'
      | 'digitalTransportRefresh'
      | 'digitalTransportReject'
      | 'digitalTransportConfirmDelivery'
      | 'digitalTransportConfirmReturn'
      | 'digitalTransportTransfer',
    path: string,
    expected: Expected,
    opts?: RequestOptions,
    body?: string,
  ) =>
    runtime.run(
      operation,
      path,
      (value: unknown, report: Report): DigitalTransportOutcome => {
        consistent(value, operation);
        const outcome = refused(value, report);
        if (outcome !== undefined) return outcome;
        // The documented answer is the wrapped record alone; a top-level status is not part
        // of it and is not guessed at.
        if (value !== null && typeof value === 'object' && 'status' in value)
          throw new WrappError('PROTOCOL_ERROR', operation);
        return freeze({ kind: 'observed', transport: unwrapped(value, operation, expected) });
      },
      opts,
      body,
    );
  const at = (transportId: string, operation: string, action = '') =>
    '/digital_transports/' + encodeURIComponent(input(identifier, transportId, operation)) + action;
  return {
    list: async (
      filters: Readonly<{ category?: 'shipping' | 'receiving'; page?: number }> = {},
      opts?: RequestOptions,
    ) => {
      const valid = input(transportListSchema, filters, 'digitalTransports');
      const query = new URLSearchParams();
      if (valid.category !== undefined) query.set('category', valid.category);
      if (valid.page !== undefined) query.set('page', String(valid.page));
      const search = query.toString();
      return runtime.run(
        'digitalTransports',
        '/digital_transports' + (search === '' ? '' : '?' + search),
        (value, report) => {
          consistent(value, 'digitalTransports');
          const page = decode(transportPageSchema, readValue(value, report), 'digitalTransports');
          return freeze({
            digital_transports: page.digital_transports.map((raw) =>
              record(raw, 'digitalTransports'),
            ),
            total_pages: page.total_pages,
            current_page: page.current_page,
          });
        },
        opts,
      );
    },
    get: async (transportId: string, opts?: RequestOptions) => {
      const path = at(transportId, 'digitalTransport');
      return runtime.run(
        'digitalTransport',
        path,
        (value, report) => {
          consistent(value, 'digitalTransport');
          return unwrapped(readValue(value, report), 'digitalTransport', { id: transportId });
        },
        opts,
      );
    },
    create: async (transport: CreateDigitalTransportInput, opts?: RequestOptions) => {
      const data = input(transportCreateSchema, transport, 'digitalTransportCreate');
      return write(
        'digitalTransportCreate',
        '/digital_transports',
        { invoiceId: data.invoice_id },
        opts,
        encodeJson(data),
      );
    },
    refresh: async (transportId: string, opts?: RequestOptions) =>
      write(
        'digitalTransportRefresh',
        at(transportId, 'digitalTransportRefresh', '/refresh'),
        { id: transportId },
        opts,
      ),
    reject: async (
      transportId: string,
      reason: Readonly<{ reject_reason?: string }> = {},
      opts?: RequestOptions,
    ) => {
      const path = at(transportId, 'digitalTransportReject', '/reject');
      const data = input(transportRejectSchema, reason, 'digitalTransportReject');
      return write('digitalTransportReject', path, { id: transportId }, opts, encodeJson(data));
    },
    confirmDelivery: async (
      transportId: string,
      delivery: ConfirmDeliveryInput,
      opts?: RequestOptions,
    ) => {
      const path = at(transportId, 'digitalTransportConfirmDelivery', '/confirm_delivery');
      const data = input(confirmDeliverySchema, delivery, 'digitalTransportConfirmDelivery');
      return write(
        'digitalTransportConfirmDelivery',
        path,
        { id: transportId },
        opts,
        encodeJson(data),
      );
    },
    confirmReturn: async (transportId: string, opts?: RequestOptions) =>
      write(
        'digitalTransportConfirmReturn',
        at(transportId, 'digitalTransportConfirmReturn', '/confirm_return'),
        { id: transportId },
        opts,
      ),
    transfer: async (transportId: string, leg: TransportLegInput, opts?: RequestOptions) => {
      const path = at(transportId, 'digitalTransportTransfer', '/transfer');
      const data = input(transportLegSchema, leg, 'digitalTransportTransfer');
      return write('digitalTransportTransfer', path, { id: transportId }, opts, encodeJson(data));
    },
  };
}
