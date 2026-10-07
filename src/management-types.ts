import type { BillingBook, Branch, RejectionSource, RequestOptions } from './types.js';

/**
 * A new branch. The six address and identity fields are required; the rest are optional and
 * are left off the wire when omitted. An explicit false is sent as false.
 */
export interface CreateBranchInput {
  readonly name: string;
  /** The branch code as registered with the tax authority; a nonnegative integer. */
  readonly code: number;
  readonly address: string;
  readonly street_number: string;
  readonly city: string;
  readonly postal_code: string;
  readonly phone?: string;
  readonly address_en?: string;
  readonly city_en?: string;
  /** The provider keeps one default branch: setting this true clears it on every other one. */
  readonly default_option?: boolean;
  readonly company_activity?: string;
  readonly company_activity_en?: string;
}
/**
 * The fields to change, at least one. Only the fields given are sent; the SDK never reads the
 * branch first, merges values or fills in defaults.
 */
export type UpdateBranchInput = Partial<CreateBranchInput>;
/** A branch write answered with the branch as the provider now holds it, or refused. */
export type BranchWriteOutcome =
  | Readonly<{ kind: 'observed'; branch: Branch }>
  | Readonly<{ kind: 'rejected'; errorCount: number; rejectionSource: RejectionSource }>;
/**
 * A new billing book. number is the counter the provider numbers invoices from: the SDK sends
 * the value given and neither allocates nor reconciles counters. invoice_type_code is one of
 * the provider's 52 type codes; a book can exist for a type this SDK cannot issue.
 */
export interface CreateBillingBookInput {
  readonly name: string;
  readonly series: string;
  /** A nonnegative integer. */
  readonly number: number;
  readonly invoice_type_code: string;
}
/**
 * What the provider returns for a created billing book. number is absent when the provider
 * omits it, as its documented answer does. invoice_type_code can differ from the one
 * requested: the provider stores some types under their family, for example 1.2 as 1.1.
 */
export interface BillingBookReceipt {
  readonly id: string;
  readonly name: string;
  readonly series: string;
  readonly invoice_type_code: string;
  readonly number?: string;
}
export type BillingBookCreateOutcome =
  | Readonly<{ kind: 'observed'; billingBook: BillingBookReceipt }>
  | Readonly<{ kind: 'rejected'; errorCount: number; rejectionSource: RejectionSource }>;
/** Branch operations. Writes are dispatched at most once and never retried. */
export interface BranchResource {
  list(options?: RequestOptions): Promise<readonly Branch[]>;
  create(input: CreateBranchInput, options?: RequestOptions): Promise<BranchWriteOutcome>;
  update(
    branchId: string,
    patch: UpdateBranchInput,
    options?: RequestOptions,
  ): Promise<BranchWriteOutcome>;
}
/** Billing-book operations. Creation is dispatched at most once and never retried. */
export interface BillingBookResource {
  list(options?: RequestOptions): Promise<readonly BillingBook[]>;
  create(
    input: CreateBillingBookInput,
    options?: RequestOptions,
  ): Promise<BillingBookCreateOutcome>;
}
