import { ProviderConfig } from './contracts.js';
import type {
  GenerationRequest,
  GenerationResult,
  LlmProvider,
} from './contracts.js';
import { FakeProvider } from './fake.js';

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** HTTP is confined to the explicitly configured inference endpoint. No model tools. */
class HttpProvider implements LlmProvider {
  readonly id: string;
  private readonly endpoint: URL;
  private inFlight = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly config: ProviderConfig) {
    this.id = config.kind;
    this.endpoint = new URL(
      config.baseUrl ??
        (config.kind === 'ollama'
          ? 'http://127.0.0.1:11434'
          : 'http://127.0.0.1:1234/v1'),
    );
    if (
      !['http:', 'https:'].includes(this.endpoint.protocol) ||
      this.endpoint.username ||
      this.endpoint.password ||
      this.endpoint.search ||
      this.endpoint.hash
    )
      throw new ProviderError(
        'Provider URL must be HTTP(S), without credentials, query or fragment',
      );
  }
  private url(path: string) {
    return this.endpoint.toString().replace(/\/$/, '') + path;
  }
  private async request(
    path: string,
    body: object | undefined,
    signal?: AbortSignal,
  ): Promise<unknown> {
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(this.url(path), {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey
          ? { Authorization: `Bearer ${this.config.apiKey}` }
          : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: combined,
      redirect: 'error',
    });
    if (!response.ok)
      throw new ProviderError(
        `Inference endpoint returned HTTP ${response.status}`,
        response.status === 429 || response.status >= 500,
      );
    // Reject pathological output before parsing; never execute any returned content.
    let text = '';
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 1_000_000) {
          await reader.cancel();
          throw new ProviderError('Inference response exceeded 1 MB');
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError('Inference endpoint returned malformed JSON');
    }
  }
  async health(signal?: AbortSignal) {
    try {
      const value = (await this.request(
        this.config.kind === 'ollama' ? '/api/tags' : '/models',
        undefined,
        signal,
      )) as {
        models?: Array<{ name?: string }>;
        data?: Array<{ id?: string }>;
      };
      const models = (
        value.models?.map((m) => m.name) ??
        value.data?.map((m) => m.id) ??
        []
      ).filter((m): m is string => typeof m === 'string');
      return { ok: true, message: `${this.id} endpoint reachable`, models };
    } catch (error) {
      signal?.throwIfAborted();
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : 'Provider unavailable',
        models: [],
      };
    }
  }
  async generateStructured(
    request: GenerationRequest,
  ): Promise<GenerationResult> {
    request.signal?.throwIfAborted();
    const limit =
      this.config.concurrency ?? (this.config.kind === 'ollama' ? 1 : 2);
    if (this.inFlight >= limit) {
      if (this.queue.length >= 80)
        throw new ProviderError(
          'Inference queue is full. Wait for the current turn.',
        );
      await new Promise<void>((resolve) => this.queue.push(resolve));
    } else this.inFlight++;
    try {
      request.signal?.throwIfAborted();
      return await this.generate(request);
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.inFlight--;
    }
  }
  private async generate(
    request: GenerationRequest,
  ): Promise<GenerationResult> {
    const started = performance.now();
    let retries = 0;
    while (true) {
      request.signal?.throwIfAborted();
      try {
        const messages = [
          { role: 'system', content: request.system },
          { role: 'user', content: request.prompt },
        ];
        const body =
          this.config.kind === 'ollama'
            ? {
                model: request.model,
                stream: false,
                think: false,
                messages,
                format: request.jsonSchema,
                options: {
                  temperature: request.temperature ?? this.config.temperature,
                  num_predict: request.maxTokens ?? 3000,
                  ...(this.config.contextTokens
                    ? { num_ctx: this.config.contextTokens }
                    : {}),
                },
              }
            : {
                model: request.model,
                messages,
                temperature: request.temperature ?? this.config.temperature,
                max_tokens: request.maxTokens ?? 3000,
                response_format: {
                  type: 'json_schema',
                  json_schema: {
                    name: `mandate_${request.role}`,
                    strict: true,
                    schema: request.jsonSchema,
                  },
                },
              };
        const data = (await this.request(
          this.config.kind === 'ollama' ? '/api/chat' : '/chat/completions',
          body,
          request.signal,
        )) as {
          message?: { content?: string };
          choices?: Array<{ message?: { content?: string } }>;
          prompt_eval_count?: number;
          eval_count?: number;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const rawText =
          data.message?.content ?? data.choices?.[0]?.message?.content;
        if (typeof rawText !== 'string')
          throw new ProviderError('Inference response has no message content');
        let value: unknown;
        try {
          value = JSON.parse(rawText);
        } catch {
          value = null;
        }
        return {
          value,
          rawText,
          latencyMs: performance.now() - started,
          retries,
          usage: {
            ...(data.prompt_eval_count !== undefined ||
            data.usage?.prompt_tokens !== undefined
              ? {
                  promptTokens:
                    data.prompt_eval_count ?? data.usage?.prompt_tokens ?? 0,
                }
              : {}),
            ...(data.eval_count !== undefined ||
            data.usage?.completion_tokens !== undefined
              ? {
                  completionTokens:
                    data.eval_count ?? data.usage?.completion_tokens ?? 0,
                }
              : {}),
          },
        };
      } catch (error) {
        request.signal?.throwIfAborted();
        const retryable =
          error instanceof ProviderError
            ? error.retryable
            : error instanceof TypeError;
        if (!retryable || retries >= this.config.retries) {
          if (error instanceof Error) Object.assign(error, { retries });
          throw error;
        }
        retries++;
      }
    }
  }
}
export function createProvider(input: unknown = {}): LlmProvider {
  const config = ProviderConfig.parse(input);
  return config.kind === 'fake' ? new FakeProvider() : new HttpProvider(config);
}
