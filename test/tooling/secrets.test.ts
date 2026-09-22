import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../scripts/secrets.mjs', import.meta.url));
const directories: string[] = [];
function run(repo: string, args: string[]) {
  const result = spawnSync(
    'git',
    [
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'commit.gpgSign=false',
      '-c',
      'user.name=Security Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      ...args,
    ],
    { cwd: repo, encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error('Synthetic Git fixture failed');
}
function fixture() {
  const path = mkdtempSync(join(tmpdir(), 'wrapp-secret-fixture-'));
  directories.push(path);
  run(path, ['init', '--quiet']);
  run(path, ['commit', '--quiet', '--allow-empty', '-m', 'chore: synthetic baseline']);
  return path;
}
function scan(repo: string, mode = 'check') {
  return spawnSync(process.execPath, [script, mode, repo], { encoding: 'utf8', timeout: 20_000 });
}
const fakeSecret = () => 'gh' + 'p_' + randomBytes(20).toString('hex');
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
describe('secret scanning enforcement', () => {
  it('should fail closed when the local scanner has not been installed', () => {
    const repo = fixture();
    mkdirSync(join(repo, 'scripts'));
    const isolatedScript = join(repo, 'scripts', 'secrets.mjs');
    writeFileSync(isolatedScript, readFileSync(script));
    const result = spawnSync(process.execPath, [isolatedScript, 'check'], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Scanner missing');
  });
  it('should accept a clean synthetic history', () => {
    const result = scan(fixture());
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
  it('should detect staged secrets even if the working file has been cleaned', () => {
    const repo = fixture(),
      secret = fakeSecret();
    writeFileSync(join(repo, 'fixture.txt'), 'token = "' + secret + '"');
    run(repo, ['add', 'fixture.txt']);
    writeFileSync(join(repo, 'fixture.txt'), 'clean');
    const result = scan(repo, 'staged');
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(result.stderr).toContain('Secret scan failed for staged');
  });
  it('should find a secret deleted from HEAD but retained in history', () => {
    const repo = fixture();
    writeFileSync(join(repo, 'fixture.txt'), fakeSecret());
    run(repo, ['add', 'fixture.txt']);
    run(repo, ['commit', '--quiet', '-m', 'test: synthetic token']);
    writeFileSync(join(repo, 'fixture.txt'), 'clean');
    run(repo, ['add', 'fixture.txt']);
    run(repo, ['commit', '--quiet', '-m', 'test: clean head']);
    expect(scan(repo).stderr).toContain('Secret scan failed for history');
  });
  it('should scan untracked files and refuse shallow history', () => {
    const repo = fixture();
    writeFileSync(join(repo, 'untracked.txt'), fakeSecret());
    expect(scan(repo).stderr).toContain('Secret scan failed for working files');
    const tip = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    }).stdout.trim();
    writeFileSync(join(repo, '.git', 'shallow'), tip + '\n');
    expect(scan(repo).stderr).toContain('Shallow history');
  });
});
