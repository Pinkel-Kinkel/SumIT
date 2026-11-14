const {chromium} = require('../build/test-tools/node_modules/playwright-core');
const {pathToFileURL} = require('url');
const path = require('path');
const assert = require('assert/strict');
(async () => {
 const browser = await chromium.launch({channel:'msedge',headless:true});
 const page = await browser.newPage({viewport:{width:1440,height:1100}});
 const errors=[]; page.on('pageerror',e=>errors.push(e.message + ' @ ' + String(e.stack).split(String.fromCharCode(10)).slice(1,3).join(' | ')));
 await page.goto(pathToFileURL(path.resolve(__dirname,'../src/web/ui.html')).href+'?demo=1');
 await page.waitForFunction(()=>typeof S!=='undefined' && S.courses && S.ai && S.ready.settings);
 await page.evaluate(()=>{
  window.sent=[]; host.postMessage=m=>window.sent.push(m);
  $('splash').remove(); $('wizard').hidden=true;
  S.course=S.courses[0]; $('courseName').textContent=S.course.name; $('courseBand').innerHTML=ART.band(S.course.id); S.local={dir:'test',lectures:[],setupDone:true}; S.sections=[]; S.notability={};
  show('course'); applySetupMode(); setTab('lessons'); renderLectures();
 });
 await page.locator('button[data-new]').click();
 assert.equal(await page.evaluate(()=>sent.at(-1).type),'saveLecture');
 assert.equal(await page.evaluate(()=>sent.at(-1).num),1);
 await page.evaluate(()=>onMessage({type:'courseLocal',course:S.course.name,local:{dir:'test',setupDone:true,lectures:[{num:1,title:'נגזרות ואינטגרלים',date:'2026-10-25',due:'',items:[],local:{exists:true,files:2,videos:0,dir:'test'}}]},notability:{}}));
 assert.equal(await page.locator('.lecture').count(),1);
 // Homework from Moodle: the bar above the site shows the course and the lecture's homework folder.
 await page.getByRole('button',{name:'שיעורי בית ופתרונות מה-Moodle',exact:true}).click();
 assert.equal(await page.evaluate(()=>sent.findLast(m=>m.type==='setDownloadTarget').folder),'הרצאות\\הרצאה 1\\תרגילים');
 assert.equal(await page.evaluate(()=>$('dlCourse').value===S.course.name && $('dlFolder').selectedOptions[0].textContent.includes('שיעורי בית')),true);
 assert.equal(await page.locator('#siteBackCourse').isVisible(),true);
 // The button always lands on the course page in Moodle (not on the page the student left the site on), and turns green once homework is there, with or without solutions.
 await page.waitForTimeout(450);
 assert.equal(await page.evaluate(()=>sent.some(m=>m.type==='siteNavigate'&&m.url.includes('/course/view.php'))),true);
 await page.evaluate(()=>{onMessage({type:'courseLocal',course:S.course.name,local:{dir:'test',setupDone:true,lectures:[{num:1,title:'x',date:'',due:'',items:[],local:{exists:true,files:2,dir:'test',materialFiles:[{name:'תרגילים\\\\דף תרגילים מס 5.pdf',path:'x'}]}}]},notability:{}});show('course');});
 assert.equal(await page.getByRole('button',{name:'שיעורי בית ופתרונות מה-Moodle',exact:true}).evaluate(e=>e.classList.contains('done')),true);
 await page.evaluate(()=>show('course'));
 // The recording is named after the lecture by default.
 await page.getByRole('button',{name:'הוסף הקלטה',exact:true}).first().click();
 assert.equal(await page.locator('.rec-row [data-name]').inputValue(),'הרצאה מספר 1');
 await page.locator('.rec-row [data-name]').fill('אינטגרלים חלק א');
 await page.locator('.rec-row input.ltr').fill('https://hit-ac-il.zoom.us/rec/play/test');
 await page.locator('.rec-row button.soft').click();
 assert.deepEqual(await page.evaluate(()=>({num:sent.at(-1).num,name:sent.at(-1).name})),{num:1,name:'אינטגרלים חלק א'});
 // A recording already on the PC can be added too, without a link.
 if (!(await page.locator('.rec-row').count())) await page.getByRole('button',{name:'הוסף הקלטה',exact:true}).first().click();
 await page.locator('.rec-row [data-pc]').click();
 assert.deepEqual(await page.evaluate(()=>({type:sent.at(-1).type,num:sent.at(-1).num})),{type:'addRecordingFile',num:1});
 // Slides from Moodle go to the lecture; the site bar has the big "save as PDF".
 await page.getByRole('button',{name:'מצגות וחומר מה-Moodle',exact:true}).click();
 assert.equal(await page.evaluate(()=>sent.findLast(m=>m.type==='setDownloadTarget').folder),'הרצאות\\הרצאה 1');
 assert.equal(await page.locator('#siteBarMain').isVisible(),true);
 assert.equal(await page.locator('#sitePrint').isVisible(),true);
 await page.locator('#sitePrint').click();
 assert.equal(await page.evaluate(()=>sent.at(-1).action),'savepdf');
 // A file being saved shows a percentage.
 await page.evaluate(()=>onMessage({type:'siteDownload',state:'progress',name:'a.pdf',pct:42,where:'קורס › הרצאה 1'}));
 assert.equal(await page.locator('#dlPct').textContent(),'42%');
 await page.evaluate(()=>onMessage({type:'siteDownload',state:'done',name:'a.pdf',where:'קורס › הרצאה 1',dir:'x',path:'x'}));
 assert.equal(await page.locator('#dlStrip').isVisible(),false);
 // Leaving the course and coming back keeps a summary's progress.
 await page.evaluate(()=>{ onMessage({type:'courseLocal',course:S.course.name,local:{dir:'test',setupDone:true,lectures:[{num:1,title:'x',date:'',due:'',items:[],running:true,progress:{pct:57,eta:120,text:'כותב'},local:{exists:true,files:2,dir:'test'}}]},notability:{}}); show('course'); });
 assert.equal(await page.locator('.sum-progress b').textContent(),'57%');
 assert.equal(await page.evaluate(()=>suggestedLectureDate(2,{first:'2026-10-25',holidays:['2026-11-01']})),'2026-11-08');
 // Two meetings a week (Sunday + Wednesday) from the timetable, with one day off.
 assert.deepEqual(await page.evaluate(()=>[1,2,3,4].map(n=>suggestedLectureDate(n,{first:'2026-10-25',holidays:['2026-10-28']},[0,3]))),['2026-10-25','2026-11-01','2026-11-04','2026-11-08']);
 await page.evaluate(()=>{
  show('course'); setTab('lessons'); setChatScope('lesson:1');
  addMsg('assistant',String.raw`בעברית: חשב $x^2+2x=3$ ואז English עם 123.\n\n$$\int_0^1 x^2\,dx=\frac{1}{3}$$\n\n<script>alert(1)</script>`);
 });
 assert.equal(await page.locator('.msg.assistant .katex').count(),2);
 assert.equal(await page.locator('.msg.assistant script').count(),0);
 assert.equal(await page.locator('.katex-error').count(),0);
 await page.screenshot({path:path.resolve(__dirname,'../build/lecture-ui.png'),fullPage:true,animations:'disabled'});
 await page.evaluate(()=>{
  S.timetable={classes:[{day:'ראשון',start:'09:00',end:'11:00',course:'אלגברה'},{day:'רביעי',start:'14:00',end:'16:00',course:'פיזיקה'}],exams:Array.from({length:8},(_,i)=>({course:'מבחן '+i,date:'2099-01-'+String(i+1).padStart(2,'0')}))};
  show('home');renderTimetable();
  S.update={version:'99.0',canAuto:true};renderBanners();
 });
 assert.equal(await page.locator('.week-table tbody tr').count(),2);
 assert.equal(await page.locator('#examBoard .deadline').count(),8);
 await page.getByRole('button',{name:'לא עכשיו',exact:true}).click();
 assert.equal(await page.evaluate(()=>sent.some(m=>m.type==='installUpdate')),false);
 await page.evaluate(()=>{S.dismissedUpdate=null;renderBanners();});
 await page.getByRole('button',{name:'הורד והתקן בסגירה',exact:true}).click();
 assert.equal(await page.evaluate(()=>sent.at(-1).type),'installUpdate');
 // The student's own name and bio replace "SumIT" at the top; ChatGPT and Gemini connect with a key.
 await page.evaluate(()=>onMessage(Object.assign({},S.settings,{type:'settings',displayName:'נועה לוי',bio:'סטודנטית להנדסת חשמל',hasGeminiKey:true,hasOpenAiKey:false,helperPref:'auto',profileImage:''})));
 assert.equal(await page.locator('#brandName').textContent(),'נועה לוי');
 assert.equal(await page.locator('#brandSub').textContent(),'סטודנטית להנדסת חשמל');
 await page.evaluate(()=>show('settings'));
 // Gemini is signed in with the Google account; ChatGPT offers the account sign-in first, the key only as small print.
 await page.evaluate(()=>{S.ai=Object.assign({},S.ai,{helpers:{gemini:'account',openai:'',order:['gemini']}});renderProviders();});
 assert.equal(await page.locator('#providers .provider[data-kind=gemini] [data-logout]').isVisible(),true);
 assert.equal(await page.locator('#providers .provider[data-kind=gemini] [data-key]').count(),0);
 assert.equal(await page.locator('#providers .provider[data-kind=openai] input[data-key]').isVisible(),false);
 // Gemini signs in through Google's page and a pasted code, all inside the card.
 await page.evaluate(()=>{S.ai=Object.assign({},S.ai,{helpers:{gemini:'',openai:'',order:[]}});renderProviders();});
 await page.locator('#providers .provider[data-kind=gemini] [data-login]').click();
 assert.deepEqual(await page.evaluate(()=>{const m=sent.at(-1);return [m.type,m.kind];}),['connectBrain','gemini']);
 await page.evaluate(()=>onMessage({type:'authCode',kind:'gemini',state:'wait',url:'https://accounts.google.com/x'}));
 assert.equal(await page.locator('#providers .provider[data-kind=gemini] .auth-code').isVisible(),true);
 await page.locator('#providers .provider[data-kind=gemini] [data-cancel-login]').click();
 assert.equal(await page.evaluate(()=>sent.at(-1).type),'cancelGeminiLogin');
 await page.evaluate(()=>onMessage({type:'authCode',kind:'gemini',state:'done'}));
 assert.equal(await page.locator('#providers .provider[data-kind=gemini] .auth-code').count(),0);
 await page.evaluate(()=>{S.ai=Object.assign({},S.ai,{helpers:{gemini:'account',openai:'',order:['gemini']}});renderProviders();});
 await page.locator('#providers .provider[data-kind=openai] [data-login]').click();
 assert.deepEqual(await page.evaluate(()=>{const m=sent.at(-1);return [m.type,m.kind];}),['connectBrain','chatgpt']);
 await page.evaluate(()=>{S.ai=Object.assign({},S.ai,{setup:'login-chatgpt'});renderProviders();});
 assert.equal((await page.locator('#providers .provider[data-kind=openai] .state').textContent()).includes('ChatGPT'),true);
 await page.evaluate(()=>{S.ai=Object.assign({},S.ai,{setup:''});renderProviders();});
 await page.locator('#providers .provider[data-kind=openai] summary').click();
 assert.equal(await page.locator('#providers .provider[data-kind=openai] input[data-key]').isVisible(),true);
 await page.locator('#providers .provider[data-kind=openai] input[data-key]').fill('sk-'+'x'.repeat(30));
 await page.locator('#providers .provider[data-kind=openai] [data-save]').click();
 assert.deepEqual(await page.evaluate(()=>{const m=sent.at(-1);return [m.type,m.provider];}),['setHelperKey','openai']);
 await page.locator('#helperPref').selectOption('claude');
 assert.deepEqual(await page.evaluate(()=>{const m=sent.at(-1);return [m.name,m.value];}),['helperPref','claude']);
 // The background picker opens fully inside the window (it used to be cut off by the course banner).
 await page.evaluate(()=>{show('course');});
 await page.locator('#changeBg').click();
 const popRect=await page.evaluate(()=>{const r=document.querySelector('.bg-pop').getBoundingClientRect();return [Math.round(r.top),Math.round(r.bottom),Math.round(r.left),Math.round(r.right),innerHeight,innerWidth];});
 assert.ok(popRect[1]<=popRect[4]&&popRect[0]>=0&&popRect[1]-popRect[0]>120&&popRect[3]<=popRect[5],'popover rect '+popRect.join(','));
 // Exams and the syllabus come from Moodle with one click.
 await page.evaluate(()=>{document.body.click();S.local={dir:'t',lectures:[],exams:0};S.sections=[];renderLectures();});
 await page.getByRole('button',{name:'הורד את כל המבחנים (Moodle ו-CS24)',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>{const m=sent.at(-1);return [m.type,m.what];}),['downloadMoodle','exams']);
 await page.evaluate(()=>{S.local={dir:'t',lectures:[]};setTab('info');});
 await page.getByRole('button',{name:'לחץ כאן כדי לסנכרן את הסילבוס',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>{const m=sent.at(-1);return [m.type,m.what];}),['downloadMoodle','syllabus']);
 assert.equal(await page.getByText('הסיכום המלא').count(),0);
 // The profile (name, description, picture) is edited with the pen on the picture, not in the settings.
 assert.equal(await page.locator('#view-settings #profName').count(),0);
 assert.equal(await page.locator('#view-settings #recDir').count(),0);
 await page.locator('#editProfile').click();
 assert.equal(await page.locator('#profileDlg').isVisible(),true);
 await page.locator('#profName').fill('דנה');
 await page.locator('#saveProfile').click();
 assert.deepEqual(await page.evaluate(()=>{const m=sent.at(-1);return [m.type,m.name];}),['setProfile','דנה']);
 assert.equal(await page.locator('#profileDlg').isVisible(),false);
 assert.equal(await page.locator('#view-home').evaluate(()=>true),true); // Gone: the library course, NotebookLM, "analyze what exists", CS24 exams on the home page, "summary ready" tile.
 assert.equal(await page.getByText('נתח את מה שכבר יש').count(),0);
 assert.equal(await page.locator('[data-site-link=notebooklm],[data-site=notebooklm]').count(),0);
 await page.evaluate(()=>{onMessage({type:'courses',data:[{id:1,name:'ספרייה',current:false},{id:2,name:'אלגברה',current:true}]});show('home');});
 assert.equal(await page.evaluate(()=>S.courses.map(c=>c.name).join()),'אלגברה');
 assert.equal(await page.locator('#view-home').getByText('מבחנים ב-CS24').count(),0);
 assert.equal(await page.locator('#stats').getByText('סיכום מוכן').count(),0);
 // The weekly timetable comes first, the exams are a card of their own below it.
 assert.equal(await page.evaluate(()=>document.getElementById('timetable').getBoundingClientRect().top<document.getElementById('examBoard').getBoundingClientRect().top),true);
 // My tasks: added on the home page, shown on the tasks page, checked off, kept through the app's settings.
 await page.locator('.nav-item[data-view=tasks]').click();
 await page.locator('#tasksPage [data-t-title]').fill('להגיש תרגיל 3');
 await page.locator('#tasksPage [data-t-due]').fill('2099-01-05');
 await page.locator('#tasksPage button[type=submit]').click();
 assert.deepEqual(await page.evaluate(()=>{const m=sent.at(-1);return [m.type,m.tasks.length,m.tasks[0].title,m.tasks[0].due];}),['saveTasks',1,'להגיש תרגיל 3','2099-01-05']);
 assert.equal(await page.locator('#tasksPage .task').count(),1);
 assert.equal(await page.locator('#view-home #homeTasks').count(),0);
 await page.locator('#tasksPage .task-check').click();
 assert.equal(await page.evaluate(()=>S.tasks[0].done),true);
 // First run: the OneDrive of HIT is recommended as the place for the files (or a warning, if it is not on this PC).
 await page.evaluate(()=>{onMessage(Object.assign({},S.settings,{type:'settings',onboarded:true,hitOneDrive:'C:\\\\Users\\\\x\\\\OneDrive - Holon Institute of Technology',studyInHitOneDrive:false}));openWizard(4);});
 await page.locator('#wizOneDrive [data-od]').click();
 assert.equal(await page.evaluate(()=>sent.at(-1).type),'useHitOneDrive');
 await page.evaluate(()=>{onMessage(Object.assign({},S.settings,{type:'settings',onboarded:true,hitOneDrive:'',studyInHitOneDrive:false}));});
 assert.equal((await page.locator('#wizOneDrive').textContent()).includes('לא מצאתי OneDrive של HIT'),true);
 await page.evaluate(()=>{$('wizard').hidden=true;}); // The timetable: update reads the saved portal pages, delete asks first, the portal shows how to download them (no "read the page" button).
 page.on('dialog',d=>d.accept());
 await page.evaluate(()=>show('home'));
 await page.locator('#ttImport').click();
 assert.deepEqual(await page.evaluate(()=>{const m=sent.at(-1);return [m.type,m.fromFolder];}),['importTimetable',true]);
 await page.locator('#ttDelete').click();
 assert.equal(await page.evaluate(()=>sent.at(-1).type),'deleteTimetable');
 assert.equal(await page.locator('#siteCalendar').count(),0);
 await page.evaluate(()=>onMessage({type:'siteNav',url:'https://webrashim.hit.ac.il/Portals/student/schedule',canBack:false,canForward:false}));
 await page.evaluate(()=>{show('sites');});
 assert.equal(await page.locator('#portalHint').isVisible(),true);
 assert.equal((await page.locator('#portalHint').textContent()).includes('מבנה יומן'),true);
 await page.locator('#portalUpdate').click();
 assert.deepEqual(await page.evaluate(()=>{const m=sent.at(-1);return [m.type,m.fromFolder];}),['importTimetable',true]);
 await page.evaluate(()=>onMessage({type:'siteNav',url:'https://md.hit.ac.il/',canBack:false,canForward:false}));
 assert.equal(await page.locator('#portalHint').isVisible(),false);
 await page.evaluate(()=>{show('home');});
 // A connected helper shows a small test button that reports how long the answer took.
 await page.evaluate(()=>{S.ai=Object.assign({},S.ai,{helpers:{gemini:'account',openai:'',order:['gemini']}});show('settings');renderProviders();});
 assert.equal(await page.locator('#aiTeam').count(),0);
 await page.locator('#providers .provider[data-kind=gemini] [data-test]').click();
 assert.deepEqual(await page.evaluate(()=>{const m=sent.at(-1);return [m.type,m.kind];}),['testBrain','gemini']);
 await page.evaluate(()=>onMessage({type:'brainTest',kind:'gemini',ok:true,ms:2500,text:'ok'}));
 assert.equal((await page.locator('#providers .provider[data-kind=gemini] .test-line.ok').textContent()).includes('2.5'),true);
 // With another AI connected: a "check with another AI" button under the last chat answer and on a ready summary.
 await page.evaluate(()=>{show('course');setTab('lessons');setChatScope('lesson:1');S.chatBusy=false;addMsg('assistant','תשובה לבדיקה');addCheckButton();});
 await page.getByRole('button',{name:'בדוק עם AI נוסף',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>{const m=sent.at(-1);return [m.type,m.scope];}),['chatCheck','lesson:1']);
 await page.evaluate(()=>{onMessage({type:'chatDone',course:S.course.name,scope:'lesson:1'});S.local={dir:'t',lectures:[]};onMessage({type:'courseLocal',course:S.course.name,local:{dir:'test',setupDone:true,lectures:[{num:1,title:'x',date:'',due:'',items:[],local:{exists:true,files:2,studyPage:'a.html',lecturePdf:'a.pdf',dir:'test'}}]},notability:{}});show('course');setTab('lessons');});
 await page.evaluate(()=>{S.ai=Object.assign({},S.ai,{helpers:{gemini:'',openai:'',order:[]}});renderLectures();});
 assert.equal(await page.getByRole('button',{name:'בדיקה שנייה עם AI נוסף',exact:true}).count(),0); // The lecture row stays lean: no second opinion, PDF, question or date buttons.
 await page.screenshot({path:path.resolve(__dirname,'../build/timetable-ui.png'),fullPage:true,animations:'disabled'});
 // A finished summary is not opened in a browser: the app offers it, and the interactive version opens inside the app, with a PDF button.
 await page.evaluate(()=>onMessage({type:'summaryReady',course:S.course?S.course.name:'x',num:1,page:'C:\\x\\s.html',pdf:'C:\\x\\s.pdf'}));
 assert.equal((await page.locator('body').innerText()).includes('פתח את הסיכום'),true);
 assert.equal((await page.locator('#viewerPdf').textContent()).includes('פתח כ-PDF'),true); // Outlook and OneDrive of HIT are in the side menu and in the site tabs.
 assert.equal(await page.locator('.nav-item[data-site-link=outlook]').count()+await page.locator('.nav-item[data-site-link=onedrive]').count()+await page.locator('#siteTabs [data-site=outlook]').count()+await page.locator('#siteTabs [data-site=onedrive]').count(),4);
 // The first-run guide has the gauntlet, and the stones light as things get connected.
 await page.evaluate(()=>{localStorage.removeItem('sumit.snap');S.settings=Object.assign({},S.settings,{snapSeen:false});openWizard(1);});
 assert.equal(await page.locator('#wizGauntlet .float-stone').count(),6);
 await page.evaluate(()=>{$('wizard').hidden=true;});
 // Infinity stones: with only some connected the gauntlet is not ready; with all five the stones dock, the gauntlet can be clicked and snaps.
 await page.evaluate(()=>{S.moodle='ready';S.ai=Object.assign({},S.ai,{claude:{loggedIn:true},helpers:{gemini:'account',openai:'',order:['gemini']}});S.settings=Object.assign({},S.settings,{snapSeen:false});S.timetable={classes:[{day:'ראשון',start:'09:00',end:'11:00',course:'x'}],exams:[]};localStorage.removeItem('sumit.snap');show('settings');});
 await page.waitForSelector('#stoneField .gf-gauntlet');
 assert.equal(await page.locator('#stoneField .float-stone:not(.off)').count(),5);
 assert.equal(await page.locator('#stoneField .gf-gauntlet.ready').count(),0);
 await page.locator('#stoneField .float-stone').nth(3).hover({force:true});
 assert.equal((await page.locator('#stoneField .stone-tip').innerText()).includes('Power Stone')&&(await page.locator('#stoneField .stone-tip').innerText()).includes('CS24'),true);
 // The Mind Stone (Claude) is the big one in the palm.
 assert.equal(await page.locator('#stoneField .float-stone.big').count(),1);
 await page.evaluate(()=>{S.ai=Object.assign({},S.ai,{helpers:{gemini:'account',openai:'account',order:['gemini','openai']}});renderStoneField();});
 assert.equal(await page.locator('#stoneField .float-stone:not(.off)').count(),6);
 assert.equal(await page.locator('#stoneField .gf-gauntlet.ready').count(),1);
 await page.locator('#stoneField .gf-gauntlet').click();
 await page.waitForFunction(()=>document.body.classList.contains('snapped'),null,{timeout:8000});
 assert.equal(await page.evaluate(()=>sent.some(m=>m.type==='snapDone')),true);
 assert.equal(await page.locator('#stoneField').count(),0);
 assert.equal(await page.evaluate(()=>document.querySelectorAll('.dusted').length>3),true);
 assert.deepEqual(errors,[]);
 console.log('PASS: lecture creation, homework import, recording name/scope, browser target, holidays, RTL math, XSS escaping, full timetable, all exams, optional updates; no browser errors.');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
