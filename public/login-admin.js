import {$,api,showError} from '/shared.js';
const button=$('#admin-login'),message=$('#login-message');
if(new URL(location.href).searchParams.has('login_error'))message.textContent='登入未完成，請確認使用已授權的 Google 帳號後再試。';
button.addEventListener('click',async()=>{button.disabled=true;message.textContent='正在連線至 Google…';try{const {url}=await api('/api/auth/login',{method:'POST',body:JSON.stringify({admin:true})});location.assign(url);}catch(error){showError(message,error);button.disabled=false;}});
