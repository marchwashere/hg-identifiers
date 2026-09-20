const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('playwright');
const root = path.resolve(process.argv[2] || path.join(__dirname, '../site'));
const catalogue = JSON.parse(fs.readFileSync(path.join(root,'catalog.json'),'utf8'));
const requested = [];
let failCatalogue = false, failAsset = false;
const server = http.createServer((req,res)=>{
  const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  requested.push(pathname);
  const relative = pathname.startsWith('/identifier/') ? pathname.slice('/identifier/'.length) : pathname.slice(1);
  const file = path.resolve(root, relative || 'index.html');
  if (!file.startsWith(root+path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.writeHead(404);res.end('Not found');return;}
  if ((failCatalogue && relative==='catalog.json') || (failAsset && relative.startsWith('data/'))) {res.writeHead(503);res.end('test failure');return;}
  const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'text/plain','Cache-Control':'no-store'});
  fs.createReadStream(file).pipe(res);
});
async function main(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {}),headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1100,height:840}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const network=[];page.on('request',r=>network.push(r.url()));
    const dataRequests=()=>requested.filter(p=>p.includes('/data/')).length;
    await page.goto(url+'/identifier/');
    await page.evaluate(()=>App.ready);
    assert.equal(await page.evaluate(()=>Boolean(window.__TAURI__)),false);
    assert.equal(await page.locator('[data-scenario]').count(),2);
    assert.equal(await page.locator('input[type="file"], #filter-directory').count(),0,'no import or reload controls');
    assert(!/Reload datasets|individual JSON files|Hosted datasets/.test(await page.locator('body').innerText()));
    assert.equal(dataRequests(),0,'startup must only load metadata');
    for(const scenario of ['Falkner','Whitney']){
      await page.getByRole('button',{name:new RegExp(`^${scenario} `)}).click();
      assert.equal(await page.locator('[data-dataset]').count(),catalogue.files.filter(f=>f.scenario===scenario).length);
      assert((await page.locator('[data-dataset]').allTextContents()).every(t=>/Win rate:\s*\d+\.\d%/.test(t)));
    }
    assert.equal(dataRequests(),0,'scenario navigation must not load fights');
    await page.getByRole('button',{name:/^Falkner /}).click();
    failAsset=true;
    await page.locator('[data-dataset]').first().click();
    await page.waitForFunction(()=>App.views.filter.loadingDataset===null);
    assert.match(await page.evaluate(()=>App.views.filter.notice),/503/);
    assert.equal(await page.evaluate(()=>App.views.filter.dataset()),null);
    failAsset=false;
    await page.locator('[data-dataset]').first().click();
    await page.waitForSelector('#filter-identifier-modal');
    assert.equal(dataRequests(),2,'one failed request and one successful retry');
    const first=await page.evaluate(()=>({count:App.views.filter.dataset().fights.length,name:App.views.filter.dataset().name,hasOtherData:App.views.filter.scenarios.some(s=>s.datasets.some(d=>d.fights))}));
    assert.equal(first.count,catalogue.files.find(f=>f.scenario==='Falkner'&&f.name===first.name).summary.fight_count);
    assert.equal(first.hasOtherData,false);
    assert(await page.locator('[data-cue-type]').count()>0);
    // Exercise the real cue handler and turn navigation over fetched data.
    await page.locator('[data-cue-type="player"]:not([disabled])').first().click();
    assert(await page.evaluate(()=>App.views.filter.filters.some(f=>Object.keys(f).length>0)));
    await page.keyboard.press('Escape');
    if(await page.locator('#filter-identifier-modal').count()) await page.locator('#filter-close-identifier').click();
    await page.getByRole('button',{name:/^Whitney /}).click();
    assert.equal(await page.evaluate(()=>App.views.filter.dataset()),null,'switching scenario releases fights');
    await page.locator('[data-dataset]').first().click();
    await page.waitForSelector('#filter-identifier-modal');
    assert.equal(dataRequests(),3);
    const replay=await page.evaluate(()=>{
      const view=App.views.filter, data=view.dataset();
      const fight=data.fights.find(f=>f.bruteforce);
      if(!fight)throw Error('fixture has no winning route');
      const projected=fight.battle_log.map((t,i)=>projectReplayTurn(t,data.parser,i+1));
      return {allProjected:projected.every(Boolean),html:view.solutionHtml(fight),seed:fight.seed};
    });
    assert(replay.allProjected);assert(!replay.html.includes('Replay events unavailable'));
    await page.locator('#filter-close-identifier').click();
    failCatalogue=true;
    await page.reload();
    await page.evaluate(()=>App.ready);
    assert.match(await page.evaluate(()=>App.views.filter.notice),/503/);
    assert.match(await page.evaluate(()=>App.views.filter.notice),/Refresh the page to retry/);
    assert.equal(await page.locator('input[type="file"], #filter-directory').count(),0);
    failCatalogue=false;
    await page.reload();
    await page.evaluate(()=>App.ready);
    assert.equal(await page.evaluate(()=>App.views.filter.dataset()),null);
    await page.getByRole('button',{name:/^Falkner /}).click();
    await page.screenshot({path:path.join(path.dirname(root),'identifier-web-desktop.png'),fullPage:true});
    await page.setViewportSize({width:640,height:800});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
    await page.screenshot({path:path.join(path.dirname(root),'identifier-web-narrow.png'),fullPage:true});
    const priorDataRequests=dataRequests();
    await page.goto(url+'/');await page.evaluate(()=>App.ready);
    assert.equal(await page.locator('[data-scenario]').count(),2,'root hosting works too');
    assert.equal(await page.locator('input[type="file"], #filter-directory').count(),0);
    assert.equal(dataRequests(),priorDataRequests);
    assert(network.every(u=>u.startsWith(url+'/')),'no third-party requests');
    assert.deepEqual(errors,[]);
    console.log(`PASS: ${catalogue.files.length} catalogue entries; automatic metadata-only startup; no import/reload controls; root/subdirectory hosting; lazy loads; cue filtering; structured replay; page-refresh recovery; 640px layout; no Tauri or third-party requests.`);
  } finally {await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
