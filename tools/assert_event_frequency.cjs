const assert = require('node:assert/strict');
module.exports = async function assertEventFrequency(page) {
  await page.evaluate(() => {
    const view = App.views.filter;
    view.clearDataset();
    const fights = Array.from({length:13},(_,i)=>({
      seed:String(i),status:'WIN',normal_policy_actions:['Ember','Ember','Ember'],
      visible_turns:[
        {player:[i<8?'item Super Potion Quilava':'Ember'],npc:[i<6?'Leer':'Tackle'],player_end_hp:i%4?31:17},
        {player:['Ember'],npc:[i<6?'Leer':i<12?'Tackle':'Growl'],player_end_hp:17},
        {player:['Ember'],npc:['Tackle'],player_end_hp:17}
      ],battle_log:[]
    }));
    view.loadedDataset={name:'frequency.json',label:'Frequency',fights,parser:{},maxTurns:3,wins:13};
    view.filters=[{},{},{}]; view.identificationOpen=true; view.render();
  });
  const labels = type=>page.locator(`[data-cue-type="${type}"]:not([disabled])`).allTextContents();
  assert.deepEqual(await labels('player'),['Super Potion Quilava','Ember'],'most frequent player event first; no item prefix');
  assert.deepEqual(await labels('npc'),['Tackle','Leer'],'7 Tackle before 6 Leer');
  assert.deepEqual(await labels('hp'),['17 HP','31 HP'],'HP retains numeric ordering');
  await page.getByRole('button',{name:'Super Potion Quilava',exact:true}).click();
  assert.deepEqual(await labels('npc'),['Leer','Tackle'],'conditional counts change to 6 Leer vs 2 Tackle');
  assert.deepEqual(await labels('player'),['Super Potion Quilava','Ember'],'own choice does not zero alternative frequencies');
  await page.getByRole('button',{name:'Clear this turn',exact:true}).click();
  assert.deepEqual(await labels('npc'),['Tackle','Leer']);
  await page.locator('#filter-next').click();
  assert.deepEqual(await labels('npc'),['Leer','Tackle','Growl'],'alphabetical tie-break, less frequent Growl last');
  assert(!await page.locator('#filter-identifier-modal').innerText().then(text=>text.includes('item Super Potion')));
};
