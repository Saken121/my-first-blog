/* Real file:// browser checks. Playwright/Chromium are developer tools only. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const target=process.env.FORMA_HTML||path.resolve(__dirname,'../downloads/Forma.html');
const fixture=fs.readFileSync(path.resolve(__dirname,'fixtures/sample.tcx'),'utf8');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'forma-browser-'));
const virtualURL='http://127.0.0.1:8766/';
let targetURL=pathToFileURL(target).href;
let context,passed=0;
async function check(label,fn){await fn();passed++;console.log('PASS: '+label);}
async function launch(){
 context=await chromium.launchPersistentContext(profile,{executablePath:process.env.FORMA_CHROMIUM||'/usr/bin/chromium',headless:true,viewport:{width:1440,height:1100},timezoneId:'Europe/Warsaw',args:['--no-sandbox','--disable-dev-shm-usage']});
 await context.addInitScript(()=>{
  const OriginalDate=Date,fixed=OriginalDate.UTC(2026,9,8,12);
  window.Date=class extends OriginalDate{
   constructor(...args){super(...(args.length?args:[fixed]));}
   static now(){return fixed;}
  };
 });
 await context.route('**/*',route=>route.request().url()===virtualURL?route.fulfill({contentType:'text/html',body:fs.readFileSync(target,'utf8')}):route.abort());
 await context.setOffline(true);return context.pages()[0]||await context.newPage();
}
(async()=>{
 let page=await launch(),errors=[],network=[];
 page.on('pageerror',error=>errors.push(error.message));
 const track=request=>{if(/^https?:/.test(request.url())&&request.url()!==virtualURL&&!request.url().endsWith('/favicon.ico'))network.push(request.url());};
 page.on('request',track);
 try{await page.goto(targetURL);}catch(error){
  if(!error.message.includes('ERR_BLOCKED_BY_ADMINISTRATOR'))throw error;
  console.log('NOTE: managed cloud Chromium blocks file:// navigation. Checking the identical HTML at an in-memory local origin, with networking disabled; no browser policy changes.');
  targetURL=virtualURL;await page.close();page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));page.on('request',track);
  await page.goto(targetURL);
 }
 await page.waitForFunction(()=>document.querySelectorAll('.day-cell').length>0);
 const api=async(url,body,method='POST')=>page.evaluate(async({url,body,method})=>{
  try{return {ok:true,value:await window.FormaLocal.request(url,{method,body:JSON.stringify(body)})};}catch(error){return {ok:false,error:error.message};}
 },{url,body,method});
 const state=async()=>page.evaluate(()=>window.FormaLocal.request('/api/state/?month=2026-10'));
 const base={date:'2026-10-10',slot:1,kind:'match_iii',status:'planned',duration_minutes:90,distance_km:0,rpe:4};
 await check('Self-contained HTML runs offline without external resources or installation',async()=>{
  assert.deepEqual(network,[]);assert.equal((await state()).profile.hr_lthr,177);assert.equal((await state()).profile.threshold_power,411);
 });
 await check('Create a match using the visible calendar form',async()=>{
  await page.locator('#add-button').click();const form=page.locator('#activity-form');
  await form.locator('[name=date]').fill(base.date);await form.locator('[name=kind]').selectOption('match_iii');await form.locator('[name=title]').fill('Mecz offline');await form.locator('[name=duration_minutes]').fill('90');
  await form.locator('[type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#activity-dialog').open);
  await page.waitForFunction(()=>document.querySelector('#calendar-grid').textContent.includes('Mecz offline'));
  assert.equal((await state()).activities[0].kind,'match_iii');
 });
 await check('Match microcycles and recovery across month boundaries',async()=>{
  assert.equal((await state()).microcycles['2026-10-09'].badge,'MD−1');
  assert.equal((await state()).microcycles['2026-10-11'].badge,'MD+1');
  assert.equal((await api('/api/activities/',{...base,date:'2026-11-01',kind:'match_assistant'})).ok,true);
  assert.equal((await state()).microcycles['2026-10-31'].badge,'MD−1');
 });
 await check('TCX import with heart-rate and running-power data, entirely offline',async()=>{
  await page.locator('#import-button').click();
  await page.locator('#import-form [name=file]').setInputFiles({name:'garmin-offline.tcx',mimeType:'application/xml',buffer:Buffer.from(fixture)});
  await page.locator('#import-form [name=date]').fill('2026-10-09');await page.locator('#import-form [type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#activity-dialog').open&&document.querySelector('#imported-detail').textContent.includes('Moc średnia 250 W'));
  await page.locator('#activity-form [name=rpe]').fill('6');await page.locator('#activity-form [type=submit]').click();
  await page.waitForFunction(()=>!document.querySelector('#activity-dialog').open);
  const imported=(await state()).activities.find(a=>a.source==='tcx');assert.deepEqual(imported.zones_seconds,[60,0,60,0,0]);assert.equal(imported.avg_hr,130);assert.equal(imported.unknown_hr_seconds,60);assert.equal(imported.avg_power,250);assert.equal(imported.max_power,450);
 });
 await check('Statistics exclude plans and calculate sRPE and weekly load',async()=>{
  const s=(await state()).summary;assert.equal(s.minutes,3);assert.equal(s.completed,1);assert.equal(s.load,18);assert.equal(s.weeks[0].date,'2026-10-05');assert.equal(s.weeks[0].load,18);
 });
 await check('Two daily slots and validation preserve existing records',async()=>{
  assert.equal((await api('/api/activities/',{...base,slot:2})).ok,true);
  assert.equal((await api('/api/activities/',{...base,slot:2})).ok,false);
  for(const overrides of [{date:'2026-02-30'},{slot:3},{kind:'__proto__'},{rpe:11},{distance_km:-1},{duration_minutes:0,status:'done'}])assert.equal((await api('/api/activities/',{...base,...overrides})).ok,false);
  assert.equal((await state()).activities.filter(a=>a.date===base.date).length,2);
 });
 await check('Edits, categories and notes retain TCX measurements',async()=>{
  const a=(await state()).activities.find(a=>a.source==='tcx');
  const values={...a,kind:'match_district',notes:'Moje notatki',rpe:7};
  assert.equal((await api(`/api/activities/${a.id}/`,values)).ok,true);
  assert.equal((await api(`/api/activities/${a.id}/`,{...values,duration_minutes:999})).ok,false);
  assert.equal((await state()).summary.load,21);
 });
 await check('XML entities, malformed files and multiple activities are rejected',async()=>{
  for(const xml of ['<!DOCTYPE root [<!ENTITY x "bad">]><TrainingCenterDatabase>&x;</TrainingCenterDatabase>','<root/>',fixture.replace('</Activities>','<Activity Sport="Running"/></Activities>')]){
   const result=await page.evaluate(async text=>{const f=new FormData();f.set('file',new File([text],'bad.tcx'));try{await FormaLocal.request('/api/import/',{method:'POST',body:f});return false;}catch{return true;}},xml);assert.equal(result,true);
  }
 });
 await check('Revised HR zones recalculate existing samples',async()=>{
  const p={...(await state()).profile,zone_limits:[110,170,180,190]};assert.equal((await api('/api/profile/',p)).ok,true);
  assert.deepEqual((await state()).summary.zones_seconds,[60,60,0,0,0]);
 });
 await check('Reload and close/reopen preserve activities and settings',async()=>{
  const before=await state();await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.day-cell').length>0);assert.deepEqual(await state(),before);
  await context.close();page=await launch();page.on('pageerror',e=>errors.push(e.message));page.on('request',track);await page.goto(targetURL);await page.waitForFunction(()=>document.querySelectorAll('.day-cell').length>0);assert.deepEqual(await state(),before);
 });
 let backup,backupFile;
 await check('Backup button downloads the complete portable JSON',async()=>{
  await page.locator('#backup-button').click();const event=page.waitForEvent('download');await page.locator('#download-backup').click();const downloaded=await event;
  backupFile=path.join(profile,'backup.json');await downloaded.saveAs(backupFile);backup=JSON.parse(fs.readFileSync(backupFile));assert.equal(backup.version,1);assert.equal(backup.activities.length,4);assert.deepEqual(backup.profile.zone_limits,[110,170,180,190]);await page.locator('#backup-dialog .close-button').click();
 });
 await check('JSON restore confirms replacement and restores the full calendar',async()=>{
  const first=(await state()).activities[0];assert.equal((await api(`/api/activities/${first.id}/`,null,'DELETE')).ok,true);
  await page.locator('#backup-button').click();page.once('dialog',d=>d.accept());await page.locator('#restore-backup').setInputFiles(backupFile);await page.waitForFunction(()=>!document.querySelector('#backup-dialog').open);
  assert.equal((await state()).activities.length,3);assert.equal((await state()).summary.load,21);
 });
 await check('Invalid backup is rejected without altering saved data',async()=>{
  const before=await state();await page.locator('#backup-button').click();
  const corrupt={...backup,activities:[...backup.activities,backup.activities[0]]};await page.locator('#restore-backup').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(corrupt))});
  await page.waitForFunction(()=>document.querySelector('#backup-dialog .form-error').textContent.length>0);assert.deepEqual(await state(),before);await page.locator('#backup-dialog .close-button').click();
 });
 await check('CSV works offline, includes zone data, and protects spreadsheet formulas',async()=>{
  assert.equal((await api('/api/activities/',{...base,date:'2026-10-08',title:'=FORMULA()',notes:'@formula',status:'done'})).ok,true);
  await page.evaluate(()=>document.querySelector('#today-button').click());await page.waitForFunction(()=>document.querySelector('#calendar-grid').textContent.includes('=FORMULA()'));
  const event=page.waitForEvent('download');await page.locator('#export-link').click();const downloaded=await event,csvFile=path.join(profile,'export.csv');await downloaded.saveAs(csvFile);
  const csv=fs.readFileSync(csvFile,'utf8');assert.ok(csv.includes("'=FORMULA()"));assert.ok(csv.includes("'@formula"));assert.ok(csv.includes('Z1 (min)'));assert.ok(csv.includes('Moje notatki'));
 });
 await check('Mobile layout and calendar form remain usable',async()=>{
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('#add-button').click();assert.equal(await page.locator('#activity-form [type=submit]').isVisible(),true);await page.locator('#activity-dialog .close-button').first().click();
 });
 await check('No JavaScript errors and no network dependency',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(network,[]);});
 console.log(`All ${passed} standalone browser checks passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(context)await context.close();fs.rmSync(profile,{recursive:true,force:true});});
