import { WorldState } from '@mandate/schemas';
import type { WorldCommand, WorldState as World } from '@mandate/schemas';
export interface WorldResponse {
  world: World;
  hash: string;
}
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof value === 'object' && value && 'error' in value
        ? String(value.error)
        : 'Request failed';
    throw new Error(message);
  }
  return value as T;
}
export function parseResponse(value: WorldResponse): WorldResponse {
  return { world: WorldState.parse(value.world), hash: value.hash };
}
export function commandRequest(
  world: World,
  command: WorldCommand | WorldCommand[],
  reason: string,
  expectedHash: string,
) {
  const commands = Array.isArray(command) ? command : [command];
  return {
    expectedRevision: world.revision,
    expectedHash,
    action: {
      source: 'debug',
      actorNationId: world.playerNationId,
      text: reason,
    },
    commands: commands.map((entry, index) => ({
      id: `command:${crypto.randomUUID()}`,
      reason:
        commands.length > 1
          ? `${reason} (${index + 1}/${commands.length})`
          : reason,
      command: entry,
    })),
  };
}
