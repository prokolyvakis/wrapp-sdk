import {
  booksSchema,
  branchesSchema,
  decode,
  exemptionsSchema,
  input,
  tenantSchema,
  vatInputSchema,
  vatSchema,
} from './codecs.js';
import { invoiceResource } from './resources/invoices.js';
import type { InvoiceResource } from './resources/invoices.js';
import { createRuntime, readValue } from './runtime.js';
import type {
  BillingBook,
  Branch,
  ClientOptions,
  RequestOptions,
  TenantDetails,
  VatDetails,
} from './types.js';

/**
 * Tenant/environment-isolated client. No requests occur during construction; login happens
 * lazily, coalesced across concurrent calls. The instance and its resources are frozen.
 */
export class WrappClient {
  readonly tenant: Readonly<{ get(options?: RequestOptions): Promise<TenantDetails> }>;
  readonly branches: Readonly<{ list(options?: RequestOptions): Promise<readonly Branch[]> }>;
  readonly billingBooks: Readonly<{
    list(options?: RequestOptions): Promise<readonly BillingBook[]>;
  }>;
  readonly vat: Readonly<{
    search(
      query: Readonly<{ vat: string; country_code: string }>,
      options?: RequestOptions,
    ): Promise<VatDetails>;
    exemptions(options?: RequestOptions): Promise<readonly Readonly<Record<string, string>>[]>;
  }>;
  readonly invoices: Readonly<InvoiceResource>;

  constructor(options: ClientOptions) {
    // One runtime per client: every resource shares its session, deadline and limits, and
    // none of them can reach the credentials or another origin through it.
    const runtime = createRuntime(options);
    this.tenant = Object.freeze({
      get: (opts?: RequestOptions) =>
        runtime.run(
          'tenant',
          '/tenant_details',
          (v, report) => decode(tenantSchema, readValue(v, report), 'tenant'),
          opts,
        ),
    });
    this.branches = Object.freeze({
      list: (opts?: RequestOptions) =>
        runtime.run(
          'branches',
          '/branches',
          (v, report) => decode(branchesSchema, readValue(v, report), 'branches'),
          opts,
        ),
    });
    this.billingBooks = Object.freeze({
      list: (opts?: RequestOptions) =>
        runtime.run(
          'billingBooks',
          '/billing_books',
          (v, report) => decode(booksSchema, readValue(v, report), 'billingBooks'),
          opts,
        ),
    });
    this.vat = Object.freeze({
      search: async (
        query: Readonly<{ vat: string; country_code: string }>,
        opts?: RequestOptions,
      ) => {
        const data = input(vatInputSchema, query, 'vat');
        return runtime.run(
          'vat',
          '/vat_search?' + new URLSearchParams(data).toString(),
          (v, report) => decode(vatSchema, readValue(v, report), 'vat'),
          opts,
        );
      },
      exemptions: (opts?: RequestOptions) =>
        runtime.run(
          'exemptions',
          '/vat_exemptions',
          (v, report) => decode(exemptionsSchema, readValue(v, report), 'exemptions'),
          opts,
        ),
    });
    this.invoices = Object.freeze(invoiceResource(runtime));
    Object.freeze(this);
  }
}
