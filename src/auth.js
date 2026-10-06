const SUPABASE_URL=import.meta.env.VITE_SUPABASE_URL||'https://gmysuhoebcapigdidnnv.supabase.co';
const SUPABASE_KEY=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY||'sb_publishable_zHcukZ2xWD8RqrYu3i-Wzw_Kd4c8x-h';
const STORE='bdf:auth-session';

let session=null;
let authSettings={external:{}};

function save(value){
  session=value||null;
  try{
    if(session)localStorage.setItem(STORE,JSON.stringify(session));
    else localStorage.removeItem(STORE);
  }catch{}
}
function read(){
  try{return JSON.parse(localStorage.getItem(STORE)||'null');}catch{return null;}
}
async function request(path,{method='GET',body,token}={}){
  const res=await fetch(SUPABASE_URL+'/auth/v1'+path,{
    method,
    headers:{
      'apikey':SUPABASE_KEY,
      'Content-Type':'application/json',
      ...(token?{'Authorization':'Bearer '+token}:{})
    },
    ...(body?{body:JSON.stringify(body)}:{})
  });
  let data={};
  try{data=await res.json();}catch{}
  if(!res.ok){
    const error=new Error(data.msg||data.message||data.error_description||data.error||'تعذر تسجيل الدخول.');
    error.status=res.status;
    throw error;
  }
  return data;
}
function normalize(data){
  if(!data)return null;
  if(data.access_token)return {
    access_token:data.access_token,
    refresh_token:data.refresh_token,
    expires_at:Math.floor(Date.now()/1000)+(Number(data.expires_in)||3600),
    user:data.user||null
  };
  return data;
}
function parseOAuthCallback(){
  const hash=new URLSearchParams(location.hash.replace(/^#/,''));
  const access=hash.get('access_token');
  const error=hash.get('error_description')||hash.get('error');
  if(error){
    history.replaceState({},'',location.pathname);
    return {error:decodeURIComponent(error)};
  }
  if(!access)return null;
  const value={
    access_token:access,
    refresh_token:hash.get('refresh_token')||'',
    expires_at:Math.floor(Date.now()/1000)+(Number(hash.get('expires_in'))||3600),
    user:null
  };
  save(value);
  history.replaceState({},'',location.pathname);
  return {session:value};
}
async function refresh(){
  if(!session?.refresh_token)return null;
  try{
    const data=await request('/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token}});
    save(normalize(data));
    return session;
  }catch{
    save(null);
    return null;
  }
}
async function hydrateUser(){
  if(!session?.access_token)return null;
  try{
    const user=await request('/user',{token:session.access_token});
    session={...session,user};
    save(session);
    return user;
  }catch(err){
    if(err.status===401&&session?.refresh_token){
      await refresh();
      if(session?.access_token){
        try{
          const user=await request('/user',{token:session.access_token});
          session={...session,user};save(session);return user;
        }catch{}
      }
    }
    save(null);
    return null;
  }
}
export async function initAuth(){
  const callback=parseOAuthCallback();
  session=read();
  try{authSettings=await request('/settings');}catch{authSettings={external:{}};}
  if(session?.expires_at&&session.expires_at<Math.floor(Date.now()/1000)+60)await refresh();
  const user=await hydrateUser();
  return {user,error:callback?.error||'',googleEnabled:!!authSettings?.external?.google};
}
export function currentUser(){return session?.user||null;}
export function authToken(){return session?.access_token||'';}
export async function signIn(email,password){
  const data=await request('/token?grant_type=password',{method:'POST',body:{email,password}});
  save(normalize(data));
  await hydrateUser();
  return currentUser();
}
export async function signUp(email,password){
  const res=await fetch('/api/signup',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email,password})
  });
  let data={};
  try{data=await res.json();}catch{}
  if(res.status===409||data.status==='existing'){
    try{
      const user=await signIn(email,password);
      return {user,needsConfirmation:false,existing:true,signedIn:true};
    }catch{
      return {user:null,needsConfirmation:false,existing:true,signedIn:false};
    }
  }
  if(!res.ok)throw new Error(data.error||'تعذر إنشاء الحساب.');
  const user=await signIn(email,password);
  return {user,needsConfirmation:false,existing:false,signedIn:true};
}
export async function sendPasswordReset(email){
  if(!email)throw new Error('اكتب بريدك الإلكتروني أولًا.');
  const redirect=encodeURIComponent(location.origin+'/login');
  await request('/recover?redirect_to='+redirect,{method:'POST',body:{email}});
  return true;
}
export function googleEnabled(){return !!authSettings?.external?.google;}
export async function signInGoogle(){
  if(!googleEnabled())throw new Error('تسجيل الدخول بجوجل غير مفعّل بعد في إعدادات Supabase.');
  const redirect=location.origin+'/login';
  location.href=SUPABASE_URL+'/auth/v1/authorize?provider=google&redirect_to='+encodeURIComponent(redirect);
}
export async function signOut(){
  try{if(session?.access_token)await request('/logout',{method:'POST',token:session.access_token});}catch{}
  save(null);
}
