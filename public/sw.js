const CACHE='bdf-app-v1';
const SHELL=['/','/manifest.webmanifest','/logo.svg','/icon-192.png','/icon-512.png','/icon-180.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('bdf-app-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',e=>{
 const r=e.request,u=new URL(r.url);
 if(r.method!=='GET'||u.origin!==self.location.origin||u.pathname.startsWith('/api/'))return;
 if(r.mode==='navigate'){
  e.respondWith(fetch(r).catch(()=>caches.match('/').then(response=>response||new Response('الاتصال غير متاح. أعد المحاولة عند عودة الإنترنت.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}}))));return;
 }
 if(!u.pathname.startsWith('/assets/')&&!SHELL.includes(u.pathname)||u.search)return;
 e.respondWith(caches.match(r).then(hit=>hit||fetch(r).then(async response=>{
  if(response.ok&&response.type==='basic'){const c=await caches.open(CACHE);await c.put(r,response.clone());const keys=await c.keys();if(keys.length>100)await c.delete(keys.find(k=>new URL(k.url).pathname.startsWith('/assets/'))||keys[0]);}return response;
 })));
});
