// Parity harness: the JS engine must reproduce the Java engine's scenarios
// bit for bit. Regenerates the Java outputs into a temp dir, runs the same
// params through web/src/engine.js, and compares series checksums and stats.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { runSim, defaultParams } from '../web/src/engine.js';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = '/tmp/lob-parity-java';

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log('  ok  ' + name); }
  else { failed++; console.log('FAIL  ' + name + '  ' + extra); }
};

execFileSync('bash', ['-lc', `
  set -e
  cd ${ROOT}
  mkdir -p build/classes
  javac -d build/classes $(find src -name '*.java')
  rm -rf ${OUT}
  JAVA="\${JAVA_HOME:+\${JAVA_HOME}/bin/java}"
  [ -z "$JAVA" ] && JAVA=$([ -x "$HOME/jdk/bin/java" ] && echo "$HOME/jdk/bin/java" || command -v java)
  $JAVA -cp build/classes lob.sim.Main ${OUT} > /dev/null
`], { stdio: 'pipe' });

const scenarioParams = {
  calm: { ...defaultParams(), seed: 11 },
  volatile: { ...defaultParams(), seed: 22, fundamentalVol: 18, noiseProb: 0.45 },
  informed: { ...defaultParams(), seed: 33, informedProb: 0.22, informedQtyMax: 40 },
  flash: { ...defaultParams(), seed: 44, flashTick: 1000, flashJumpTicks: -600 },
};

const checksum = (a) => a.reduce((x, y) => (x * 31 + y) % 1_000_000_007, 0);

for (const [name, p] of Object.entries(scenarioParams)) {
  const java = JSON.parse(readFileSync(`${OUT}/${name}.json`, 'utf8'));
  const js = runSim(p);
  check(name + ': final pnl identical', js.stats.finalPnlTicks === java.stats.finalPnlTicks,
      `js=${js.stats.finalPnlTicks} java=${java.stats.finalPnlTicks}`);
  check(name + ': trade count identical', js.stats.trades === java.stats.trades);
  check(name + ': pnl series identical', checksum(js.series.pnl) === checksum(java.series.pnl));
  check(name + ': mid series identical', checksum(js.series.mid) === checksum(java.series.mid));
  check(name + ': markouts identical',
      js.markout.noiseTicks === java.markout.noiseTicks && js.markout.informedTicks === java.markout.informedTicks);
  check(name + ': depth identical', JSON.stringify(js.depth) === JSON.stringify(java.depth));
}

rmSync(OUT, { recursive: true, force: true });
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
