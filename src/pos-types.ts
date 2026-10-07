import type { AcknowledgementOutcome } from './invoice-lifecycle-types.js';
import type { RejectionSource, RequestOptions } from './types.js';

/** A registered POS device as the provider returns it. */
export interface PosDevice {
  readonly id: string;
  readonly name: string;
  /**
   * Absent when the provider omits the field and null when it reports no value. Absent and
   * null are different observations.
   */
  readonly terminal_id?: string | null;
  /** For a Worldline SoftPOS device this is the merchant's email address. */
  readonly merchant_id?: string | null;
}
/** Device types registered with an authorization code. */
export type PosAuthorizationCodeType =
  | 'epay'
  | 'worldline'
  | 'nbg'
  | 'cosmote'
  | 'jcc'
  | 'attica'
  | 'pancreta'
  | 'tora'
  | 'pbt'
  | 'mypos'
  | 'nexi-mellon'
  | 'nexi'
  | 'nbg_edps';
/**
 * Device registration input, one shape per credential the provider documents: a merchant id
 * for Viva and Worldline SoftPOS, an authorization code for every other type. Supplying the
 * other credential, or both, is refused before any request.
 */
export type CreatePosDeviceInput =
  | Readonly<{ pos_type: 'viva'; name: string; terminal_id: string; merchant_id: string }>
  | Readonly<{
      pos_type: 'worldline_softpos';
      /** Optional for this type only: the provider generates a name when it is omitted. */
      name?: string;
      terminal_id: string;
      /** The merchant's email address. */
      merchant_id: string;
    }>
  | Readonly<{
      pos_type: PosAuthorizationCodeType;
      name: string;
      terminal_id: string;
      authorization_code: string;
    }>;
/**
 * Result of registering a device. 'observed' carries the device the provider returned; for
 * Worldline SoftPOS that can be an existing terminal that was enabled again, which the
 * result does not distinguish from a new one.
 */
export type PosDeviceCreateOutcome =
  | Readonly<{ kind: 'observed'; device: PosDevice }>
  | Readonly<{ kind: 'rejected'; errorCount: number; rejectionSource: RejectionSource }>;
export interface PosDeviceResource {
  list(options?: RequestOptions): Promise<readonly PosDevice[]>;
  /**
   * Registers a device. Dispatched at most once and never retried: after a failure whose
   * effect is 'unknown', list the devices before registering again.
   */
  create(device: CreatePosDeviceInput, options?: RequestOptions): Promise<PosDeviceCreateOutcome>;
  /**
   * Deletes a device permanently. The provider refuses a device that has a successful
   * transaction. Dispatched at most once.
   */
  delete(deviceId: string, options?: RequestOptions): Promise<AcknowledgementOutcome>;
}
export interface PosSessionResource {
  /**
   * Aborts the pending POS session of an invoice. The id is the invoice's id, not a device or
   * session id. The provider documents this for Viva terminals only and decides whether the
   * invoice has a session to abort. Dispatched at most once.
   */
  abort(invoiceId: string, options?: RequestOptions): Promise<AcknowledgementOutcome>;
}
