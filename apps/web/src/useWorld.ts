import { useCallback, useEffect, useState } from 'react';
import type { WorldCommand } from '@mandate/schemas';
import { api, commandRequest, parseResponse } from './api.js';
import type { WorldResponse } from './api.js';
export function useWorld() {
  const [state, setState] = useState<WorldResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setState(parseResponse(await api<WorldResponse>('/api/world')));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const commit = async (
    command: WorldCommand | WorldCommand[],
    reason: string,
  ): Promise<boolean> => {
    if (!state || busy) return false;
    setBusy(true);
    setError('');
    try {
      setState(
        parseResponse(
          await api<WorldResponse>('/api/turns', {
            method: 'POST',
            body: JSON.stringify(
              commandRequest(state.world, command, reason, state.hash),
            ),
          }),
        ),
      );
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Command rejected');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const importSave = async (save: unknown): Promise<boolean> => {
    if (!state || busy) return false;
    setBusy(true);
    setError('');
    try {
      setState(
        parseResponse(
          await api<WorldResponse>('/api/import', {
            method: 'POST',
            body: JSON.stringify({
              expectedRevision: state.world.revision,
              expectedHash: state.hash,
              save,
            }),
          }),
        ),
      );
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import rejected');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const operate = async (
    endpoint: string,
    input: object = {},
  ): Promise<unknown> => {
    if (!state || busy) return null;
    setBusy(true);
    setError('');
    try {
      const result = await api<WorldResponse & { statistics?: unknown }>(
        endpoint,
        {
          method: 'POST',
          body: JSON.stringify({
            expectedRevision: state.world.revision,
            expectedHash: state.hash,
            ...input,
          }),
        },
      );
      if (result.world) setState(parseResponse(result));
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation rejected');
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { state, error, busy, refresh, commit, importSave, operate };
}
