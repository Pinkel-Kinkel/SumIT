// The summary stays visible beside an independent Gemini-only conversation.
const summaryThreads = new Map();
let summaryChatJob = null;
function summaryThread() {
  if(!S.viewer)return null;
  const key=S.viewer.path;
  if(!summaryThreads.has(key))summaryThreads.set(key,{messages:[],selection:null,draft:''});
  return summaryThreads.get(key);
}
function openSummaryChat(){if(!S.viewer)return;$('flashcards').hidden=true;$('summaryChat').hidden=false;renderSummaryChat();$('summaryChatText').focus();requestAnimationFrame(()=>placeSite(false));}
function renderSummaryChat(){
  const t=summaryThread();if(!t)return;
  const writing=summaryChatJob?.path===S.viewer.path&&summaryChatJob.partial?[{role:'assistant',text:summaryChatJob.partial}]:[];
  $('summaryChatMessages').innerHTML=t.messages.concat(writing).map(m=>`<div class="summary-chat-message ${m.role}"><b>${m.role==='user'?'אתה':m.role==='error'?'לא התקבלה תשובה':esc(m.provider||'AI')}</b><div>${md(m.text)}</div></div>`).join('');
  if($('summaryChatText').value!==t.draft)$('summaryChatText').value=t.draft;
  $('summaryChatSelection').hidden=!t.selection;
  $('summaryChatImage').src=t.selection?.image||'';
  $('summaryChatSend').disabled=!!summaryChatJob;
  $('summaryChatStatus').textContent=summaryChatJob?.path===S.viewer.path?(summaryChatJob.partial?'Gemini כותב…':'Gemini חושב…'):summaryChatJob?'ממתין לתשובה בסיכום אחר · Gemini תחילה':'Gemini תחילה · כל דף הסיכום נשלח כהקשר';
  $('summaryChatMessages').scrollTop=$('summaryChatMessages').scrollHeight;
}
$('viewerChat').onclick=openSummaryChat;
$('viewerSelect').onclick=()=>{if(S.viewer&&S.course)send({type:'selectSummary',course:S.course.name,path:S.viewer.path});};
$('summaryChatClose').onclick=()=>{$('summaryChat').hidden=true;requestAnimationFrame(()=>placeSite(false));};
$('summaryChatClearSelection').onclick=()=>{const t=summaryThread();if(t){t.selection=null;renderSummaryChat();}};
$('summaryChatText').oninput=()=>{const t=summaryThread();if(t)t.draft=$('summaryChatText').value;};
$('summaryChatSend').onclick=()=>{
  const t=summaryThread(),text=$('summaryChatText').value.trim();if(!t||!text||summaryChatJob)return;
  const requestId='summary-chat-'+Date.now();summaryChatJob={requestId,path:S.viewer.path,text};
  t.messages.push({role:'user',text:(t.selection?'על האזור שסימנתי:\n':'')+text});t.draft='';
  send({type:'summaryChat',requestId,course:S.course.name,path:S.viewer.path,title:S.viewer.title||'',text,selected:!!t.selection});renderSummaryChat();
};
$('summaryChatText').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('summaryChatSend').click();}};
function summaryChatEvent(m){
  if(m.type==='summarySelectionReady'){
    if(S.viewer?.path!==m.path||S.view!=='sites')return;
    for(const t of summaryThreads.values())t.selection=null;summaryThread().selection={text:m.text,image:m.image};openSummaryChat();return;
  }
  if(m.requestId!==summaryChatJob?.requestId||m.path!==summaryChatJob.path)return;
  if(m.type==='summaryChatChunk'){summaryChatJob.partial=m.text;if(S.viewer?.path===m.path)renderSummaryChat();return;}
  if(m.type!=='summaryChatResult')return;
  const t=summaryThreads.get(m.path);
  if(t){t.messages.push({role:m.error?'error':'assistant',text:m.text,provider:m.provider});if(m.error)t.draft=summaryChatJob.text;}
  summaryChatJob=null;if(S.viewer)renderSummaryChat();
}

function setSummaryChatWidth(value) {
  const width=Math.max(300,Math.min(680,Number(value)||380));
  $('summaryWorkspace').style.setProperty('--summary-chat-width',width+'px');
  $('summaryChatWidth').value=width;
  $('summaryChatExpand').textContent=width>=540?'הקטן':'הגדל';
  $('summaryChatExpand').setAttribute('aria-pressed',String(width>=540));
  try{localStorage.setItem('sumit-summary-chat-width',String(width));}catch{}
  requestAnimationFrame(()=>placeSite(false));
}
$('summaryChatWidth').oninput=e=>setSummaryChatWidth(e.target.value);
$('summaryChatExpand').onclick=()=>setSummaryChatWidth(Number($('summaryChatWidth').value)>=540?380:600);
try{setSummaryChatWidth(localStorage.getItem('sumit-summary-chat-width')||380);}catch{setSummaryChatWidth(380);}
