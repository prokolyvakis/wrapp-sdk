import { decode, encodeJson, loginSchema } from './codecs.js';
import { scope, waitFor } from './transport.js';
import type { Transport } from './transport.js';
import type { TenantIdentity } from './types.js';

export class Session {
  #cached: { token: string; acquired: number } | undefined;
  #pending: Promise<string> | undefined;
  constructor(
    private readonly transport: Transport,
    private readonly apiKey: string,
    private readonly tenant: TenantIdentity,
    private readonly timeoutMs: number,
    private readonly now: () => number,
  ) {}
  invalidate(token: string): void {
    if (this.#cached?.token === token) this.#cached = undefined;
  }
  get(signal: AbortSignal): Promise<string> {
    const now = this.now();
    // 24h documented JWT lifetime minus a margin exceeding the 120s maximum request timeout,
    // so a token admitted at the window's edge cannot expire mid-flight.
    if (this.#cached && now >= this.#cached.acquired && now - this.#cached.acquired < 86_220_000) {
      return Promise.resolve(this.#cached.token);
    }
    this.#pending ??= this.login().finally(() => {
      this.#pending = undefined;
    });
    return waitFor(this.#pending, signal, 'login', 'not-sent');
  }
  private async login(): Promise<string> {
    const deadline = scope(this.timeoutMs);
    const acquired = this.now();
    try {
      const body = encodeJson({
        api_key: this.apiKey,
        [this.tenant.kind === 'email' ? 'email' : 'wrapp_user_id']: this.tenant.value,
      });
      const value = await this.transport.send('login', '/login', deadline.signal, undefined, body);
      const token = decode(loginSchema, value, 'login').data.attributes.jwt;
      this.#cached = { token, acquired };
      return token;
    } finally {
      deadline.dispose();
    }
  }
}
