import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['index', 'client', 'types', 'values', 'errors', 'webhooks'];
const report = files
  .map(
    (name) =>
      '// dist/' + name + '.d.ts\n' + readFileSync(join(root, 'dist', name + '.d.ts'), 'utf8'),
  )
  .join('\n');
const target = join(root, 'docs/api/core.api.txt');
if (process.argv.includes('--update')) {
  writeFileSync(target, report);
  console.log('Updated declaration baseline; review the diff before committing.');
} else {
  if (readFileSync(target, 'utf8') !== report)
    throw new Error(
      'Declaration baseline changed. Review compatibility before npm run api:update.',
    );
  console.log('Declaration baseline matches.');
}
