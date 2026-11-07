// Evaluate this plugin's manifest with DSH's own compatibility check against the installed runtime.
import { readFileSync } from 'node:fs';
import { evaluatePluginCompatibility, getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const runtime = getDshRuntimeVersion();
const issue = evaluatePluginCompatibility(manifest, {}, runtime);
console.log(`runtime ${runtime}; ${manifest.name}@${manifest.version}: ${issue === undefined ? 'compatible' : `INCOMPATIBLE ${JSON.stringify(issue.requirements)}`}`);
for (const version of ['0.2.1-rc.5', '0.2.2-rc.1', '0.2.2', '0.2.3-rc.1']) {
  const result = evaluatePluginCompatibility(manifest, {}, version);
  console.log(`  on ${version}: ${result === undefined ? 'compatible' : 'incompatible'}`);
}
