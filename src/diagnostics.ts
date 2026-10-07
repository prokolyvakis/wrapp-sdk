import { freeze } from './values.js';

/** One issue as the provider reported it. Provider text: bounded, never interpreted. */
export interface ProviderIssue {
  readonly code?: string;
  readonly title?: string;
  readonly message?: string;
}
/**
 * The provider's rejection detail, retained only for a call that opted in with
 * RequestOptions.diagnostics and read back with getProviderDiagnostics. It is evidence for a
 * human or a log the caller controls. It never establishes that a reference is free, that a
 * duplicate matches an earlier request, or that repeating a write is safe.
 */
export interface ProviderDiagnostics {
  /** The envelope's status label, when present and at most 256 UTF-16 code units. */
  readonly providerStatus?: string;
  /** At most 100 issues and 64 KiB of UTF-8 text in total. */
  readonly issues: readonly ProviderIssue[];
  /** True when an issue, a field or the status was dropped or shortened to fit the bounds. */
  readonly truncated: boolean;
  /** Always true: provider text can describe a customer, a document or a transaction. */
  readonly sensitive: true;
}

const store = new WeakMap<object, ProviderDiagnostics>();
const maxIssues = 100;
const maxText = 4096;
const maxCode = 256;
const maxBytes = 65_536;

/**
 * Returns the provider detail retained for exactly this result or error object, or undefined.
 * The detail lives outside the object: copying, spreading, serializing or inspecting the
 * result or error never carries it along.
 */
export function getProviderDiagnostics(target: unknown): ProviderDiagnostics | undefined {
  return typeof target === 'object' && target !== null ? store.get(target) : undefined;
}
/** Moves retained detail from an internal error to the public error that replaces it. */
export function transfer(from: object, to: object): void {
  const found = store.get(from);
  if (found !== undefined) store.set(to, found);
}
function own(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' && Object.hasOwn(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}
/**
 * Retains the issues of a provider error body for `target`: every entry of `errors[]` and the
 * single `error` string, when present. A body without a recognizable issue retains nothing.
 *
 * Each exact occurrence of an active credential inside a retained text is replaced first, and
 * the bounds are applied to the result, so no fragment of a credential can survive a cut.
 * This is a safety net, not a guarantee: an encoded, re-cased or split credential is not
 * recognized, which is one reason the detail is always marked sensitive.
 */
export function attach(target: object, body: unknown, secrets: readonly string[]): void {
  let truncated = false;
  const bounded = (raw: unknown, limit: number, shorten: boolean): string | undefined => {
    if (typeof raw !== 'string') return undefined;
    let text = raw;
    for (const secret of secrets)
      if (secret.length > 0) text = text.replaceAll(secret, '[REDACTED]');
    if (text.length <= limit) return text;
    truncated = true;
    if (!shorten) return undefined;
    // Never end on the first half of a surrogate pair.
    const end = /[\ud800-\udbff]/.test(text.charAt(limit - 1)) ? limit - 1 : limit;
    return text.slice(0, end);
  };
  const errors = own(body, 'errors');
  const single = own(body, 'error');
  const entries: readonly unknown[] = [
    ...(Array.isArray(errors) ? (errors as unknown[]) : []),
    ...(typeof single === 'string' ? [{ message: single }] : []),
  ];
  const providerStatus = bounded(own(body, 'status'), maxCode, false);
  const issues: ProviderIssue[] = [];
  let bytes = Buffer.byteLength(providerStatus ?? '');
  for (const entry of entries) {
    // An identifier is kept whole or not at all; free text is shortened.
    const code = bounded(own(entry, 'code'), maxCode, false);
    const title = bounded(own(entry, 'title'), maxText, true);
    const message = bounded(own(entry, 'message'), maxText, true);
    if (code === undefined && title === undefined && message === undefined) continue;
    const size = Buffer.byteLength((code ?? '') + (title ?? '') + (message ?? ''));
    if (issues.length === maxIssues || bytes + size > maxBytes) {
      truncated = true;
      break;
    }
    bytes += size;
    issues.push({
      ...(code === undefined ? {} : { code }),
      ...(title === undefined ? {} : { title }),
      ...(message === undefined ? {} : { message }),
    });
  }
  if (issues.length === 0) return;
  store.set(
    target,
    freeze({
      ...(providerStatus === undefined ? {} : { providerStatus }),
      issues,
      truncated,
      sensitive: true,
    }),
  );
}
