import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const DesktopConfiguration = z.strictObject({
  version: z.literal(1),
  width: z.number().int().min(1000).max(7680).default(1440),
  height: z.number().int().min(700).max(4320).default(960),
  maximized: z.boolean().default(false),
});
export type DesktopConfiguration = z.infer<typeof DesktopConfiguration>;
export function desktopDirectories(userData: string) {
  const paths = {
    saves: join(userData, 'saves'),
    scenarios: join(userData, 'scenarios'),
    exports: join(userData, 'exports'),
    logs: join(userData, 'logs'),
    services: join(userData, 'services'),
  };
  for (const path of Object.values(paths)) mkdirSync(path, { recursive: true });
  return paths;
}
export function readConfiguration(userData: string): DesktopConfiguration {
  try {
    return DesktopConfiguration.parse(
      JSON.parse(readFileSync(join(userData, 'desktop.json'), 'utf8')),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return DesktopConfiguration.parse({ version: 1 });
  }
}
export function writeConfiguration(userData: string, value: unknown): void {
  const configuration = DesktopConfiguration.parse(value);
  const temporary = join(userData, 'desktop.json.tmp');
  writeFileSync(temporary, JSON.stringify(configuration, null, 2) + '\n', {
    mode: 0o600,
  });
  renameSync(temporary, join(userData, 'desktop.json'));
}
