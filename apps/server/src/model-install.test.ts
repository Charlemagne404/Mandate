import { afterEach, describe, expect, it, vi } from 'vitest';
import { installLocalModel } from './model-install.js';

vi.mock('node:fs', () => ({
  statfsSync: () => ({ bavail: 10 * 1024 ** 3, bsize: 1 }),
}));
vi.mock('node:os', () => ({
  homedir: () => '/test-home',
  totalmem: () => 8 * 1024 ** 3,
}));
afterEach(() => vi.unstubAllGlobals());

describe('explicit bounded local model download', () => {
  it('uses only the fixed loopback pull endpoint and requires confirmed completion', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          '{"status":"pulling","total":100,"completed":50}\n{"status":"success"}\n',
        ),
      );
    vi.stubGlobal('fetch', fetch);
    const status: string[] = [];
    await expect(
      installLocalModel('qwen2.5:3b', new AbortController().signal, (s) =>
        status.push(s),
      ),
    ).resolves.toEqual({ installed: true, model: 'qwen2.5:3b' });
    expect(fetch.mock.calls[0]![0]).toBe('http://127.0.0.1:11434/api/pull');
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({
      model: 'qwen2.5:3b',
      stream: true,
    });
    expect(status).toContain('pulling · 50%');
  });
  it('rejects an oversized layer and cancels the progress stream', async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('{"status":"pulling","total":4294967296}\n'),
        );
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)));
    await expect(
      installLocalModel(
        'qwen3:4b-instruct',
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow('3 GB');
    expect(cancelled).toBe(true);
  });
  it('an interrupted download is never reported as an installed model', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('{"status":"pulling","total":100,"completed":50}\n'),
        ),
    );
    await expect(
      installLocalModel('qwen2.5:3b', new AbortController().signal, () => {}),
    ).rejects.toThrow('before Ollama confirmed success');
  });
});
