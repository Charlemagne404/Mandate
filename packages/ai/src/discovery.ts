import { ProviderConfig } from './contracts.js';
import { createProvider } from './providers.js';
/** Probe inference servers only. Never downloads models or starts an application. */
export async function discoverLocalProviders(signal?: AbortSignal) {
  const candidates = [
    { kind: 'ollama', baseUrl: 'http://127.0.0.1:11434' },
    { kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1234/v1' },
    { kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080/v1' },
  ] as const;
  return Promise.all(
    candidates.map(async (candidate) => {
      const config = ProviderConfig.parse({
        ...candidate,
        timeoutMs: 2000,
        retries: 0,
      });
      const health = await createProvider(config).health(signal);
      return { ...candidate, ...health };
    }),
  );
}
