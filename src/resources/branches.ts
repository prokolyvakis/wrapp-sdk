import {
  branchSchema,
  branchesSchema,
  decode,
  encodeJson,
  identifier,
  input,
  rejection,
} from '../codecs.js';
import { WrappError } from '../errors.js';
import { branchCreateSchema, branchUpdateSchema } from '../management-codecs.js';
import type {
  BranchResource,
  BranchWriteOutcome,
  CreateBranchInput,
  UpdateBranchInput,
} from '../management-types.js';
import { readValue } from '../runtime.js';
import type { Report, Runtime } from '../runtime.js';
import type { RequestOptions } from '../types.js';
import { freeze } from '../values.js';

// A branch write answers with the branch or with a rejection envelope. `expected`, when
// given, is the id the answer must carry.
function written(
  value: unknown,
  report: Report,
  operation: string,
  expected?: string,
): BranchWriteOutcome {
  const refusal = rejection(value);
  if (refusal !== undefined) {
    const outcome = freeze({
      kind: 'rejected',
      errorCount: refusal.errorCount,
      rejectionSource: refusal.source,
    } as const);
    report(outcome, value);
    return outcome;
  }
  // A rejection envelope may name its family in `status`; a success answer documents no
  // status, so one found here is refused, not ignored.
  if (value !== null && typeof value === 'object' && 'status' in value)
    throw new WrappError('PROTOCOL_ERROR', operation);
  const branch = decode(branchSchema, value, operation);
  if (expected !== undefined && branch.id !== expected)
    throw new WrappError('PROTOCOL_ERROR', operation);
  return freeze({ kind: 'observed', branch });
}

export function branchResource(runtime: Runtime): BranchResource {
  return {
    list: (opts?: RequestOptions) =>
      runtime.run(
        'branches',
        '/branches',
        (v, report) => decode(branchesSchema, readValue(v, report), 'branches'),
        opts,
      ),
    create: async (branch: CreateBranchInput, opts?: RequestOptions) => {
      const data = input(branchCreateSchema, branch, 'branchCreate');
      return runtime.run(
        'branchCreate',
        '/branches',
        (value, report) => written(value, report, 'branchCreate'),
        opts,
        encodeJson(data),
      );
    },
    update: async (branchId: string, patch: UpdateBranchInput, opts?: RequestOptions) => {
      const valid = input(identifier, branchId, 'branchUpdate');
      const data = input(branchUpdateSchema, patch, 'branchUpdate');
      return runtime.run(
        'branchUpdate',
        '/branches/' + encodeURIComponent(valid),
        (value, report) => written(value, report, 'branchUpdate', valid),
        opts,
        encodeJson(data),
      );
    },
  };
}
