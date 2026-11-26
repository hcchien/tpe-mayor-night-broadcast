import { $, el, api, externalLink, options, venueFields, readVenue, showError, challenge } from './shared.js';
let config;let registerChallenge;let reportChallenge;let reportVenueId='';let currentPage=1;let requestNumber=0;
let merchant=null;
const authMessage=$('#merchant-message');
$('#google-login').addEventListener('click',async()=>{
  const button=$('#google-login');button.disabled=true;authMessage.textContent='正在前往登入…';
  try{const data=await api('/api/auth/login',{method:'POST',body:'{}'});if(config?.localDevelopment){merchant=(await api('/api/auth/me')).user;updateMerchantUI();authMessage.textContent='已完成本機模擬登入。';}else{location.assign(data.url);}}
  catch(error){showError(authMessage,error);button.disabled=false;}
});
$('#merchant-logout').addEventListener('click',async()=>{
  const button=$('#merchant-logout');button.disabled=true;
  try{await api('/api/auth/logout',{method:'POST',body:'{}'});merchant=null;updateMerchantUI();authMessage.className='form-message';authMessage.textContent='已登出本站。';}
  catch(error){showError(authMessage,error);}finally{button.disabled=false;}
});
function updateMerchantUI(){
  $('#merchant-identity').textContent=merchant?`登入帳號：${merchant.email}${merchant.provider==='local'?'（本機模擬登入）':''}`:'登記前，請先使用 Google 帳號登入。';
  $('#google-login').hidden=!!merchant;$('#merchant-logout').hidden=!merchant;
  $('#google-login').disabled=!config?.registrationOpen||!config?.googleLoginAvailable;
  $('#google-login').textContent=config?.localDevelopment?'本機模擬 Google 登入':'使用 Google 帳號登入';
  const fields=$('#registration-fields');if(fields)fields.disabled=!config?.registrationOpen||!merchant;
  const email=$('#register-form [name=contact_email]');if(email){email.value=merchant?.email||'';email.readOnly=true;email.setAttribute('aria-describedby','merchant-identity');email.closest('label').querySelector('span').textContent='Google 帳號 Email（自動帶入） *';}
}
const glyphs={'餐廳':'♨','咖啡廳':'☕','酒吧':'◒','共享空間':'▦','其他場地':'⌂'};
function card(venue) {
  const map = 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(venue.address);
  const details = el('div',{class:'venue-details'},el('p',{},'開放時間｜'+venue.opening_time),el('p',{},'消費方式｜'+venue.cost));
  if (venue.accessible) details.append(el('p',{},'✓ 店家提供無階梯入口（細節請先確認）'));
  const share = el('button',{type:'button',class:'link-button',onClick:async()=>{
    const url=new URL(location.origin);url.searchParams.set('q',venue.name);
    try {
      if (navigator.share) await navigator.share({title:`一起看台北｜${venue.name}`,text:`${venue.name}\n${venue.address}`,url:url.href});
      else {await navigator.clipboard.writeText(url.href);share.textContent='已複製場地搜尋連結';}
    } catch (error) { if (error.name !== 'AbortError') share.textContent='請複製網址列連結分享'; }
  }},'分享給朋友 ↗');
  return el('article',{class:'venue-card'},
    el('div',{class:'card-top','data-category':venue.category},el('span',{class:'tag'},venue.category),el('span',{class:'category-glyph','aria-hidden':true},glyphs[venue.category]||'⌂')),
    el('div',{class:'card-body'},el('span',{class:'eyebrow'},venue.district+' · 已查核'),el('h3',{},venue.name),el('p',{class:'card-address'},venue.address),
      el('div',{class:'facts'},el('p',{},'空間容量',el('strong',{},`約 ${venue.capacity} 人`)),el('p',{},'播放設備',el('strong',{},venue.screen))),
      el('p',{class:'description'},venue.description),details,
      el('div',{class:'card-actions'},externalLink('查看地圖 ↗',map),externalLink('店家／預約 ↗',venue.booking_url,'button')),
      el('div',{class:'card-links'},share,el('button',{type:'button',class:'link-button',onClick:()=>openReport(venue)},'回報問題'))));
}
async function loadVenues(page=1) {
  currentPage=page;const seq=++requestNumber;const fd=new FormData($('#search-form'));
  const params=new URLSearchParams({page:String(page)});
  for(const key of ['q','district','category'])if(fd.get(key))params.set(key,String(fd.get(key)).trim());
  if(fd.has('accessible'))params.set('accessible','1');
  const shareParams=new URLSearchParams(params);shareParams.delete('page');history.replaceState(null,'',`${location.pathname}${shareParams.size?'?'+shareParams:''}${location.hash}`);
  $('#directory-message').replaceChildren(el('p',{class:'subtle'},'正在尋找一起看的地方…'));$('#venue-grid').setAttribute('aria-busy','true');
  try{
    const data=await api('/api/venues?'+params);if(seq!==requestNumber)return;
    $('#venue-count').textContent=`${data.total} 個聯播場地`;$('#venue-grid').replaceChildren(...data.venues.map(card));$('#directory-message').replaceChildren();
    if(!data.venues.length)$('#directory-message').append(el('div',{class:'empty-state'},el('span',{class:'empty-icon','aria-hidden':true},'⌂'),el('h3',{},shareParams.size?'還沒找到符合的場地':'第一個相聚的地方，等你開門。'),el('p',{},shareParams.size?'試著選擇其他行政區、類型，或清除搜尋條件。':'場地正在招募與查核中。有螢幕、有空間的你，歡迎登記加入。'),el('a',{class:'button secondary',href:'#register'},'登記我的場地 ↗')));
    const pagination=$('#pagination');pagination.replaceChildren();const pages=Math.ceil(data.total/24);
    if(pages>1)pagination.append(el('button',{class:'button secondary',disabled:page===1,onClick:()=>loadVenues(page-1)},'上一頁'),el('span',{},`${page} / ${pages}`),el('button',{class:'button secondary',disabled:page===pages,onClick:()=>loadVenues(page+1)},'下一頁'));
  }catch(error){if(seq!==requestNumber)return;$('#venue-count').textContent='暫時無法載入';$('#venue-grid').replaceChildren();$('#pagination').replaceChildren();$('#directory-message').replaceChildren(el('div',{class:'empty-state'},el('h3',{},'場地資訊暫時無法載入'),el('p',{class:'error'},error.message),el('button',{class:'button secondary',onClick:()=>loadVenues(currentPage)},'重新載入')));}finally{if(seq===requestNumber)$('#venue-grid').removeAttribute('aria-busy');}
}
$('#search-form').addEventListener('submit',e=>{e.preventDefault();loadVenues();});
$('#search-form').addEventListener('reset',()=>setTimeout(()=>loadVenues(),0));
async function openReport(venue){
  reportVenueId=venue.id;$('#report-form').reset();$('#report-message').textContent='';$('#report-venue').textContent=venue.name;$('#report-dialog').showModal();
  try{if(!reportChallenge)reportChallenge=await challenge($('#report-turnstile'),config,'report');else reportChallenge.reset();}catch(error){showError($('#report-message'),error);}
}
$('#close-report').addEventListener('click',()=>$('#report-dialog').close());
$('#report-form').addEventListener('submit',async e=>{
  e.preventDefault();const message=$('#report-message');const token=reportChallenge?.token();
  if(!token){showError(message,new Error('請先完成人機驗證。'));return;}
  const button=$('button[type=submit]',e.target);button.disabled=true;const fd=new FormData(e.target);
  try{const data=await api('/api/reports',{method:'POST',body:JSON.stringify({venue_id:reportVenueId,reason:String(fd.get('reason')).trim(),website:fd.get('website'),turnstile_token:token})});message.className='form-message success';message.textContent=data.message;e.target.reset();}catch(error){showError(message,error);}finally{reportChallenge.reset();button.disabled=false;}
});
$('#register-form').addEventListener('submit',async e=>{
  e.preventDefault();const message=$('#register-message');const token=registerChallenge?.token();
  if(!merchant){showError(message,new Error('請先使用 Google 帳號登入。'));return;}
  if(!token){showError(message,new Error('請先完成人機驗證。'));return;}
  const button=$('button[type=submit]',e.target);button.disabled=true;button.textContent='正在送出…';message.textContent='';
  const fd=new FormData(e.target);
  try{const data=await api('/api/venues',{method:'POST',body:JSON.stringify({...readVenue(e.target),consent:fd.has('consent'),website:fd.get('website'),turnstile_token:token})});
    const receipt=el('div',{class:'receipt',tabindex:'-1'},el('h3',{},'已收到，謝謝你打開這扇門。'),el('p',{},data.message),el('code',{},data.id),el('p',{},'請截圖或複製保存編號。需要修改、取消或確認審核進度時，請聯絡主辦單位。'),el('a',{class:'button secondary',href:'#venues'},'回到場地列表'));
    e.target.replaceChildren(receipt);receipt.focus();
  }catch(error){showError(message,error);registerChallenge.reset();button.disabled=false;button.textContent='送出店家登記 ↗';if(error.status===401){merchant=null;updateMerchantUI();showError(authMessage,new Error('登入已過期，請重新登入後再登記。'));}}
});
async function init(){
  await loadVenuesFromUrl();
  try{
    config=await api('/api/config');options($('#district-filter'),config.districts);options($('#category-filter'),config.categories);
    const params=new URLSearchParams(location.search);for(const key of ['district','category'])if(params.get(key))$('#search-form').elements[key].value=params.get(key);
    $('#event-time').textContent=config.eventTime;$('#organizer').textContent=config.organizerName?`主辦／資料管理：${config.organizerName}`:'';
    if(config.contactEmail){$('#contact-link').hidden=false;$('#contact-link').href='mailto:'+encodeURIComponent(config.contactEmail);}
    if(config.livestreamUrl){const link=externalLink('前往官方直播 ↗',config.livestreamUrl,'text-link');if(link)$('#livestream').replaceWith(link);}
    $('#venue-fields').append(venueFields(config));$('#contact-fields').append(venueFields(config,{},true));
    const loginError=new URLSearchParams(location.search).get('login_error');
    if(loginError){showError(authMessage,new Error(({cancelled:'你已取消 Google 登入，可隨時再試。',unavailable:'Google 登入暫時無法使用，請稍後重試。',failed:'登入請求已失效或驗證失敗，請重新登入。'})[loginError]||'登入失敗，請重新登入。'));}
    try{merchant=(await api('/api/auth/me')).user;}catch(error){showError(authMessage,error);}
    updateMerchantUI();
    if(config.registrationOpen){if(!config.googleLoginAvailable)showError(authMessage,new Error('Google 登入尚未設定，暫時無法登記。'));try{registerChallenge=await challenge($('#register-turnstile'),config,'register');}catch(error){showError($('#register-message'),error);}}
    else $('#registration-notice').append(el('div',{class:'notice'},'店家登記暫停受理。開放時間請留意主辦單位公告。'));
    await loadVenues();
  }catch(error){$('#registration-notice').append(el('div',{class:'notice'},'登記設定暫時無法載入，請重新整理。'));await loadVenues();}
}
async function loadVenuesFromUrl(){const params=new URLSearchParams(location.search);$('#search-form').elements.q.value=params.get('q')||'';$('#search-form').elements.accessible.checked=params.get('accessible')==='1';}
init();
