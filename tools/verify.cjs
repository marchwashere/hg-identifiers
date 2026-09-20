const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(process.argv[2] || path.join(__dirname, '../site'));
const {projectReplayTurn} = require(path.join(root, 'replay-events.js'));
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog.json')));
assert.equal(catalog.schema_version, 1);
assert(Array.isArray(catalog.files) && catalog.files.length > 0);
let fights = 0, turns = 0;
const paths = new Set();
const scenarios = {};
for (const file of catalog.files) {
  assert.match(file.asset, /^data\/[0-9a-f]{64}\.json$/);
  assert(!paths.has(file.relative_path), 'Duplicate cluster');
  paths.add(file.relative_path);
  const bytes = fs.readFileSync(path.join(root, file.asset));
  assert.equal(bytes.length, file.bytes);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(file.asset, `data/${hash}.json`);
  const data = JSON.parse(bytes);
  assert(data.parser && Array.isArray(data.fights));
  assert.equal(data.fights.length, file.summary.fight_count);
  assert.equal(data.fights.filter(f => f.status === 'WIN' || Boolean(f.bruteforce)).length, file.summary.wins);
  for (const fight of data.fights) {
    assert(Array.isArray(fight.visible_turns) && Array.isArray(fight.battle_log));
    for (const [i, turn] of fight.battle_log.entries()) {
      assert(projectReplayTurn(turn, data.parser, i + 1), 'Unsupported route replay');
      turns++;
    }
  }
  fights += data.fights.length;
  scenarios[file.scenario] = (scenarios[file.scenario] || 0) + 1;
}
for (const file of ['index.html', 'app.js', 'filter.js', 'replay-events.js', 'styles.css', 'web-runtime.js']) {
  assert(fs.statSync(path.join(root, file)).isFile());
}
console.log(JSON.stringify({clusters: catalog.files.length, scenarios, fights, replayTurns: turns, result: 'PASS'}, null, 2));
