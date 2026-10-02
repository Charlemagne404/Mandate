import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  ProviderConfig,
  createProvider,
  discoverLocalProviders,
} from '../packages/ai/src/index.js';

/** Credentials stay in this CLI process; callers must never serialize configs. */
export async function inferenceOptions() {
  const candidates: Array<{ source: string; config: ProviderConfig }> = [];
  const url =
    process.env.MANDATE_AI_URL ??
    process.env.OPENAI_BASE_URL ??
    process.env.OPENAI_API_BASE ??
    process.env.OLLAMA_HOST;
  const kind =
    process.env.MANDATE_AI_KIND ??
    (process.env.OLLAMA_HOST
      ? 'ollama'
      : url
        ? 'openai-compatible'
        : undefined);
  if (kind && kind !== 'fake')
    candidates.push({
      source: 'environment',
      config: ProviderConfig.parse({
        kind,
        baseUrl: url,
        model:
          process.env.MANDATE_AI_MODEL ??
          process.env.OPENAI_MODEL ??
          'local-model',
        apiKey: process.env.MANDATE_AI_API_KEY ?? process.env.OPENAI_API_KEY,
        timeoutMs: Number(process.env.MANDATE_AI_TIMEOUT ?? 60000),
        ...(process.env.MANDATE_AI_CONTEXT_TOKENS
          ? { contextTokens: Number(process.env.MANDATE_AI_CONTEXT_TOKENS) }
          : {}),
        roleModels: JSON.parse(
          process.env.MANDATE_AI_ROLE_MODELS ?? '{}',
        ) as unknown,
      }),
    });
  // An API key alone is usable through the existing compatible provider, without choosing a new vendor.
  if (!kind && process.env.OPENAI_API_KEY)
    candidates.push({
      source: 'environment-configured credential',
      config: ProviderConfig.parse({
        kind: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        model: process.env.OPENAI_MODEL ?? 'local-model',
        apiKey: process.env.OPENAI_API_KEY,
      }),
    });
  if (existsSync('.runtime/services/archive.sqlite')) {
    const db = new DatabaseSync('.runtime/services/archive.sqlite', {
      readOnly: true,
    });
    try {
      const row = db
        .prepare("SELECT value_json FROM settings WHERE key='provider'")
        .get();
      if (row) {
        const parsed = ProviderConfig.safeParse(
          JSON.parse(String(row.value_json)),
        );
        if (parsed.success && parsed.data.kind !== 'fake')
          candidates.push({
            source: 'existing game configuration',
            config: parsed.data,
          });
      }
    } finally {
      db.close();
    }
  }
  const local = await discoverLocalProviders();
  for (const p of local.filter((p) => p.ok && p.models.length))
    candidates.push({
      source: 'local discovery',
      config: ProviderConfig.parse({
        kind: p.kind,
        baseUrl: p.baseUrl,
        model:
          p.models.find((m) => !/embed|rerank|whisper|tts|clip/i.test(m)) ??
          p.models[0],
      }),
    });
  const records: Array<{
    source: string;
    kind: string;
    endpoint: string;
    ok: boolean;
    models: string[];
  }> = [];
  let selected: ProviderConfig | undefined;
  for (const c of candidates) {
    const h = await createProvider({
      ...c.config,
      timeoutMs: 3000,
      retries: 0,
    }).health();
    const u = new URL(
      c.config.baseUrl ??
        (c.config.kind === 'ollama'
          ? 'http://127.0.0.1:11434'
          : 'http://127.0.0.1:1234/v1'),
    );
    records.push({
      source: c.source,
      kind: c.config.kind,
      endpoint: u.origin + u.pathname,
      ok: h.ok,
      models: h.models,
    });
    if (!selected && h.ok) {
      const model =
        c.config.model === 'local-model'
          ? h.models.find((m) => !/embed|rerank|whisper|tts|clip/i.test(m))
          : c.config.model;
      if (model) selected = { ...c.config, model };
    }
  }
  return {
    selected,
    report: {
      local,
      configured: records,
      usable: !!selected,
      credentialEnvironmentNames: Object.keys(process.env).filter((k) =>
        /^(MANDATE_AI_API_KEY|OPENAI_API_KEY)$/.test(k),
      ),
    },
  };
}
