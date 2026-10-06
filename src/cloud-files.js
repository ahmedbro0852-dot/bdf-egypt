import {currentUser,authToken} from './auth.js';

const SUPABASE_URL=import.meta.env.VITE_SUPABASE_URL||'https://gmysuhoebcapigdidnnv.supabase.co';
const SUPABASE_KEY=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY||'sb_publishable_zHcukZ2xWD8RqrYu3i-Wzw_Kd4c8x-h';
const BUCKET='bdf-user-files';
const MAX_FILE=100*1024*1024;

const safeName=name=>String(name||'file').replace(/[\\/:*?"<>|#%{}\[\]]+/g,'-').replace(/\s+/g,' ').trim().slice(0,120)||'file';
const encPath=path=>path.split('/').map(encodeURIComponent).join('/');
function authHeaders(extra={}) {
  const token=authToken();
  return {'apikey':SUPABASE_KEY,'Authorization':'Bearer '+token,...extra};
}
function ensureAuth(){
  const user=currentUser(),token=authToken();
  if(!user||!token)throw Error('سجّل الدخول أولًا لحفظ الملفات في السحابة.');
  return user;
}
async function metadataInsert(row){
  const r=await fetch(SUPABASE_URL+'/rest/v1/bdf_files',{
    method:'POST',
    headers:authHeaders({'Content-Type':'application/json','Prefer':'return=representation'}),
    body:JSON.stringify(row)
  });
  const data=await r.json().catch(()=>[]);
  if(!r.ok)throw Error(data?.message||data?.error||'تعذر تسجيل الملف في المكتبة.');
  return Array.isArray(data)?data[0]:data;
}
async function storageRemove(path){
  const r=await fetch(SUPABASE_URL+'/storage/v1/object/'+BUCKET,{
    method:'DELETE',
    headers:authHeaders({'Content-Type':'application/json'}),
    body:JSON.stringify({prefixes:[path]})
  });
  if(!r.ok){
    const data=await r.json().catch(()=>({}));
    throw Error(data?.message||data?.error||'تعذر حذف الملف.');
  }
}
export async function uploadCloudBlob(blob,name,{toolId='',kind='uploaded'}={}){
  const user=ensureAuth();
  const fileBlob=blob instanceof Blob?blob:new Blob([blob]);
  if(!fileBlob.size)throw Error('الملف فارغ.');
  if(fileBlob.size>MAX_FILE)throw Error('الحد السحابي للملف الواحد 100MB.');
  const clean=safeName(name);
  const month=new Date().toISOString().slice(0,7);
  const path=user.id+'/'+month+'/'+crypto.randomUUID()+'-'+clean;
  const mime=fileBlob.type||'application/octet-stream';
  const r=await fetch(SUPABASE_URL+'/storage/v1/object/'+BUCKET+'/'+encPath(path),{
    method:'POST',
    headers:authHeaders({'Content-Type':mime,'x-upsert':'false','cache-control':'3600'}),
    body:fileBlob
  });
  if(!r.ok){
    const data=await r.json().catch(()=>({}));
    throw Error(data?.message||data?.error||'تعذر رفع الملف إلى السحابة.');
  }
  try{
    return await metadataInsert({
      user_id:user.id,
      bucket_id:BUCKET,
      object_path:path,
      original_name:clean,
      kind,
      tool_id:toolId||null,
      mime_type:mime,
      size_bytes:fileBlob.size
    });
  }catch(err){
    try{await storageRemove(path)}catch{}
    throw err;
  }
}
export async function saveCloudFiles(files,toolId='',kind='input'){
  if(!currentUser()||!authToken())return {saved:0,failed:0,skipped:true};
  let saved=0,failed=0;
  for(const file of files||[]){
    try{await uploadCloudBlob(file,file.name,{toolId,kind});saved++}catch{failed++}
  }
  return {saved,failed,skipped:false};
}
export async function saveCloudResults(results,toolId=''){
  if(!currentUser()||!authToken())return {saved:0,failed:0,skipped:true};
  let saved=0,failed=0;
  for(const item of results||[]){
    try{
      const blob=item.data instanceof Blob?item.data:new Blob([item.data],{type:item.type||'application/octet-stream'});
      await uploadCloudBlob(blob,item.name||'BDF-Egypt-result',{toolId,kind:'output'});
      saved++;
    }catch{failed++}
  }
  return {saved,failed,skipped:false};
}
export async function listCloudFiles(){
  ensureAuth();
  const q='select=id,object_path,original_name,kind,tool_id,mime_type,size_bytes,created_at&order=created_at.desc&limit=300';
  const r=await fetch(SUPABASE_URL+'/rest/v1/bdf_files?'+q,{headers:authHeaders()});
  const data=await r.json().catch(()=>[]);
  if(!r.ok)throw Error(data?.message||data?.error||'تعذر قراءة ملفاتك.');
  return Array.isArray(data)?data:[];
}
export async function downloadCloudFile(row){
  ensureAuth();
  const r=await fetch(SUPABASE_URL+'/storage/v1/object/authenticated/'+BUCKET+'/'+encPath(row.object_path),{headers:authHeaders()});
  if(!r.ok)throw Error('تعذر تحميل الملف.');
  const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=row.original_name||'BDF-Egypt-file';document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
}
export async function deleteCloudFile(row){
  ensureAuth();
  await storageRemove(row.object_path);
  const r=await fetch(SUPABASE_URL+'/rest/v1/bdf_files?id=eq.'+encodeURIComponent(row.id),{
    method:'DELETE',
    headers:authHeaders({'Prefer':'return=minimal'})
  });
  if(!r.ok)throw Error('تم حذف الملف من التخزين لكن تعذر تحديث القائمة.');
  return true;
}
export function cloudLimitBytes(){return MAX_FILE;}
