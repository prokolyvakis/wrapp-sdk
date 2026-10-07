import {
  cateringTableCreateSchema,
  cateringTableOpenSchema,
  cateringTableSchema,
  cateringTableSummariesSchema,
  cateringTableTransferSchema,
  cateringTableUpdateSchema,
} from '../catering-codecs.js';
import type {
  CateringTable,
  CateringTableOutcome,
  CateringTableResource,
  OpenCateringTableInput,
  TransferCateringOrderNotesInput,
} from '../catering-types.js';
import { decode, encodeJson, identifier, input, rejection } from '../codecs.js';
import { WrappError } from '../errors.js';
import { acknowledgement, readValue, refused, rejected } from '../runtime.js';
import type { Report, Runtime } from '../runtime.js';
import type { RequestOptions } from '../types.js';
import { freeze } from '../values.js';

// A table answer carries its own `status` field, so the reserved-key rule of other answers
// does not apply here: only an error field marks a rejection. `expected`, when given, is the
// id the answer must carry.
function table(value: unknown, operation: string, expected?: string): CateringTable {
  const details = decode(cateringTableSchema, value, operation);
  if (expected !== undefined && details.id !== expected)
    throw new WrappError('PROTOCOL_ERROR', operation);
  return details;
}
function written(
  value: unknown,
  report: Report,
  operation: string,
  expected?: string,
): CateringTableOutcome {
  return (
    refused(value, report) ?? freeze({ kind: 'observed', table: table(value, operation, expected) })
  );
}

export function cateringTableResource(runtime: Runtime): CateringTableResource {
  return {
    list: (opts?: RequestOptions) =>
      runtime.run(
        'cateringTables',
        '/catering_tables',
        (v, report) => decode(cateringTableSummariesSchema, readValue(v, report), 'cateringTables'),
        opts,
      ),
    get: async (tableId: string, opts?: RequestOptions) => {
      const valid = input(identifier, tableId, 'cateringTable');
      // This word is the route of the transfer, which changes state: a read never reaches it.
      if (valid === 'transfer') throw new WrappError('INVALID_INPUT', 'cateringTable');
      return runtime.run(
        'cateringTable',
        '/catering_tables/' + encodeURIComponent(valid),
        (value, report) => {
          if (rejection(value) !== undefined) throw rejected('cateringTable', value, report);
          return table(value, 'cateringTable', valid);
        },
        opts,
      );
    },
    create: async (data: Readonly<{ name: string }>, opts?: RequestOptions) => {
      const body = input(cateringTableCreateSchema, data, 'cateringTableCreate');
      return runtime.run(
        'cateringTableCreate',
        '/catering_tables',
        (value, report) => written(value, report, 'cateringTableCreate'),
        opts,
        encodeJson(body),
      );
    },
    update: async (tableId: string, patch: Readonly<{ name: string }>, opts?: RequestOptions) => {
      const valid = input(identifier, tableId, 'cateringTableUpdate');
      const body = input(cateringTableUpdateSchema, patch, 'cateringTableUpdate');
      return runtime.run(
        'cateringTableUpdate',
        '/catering_tables/' + encodeURIComponent(valid),
        (value, report) => written(value, report, 'cateringTableUpdate', valid),
        opts,
        encodeJson(body),
      );
    },
    open: async (data: OpenCateringTableInput, opts?: RequestOptions) => {
      const body = input(cateringTableOpenSchema, data, 'cateringTableOpen');
      return runtime.run(
        'cateringTableOpen',
        '/catering_tables/open_table',
        (value, report) => written(value, report, 'cateringTableOpen', body.id),
        opts,
        encodeJson(body),
      );
    },
    close: async (tableId: string, opts?: RequestOptions) => {
      const valid = input(identifier, tableId, 'cateringTableClose');
      return runtime.run(
        'cateringTableClose',
        '/catering_tables/' + encodeURIComponent(valid) + '/close',
        (value, report) => written(value, report, 'cateringTableClose', valid),
        opts,
      );
    },
    transfer: async (data: TransferCateringOrderNotesInput, opts?: RequestOptions) => {
      const valid = input(cateringTableTransferSchema, data, 'cateringTableTransfer');
      const query = new URLSearchParams({
        current_table: valid.current_table,
        target_table: valid.target_table,
      });
      for (const mark of valid.marks ?? []) query.append('marks[]', mark);
      return runtime.run(
        'cateringTableTransfer',
        '/catering_tables/transfer?' + query.toString(),
        // The provider's answer does not say which of the two tables it is, so no id is expected.
        (value, report) => written(value, report, 'cateringTableTransfer'),
        opts,
      );
    },
    delete: async (tableId: string, opts?: RequestOptions) => {
      const valid = input(identifier, tableId, 'cateringTableDelete');
      return runtime.run(
        'cateringTableDelete',
        '/catering_tables/' + encodeURIComponent(valid),
        (value, report) => {
          // A table also has a status, so a table answer would pass for the acknowledgement.
          // It is another operation's answer and says nothing about a deletion.
          if (value !== null && typeof value === 'object' && ('id' in value || 'total' in value))
            throw new WrappError('PROTOCOL_ERROR', 'cateringTableDelete');
          return acknowledgement(value, report, 'cateringTableDelete');
        },
        opts,
      );
    },
  };
}
