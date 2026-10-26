$('collapseSidebar').onclick=()=>{
 const hidden=document.querySelector('.app').classList.toggle('nav-collapsed');
 $('collapseSidebar').setAttribute('aria-expanded',String(!hidden));$('collapseSidebar').title=hidden?'הצג תפריט ראשי':'הסתר תפריט ראשי';
 try{localStorage.setItem('sumit-nav-collapsed',String(hidden));}catch{}
 requestAnimationFrame(()=>placeSite(false));
};
try{if(localStorage.getItem('sumit-nav-collapsed')==='true')$('collapseSidebar').click();}catch{}
$('exportDiagnostics').onclick=()=>send({type:'exportDiagnostics'});
$('viewerShareCloud').onclick=()=>{S.shareToCloud=true;$('viewerShare').click();S.shareToCloud=false;};
function showSummaryImport(course,num){
 const dialog=h('<dialog dir="rtl"><h2>סיכום של חבר · הרצאה '+esc(num)+'</h2><p>הסיכום יתווסף בנפרד. הסיכום שלך לא יוחלף.</p><div class="row wrap"><button data-local>בחר ZIP</button><button data-paste>הדבק ZIP שהעתקת</button><button data-sync>תיקיית OneDrive מסונכרנת</button><button data-cloud>הורדה מאתר OneDrive</button></div><p>ב-OneDrive בוחרים קובץ ZIP ולוחצים הורדה; הוא יתווסף להרצאה שבחרת.</p><button data-close>סגור</button></dialog>');
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());
 const choose=extra=>{send({type:'importSharedSummary',course,num,...extra});dialog.close();};
 dialog.querySelector('[data-local]').onclick=()=>choose({});dialog.querySelector('[data-paste]').onclick=()=>choose({clipboard:true});dialog.querySelector('[data-sync]').onclick=()=>choose({onedrive:true});
 dialog.querySelector('[data-cloud]').onclick=()=>{send({type:'cloudSummaryImport',course,num});dialog.close();openSite('onedrive');toast('בחר ZIP ב-OneDrive ולחץ הורדה. הסיכום יתווסף להרצאה '+num,{ms:20000,action:'בטל ייבוא',onAction:()=>send({type:'cancelCloudImport'})});};
 dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='v'){e.preventDefault();choose({clipboard:true});}};dialog.showModal();
}
