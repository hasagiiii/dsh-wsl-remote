// Regenerate cordis.patch.yml from patch.template.yml, substituting @MODE@ with
// lib/boot.js MODE_EXPRESSION, and check that every `!!js` expression parses.
//   node scripts/build-patch.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { MODE_EXPRESSION } = await import(pathToFileURL(join(root, 'lib/boot.js')).href);
if (MODE_EXPRESSION.includes('\\') || MODE_EXPRESSION.includes('"')) throw new Error('MODE_EXPRESSION must not contain backslashes or double quotes');

const template = readFileSync(join(root, 'patch.template.yml'), 'utf8');
const patch = template
  .replaceAll('@MODE@', MODE_EXPRESSION)
  .replace(/^# GENERATED[\s\S]*?Edit the template, not this file\.\n#\n/m, '# GENERATED from patch.template.yml by scripts/build-patch.mjs; edit the template.\n#\n');

for (const match of patch.matchAll(/!!js "((?:[^"\\]|\\.)*)"/g)) {
  // eslint-disable-next-line no-new-func
  new Function('ctx', `with (ctx) { return (${JSON.parse(`"${match[1]}"`)}) }`);
}
writeFileSync(join(root, 'cordis.patch.yml'), patch);
console.log('cordis.patch.yml regenerated');
