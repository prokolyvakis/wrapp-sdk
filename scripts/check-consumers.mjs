import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'wrapp-consumer-'));
function run(command, args, cwd = scratch) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120_000 });
  if (result.error || result.status !== 0) {
    throw new Error(
      'Consumer check failed: ' +
        command +
        '\n' +
        (result.error?.message ?? '') +
        (result.stdout ?? '') +
        (result.stderr ?? ''),
    );
  }
  return result.stdout;
}
// npm 10 runs the prepare script during pack despite --ignore-scripts, so hook tooling can
// print to stdout ahead of the JSON payload — including bracketed noise like "[husky] ...".
function extractJson(output) {
  for (let index = output.indexOf('['); index !== -1; index = output.indexOf('[', index + 1)) {
    try {
      return JSON.parse(output.slice(index));
    } catch {
      // Not the payload; keep scanning for the next bracket.
    }
  }
  throw new Error('npm pack emitted no JSON payload');
}
try {
  const packOutput = run(
    'npm',
    ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch],
    root,
  );
  const packed = z
    .array(z.object({ filename: z.string(), files: z.array(z.object({ path: z.string() })) }))
    .min(1)
    .parse(extractJson(packOutput))[0];
  if (
    !packed ||
    packed.files.some((file) => !/^(dist\/|README\.md$|LICENSE$|package\.json$)/.test(file.path))
  ) {
    throw new Error('Unexpected tarball content');
  }
  writeFileSync(join(scratch, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  // prefer-offline, not offline: a fresh runner's cache lacks registry metadata
  // for the tarball's dependencies. Versions are exact-pinned and both runtime
  // deps carry no transitive dependencies, so a network fallback cannot change
  // what is installed; a future dep with semver ranges would weaken this.
  run('npm', [
    'install',
    '--prefer-offline',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    join(scratch, packed.filename),
  ]);
  const fixture = readFileSync(join(root, 'test/consumers/core.fixture.txt'), 'utf8');
  writeFileSync(join(scratch, 'consumer.ts'), fixture);
  for (const compiler of ['typescript-5-8', 'typescript']) {
    for (const mode of ['NodeNext', 'Bundler']) {
      run(process.execPath, [
        join(root, 'node_modules', compiler, 'bin/tsc'),
        '--strict',
        '--exactOptionalPropertyTypes',
        '--target',
        'ES2022',
        '--lib',
        'ES2022',
        '--types',
        'node',
        '--typeRoots',
        join(root, 'node_modules/@types'),
        '--moduleResolution',
        mode,
        '--module',
        mode === 'NodeNext' ? 'NodeNext' : 'ESNext',
        '--outDir',
        'compiled',
        'consumer.ts',
      ]);
      run(process.execPath, ['compiled/consumer.js']);
      console.log('Packed consumer passed: ' + compiler + ' / ' + mode);
    }
  }
} finally {
  // Only this freshly allocated scratch directory is removed, never a checkout or arbitrary path.
  rmSync(scratch, { recursive: true, force: true });
}
