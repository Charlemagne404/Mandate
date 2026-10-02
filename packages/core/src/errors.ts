export class WorldError extends Error {
  constructor(
    public readonly code:
      | 'DOMAIN'
      | 'INVARIANT'
      | 'STALE_REVISION'
      | 'UNSUPPORTED_VERSION'
      | 'GEOGRAPHY',
    message: string,
  ) {
    super(message);
    this.name = 'WorldError';
  }
}
export function requireDomain(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new WorldError('DOMAIN', message);
}
