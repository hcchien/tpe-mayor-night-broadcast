import { $,el,api,venueFields,readVenue,showError,externalLink } from '/shared.js';
const statuses={pending:'待審核',approved:'已公開',rejected:'未通過',withdrawn:'已下架',reports:'問題回報',audit:'操作紀錄'};
let config;let active='pending';let page=1;let sequence=0;
function fmt(stamp){return new Date(stamp).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});}
function venueCard(venue){
  const form=el('form',{class:'admin-card'});
  const message=el('p',{class:'form-message',role:'status'});
  const note=el('textarea',{name:'moderation_note',required:true,minlength:3,maxlength:1000,rows:2,placeholder:'請記錄查核結果、聯絡情形或下架原因（至少 3 字）'});note.value=venue.moderation_note;
  const status=el('select',{name:'review_status',required:true});for(const key of ['pending','approved','rejected','withdrawn'])status.append(el('option',{value:key},statuses[key]));status.value=venue.status;
  const fields=el('div',{},venueFields(config,venue,false,venue.id+'-'),el('div',{class:'private-heading'},el('h3',{},'非公開聯絡資料')),venueFields(config,venue,true,venue.id+'-'));
  const identityText=venue.owner_google_sub?`${venue.owner_identity_provider==='google'?'Google 登入已驗證':'本機測試身分（非 Google 驗證）'}\n登記帳號：${venue.owner_google_email}\n帳號識別碼：${venue.owner_google_sub}\n驗證時間：${fmt(venue.owner_verified_at)}${venue.owner_identity_provider==='google'&&!venue.owner_email_authoritative?'\n此帳號使用第三方信箱，請另確認目前信箱控制權。':''}\nGoogle 登入不代表有權代理店家，仍需查核授權。`:'舊資料：未完成 Google 驗證，請另聯絡登記人確認。';
  const edit=el('details',{},el('summary',{},'查看／編輯完整場地資料'),fields);
  const save=el('button',{class:'button',type:'submit'},'儲存審核與修改');
  const remove=el('button',{class:'button danger',type:'button',onClick:async()=>{
    if(!confirm(`永久刪除「${venue.name}」的場地、聯絡資料及相關回報？此操作無法從後台復原。`))return;
    remove.disabled=true;save.disabled=true;
    try{const result=await api(`/api/admin/venues/${venue.id}`,{method:'DELETE',body:JSON.stringify({version:venue.version})});await load();$('#admin-message').textContent=result.message;}catch(error){showError(message,error);remove.disabled=false;save.disabled=false;}
  }},'永久刪除');
  form.append(el('p',{class:'eyebrow'},`${statuses[venue.status]} · ${fmt(venue.created_at)}`),el('h3',{},venue.name),el('p',{},`${venue.district} · ${venue.category}\n${venue.address}`),
    el('p',{},`${venue.screen} · 約 ${venue.capacity} 人\n開放：${venue.opening_time}\n消費：${venue.cost}`),el('p',{},venue.description),externalLink('檢查公開連結 ↗',venue.booking_url),
    el('p',{class:'private-data'},identityText),el('p',{class:'private-data'},`聯絡人：${venue.contact_name}\n聯絡 Email：${venue.contact_email}\n電話：${venue.contact_phone}\n登記編號：${venue.id}\n同意版本：${venue.consent_version}`),edit,
    el('label',{},'審核結果',status),el('label',{},'查核備註（不公開）',note),message,el('div',{class:'review-actions'},save,remove));
  form.addEventListener('invalid',()=>{edit.open=true;},true);
  form.addEventListener('submit',async event=>{
    event.preventDefault();save.disabled=true;remove.disabled=true;message.textContent='儲存中…';
    try{const result=await api(`/api/admin/venues/${venue.id}`,{method:'PATCH',body:JSON.stringify({version:venue.version,status:status.value,moderation_note:note.value.trim(),venue:readVenue(form)})});await load();$('#admin-message').textContent=result.message;}
    catch(error){showError(message,error);save.disabled=false;remove.disabled=false;}
  });return form;
}
function reportCard(report){
  const form=el('form',{class:'admin-card'});const message=el('p',{class:'form-message',role:'status'});const resolution=el('textarea',{required:true,minlength:3,maxlength:1000,rows:2,name:'resolution',placeholder:'查核結果與處理方式'});const submit=el('button',{type:'submit',class:'button'},'標記已處理');
  form.append(el('p',{class:'eyebrow'},fmt(report.created_at)),el('h3',{},report.name),el('p',{},`場地編號：${report.venue_id}`),el('p',{},report.reason),el('p',{class:'subtle'},'若需修改或下架場地，請到「已公開」分頁處理。'),el('label',{},'處理結果',resolution),message,submit);
  form.addEventListener('submit',async event=>{event.preventDefault();submit.disabled=true;try{await api(`/api/admin/reports/${report.id}`,{method:'PATCH',body:JSON.stringify({resolution:resolution.value.trim()})});await load();}catch(error){showError(message,error);submit.disabled=false;}});return form;
}
async function load(){
  const seq=++sequence;const list=$('#admin-list');$('#admin-message').className='';$('#admin-message').textContent='載入中…';$('#admin-pagination').replaceChildren();list.replaceChildren();
  for(const button of $('#admin-tabs').children){button.classList.toggle('active-tab',button.dataset.status===active);button.setAttribute('aria-pressed',String(button.dataset.status===active));}
  try{
    if(active==='reports'){const data=await api('/api/admin/reports');if(seq!==sequence)return;list.replaceChildren(...data.reports.map(reportCard));$('#admin-message').textContent=data.reports.length?`顯示 ${data.reports.length} 筆待處理回報（一次最多 100 筆；處理後重新載入）。`:'目前沒有待處理回報。';}
    else if(active==='audit'){const data=await api('/api/admin/audit');if(seq!==sequence)return;list.replaceChildren(...data.logs.map(log=>el('article',{class:'admin-card'},el('strong',{},`${fmt(log.created_at)} · ${log.action}`),el('p',{},`${log.actor}\n對象：${log.target_id}`),el('pre',{},log.detail))));$('#admin-message').textContent=`最近 ${data.logs.length} 筆操作紀錄（最多 100 筆）。`;}
    else {const data=await api(`/api/admin/venues?status=${active}&page=${page}`);if(seq!==sequence)return;$('#admin-identity').textContent=`登入身分：${data.actor}${config.localDevelopment?'（僅本機開發）':''}`;list.replaceChildren(...data.venues.map(venueCard));$('#admin-message').textContent=`${statuses[active]}：${data.total} 筆`;const pages=Math.ceil(data.total/30);if(pages>1)$('#admin-pagination').append(el('button',{class:'button secondary',disabled:page===1,onClick:()=>{page--;load();}},'上一頁'),el('span',{},`${page} / ${pages}`),el('button',{class:'button secondary',disabled:page===pages,onClick:()=>{page++;load();}},'下一頁'));}
  }catch(error){if(seq!==sequence)return;showError($('#admin-message'),error);list.append(el('button',{class:'button secondary',onClick:load},'重新載入'));}
}
try{config=await api('/api/config');for(const [key,label] of Object.entries(statuses))$('#admin-tabs').append(el('button',{type:'button',class:'button secondary','data-status':key,onClick:()=>{active=key;page=1;load();}},label));await load();}catch(error){showError($('#admin-message'),error);}
