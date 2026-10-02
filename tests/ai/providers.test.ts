import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProvider } from '../../packages/ai/src/index.js';

afterEach(() => vi.unstubAllGlobals());
const generation = {
  role: 'resolver' as const,
  model: 'custom-model',
  system: 'Rules',
  prompt: '{}',
  jsonSchema: { type: 'object' },
};

describe('inference provider adapters', () => {
  it('fake health is launchable without an inference runtime', async () => {
    expect(await createProvider().health()).toEqual({
      ok: true,
      message: expect.stringContaining('demo'),
      models: ['demo-rules-v1'],
    });
  });
  it('Ollama posts JSON-schema structured generation without tools', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            message: { content: '{"version":1}' },
            prompt_eval_count: 12,
            eval_count: 3,
          }),
        ),
    );
    vi.stubGlobal('fetch', fetch);
    const provider = createProvider({
      kind: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      contextTokens: 8192,
    });
    const result = await provider.generateStructured(generation);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'custom-model',
      stream: false,
      format: generation.jsonSchema,
      options: { num_ctx: 8192 },
    });
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(result.value).toEqual({ version: 1 });
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 3 });
  });
  it('OpenAI-compatible posts strict response format to configured endpoint', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"ok":true}' } }],
          }),
        ),
    );
    vi.stubGlobal('fetch', fetch);
    const result = await createProvider({
      kind: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:1234/v1',
      apiKey: 'test-secret',
    }).generateStructured(generation);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:1234/v1/chat/completions');
    expect(JSON.parse(init.body as string)).toMatchObject({
      response_format: { type: 'json_schema', json_schema: { strict: true } },
    });
    expect(JSON.stringify(result)).not.toContain('test-secret');
  });
  it('retries transient provider HTTP failure within a fixed bound', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: { content: '{}' } })),
      );
    vi.stubGlobal('fetch', fetch);
    expect(
      (
        await createProvider({ kind: 'ollama', retries: 1 }).generateStructured(
          generation,
        )
      ).retries,
    ).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not retry malformed endpoint envelopes or fatal HTTP failures', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    await expect(
      createProvider({ kind: 'ollama', retries: 2 }).generateStructured(
        generation,
      ),
    ).rejects.toThrow('HTTP 401');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('malformed model JSON is observable raw text and cannot be silently coerced', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: { content: 'not JSON' } })),
      ),
    );
    const result = await createProvider({ kind: 'ollama' }).generateStructured(
      generation,
    );
    expect(result.value).toBeNull();
    expect(result.rawText).toBe('not JSON');
  });
  it('streamed inference responses are bounded before JSON parsing', async () => {
    const fetch = vi.fn(async () => new Response('x'.repeat(1_000_001)));
    vi.stubGlobal('fetch', fetch);
    await expect(
      createProvider({ kind: 'ollama', retries: 2 }).generateStructured(
        generation,
      ),
    ).rejects.toThrow('exceeded 1 MB');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('cancellation prevents HTTP calls', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    controller.abort();
    await expect(
      createProvider({ kind: 'ollama' }).generateStructured({
        ...generation,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    'file:///tmp/provider',
    'http://name:secret@127.0.0.1:11434',
    'http://127.0.0.1:11434?credential=secret',
  ])('rejects unsafe inference URL %s', (baseUrl) => {
    expect(() => createProvider({ kind: 'ollama', baseUrl })).toThrow();
  });
  it('health lists configured runtime models and reports bounded failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ models: [{ name: 'any-model' }] })),
      ),
    );
    expect(await createProvider({ kind: 'ollama' }).health()).toMatchObject({
      ok: true,
      models: ['any-model'],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Connection refused');
      }),
    );
    expect(await createProvider({ kind: 'ollama' }).health()).toMatchObject({
      ok: false,
      message: 'Connection refused',
    });
  });
});

it('reports attempted retries even when all transport attempts fail', async () => {
  const fetch = vi.fn(async () => new Response('', { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  await expect(
    createProvider({ kind: 'ollama', retries: 1 }).generateStructured(
      generation,
    ),
  ).rejects.toMatchObject({ retries: 1 });
  expect(fetch).toHaveBeenCalledTimes(2);
});
