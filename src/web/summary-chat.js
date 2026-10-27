// Each summary owns its conversation and up to six removable image attachments.
const summaryThreads=new Map();let summaryChatJob=null;
function summaryThread(){if(!S.viewer)return null;const key=S.viewer.path;if(!summaryThreads.has(key))summaryThreads.set(key,{messages:[],attachments:[],draft:''});return summaryThreads.get(key);}
function openSummaryChat(){if(!S.viewer)return;$('summaryChat').hidden=false;renderSummaryChat();$('summaryChatText').focus();requestAnimationFrame(()=>placeSite(false));}
function renderSummaryChat(){const t=summaryThread();if(!t)return;
 $('summaryChatMessages').innerHTML=t.messages.length?t.messages.map(m=>`<div class="summary-chat-message ${m.role}"><b>${m.role==='user'?'אתה':m.role==='error'?'לא התקבלה תשובה':esc(m.provider||'AI')}</b><div>${md(m.text)}</div></div>`).join(''):'<div class="summary-chat-empty"><b>מה תרצה להבין?</b><p>כל הסיכום כבר בהקשר. אפשר להדביק כמה תמונות, לצרף קובץ או לסמן אזור בסיכום.</p></div>';
 $('summaryChatText').value=t.draft;$('summaryChatSelection').hidden=!t.attachments.length;
 $('summaryChatAttachments').innerHTML=t.attachments.map((a,i)=>`<div class="chat-attachment"><img src="${a.image}" alt="תמונה ${i+1}"><button class="ghost small" data-remove="${a.id}" aria-label="הסר תמונה ${i+1}">×</button><span>${i+1}</span></div>`).join('');
 $('summaryChatAttachments').querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{t.attachments=t.attachments.filter(a=>a.id!==b.dataset.remove);renderSummaryChat();});
 $('summaryChatSend').disabled=!!summaryChatJob;
 $('summaryChatStatus').textContent=summaryChatJob?.path===S.viewer.path?'מכין תשובה…':summaryChatJob?'ממתין לתשובה בסיכום אחר':'הסיכום המלא זמין לשיחה';
 $('summaryChatMessages').scrollTop=$('summaryChatMessages').scrollHeight;
}
async function addChatImage(blob,text='',thread=summaryThread()){
 if(!thread)return;if(thread.attachments.length>=6){toast('אפשר לצרף עד 6 תמונות. הסר תמונה כדי להוסיף אחרת.');return;}
 if(blob.size>20*1024*1024){toast('התמונה גדולה מדי (עד 20MB לפני הקטנה).');return;}
 const url=URL.createObjectURL(blob);try{const img=new Image();img.src=url;await img.decode();const scale=Math.min(1,1600/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);const image=canvas.toDataURL('image/png');if(image.length>2800000)throw new Error('התמונה כבדה מדי. נסה לחתוך לאזור הרלוונטי.');if(thread.attachments.length>=6)return;thread.attachments.push({id:crypto.randomUUID(),image,text});if(summaryThread()===thread)renderSummaryChat();}catch(e){toast(e.message||'לא ניתן לקרוא את התמונה');}finally{URL.revokeObjectURL(url);}
}
$('viewerChat').onclick=openSummaryChat;
$('summaryLearningReset').onclick=()=>{if(S.viewer&&S.course)send({type:'resetLearningNeeds',course:S.course.name,path:S.viewer.path});};
$('viewerSelect').onclick=()=>{if(S.viewer&&S.course)send({type:'selectSummary',course:S.course.name,path:S.viewer.path});};
$('summaryChatClose').onclick=()=>{$('summaryChat').hidden=true;requestAnimationFrame(()=>placeSite(false));};
$('summaryChatClearSelection').onclick=()=>{const t=summaryThread();if(t){t.attachments=[];renderSummaryChat();}};
$('summaryChatAttach').onclick=()=>$('summaryChatFiles').click();
$('summaryChatFiles').onchange=async e=>{const t=summaryThread();for(const f of e.target.files)await addChatImage(f,'',t);e.target.value='';};
$('summaryChat').addEventListener('paste',async e=>{const files=[...e.clipboardData.items].filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile());if(!files.length)return;e.preventDefault();const t=summaryThread();for(const f of files)await addChatImage(f,'',t);});
$('summaryChatText').oninput=()=>{const t=summaryThread();if(t)t.draft=$('summaryChatText').value;};
$('summaryChatSend').onclick=()=>{const t=summaryThread(),text=$('summaryChatText').value.trim();if(!t||!text||summaryChatJob)return;const requestId='summary-chat-'+Date.now();summaryChatJob={requestId,path:S.viewer.path,text};t.messages.push({role:'user',text:text+(t.attachments.length?'\n\nמצורפות '+t.attachments.length+' תמונות':'')});t.draft='';send({type:'summaryChat',requestId,course:S.course.name,path:S.viewer.path,text,images:t.attachments.map(a=>a.image),imageNotes:t.attachments.map((a,i)=>'תמונה '+(i+1)+': '+a.text).join('\n')});renderSummaryChat();};
$('summaryChatText').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('summaryChatSend').click();}};
function summaryImageBlob(data){return new Blob([Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0))],{type:'image/png'});}
async function summaryChatEvent(m){if(m.type==='summarySelectionReady'){if(S.viewer?.path!==m.path||S.view!=='sites')return;const t=summaryThread();openSummaryChat();await addChatImage(summaryImageBlob(m.image),m.text,t);return;}if(m.type!=='summaryChatResult'||m.requestId!==summaryChatJob?.requestId||m.path!==summaryChatJob.path)return;const t=summaryThreads.get(m.path);if(t){t.messages.push({role:m.error?'error':'assistant',text:m.text,provider:m.provider});if(m.error)t.draft=summaryChatJob.text;}summaryChatJob=null;if(S.viewer)renderSummaryChat();}
let summaryChatWidth=400;
function setSummaryChatWidth(value){summaryChatWidth=Math.max(320,Math.min(800,Number(value)||400));$('summaryWorkspace').style.setProperty('--summary-chat-width',summaryChatWidth+'px');$('summaryChatExpand').textContent=summaryChatWidth>=560?'הקטן':'הגדל';$('summaryChatExpand').setAttribute('aria-pressed',String(summaryChatWidth>=560));$('summaryChatResize').setAttribute('aria-valuenow',summaryChatWidth);try{localStorage.setItem('sumit-summary-chat-width',summaryChatWidth);}catch{}requestAnimationFrame(()=>placeSite(false));}
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
