// Static, lossless data bundle. Sequential parsing keeps only one source cluster in memory.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {projectReplayTurn} = require('../site/replay-events.js');
const options = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  if (!['--source', '--out'].includes(process.argv[i]) || !process.argv[i+1]) throw new Error('Usage: build_web.cjs --source Identifier --out NEW_OUTPUT');
  options.set(process.argv[i], process.argv[i+1]);
}
if (!options.has('--source') || !options.has('--out')) throw new Error('--source and --out are required');
const source = fs.realpathSync(options.get('--source'));
const out = path.resolve(options.get('--out'));
if (fs.existsSync(out)) throw new Error('Output already exists; choose a new release directory');
if (out === source || out.startsWith(source + path.sep)) throw new Error('Output must be outside the input Identifier directory');
const app = path.resolve(__dirname, '..');
const files = [];
let sourceBytes = 0, bundledBytes = 0, fights = 0, replayTurns = 0;
const sha = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
function walk(dir) {
  return fs.readdirSync(dir, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not supported: ${entry.name}`);
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : entry.name.toLowerCase().endsWith('.json') ? [file] : [];
  });
}
// Resolve input folders before creating output; never traverse backups or other scenarios.
const inputs = ['Falkner', 'Whitney'].flatMap(scenario => walk(path.join(source, scenario)).map(file=>({scenario,file})));
if (!inputs.length) throw new Error('No clusters found');
fs.mkdirSync(path.join(out, 'data'), {recursive:true});
for (const {scenario,file} of inputs) {
  const raw = fs.readFileSync(file);
  const data = JSON.parse(raw);
  if (!data.parser || !Array.isArray(data.fights)) throw new Error(`Invalid identifier export: ${file}`);
  for (const fight of data.fights) {
    if (!Array.isArray(fight.visible_turns) || !Array.isArray(fight.battle_log)) throw new Error(`Missing observations/replay: ${file}`);
    for (const [i,turn] of fight.battle_log.entries()) {
      if (!projectReplayTurn(turn, data.parser, i+1)) throw new Error(`Unsupported replay events: ${file}, ${fight.seed}, turn ${i+1}`);
      replayTurns++;
    }
  }
  const packed = Buffer.from(JSON.stringify(data));
  const digest = sha(packed), asset = `data/${digest}.json`;
  fs.writeFileSync(path.join(out, asset), packed, {flag:'wx'});
  const relative = path.relative(source, file).split(path.sep).join('/');
  files.push({name:path.basename(file), scenario, relative_path:relative, asset,
    summary:{wins:data.fights.filter(f=>f.status==='WIN'||Boolean(f.bruteforce)).length, fight_count:data.fights.length},
    bytes:packed.length, source_sha256:sha(raw)});
  sourceBytes += raw.length; bundledBytes += packed.length; fights += data.fights.length;
}
for (const name of ['app.js','filter.js','replay-events.js','styles.css','web-runtime.js','index.html','README.md']) fs.copyFileSync(path.join(app,'site',name), path.join(out,name));
fs.writeFileSync(path.join(out,'catalog.json'), JSON.stringify({schema_version:1, generated_at:new Date().toISOString(), files}));
console.log(JSON.stringify({output:out, scenarios:['Falkner','Whitney'], clusters:files.length, fights, replayTurns, sourceBytes, bundledBytes, catalogueBytes:fs.statSync(path.join(out,'catalog.json')).size}, null, 2));
