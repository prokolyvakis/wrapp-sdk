import { decode, encodeJson, identifier, input } from '../codecs.js';
import { WrappError } from '../errors.js';
import {
  fieldErrors,
  posDeviceCreateSchema,
  posDeviceSchema,
  posDevicesSchema,
} from '../pos-codecs.js';
import type {
  CreatePosDeviceInput,
  PosDeviceCreateOutcome,
  PosDeviceResource,
} from '../pos-types.js';
import { acknowledgement, readValue, refused } from '../runtime.js';
import type { Report, Runtime } from '../runtime.js';
import type { RequestOptions } from '../types.js';
import { freeze } from '../values.js';

function created(value: unknown, report: Report): PosDeviceCreateOutcome {
  const outcome = refused(fieldErrors(value, 'posDeviceCreate'), report);
  if (outcome !== undefined) return outcome;
  // The documented success is the device alone, for a new terminal (201) and for an
  // existing one that was enabled again (200).
  if (value !== null && typeof value === 'object' && 'status' in value)
    throw new WrappError('PROTOCOL_ERROR', 'posDeviceCreate');
  return freeze({ kind: 'observed', device: decode(posDeviceSchema, value, 'posDeviceCreate') });
}

export function posDeviceResource(runtime: Runtime): PosDeviceResource {
  return {
    list: (opts?: RequestOptions) =>
      runtime.run(
        'posDevices',
        '/pos_devices',
        (v, report) => decode(posDevicesSchema, readValue(v, report), 'posDevices'),
        opts,
      ),
    create: async (device: CreatePosDeviceInput, opts?: RequestOptions) => {
      const data = input(posDeviceCreateSchema, device, 'posDeviceCreate');
      return runtime.run(
        'posDeviceCreate',
        '/pos_devices',
        created,
        opts,
        encodeJson(data),
        // The account credential and the merchant's address never belong in retained
        // provider text, should the provider echo them.
        'merchant_id' in data ? [data.merchant_id] : [data.authorization_code],
      );
    },
    delete: async (deviceId: string, opts?: RequestOptions) => {
      const valid = input(identifier, deviceId, 'posDeviceDelete');
      return runtime.run(
        'posDeviceDelete',
        '/pos_devices/' + encodeURIComponent(valid),
        (value, report) => acknowledgement(value, report, 'posDeviceDelete'),
        opts,
      );
    },
  };
}
