import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  chmodSync,
  copyFileSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = '8.30.1';
const assets = {
  darwin_arm64: 'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5',
  darwin_x64: 'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709',
  linux_arm64: 'e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080',
  linux_x64: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
};
const binary = join(root, '.tools', 'gitleaks', version, 'gitleaks');
const mode = process.argv[2];
const target = realpathSync(resolve(process.argv[3] ?? root));
function execute(file, args, cwd = target) {
  return spawnSync(file, args, { cwd, encoding: 'utf8', timeout: 150_000, maxBuffer: 2_097_152 });
}
function git(args) {
  const result = execute('git', args);
  if (result.error || result.status !== 0)
    throw new Error('Git inventory failed; scan incomplete.');
  return result.stdout.trim();
}
async function install() {
  const platform = process.platform + '_' + process.arch;
  const expected = assets[platform];
  if (!expected)
    throw new Error('Unsupported scanner platform; use a documented Linux/macOS runner.');
  const asset = 'gitleaks_' + version + '_' + platform + '.tar.gz';
  const response = await fetch(
    'https://github.com/gitleaks/gitleaks/releases/download/v' + version + '/' + asset,
    { signal: AbortSignal.timeout(60_000) },
  );
  if (!response.ok) throw new Error('Scanner download failed.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== expected)
    throw new Error('Scanner checksum mismatch.');
  const scratch = mkdtempSync(join(tmpdir(), 'wrapp-gitleaks-install-'));
  try {
    const archive = join(scratch, 'scanner.tar.gz');
    writeFileSync(archive, bytes, { mode: 0o600 });
    const extracted = execute('tar', ['-xzf', archive, '-C', scratch, 'gitleaks'], root);
    if (extracted.error || extracted.status !== 0) throw new Error('Scanner extraction failed.');
    mkdirSync(join(root, '.tools', 'gitleaks', version), { recursive: true });
    copyFileSync(join(scratch, 'gitleaks'), binary);
    chmodSync(binary, 0o700);
    console.log('Installed checksum-verified Gitleaks ' + version + ' locally.');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
function scan() {
  if (!['staged', 'check'].includes(mode))
    throw new Error('Usage: npm run secrets:install | secrets:staged | secrets:check');
  if (!existsSync(binary))
    throw new Error('Scanner missing. Run npm run secrets:install; check has not passed.');
  const installed = execute(binary, ['version'], root);
  if (installed.error || installed.status !== 0 || installed.stdout.trim() !== version)
    throw new Error('Scanner version mismatch.');
  if (realpathSync(git(['rev-parse', '--show-toplevel'])) !== target)
    throw new Error('Scan must target a Git repository root.');
  if (mode === 'check' && git(['rev-parse', '--is-shallow-repository']) !== 'false') {
    throw new Error('Shallow history: fetch complete history before checking.');
  }
  const scratch = mkdtempSync(join(tmpdir(), 'wrapp-gitleaks-scan-'));
  try {
    const ignore = join(scratch, 'empty-ignore');
    writeFileSync(ignore, '');
    const config = join(root, '.gitleaks.toml');
    const worktree = join(scratch, 'worktree.toml');
    writeFileSync(
      worktree,
      readFileSync(config, 'utf8') +
        `
[[allowlists]]
description = "Local dependencies and generated artifacts only; not applied to Git scans."
paths = ['(^|/)(node_modules|[.]git|[.]tools|coverage)/']
`,
    );
    const scopes =
      mode === 'staged'
        ? [['staged', ['git', '--staged', target], config]]
        : [
            ['history', ['git', '--log-opts=--all --full-history -m', target], config],
            ['staged', ['git', '--staged', target], config],
            ['working files', ['dir', target], worktree],
          ];
    for (const [label, args, configuration] of scopes) {
      const result = execute(binary, [
        ...args,
        '--config',
        configuration,
        '--gitleaks-ignore-path',
        ignore,
        '--ignore-gitleaks-allow',
        '--redact=100',
        '--no-banner',
        '--no-color',
        '--log-level=error',
        '--timeout=120',
        '--max-decode-depth=2',
        '--max-archive-depth=2',
      ]);
      if (result.error || result.status !== 0) {
        throw new Error(
          'Secret scan failed for ' +
            label +
            ' (findings or scanner error). Details withheld to avoid disclosure.',
        );
      }
    }
    console.log(
      'Secret scans passed for ' +
        (mode === 'staged'
          ? 'staged changes.'
          : 'locally available history, staged changes and eligible working files. Manual publication review is still required.'),
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
try {
  if (mode === 'install') await install();
  else scan();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Secret check failed.');
  process.exitCode = 1;
}
