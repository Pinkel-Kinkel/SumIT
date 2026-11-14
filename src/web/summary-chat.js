// Each summary owns its conversation and up to six removable image attachments.
const summaryThreads=new Map();let summaryChatJob=null;
function summaryThread(){if(!S.viewer)return null;const key=S.viewer.path;if(!summaryThreads.has(key))summaryThreads.set(key,{messages:[],attachments:[],draft:''});return summaryThreads.get(key);}
const SUMMARY_SUGGESTIONS=[['הסבר לי את הנקודה המרכזית בסיכום במילים פשוטות','הסבר פשוט'],['עזור לי להתחיל את שאלה 1, רמזים בלבד','רמזים בלבד'],['תן לי תרגיל דומה כדי לתרגל','תרגיל דומה']];
// Models the student can pick. The recommendation depends on the course: math and physics go to the strongest reasoning model.
const CHAT_MODELS=[
 {id:'claude:opus',p:'claude',label:'Claude Opus',note:'הכי חזק בהוכחות, חישובים והסברים מתמטיים'},
 {id:'claude:sonnet',p:'claude',label:'Claude Sonnet',note:'מהיר ומדויק, טוב לרוב השאלות'},
 {id:'claude:haiku',p:'claude',label:'Claude Haiku',note:'הכי מהיר, לשאלות קצרות'},
 {id:'gemini:gemini-4-hydrogen-high',p:'gemini',label:'Gemini 4 Hydrogen',note:'חשיבה מעמיקה, טוב בחישוב'},
 {id:'gemini:gemini-3.8-flash-medium',p:'gemini',label:'Gemini 3.8 Flash',note:'מהיר'},
 {id:'openai:',p:'openai',label:'ChatGPT',note:'המודל של המנוי שלך'}];
const PROVIDER_NAME={claude:'Claude',gemini:'Gemini',openai:'ChatGPT'};
function mathCourse(){return /חשבון|אינפי|משוואות|דיפרנציאל|פיסיקה|פיזיקה|אלגברה|לינארית|הסתברות|סטטיסטיקה|מתמטיקה|מכניקה|אותות|calculus|physics|algebra|math/i.test(S.course?.name||'');}
function modelReady(p){const a=S.ai||{};return p==='claude'?!!a.claude?.loggedIn:!!(a.helpers&&a.helpers[p]==='account');}
function recommendedModel(){const order=mathCourse()?['claude:opus','gemini:gemini-4-hydrogen-high','openai:','claude:sonnet']:['claude:sonnet','gemini:gemini-3.8-flash-medium','openai:','claude:opus'];return order.find(id=>modelReady(CHAT_MODELS.find(m=>m.id===id).p))||order[0];}
function chatModel(){let id='';try{id=localStorage.getItem('sumit-chat-model')||'';}catch{}const m=CHAT_MODELS.find(x=>x.id===id);return m&&modelReady(m.p)?m.id:recommendedModel();}
function renderChatModel(){const m=CHAT_MODELS.find(x=>x.id===chatModel());$('scModelLabel').textContent=m.label;$('scModel').dataset.p=m.p;}
function renderModelMenu(){const cur=chatModel(),rec=recommendedModel(),menu=$('scModelMenu');
 menu.innerHTML='<div class="sc-menu-head">'+(mathCourse()?'קורס מתמטי: מומלץ מודל חזק בחשיבה':'בחר את המודל שיענה לך')+'</div>'+['claude','gemini','openai'].map(p=>'<div class="sc-menu-group"><small>'+PROVIDER_NAME[p]+(modelReady(p)?'':' · לא מחובר')+'</small>'+CHAT_MODELS.filter(m=>m.p===p).map(m=>'<button type="button" role="option" class="sc-opt" data-id="'+m.id+'" data-p="'+p+'" aria-selected="'+(m.id===cur)+'"'+(modelReady(p)?'':' disabled')+'><i class="sc-model-dot"></i><span><b>'+esc(m.label)+'</b>'+(m.id===rec?'<em>מומלץ</em>':'')+'<small>'+esc(m.note)+'</small></span>'+(m.id===cur?'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>':'')+'</button>').join('')+'</div>').join('');
 menu.querySelectorAll('.sc-opt').forEach(b=>b.onclick=()=>{try{localStorage.setItem('sumit-chat-model',b.dataset.id);}catch{}toggleModelMenu(false);renderChatModel();});}
function toggleModelMenu(open){const menu=$('scModelMenu');if(open==null)open=menu.hidden;if(open)renderModelMenu();menu.hidden=!open;$('scModel').setAttribute('aria-expanded',String(open));}
$('scModel').onclick=e=>{e.stopPropagation();toggleModelMenu();};
document.addEventListener('click',e=>{if(!$('scModelMenu').hidden&&!e.target.closest('#scModelMenu'))toggleModelMenu(false);});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('scModelMenu').hidden)toggleModelMenu(false);});
function setSummaryChatOpen(open){if(open&&$('flashcards'))$('flashcards').hidden=true;$('summaryChat').hidden=!open;$('viewerChat').classList.toggle('on',open);$('viewerChat').setAttribute('aria-pressed',String(open));requestAnimationFrame(()=>placeSite(false));}
function openSummaryChat(){if(!S.viewer)return;setSummaryChatOpen(true);renderChatModel();renderSummaryChat();$('summaryChatText').focus();}
function closeSummaryChat(){setSummaryChatOpen(false);}
function growSummaryInput(){const t=$('summaryChatText');t.style.height='auto';t.style.height=Math.min(t.scrollHeight,180)+'px';}
// A formula typed inside a Hebrew question ("z = arctan(y/x)") keeps its left-to-right order.
function ltrRuns(t){return t.replace(/[A-Za-z0-9(][A-Za-z0-9 ()\/=+\-*^.,']*[A-Za-z0-9)]/g,r=>/[=()\/+\-*^]/.test(r)?'<bdi dir="ltr">'+r+'</bdi>':r);}
function summaryMessageHtml(m){
 if(m.role==='user')return '<div class="sc-row user">'+((m.images&&m.images.length)?'<div class="sc-thumbs">'+m.images.map(i=>'<img src="'+i+'" alt="תמונה שצורפה">').join('')+'</div>':'')+'<div class="sc-bubble">'+ltrRuns(esc(m.text)).replace(/\n/g,'<br>')+'</div></div>';
 if(m.role==='error')return '<div class="sc-row error"><div class="sc-error">'+esc(m.text)+'</div></div>';
 return '<div class="sc-row assistant"><div class="sc-who-row"><i class="sc-avatar" aria-hidden="true"></i><small class="sc-who">'+esc(m.model||PROVIDER_NAME[m.provider]||m.provider||'SumIT')+'</small></div><div class="sc-answer" dir="rtl">'+md(m.text)+'</div></div>';
}
function renderSummaryChat(){const t=summaryThread();if(!t)return;
 const busy=summaryChatJob?.path===S.viewer.path,box=$('summaryChatMessages');
 if(!t.messages.length&&!busy){
  box.innerHTML='<div class="sc-empty"><div class="sc-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M19 15l.8 1.9 1.9.8-1.9.8L19 20.4l-.8-1.9-1.9-.8 1.9-.8z"/></svg></div><h3>מה תרצה להבין?</h3><p>הסיכום כולו כבר בהקשר. אפשר לצרף תמונה או לסמן אזור בסיכום.</p><div class="sc-suggest">'+SUMMARY_SUGGESTIONS.map(x=>'<button type="button" class="sc-chip" data-q="'+esc(x[0])+'"><b>'+esc(x[1])+'</b><span>'+esc(x[0])+'</span></button>').join('')+'</div></div>';
  box.querySelectorAll('.sc-chip').forEach(b=>b.onclick=()=>{$('summaryChatText').value=b.dataset.q;t.draft=b.dataset.q;growSummaryInput();$('summaryChatText').focus();});
 }else box.innerHTML=t.messages.map(summaryMessageHtml).join('')+(busy?'<div class="sc-row assistant"><div class="sc-typing" role="status" aria-label="מכין תשובה"><i></i><i></i><i></i></div></div>':'');
 $('summaryChatText').value=t.draft;growSummaryInput();$('summaryChatSelection').hidden=!t.attachments.length;
 $('summaryChatAttachments').innerHTML=t.attachments.map((a,i)=>'<div class="chat-attachment"><img src="'+a.image+'" alt="תמונה '+(i+1)+'"><button type="button" class="sc-x" data-remove="'+a.id+'" aria-label="הסר תמונה '+(i+1)+'">×</button></div>').join('');
 $('summaryChatAttachments').querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{t.attachments=t.attachments.filter(a=>a.id!==b.dataset.remove);renderSummaryChat();});
 $('summaryChatSend').disabled=!!summaryChatJob;
 $('summaryChatStatus').textContent=summaryChatJob&&!busy?'ממתין לתשובה בסיכום אחר':'';
 box.scrollTop=box.scrollHeight;
}
async function addChatImage(blob,text='',thread=summaryThread()){
 if(!thread)return;if(thread.attachments.length>=6){toast('אפשר לצרף עד 6 תמונות. הסר תמונה כדי להוסיף אחרת.');return;}
 if(blob.size>20*1024*1024){toast('התמונה גדולה מדי (עד 20MB לפני הקטנה).');return;}
 const url=URL.createObjectURL(blob);try{const img=new Image();img.src=url;await img.decode();const scale=Math.min(1,1600/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);const image=canvas.toDataURL('image/png');if(image.length>2800000)throw new Error('התמונה כבדה מדי. נסה לחתוך לאזור הרלוונטי.');if(thread.attachments.length>=6)return;thread.attachments.push({id:crypto.randomUUID(),image,text});if(summaryThread()===thread)renderSummaryChat();}catch(e){toast(e.message||'לא ניתן לקרוא את התמונה');}finally{URL.revokeObjectURL(url);}
}
$('viewerChat').onclick=()=>{if(!$('summaryChat').hidden)closeSummaryChat();else openSummaryChat();};
$('summaryChatNew').onclick=()=>{const t=summaryThread();if(!t||summaryChatJob?.path===S.viewer.path)return;t.messages=[];t.attachments=[];t.draft='';send({type:'summaryChatReset',course:S.course?S.course.name:'',path:S.viewer.path});renderSummaryChat();$('summaryChatText').focus();};
$('summaryLearningReset').onclick=()=>{if(S.viewer&&S.course)send({type:'resetLearningNeeds',course:S.course.name,path:S.viewer.path});};
$('viewerSelect').onclick=()=>{if(S.viewer&&S.course)send({type:'selectSummary',course:S.course.name,path:S.viewer.path});};
$('summaryChatClose').onclick=closeSummaryChat;
$('summaryChatClearSelection').onclick=()=>{const t=summaryThread();if(t){t.attachments=[];renderSummaryChat();}};
$('summaryChatAttach').onclick=()=>$('summaryChatFiles').click();
$('summaryChatFiles').onchange=async e=>{const t=summaryThread();for(const f of e.target.files)await addChatImage(f,'',t);e.target.value='';};
$('summaryChat').addEventListener('paste',async e=>{const files=[...e.clipboardData.items].filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile());if(!files.length)return;e.preventDefault();const t=summaryThread();for(const f of files)await addChatImage(f,'',t);});
$('summaryChatText').oninput=()=>{const t=summaryThread();if(t)t.draft=$('summaryChatText').value;growSummaryInput();};
$('summaryChatSend').onclick=()=>{const t=summaryThread(),text=$('summaryChatText').value.trim();if(!t||!text||summaryChatJob)return;
 const requestId='summary-chat-'+Date.now(),sent=t.attachments,images=sent.map(a=>a.image),notes=sent.map((a,i)=>'תמונה '+(i+1)+': '+a.text).join('\n');
 // The question goes with its own pictures; the next question starts clean.
 summaryChatJob={requestId,path:S.viewer.path,text,attachments:sent};t.messages.push({role:'user',text,images});t.draft='';t.attachments=[];
 const model=chatModel();summaryChatJob.model=CHAT_MODELS.find(x=>x.id===model).label;send({type:'summaryChat',requestId,course:S.course.name,path:S.viewer.path,text,images,imageNotes:notes,model});renderSummaryChat();};
$('summaryChatText').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('summaryChatSend').click();}};
function summaryImageBlob(data){return new Blob([Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0))],{type:'image/png'});}
async function summaryChatEvent(m){if(m.type==='summarySelectionReady'){if(S.viewer?.path!==m.path||S.view!=='sites')return;const t=summaryThread();openSummaryChat();await addChatImage(summaryImageBlob(m.image),m.text,t);return;}if(m.type!=='summaryChatResult'||m.requestId!==summaryChatJob?.requestId||m.path!==summaryChatJob.path)return;const t=summaryThreads.get(m.path);if(t){if(m.error){const last=t.messages[t.messages.length-1];if(last&&last.role==='user')t.messages.pop();t.messages.push({role:'error',text:m.text});t.draft=summaryChatJob.text;t.attachments=summaryChatJob.attachments||[];}else t.messages.push({role:'assistant',text:m.text,provider:m.provider,model:summaryChatJob.model&&CHAT_MODELS.find(x=>x.label===summaryChatJob.model)?.p===m.provider?summaryChatJob.model:''});}summaryChatJob=null;if(S.viewer)renderSummaryChat();}
let summaryChatWidth=400;
function setSummaryChatWidth(value){summaryChatWidth=Math.max(320,Math.min(800,Number(value)||400));$('summaryWorkspace').style.setProperty('--summary-chat-width',summaryChatWidth+'px');$('summaryChatExpand').title=summaryChatWidth>=560?'הקטן':'הגדל';$('summaryChatExpand').setAttribute('aria-pressed',String(summaryChatWidth>=560));$('summaryChatResize').setAttribute('aria-valuenow',summaryChatWidth);try{localStorage.setItem('sumit-summary-chat-width',summaryChatWidth);}catch{}requestAnimationFrame(()=>placeSite(false));}
$('summaryChatExpand').onclick=()=>setSummaryChatWidth(summaryChatWidth>=560?400:640);
$('summaryChatResize').onpointerdown=e=>{e.preventDefault();const start=e.clientX,width=summaryChatWidth,handle=e.currentTarget;handle.setPointerCapture(e.pointerId);handle.onpointermove=p=>setSummaryChatWidth(width+p.clientX-start);handle.onpointerup=()=>{handle.onpointermove=null;};handle.onlostpointercapture=()=>{handle.onpointermove=null;};};
$('summaryChatResize').onkeydown=e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();setSummaryChatWidth(summaryChatWidth+(e.key==='ArrowRight'?40:-40));}};
try{setSummaryChatWidth(localStorage.getItem('sumit-summary-chat-width')||400);}catch{setSummaryChatWidth(400);}

function followSummaryNavigation(url){
 if(!S.viewer||!S.local?.dir)return;
 try{const u=new URL(url);if(u.protocol!=='file:'||!u.pathname.toLowerCase().endsWith('.html'))return;
 let file=decodeURIComponent(u.pathname).replace(/^\/(?=[a-z]:)/i,'');if(u.hostname)file='//'+u.hostname+file;
 const windows=S.viewer.path.includes('\\');if(windows)file=file.replace(/\//g,'\\');
 const sep=windows?'\\':'/',root=S.local.dir.replace(/[\\/]+$/,'')+sep;
 if(!file.toLowerCase().startsWith(root.toLowerCase())||file===S.viewer.path)return;
 const lecture=file.match(/הרצאה (\d+)/),title=lecture?'הרצאה '+lecture[1]+' · סיכום':'סיכום';
 S.viewer={path:file,title,pdf:null,lec:lecture?Number(lecture[1]):S.viewer.lec};$('viewerTitle').textContent=title;$('viewerPdf').hidden=true;renderSummaryChat();
 }catch{}
}
