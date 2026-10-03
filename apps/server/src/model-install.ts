import { homedir, totalmem } from 'node:os';
import { statfsSync } from 'node:fs';
/** Fixed small local candidates only. No provider-generated URL, path or model name. */
export async function installLocalModel(
  model: 'qwen2.5:3b' | 'qwen3:4b-instruct',
  signal: AbortSignal,
  onProgress: (status: string) => void,
) {
  const disk = statfsSync(homedir());
  if (disk.bavail * disk.bsize < 6 * 1024 ** 3)
    throw new Error(
      'At least 6 GB free disk space is required for this download.',
    );
  if (totalmem() < 6 * 1024 ** 3)
    throw new Error(
      'This local candidate needs a machine with at least 6 GB memory. Use an external endpoint.',
    );
  const result = await fetch('http://127.0.0.1:11434/api/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: true }),
    signal,
    redirect: 'error',
  });
  if (!result.ok || !result.body)
    throw new Error(
      'Ollama could not download the model. Open Ollama and retry.',
    );
  let buffer = '',
    success = false;
  const decoder = new TextDecoder();
  const reader = result.body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      if (buffer.length > 65536)
        throw new Error('Invalid model download progress.');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines.filter(Boolean)) {
        const record = JSON.parse(line) as {
          status?: string;
          total?: number;
          completed?: number;
          error?: string;
        };
        if (record.error) throw new Error(record.error.slice(0, 300));
        if ((record.total ?? 0) > 3 * 1024 ** 3)
          throw new Error('Model exceeds the permitted 3 GB download size.');
        if (record.status === 'success') success = true;
        onProgress(
          `${record.status ?? 'Downloading model'}${record.total ? ` · ${Math.floor(((record.completed ?? 0) / record.total) * 100)}%` : ''}`,
        );
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (!success)
    throw new Error(
      'Download ended before Ollama confirmed success. Detect installed models and retry if needed.',
    );
  return { installed: true, model };
}
