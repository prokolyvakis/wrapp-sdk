import { beforeAll, afterAll, vi } from 'vitest';

// Guard the only production network port. This is not an OS sandbox for arbitrary dependencies.
const realFetch = globalThis.fetch;
beforeAll(() => {
  vi.stubGlobal('fetch', ((resource, init) => {
    const raw = resource instanceof Request ? resource.url : String(resource);
    const url = new URL(raw);
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) {
      return Promise.reject(new Error('External network disabled in SDK tests'));
    }
    return realFetch(resource, init);
  }) satisfies typeof fetch);
});
afterAll(() => {
  vi.unstubAllGlobals();
});
