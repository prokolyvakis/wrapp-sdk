/**
 * Unofficial, server-side TypeScript client for the Wrapp invoicing API. Nothing is retried
 * automatically, ambiguous outcomes are preserved rather than resolved, and no currency
 * amount ever passes through binary floating point.
 *
 * @packageDocumentation
 */
export { WrappClient } from './client.js';
export type { InvoiceResource } from './client.js';
export { WrappError } from './errors.js';
export type { ErrorCode, EffectCertainty } from './errors.js';
export { decimal, calendarDate } from './values.js';
export type { Decimal, CalendarDate } from './values.js';
export { verifyWebhook } from './webhooks.js';
export type { WebhookInput } from './webhooks.js';
export type {
  ClientOptions,
  RejectionSource,
  RequestOptions,
  TenantIdentity,
  InvoiceReference,
  IdentityEvidence,
  CreateInvoiceInput,
  CreateOutcome,
  InvoiceObservation,
  InvoiceDetails,
  InvoiceLine,
  Counterpart,
  InvoicePage,
  ListInvoicesInput,
  PdfOutcome,
  TenantDetails,
  Branch,
  BillingBook,
  VatDetails,
  VerifiedWebhook,
} from './types.js';
