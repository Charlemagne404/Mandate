import { packager } from '@electron/packager';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const { branding } = createRequire(import.meta.url)(
  join(root, 'apps/desktop/dist/branding.cjs'),
);
const temporary = mkdtempSync(join(tmpdir(), 'mandate-package-'));
const stage = join(temporary, 'app');
const workspaceStatePath = join(
  root,
  'node_modules/.pnpm-workspace-state-v1.json',
);
const originalWorkspaceState = existsSync(workspaceStatePath)
  ? readFileSync(workspaceStatePath)
  : undefined;
try {
  execFileSync(
    'pnpm',
    [
      '--config.verify-deps-before-run=false',
      '--filter',
      '@mandate/desktop',
      'deploy',
      '--legacy',
      '--prod',
      stage,
    ],
    { cwd: root, stdio: 'inherit' },
  );
  if (originalWorkspaceState)
    writeFileSync(workspaceStatePath, originalWorkspaceState);
  // Workspace source is already included in main.cjs. Legacy pnpm deploy leaves
  // a dangling link to the deploying package in its virtual store; it is not a
  // runtime dependency and fs.cp (used by Packager) cannot dereference it.
  const pruneBundledLinks = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        if (!existsSync(path)) {
          if (!path.includes('@mandate'))
            throw new Error(`Missing packaged dependency: ${path}`);
          rmSync(path);
        }
      } else if (stat.isDirectory()) pruneBundledLinks(path);
    }
  };
  pruneBundledLinks(join(stage, 'node_modules'));
  const stagedManifest = JSON.parse(
    readFileSync(join(stage, 'package.json'), 'utf8'),
  );
  stagedManifest.dependencies = Object.fromEntries(
    Object.entries(stagedManifest.dependencies).filter(
      ([name]) => !name.startsWith('@mandate/'),
    ),
  );
  writeFileSync(
    join(stage, 'package.json'),
    JSON.stringify(stagedManifest, null, 2) + '\n',
  );
  const resources = join(stage, 'resources');
  mkdirSync(resources, { recursive: true });
  cpSync(join(root, 'data'), join(resources, 'data'), { recursive: true });
  cpSync(
    join(root, 'packages/persistence/migrations'),
    join(resources, 'packages/persistence/migrations'),
    { recursive: true },
  );
  cpSync(join(root, 'apps/web/dist'), join(resources, 'web'), {
    recursive: true,
  });
  cpSync(join(root, 'docs/THIRD_PARTY.md'), join(stage, 'THIRD_PARTY.md'));
  mkdirSync(join(resources, 'notices'), { recursive: true });
  for (const name of ['LICENSE', 'LICENSES.chromium.html'])
    cpSync(
      join(root, 'apps/desktop/node_modules/electron/dist', name),
      join(resources, 'notices', name),
    );
  const manifest = JSON.parse(
    readFileSync(join(root, 'apps/desktop/package.json'), 'utf8'),
  );
  const paths = await packager({
    dir: stage,
    name: branding.name,
    executableName: branding.name,
    electronVersion: manifest.devDependencies.electron,
    platform: process.platform,
    arch: process.arch,
    out: join(root, 'output/desktop'),
    overwrite: true,
    asar: false,
    derefSymlinks: false,
    appBundleId: 'local.mandate.alpha',
    appCategoryType: 'public.app-category.strategy-games',
    appCopyright: 'Mandate contributors',
    prune: false,
  });
  // Node fs.cp preserves symlinks but rewrites relative links to absolute paths.
  // Rebase them onto the final app before deleting the temporary deployment.
  for (const output of paths) {
    const packagedApp =
      process.platform === 'darwin'
        ? join(output, `${branding.name}.app/Contents/Resources/app`)
        : join(output, 'resources/app');
    const rebaseLinks = (directory) => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) {
          const target = resolve(dirname(path), readlinkSync(path));
          const suffix = relative(stage, target);
          if (suffix.startsWith('..'))
            throw new Error(
              `Packaged dependency points outside deployment: ${path}`,
            );
          const finalTarget = join(packagedApp, suffix);
          if (!existsSync(finalTarget))
            throw new Error(
              `Packaged dependency target is missing: ${finalTarget}`,
            );
          rmSync(path);
          symlinkSync(relative(dirname(path), finalTarget), path);
        } else if (stat.isDirectory()) rebaseLinks(path);
      }
    };
    rebaseLinks(join(packagedApp, 'node_modules'));
  }
  console.log(paths.join('\n'));
} finally {
  if (originalWorkspaceState)
    writeFileSync(workspaceStatePath, originalWorkspaceState);
  rmSync(temporary, { recursive: true, force: true });
}
