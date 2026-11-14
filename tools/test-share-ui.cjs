const {chromium} = require('../build/test-tools/node_modules/playwright-core');
const {pathToFileURL} = require('url');
const path = require('path');
const assert = require('assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:950}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(__dirname,'../src/web/ui.html')).href+'?demo=1');
  await page.waitForFunction(()=>typeof S!=='undefined' && S.courses && S.ready.settings);
  await page.evaluate(()=>{window.sent=[];host.postMessage=m=>sent.push(m);$('splash').remove();$('wizard').hidden=true;S.course=S.courses[0];openViewer('C:\\course\\summary.html','הרצאה 1 · סיכום','C:\\course\\summary.pdf',1);});
  await page.getByRole('button',{name:'שיתוף',exact:true}).click();await page.locator('#viewerShareZip').click();
  const message=await page.evaluate(()=>sent.findLast(m=>m.type==='shareSummary'));
  assert.equal(message.path,'C:\\course\\summary.html');assert.equal(message.pdf,'C:\\course\\summary.pdf');assert.ok(message.course);
  assert.equal(await page.locator('#viewerShare').isDisabled(),true);
  assert.ok((await page.locator('#viewerShareNote').innerText()).includes('WhatsApp'));
  assert.ok((await page.locator('#viewerShareNote').innerText()).includes('OneDrive'));
  assert.equal(await page.locator('#viewerShareNote button').count(),1);
  await page.evaluate(m=>onMessage({type:'summaryShareResult',requestId:m.requestId,status:'cancelled',text:'השמירה בוטלה'}),message);
  assert.equal(await page.locator('#viewerShare').isEnabled(),true);
  await page.getByRole('button',{name:'שיתוף',exact:true}).click();await page.locator('#viewerShareZip').click();
  const retry=await page.evaluate(()=>sent.findLast(m=>m.type==='shareSummary'));
  await page.evaluate(m=>onMessage({type:'summaryShareResult',requestId:m.requestId,status:'error',text:'לא הצלחתי לשמור'}),retry);
  assert.equal(await page.locator('#viewerShareNote.error').count(),1);
  await page.getByRole('button',{name:'שיתוף',exact:true}).click();await page.locator('#viewerShareZip').click();
  const success=await page.evaluate(()=>sent.findLast(m=>m.type==='shareSummary'));
  await page.evaluate(m=>onMessage({type:'summaryShareResult',requestId:m.requestId,status:'saved',text:'קובץ ה-ZIP נשמר: C:\\Downloads\\סיכום.zip'}),success);
  assert.equal(await page.locator('#viewerShareNote.error').count(),0);

  assert.deepEqual(errors,[]);
  console.log('PASS summary toolbar share button, host message, no browser errors');
  await page.locator('#viewerShareDismiss').click();
  assert.equal(await page.locator('#viewerShareNote').isVisible(),false);
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
