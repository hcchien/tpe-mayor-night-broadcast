export const $ = (s, root = document) => root.querySelector(s);
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key,value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(),value);
    else if (key === 'text') node.textContent = value;
    else if (value !== false && value != null) node.setAttribute(key,value === true && !key.startsWith('aria-') ? '' : String(value));
  }
  node.append(...children.filter(c => c != null)); return node;
}
export async function api(path, options = {}) {
  const response = await fetch(path,{ ...options, headers:{ 'Content-Type':'application/json', ...options.headers } });
  let body;
  try { body = await response.json(); } catch { throw new Error('服務連線或登入已失效，請重新載入頁面。'); }
  if (!response.ok) {
    const error = new Error(body.error || '操作失敗，請稍後再試。'); error.fields = body.fields; error.status = response.status; throw error;
  }
  return body;
}
export function safeUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
export function externalLink(text, url, className = 'button secondary') {
  const href = safeUrl(url); return href ? el('a',{href,target:'_blank',rel:'noopener noreferrer',class:className},text) : null;
}
export function options(select, values) { for (const value of values) select.append(el('option',{value},value)); }
export function locationSelects(config, city, district, {optional=false, selected=''} = {}) {
  function refresh(value='') {
    const list=Object.hasOwn(config.districtsByCity,city.value)?config.districtsByCity[city.value]:[];
    const label=!city.value?'請先選擇縣市':optional?'所有鄉鎮市區':value&&!list.includes(value)?`原資料「${value}」無法配對，請重新選擇`:'請選擇鄉鎮市區';
    district.replaceChildren(el('option',{value:''},label));options(district,list);
    district.value=list.includes(value)?value:'';district.disabled=!city.value;
    // Search reset must not resurrect the value restored from the URL.
    for(const option of district.options)option.defaultSelected=false;
  }
  city.addEventListener('change',()=>refresh());refresh(selected);
  return refresh;
}
export function eventLabels(config, events) { return config.eventOptions.filter(option=>(events||[]).includes(option.id)).map(option=>option.label).join('、'); }
export const fieldNames = { events:'參與活動', name:'店家／場地名稱', city:'縣市', district:'鄉鎮市區', category:'場地類型', address:'完整地址', capacity:'預計容納人數', screen:'螢幕與音響設備', opening_time:'當天開放時間', cost:'消費與入場方式', description:'場地介紹與參與須知', booking_url:'店家公開網站或預約連結', accessible:'提供無階梯入口', contact_name:'聯絡人姓名', contact_email:'聯絡 Email', contact_phone:'聯絡電話' };
export function venueFields(config, value = {}, privateFields = false, prefix = '') {
  const grid = el('div',{class:'field-grid'});
  if(!privateFields) {
    const group=el('fieldset',{class:'wide event-choices'},el('legend',{},'參與活動 *（可複選）'));
    const inputs=config.eventOptions.map(option=>{
      const input=el('input',{type:'checkbox',name:'events',value:option.id,id:prefix+'event-'+option.id});input.checked=(value.events||[]).includes(option.id);
      group.append(el('label',{class:'check'},input,option.label));return input;
    });
    const validate=()=>inputs[0].setCustomValidity(inputs.some(input=>input.checked)?'':'請至少選擇一場活動');
    for(const input of inputs)input.addEventListener('change',validate);validate();
    group.append(el('p',{class:'field-hint'},'可參與其中一晚或兩晚。若兩晚的開放時間、低消或預約方式不同，請在下方分別註明。'));grid.append(group);
  }
  const specs = privateFields ? [
    ['contact_name','text',80,true],['contact_email','email',254,true],['contact_phone','tel',30,true]
  ] : [
    ['name','text',80,true],['city','select'],['district','select'],['category','select'],['address','text',200,true],
    ['capacity','number'],['screen','text',120],['opening_time','text',120],['cost','text',200,true],
    ['description','textarea',1500,true],['booking_url','url',500,true],['accessible','checkbox',0,true]
  ];
  const placeholders = {name:'例如：城市街角咖啡',district:'例如：中正區、竹北市、吉安鄉',address:'縣市＋鄉鎮市區＋路名門牌，含樓層',screen:'例如：75 吋電視、外接音響',opening_time:'例如：活動當日 18:00–22:00',cost:'例如：每人低消一杯飲料，需事先訂位',description:'介紹你的空間、設備與當天安排，請勿填寫私人聯絡資料。',booking_url:'https://（選填，供訪客聯絡或訂位）',contact_phone:'例如：02-2345-6789'};
  for (const [name,type,max,wide] of specs) {
    const label = el('label',{class:wide ? 'wide' : ''});
    if (type === 'checkbox') {
      label.classList.add('check'); const input = el('input',{type,name,id:prefix+name}); input.checked = !!value[name]; label.append(input,fieldNames[name]);
    } else {
      label.append(el('span',{},fieldNames[name] + (name === 'booking_url' ? '（選填）' : ' *')));
      const input = type === 'select' ? el('select',{name,id:prefix+name,required:true}) : type === 'textarea' ? el('textarea',{name,id:prefix+name,rows:4,required:true,maxlength:max,minlength:10}) : el('input',{name,id:prefix+name,type,required:name !== 'booking_url',maxlength:max,placeholder:placeholders[name],autocomplete:privateFields ? {contact_name:'name',contact_email:'email',contact_phone:'tel'}[name] : 'off'});
      if (type === 'select') { input.append(el('option',{value:''},'請選擇')); options(input,name === 'city' ? config.cities : name === 'category' ? config.categories : []); }
      if (type === 'number') { input.min='1';input.max='5000';input.step='1'; }
      if (['name','screen','opening_time'].includes(name)) input.minLength=2;
      if (name === 'address') input.minLength=5;
      if (name === 'contact_phone') input.minLength=6;
      if (value[name] != null) input.value=value[name];
      label.append(input);
      if (name === 'capacity') label.append(el('p',{class:'field-hint'},'空間容量，並非剩餘座位'));
      if (name === 'booking_url') label.append(el('p',{class:'field-hint'},'請填店家官方頁面，勿貼私人群組邀請或短網址'));
    }
    grid.append(label);
  }
  if(!privateFields)locationSelects(config,$('[name=city]',grid),$('[name=district]',grid),{selected:value.district||''});
  return grid;
}
export function readVenue(form) {
  const fd = new FormData(form); const data = {};
  for (const name of Object.keys(fieldNames)) data[name] = name === 'events' ? fd.getAll('events') : name === 'capacity' ? Number(fd.get(name)) : name === 'accessible' ? fd.has(name) : String(fd.get(name) || '').trim();
  return data;
}
export function showError(node,error) {
  node.className='form-message error';
  node.textContent=error.message + (error.fields?.length ? '\n'+error.fields.map(f => `${fieldNames[f.field.replace('venue.','').split('.')[0]] || f.field}：${f.message}`).join('\n') : '');
}
let turnstileLoading;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  if (!turnstileLoading) turnstileLoading = new Promise((resolve,reject) => {
    const script=el('script',{src:'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',async:true,defer:true});
    script.onload=resolve;script.onerror=()=>{turnstileLoading=null;script.remove();reject(new Error('無法載入人機驗證，請檢查網路後重新整理。'));};document.head.append(script);
  });
  return turnstileLoading;
}
export async function challenge(container, config, action) {
  if (config.localDevelopment) { container.append(el('p',{class:'subtle'},'本機開發模式：驗證略過，不可用於正式站。')); return { token:()=> 'local-development', reset:()=>{} }; }
  if (!config.turnstileSiteKey) throw new Error('人機驗證尚未設定，暫時無法送出。');
  await loadTurnstile();let token='';
  const widget=window.turnstile.render(container,{sitekey:config.turnstileSiteKey,action,theme:'light',callback:v=>{token=v;},'expired-callback':()=>{token='';},'error-callback':()=>{token='';}});
  return {token:()=>token,reset:()=>{token='';window.turnstile.reset(widget);}};
}
