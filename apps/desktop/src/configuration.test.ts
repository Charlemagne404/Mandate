import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  desktopDirectories,
  readConfiguration,
  writeConfiguration,
} from './configuration.js';

describe('desktop configuration', () => {
  it('creates scoped folders and persists schema-validated window preferences', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mandate-desktop-config-'));
    try {
      expect(Object.keys(desktopDirectories(directory))).toEqual([
        'saves',
        'scenarios',
        'exports',
        'logs',
        'services',
      ]);
      expect(readConfiguration(directory).width).toBe(1440);
      writeConfiguration(directory, {
        version: 1,
        width: 1300,
        height: 800,
        maximized: true,
      });
      expect(readConfiguration(directory)).toEqual({
        version: 1,
        width: 1300,
        height: 800,
        maximized: true,
      });
      expect(() =>
        writeConfiguration(directory, { version: 1, width: 1 }),
      ).toThrow();
      expect(
        JSON.parse(readFileSync(join(directory, 'desktop.json'), 'utf8')).width,
      ).toBe(1300);
      writeFileSync(join(directory, 'desktop.json'), '{broken');
      expect(() => readConfiguration(directory)).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
