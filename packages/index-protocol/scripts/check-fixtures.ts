// Validates every fixture against the schema its manifest entry names. Run with `pnpm check` (Node strips
// the types). The same checks run in `pnpm test`.
import { loadManifest, readFixture } from '../src/fixtures.ts';
import { formatErrors, validate } from '../src/validate.ts';

let failed = 0;
const { fixtures } = loadManifest();
for (const entry of fixtures) {
  const result = validate(entry.schema, readFixture(entry.file));
  if (result.valid) continue;
  failed++;
  console.error(`✗ ${entry.file} (${entry.schema})\n${formatErrors(result.errors).replace(/^/gm, '  ')}`);
}
if (failed > 0) {
  console.error(`${failed} of ${fixtures.length} fixtures do not match their schemas`);
  process.exit(1);
}
console.log(`${fixtures.length} fixtures match their schemas`);
