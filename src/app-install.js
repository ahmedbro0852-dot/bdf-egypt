export function initAppInstall(show, notify) {
  let prompt;
  const installed=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const button=document.querySelector('#install-app');
  function guide(){
    show('تثبيت تطبيق BDF Egypt', installed()?'<p>التطبيق مفتوح بالفعل في نافذة مستقلة على جهازك.</p>':`<p>افتح BDF من أيقونة مستقلة، مع نفس الأدوات والحساب.</p>${prompt?'<button class="primary-btn" id="confirm-install">تثبيت التطبيق الآن</button>':''}<p><strong>أندرويد:</strong> افتح الرابط في Chrome، ثم من قائمة ⋮ اختار «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».</p><p><strong>الكمبيوتر:</strong> افتح الرابط في Chrome أو Edge، واضغط أيقونة التثبيت بجوار عنوان الموقع أو اختار تثبيت من قائمة المتصفح.</p><p><strong>iPhone وiPad:</strong> افتح الرابط في Safari، واضغط مشاركة، ثم «إضافة إلى الشاشة الرئيسية» و«إضافة».</p><p>الذكاء الاصطناعي والحساب والملفات السحابية تحتاج الإنترنت. بعض الأدوات المحلية قد تعمل دون اتصال بعد فتحها مسبقًا.</p>`);
    const confirm=document.querySelector('#confirm-install');
    if(confirm)confirm.onclick=async()=>{const pending=prompt;prompt=null;confirm.disabled=true;try{await pending.prompt();const choice=await pending.userChoice;notify(choice.outcome==='accepted'?'تم قبول التثبيت.':'يمكنك التثبيت لاحقًا من قائمة المتصفح.');}catch{notify('استخدم قائمة المتصفح لتثبيت التطبيق.');}guide();};
  }
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();prompt=e;});
  window.addEventListener('appinstalled',()=>{prompt=null;notify('تم تثبيت BDF Egypt.');});
  button.onclick=guide;
  if(location.pathname==='/app')guide();
  if('serviceWorker' in navigator)window.addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(()=>{});});
}
