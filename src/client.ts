import {
  decode,
  exemptionsSchema,
  input,
  tenantSchema,
  vatInputSchema,
  vatSchema,
} from './codecs.js';
import type { CateringTableResource } from './catering-types.js';
import type { DigitalClienteleResource } from './digital-clientele-types.js';
import type { DigitalTransportResource } from './digital-transport-types.js';
import type { BillingBookResource, BranchResource } from './management-types.js';
import type { PosDeviceResource, PosSessionResource } from './pos-types.js';
import { billingBookResource } from './resources/billing-books.js';
import { cateringTableResource } from './resources/catering-tables.js';
import { branchResource } from './resources/branches.js';
import { digitalClienteleResource } from './resources/digital-clienteles.js';
import { digitalTransportResource } from './resources/digital-transports.js';
import { invoiceResource } from './resources/invoices.js';
import type { InvoiceResource } from './resources/invoices.js';
import { posDeviceResource } from './resources/pos-devices.js';
import { posSessionResource } from './resources/pos-sessions.js';
import { createRuntime, readValue } from './runtime.js';
import type { ClientOptions, RequestOptions, TenantDetails, VatDetails } from './types.js';

/**
 * Tenant/environment-isolated client. No requests occur during construction; login happens
 * lazily, coalesced across concurrent calls. The instance and its resources are frozen.
 */
export class WrappClient {
  readonly tenant: Readonly<{ get(options?: RequestOptions): Promise<TenantDetails> }>;
  readonly branches: Readonly<BranchResource>;
  readonly billingBooks: Readonly<BillingBookResource>;
  readonly vat: Readonly<{
    search(
      query: Readonly<{ vat: string; country_code: string }>,
      options?: RequestOptions,
    ): Promise<VatDetails>;
    exemptions(options?: RequestOptions): Promise<readonly Readonly<Record<string, string>>[]>;
  }>;
  readonly invoices: Readonly<InvoiceResource>;
  readonly digitalClienteles: Readonly<DigitalClienteleResource>;
  readonly cateringTables: Readonly<CateringTableResource>;
  readonly digitalTransports: Readonly<DigitalTransportResource>;
  readonly posDevices: Readonly<PosDeviceResource>;
  readonly posSessions: Readonly<PosSessionResource>;

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
    this.branches = Object.freeze(branchResource(runtime));
    this.billingBooks = Object.freeze(billingBookResource(runtime));
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
    this.digitalClienteles = Object.freeze(digitalClienteleResource(runtime));
    this.cateringTables = Object.freeze(cateringTableResource(runtime));
    this.digitalTransports = Object.freeze(digitalTransportResource(runtime));
    this.posDevices = Object.freeze(posDeviceResource(runtime));
    this.posSessions = Object.freeze(posSessionResource(runtime));
    Object.freeze(this);
  }
}
