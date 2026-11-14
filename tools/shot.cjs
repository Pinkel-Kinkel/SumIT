// Developer helper: screenshots of the demo UI (dark and light) into the folder given as the first argument.
const {chromium} = require('../build/test-tools/node_modules/playwright-core');
const {pathToFileURL} = require('url');
const path = require('path');
(async () => {
  const out = process.argv[2] || '.';
  const browser = await chromium.launch({channel:'msedge',headless:true});
  for (const theme of ['dark','light']) {
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    await page.goto(pathToFileURL(path.resolve(__dirname,'../src/web/ui.html')).href+'?demo=1');
    await page.waitForFunction(()=>typeof S!=='undefined' && S.courses && S.ai && S.ready.settings);
    await page.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);
    await page.waitForTimeout(800);
    await page.screenshot({path:path.join(out,'home-'+theme+'.png')});
    const card = page.locator('[data-course], .course-card').first();
    if (await card.count()) { await card.click(); await page.waitForTimeout(1200); await page.screenshot({path:path.join(out,'course-'+theme+'.png')}); }
    await page.close();
  }
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
