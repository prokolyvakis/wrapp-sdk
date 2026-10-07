/**
 * Unofficial, server-side TypeScript client for the Wrapp invoicing API. Nothing is retried
 * automatically, ambiguous outcomes are preserved rather than resolved, and no currency
 * amount ever passes through binary floating point.
 *
 * @packageDocumentation
 */
export { WrappClient } from './client.js';
export type { InvoiceResource } from './resources/invoices.js';
export type {
  CancelCateringOrderNotesInput,
  CateringOrderNoteCancellation,
  CateringOrderNoteCancellationOutcome,
  CateringTable,
  CateringTableOutcome,
  CateringTableResource,
  CateringTableSummary,
  OpenCateringOrderNote,
  OpenCateringOrderNotesPage,
  OpenCateringTableInput,
} from './catering-types.js';
export type {
  ClienteleCorrelationOutcome,
  DigitalClienteleResource,
} from './digital-clientele-types.js';
export type {
  ConfirmDeliveryInput,
  CreateDigitalTransportInput,
  DeliveredPackaging,
  DigitalTransport,
  DigitalTransportOutcome,
  DigitalTransportPage,
  DigitalTransportResource,
  TransportLegInput,
} from './digital-transport-types.js';
export type { ProviderJson } from './provider-json.js';
export type {
  BillingBookCreateOutcome,
  BillingBookReceipt,
  BillingBookResource,
  BranchResource,
  BranchWriteOutcome,
  CreateBillingBookInput,
  CreateBranchInput,
  UpdateBranchInput,
} from './management-types.js';
export type {
  AcknowledgementOutcome,
  CancellationObservation,
  CancellationOutcome,
  ExternalIdAssignmentOutcome,
} from './invoice-lifecycle-types.js';
export type {
  CreatePosDeviceInput,
  PosAuthorizationCodeType,
  PosDevice,
  PosDeviceCreateOutcome,
  PosDeviceResource,
  PosSessionResource,
} from './pos-types.js';
export { getProviderDiagnostics } from './diagnostics.js';
export type { ProviderDiagnostics, ProviderIssue } from './diagnostics.js';
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
  DeliveryDetail,
  OtherCorrelatedEntity,
  InvoiceStatusOutcome,
  PendingInvoiceOutcome,
  PendingIdentityEvidence,
  InvoiceObservation,
  InvoiceB2gDetails,
  InvoiceDeliveryDetails,
  InvoiceDetails,
  InvoiceLine,
  LineClassification,
  LineDeduction,
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
