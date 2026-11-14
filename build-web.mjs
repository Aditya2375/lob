// Builds docs/ from web/src + the generated scenario files. Works from a
// deleted docs/: fonts and app code are source assets copied fresh every time.
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';

const SRC = 'web/src';
const OUT = 'docs';
const DATA = 'data/scenarios';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(SRC, OUT, { recursive: true });
if (existsSync(DATA)) {
  cpSync(DATA, `${OUT}/data`, { recursive: true });
  console.log('[web] scenarios copied from ' + DATA);
} else {
  console.log('[web] WARNING: no scenarios at ' + DATA + ' (run: java lob.sim.Main data/scenarios)');
}
writeFileSync(`${OUT}/.nojekyll`, '');
console.log('[web] docs/ built');
