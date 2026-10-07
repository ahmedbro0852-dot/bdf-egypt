const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let plans=[{months:1,price:42},{months:3,price:108},{months:6,price:196},{months:12,price:328}];
let aiPlans=[{files:100,price:300},{files:500,price:1200},{files:1000,price:2000}];
let membership=null,token='',aiPack=null,aiToken='',config={ready:false,whatsapp:'',freeLimits:{files:5,mb:25},proLimits:{files:40,mb:100},monthlyAiCredits:100},show,notify;

export const batchIds=['compress','rotate','watermark','numbers','grayscale','text'];
export function hasPremium(){return !!membership&&membership.expires*1000>Date.now();}
export function membershipToken(){return hasPremium()?token:'';}
export function hasAiPack(){return !!aiPack&&aiPack.kind==='ai_files'&&[10,100,500,1000].includes(Number(aiPack.files))&&(!aiPack.expires||aiPack.expires*1000>Date.now());}
export function aiPackToken(){return hasAiPack()?aiToken:'';}
export function aiPackInfo(){return hasAiPack()?aiPack:null;}
export function hasProAccess(){return hasPremium()||hasAiPack();}
export function usageLimits(){const pro=hasProAccess();const raw=pro?config.proLimits:config.freeLimits;return {files:Number(raw?.files)||(pro?40:5),mb:Number(raw?.mb)||(pro?100:25)};}
export function monthlyAiCredits(){return Number(config.monthlyAiCredits)||100;}

const readStored=k=>{try{return JSON.parse(localStorage.getItem(k))||'';}catch{return '';}};
const saveStored=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{}};
async function request(data,admin){const res=await fetch('/api/subscription',{method:'POST',headers:{'Content-Type':'application/json',...(admin?{Authorization:'Bearer '+admin}:{})},body:JSON.stringify(data)});const result=await res.json();if(!res.ok){const error=Error(result.error||'تعذر إكمال الطلب.');error.status=res.status;throw error;}return result;}

export async function initSubscriptions(modal,toast){
 show=modal;notify=toast;document.querySelector('#pricing').onclick=()=>openPricing();
 const activation=new URLSearchParams(location.hash.slice(1)).get('activate-ai');
 if(activation)history.replaceState({},'',location.pathname+location.search);
 try{
  const response=await fetch('/api/subscription',{cache:'no-store'});
  if(response.ok){
   config=await response.json();
   if(Array.isArray(config.plans)&&config.plans.length)plans=config.plans.map(p=>({months:Number(p.months),price:Number(p.price)})).filter(p=>p.months&&p.price);
   if(Array.isArray(config.aiFilePlans)&&config.aiFilePlans.length)aiPlans=config.aiFilePlans.map(p=>({files:Number(p.files),price:Number(p.price)})).filter(p=>p.files&&p.price);
  }
 }catch{}
 const saved=readStored('bdf:membership');
 if(saved)try{const r=await request({action:'verify',token:saved});token=saved;membership=r.membership;}catch(e){if(e.status===400)saveStored('bdf:membership','');}
 const savedAi=readStored('bdf:ai-pack');
 if(savedAi)try{const r=await request({action:'verify_ai',token:savedAi});aiToken=savedAi;aiPack=r.aiPack;}catch(e){if(e.status===400)saveStored('bdf:ai-pack','');}
 updateBadge();
 if(activation){
  try{
   if(activation.length>8192)throw Error('رابط التفعيل غير صالح.');
   const r=await request({action:'verify_ai',token:activation});
   aiToken=activation;aiPack=r.aiPack;saveStored('bdf:ai-pack',activation);updateBadge();
   notify('تم تفعيل Pro AI برصيد '+aiPack.files+' نقطة.');
  }catch(e){notify(e.message||'تعذر تفعيل الكود.');}
 }
 if(location.pathname==='/pricing')openPricing(false);
 if(location.pathname==='/admin')openAdmin();
}

function updateBadge(){
 const min=plans.length?Math.min(...plans.map(p=>p.price)):42;
 const el=document.querySelector('#pricing');if(!el)return;
 el.textContent=hasAiPack()?('Pro AI · '+aiPack.files+' نقطة'):hasPremium()?'اشتراكي Pro':`الباقات · من ${min} ج`;
}

export function premiumOptions(id){return `<div class="pro-options"><strong>إضافات Pro</strong>${hasProAccess()?`${batchIds.includes(id)?'<label class="batch-toggle"><input type="checkbox" id="batch-mode" name="batchMode"> معالجة عدة ملفات بنفس الإعدادات</label>':''}<div class="preset-actions"><button type="button" class="text-button" id="save-preset">حفظ الإعدادات</button><button type="button" class="text-button" id="load-preset">استعادة الإعدادات</button></div>`:'<p>معالجة بالدفعات وحفظ الإعدادات المفضلة.</p><button type="button" class="text-button" id="show-plans">عرض الباقات</button>'}</div>`;}
export function bindPremium(id,storage,onBatchChange){document.querySelector('#show-plans')?.addEventListener('click',()=>openPricing());document.querySelector('#batch-mode')?.addEventListener('change',onBatchChange);document.querySelector('#save-preset')?.addEventListener('click',()=>{if(!hasProAccess())return notify('لا يوجد اشتراك Pro فعّال.');const values={};document.querySelectorAll('#options input,#options select,#options textarea').forEach(el=>{if(!el.name||el.type==='file'||el.type==='password'||el.name==='batchMode')return;values[el.name]=el.type==='checkbox'?el.checked:el.value;});storage.set('bdf:preset:'+id,values);notify('تم حفظ الإعدادات على جهازك.');});document.querySelector('#load-preset')?.addEventListener('click',()=>{if(!hasProAccess())return notify('لا يوجد اشتراك Pro فعّال.');const values=storage.get('bdf:preset:'+id,null);if(!values)return notify('لسه مفيش إعدادات محفوظة لهذه الأداة.');document.querySelectorAll('#options input,#options select,#options textarea').forEach(el=>{if(Object.hasOwn(values,el.name)){if(el.type==='checkbox')el.checked=values[el.name];else el.value=values[el.name];}});notify('تمت استعادة الإعدادات.');});}

export function openPricing(push=true){
 if(push)history.pushState({},'', '/pricing');
 const freeFiles=Number(config.freeLimits?.files)||5,freeMb=Number(config.freeLimits?.mb)||25;
 const proFiles=Number(config.proLimits?.files)||40,proMb=Number(config.proLimits?.mb)||100;
 const monthly=plans.find(p=>p.months===1)?.price||42;
 const basePerFile=(aiPlans.find(p=>p.files===100)?.price||300)/100;
 show('كل الباقات في مكان واحد',`
 <div class="pricing-hero">
  <div><span class="pricing-eyebrow">BDF EGYPT</span><h3>Pro للأدوات · Pro AI للذكاء الاصطناعي</h3><p>اختار المستوى المناسب: Pro الرخيص يفتح الأدوات المقفولة فقط، وPro AI يضيف أدوات الذكاء الاصطناعي ويبدأ من 300ج.</p></div>
  <div class="pro-highlight"><strong>300ج</strong><span>بداية Pro AI</span></div>
 </div>

 <div class="tier-summary">
  <article class="tier-card free-tier"><span class="tier-kicker">FREE</span><h3>مجاني</h3><p>للأدوات الأساسية.</p><ul><li>حتى ${freeFiles} ملفات في العملية</li><li>حتى ${freeMb} MB إجماليًا</li><li>الأدوات المجانية فقط</li></ul><div class="tier-price"><strong>0 ج</strong><span>دائمًا</span></div></article>
  <article class="tier-card pro-tier"><span class="tier-kicker">PRO</span><h3>Pro بدون AI</h3><p>يفتح الأدوات المقفولة والحدود الأعلى فقط.</p><ul><li>كل أدوات Pro غير المعتمدة على AI</li><li>حتى ${proFiles} ملفًا في العملية</li><li>حتى ${proMb} MB إجماليًا</li><li><strong>لا يشمل أي ذكاء اصطناعي</strong></li></ul><div class="tier-price"><strong>من ${Math.min(...plans.map(p=>p.price))} ج</strong><span>حسب المدة</span></div></article>
 </div>

 <h3 class="pricing-section-title">باقات Pro بدون ذكاء اصطناعي</h3>
 <p class="pricing-note">دي الباقات الرخيصة: تفتح الأدوات المقفولة والتحويلات والحدود الأعلى، لكن التلخيص والترجمة والتعبئة الذكية غير مشمولة.</p>
 <div class="plan-grid">${plans.map(p=>{const regular=monthly*p.months,saving=Math.max(0,regular-p.price);return `<article class="plan-card ${p.months===12?'recommended':''}">${p.months===12?'<span class="best-value">أفضل قيمة</span>':''}<span class="plan-duration">${p.months===1?'شهر واحد':p.months+' شهور'}</span><h3>${p.price}<small>جنيه</small></h3><p>Pro بدون AI · ${(p.price/p.months).toFixed(2)} ج / شهر تقريبًا</p>${saving?`<strong class="plan-saving">وفر ${saving} ج</strong>`:'<span class="plan-saving neutral">مرونة شهرية</span>'}<button class="primary" data-plan="${p.months}">اشترك Pro</button><small>يفتح الأدوات المقفولة فقط · بدون AI</small></article>`;}).join('')}</div>

 ${hasPremium()?`<div class="membership-status"><strong>Pro بدون AI مفعّل</strong><span>حتى ${new Date(membership.expires*1000).toLocaleDateString('ar-EG')}</span><button id="deactivate" class="text-button">إزالة الكود من الجهاز</button></div>`:''}
 <form id="activate-form" class="activation-form"><label for="activation-code">عندك كود Pro؟</label><textarea id="activation-code" required placeholder="الصق كود Pro هنا" dir="ltr" autocomplete="off"></textarea><button class="primary" type="submit">تفعيل Pro</button><p id="activation-message" role="status"></p></form>

 <h3 class="pricing-section-title">Pro AI — يبدأ من 300ج</h3>
 <p class="pricing-note"><strong>Pro AI يشمل كل مزايا Pro العادي + أدوات الذكاء الاصطناعي.</strong> كل نقطة = عملية AI على ملف واحد. باقة 100 ملف = 300ج يعني 3ج للملف شامل الاستخراج والمطابقة والتعبئة والتنسيق والمعاينة والتنزيل.</p>
 <div class="plan-grid">${aiPlans.map(p=>{const per=(p.price/p.files).toFixed(2).replace('.00','');const normal=Math.round(p.files*basePerFile);const saving=Math.max(0,normal-p.price);return `<article class="plan-card ${p.files===500?'recommended':''}">${p.files===100?'<span class="best-value">بداية Pro AI</span>':p.files===500?'<span class="best-value">الأكثر طلبًا</span>':'<span class="best-value">أفضل توفير</span>'}<span class="plan-duration">Pro AI · ${p.files} ملف</span><h3>${p.price}<small>جنيه</small></h3><p>${per} ج / ملف شامل المزايا</p>${saving?`<strong class="plan-saving">وفر ${saving} ج</strong>`:'<span class="plan-saving neutral">باقة البداية</span>'}<button class="primary" data-ai-files="${p.files}">اشترك Pro AI</button><small>كل أدوات Pro + أدوات AI · 1 نقطة = عملية ملف</small></article>`;}).join('')}</div>

 ${hasAiPack()?`<div class="membership-status"><strong>Pro AI مفعّل</strong><span>الباقة الأصلية: ${aiPack.files} نقطة</span><button id="deactivate-ai" class="text-button">إزالة الكود من الجهاز</button></div>`:''}
 <form id="activate-ai-form" class="activation-form"><label for="ai-activation-code">عندك كود Pro AI؟</label><textarea id="ai-activation-code" required placeholder="الصق كود Pro AI هنا" dir="ltr" autocomplete="off"></textarea><button class="primary" type="submit">تفعيل Pro AI</button><p id="ai-activation-message" role="status"></p></form>`);

 document.querySelectorAll('[data-plan]').forEach(el=>el.onclick=()=>checkout(plans.find(p=>p.months===Number(el.dataset.plan))));
 document.querySelectorAll('[data-ai-files]').forEach(el=>el.onclick=()=>checkoutAi(aiPlans.find(p=>p.files===Number(el.dataset.aiFiles))));
 document.querySelector('#deactivate')?.addEventListener('click',()=>{token='';membership=null;saveStored('bdf:membership','');updateBadge();openPricing(false);});
 document.querySelector('#deactivate-ai')?.addEventListener('click',()=>{aiToken='';aiPack=null;saveStored('bdf:ai-pack','');updateBadge();openPricing(false);});
 document.querySelector('#activate-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter,m=document.querySelector('#activation-message');b.disabled=true;try{const v=document.querySelector('#activation-code').value.trim(),r=await request({action:'verify',token:v});membership=r.membership;token=v;saveStored('bdf:membership',v);updateBadge();m.textContent='تم تفعيل Pro بدون AI بنجاح.';}catch(err){m.textContent=err.message;}finally{b.disabled=false;}};
 document.querySelector('#activate-ai-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter,m=document.querySelector('#ai-activation-message');b.disabled=true;try{const v=document.querySelector('#ai-activation-code').value.trim(),r=await request({action:'verify_ai',token:v});aiPack=r.aiPack;aiToken=v;saveStored('bdf:ai-pack',v);updateBadge();m.textContent='تم تفعيل Pro AI برصيد '+aiPack.files+' نقطة.';}catch(err){m.textContent=err.message;}finally{b.disabled=false;}};
 document.querySelector('.info-modal')?.classList.add('pricing-modal');
}

function checkout(plan){
 const message=`طلب اشتراك BDF Egypt Pro بدون AI\nالمدة: ${plan.months} شهر\nالسعر: ${plan.price} جنيه مصري\nأرجو إرسال طريقة الدفع وتأكيد التفعيل بعد الاستلام.`;
 showOrder('طلب الاشتراك',message,`باقة ${plan.months} شهر — <strong>${plan.price} جنيه</strong>`);
}
function checkoutAi(plan){
 const per=(plan.price/plan.files).toFixed(2).replace('.00','');
 const message=`طلب اشتراك BDF Egypt Pro AI\nعدد الملفات: ${plan.files} ملف\nعدد النقاط: ${plan.files} نقطة\nالسعر: ${plan.price} جنيه مصري\nمتوسط الملف: ${per} جنيه\nأرجو تأكيد الدفع وإرسال كود رصيد الملفات.`;
 showOrder('طلب Pro AI',message,`${plan.files} ملف AI — <strong>${plan.price} جنيه</strong>`);
}
function showOrder(title,message,summary){
 show(title,`<p>${summary}</p><p>هذا طلب فقط؛ الموقع لا يخصم أي مبلغ. بعد تأكيد الدفع يدويًا تستلم كود التفعيل.</p>${config.ready&&config.whatsapp?`<a class="primary" target="_blank" rel="noopener noreferrer" href="https://wa.me/${config.whatsapp}?text=${encodeURIComponent(message)}">فتح الطلب على واتساب</a>`:'<p class="notice">استقبال الطلبات لم يُفتح بعد.</p>'}<label for="order-text">تفاصيل الطلب</label><textarea id="order-text" readonly rows="7">${escape(message)}</textarea><button class="text-button" id="copy-order">نسخ الطلب</button><button class="text-button" id="back-plans">العودة للباقات</button>`);
 document.querySelector('#copy-order').onclick=async()=>{try{await navigator.clipboard.writeText(message);notify('تم نسخ الطلب.');}catch{document.querySelector('#order-text').select();notify('حدّدنا النص؛ انسخه من جهازك.');}};
 document.querySelector('#back-plans').onclick=()=>openPricing(false);
}

export function openAdmin(){
 show('إدارة الاشتراكات والرصيد',`
 <p>إصدار الأكواد يتم فقط بعد مراجعة الدفع يدويًا.</p>
 <form id="issue-ai-form" class="activation-form">
  <h3>إصدار كود Pro AI</h3>
  <label for="ai-admin-secret">مفتاح الإدارة</label><input id="ai-admin-secret" type="password" required autocomplete="off">
  <label for="ai-admin-plan">الباقة</label><select id="ai-admin-plan">${aiPlans.map(p=>`<option value="${p.files}">${p.files} ملف — ${p.price} ج</option>`).join('')}</select>
  <label for="ai-payment-ref">مرجع الدفع</label><input id="ai-payment-ref" minlength="3" maxlength="100" required>
  <label for="ai-amount-paid">المبلغ المستلم</label><input id="ai-amount-paid" type="number" min="1" required>
  <label class="batch-toggle"><input type="checkbox" id="ai-confirmed-payment" required> راجعت واستلمت المبلغ</label>
  <button type="submit" class="primary">إصدار كود Pro AI</button><p id="ai-issue-message"></p>
  <textarea id="ai-issued-code" readonly hidden dir="ltr"></textarea><button type="button" id="ai-copy-code" class="text-button" hidden>نسخ الكود</button>
 </form>
 <form id="issue-form" class="activation-form">
  <h3>إصدار كود Pro</h3>
  <label for="admin-secret">مفتاح الإدارة</label><input id="admin-secret" type="password" required autocomplete="off">
  <label for="admin-plan">الباقة</label><select id="admin-plan">${plans.map(p=>`<option value="${p.months}">${p.months} شهر — ${p.price} ج</option>`).join('')}</select>
  <label for="payment-ref">مرجع الدفع</label><input id="payment-ref" minlength="3" maxlength="100" required>
  <label for="amount-paid">المبلغ المستلم</label><input id="amount-paid" type="number" min="1" required>
  <label class="batch-toggle"><input type="checkbox" id="confirmed-payment" required> راجعت واستلمت المبلغ</label>
  <button type="submit" class="primary">إصدار كود Pro</button><p id="issue-message"></p>
  <textarea id="issued-code" readonly hidden dir="ltr"></textarea><button type="button" id="copy-code" class="text-button" hidden>نسخ الكود</button>
 </form>`);

 document.querySelector('#issue-ai-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter,m=document.querySelector('#ai-issue-message');b.disabled=true;document.querySelector('#ai-issued-code').hidden=true;document.querySelector('#ai-copy-code').hidden=true;try{const r=await request({action:'issue_ai',files:Number(document.querySelector('#ai-admin-plan').value),paid:Number(document.querySelector('#ai-amount-paid').value),reference:document.querySelector('#ai-payment-ref').value,confirmed:document.querySelector('#ai-confirmed-payment').checked},document.querySelector('#ai-admin-secret').value);document.querySelector('#ai-issued-code').value=r.token;document.querySelector('#ai-issued-code').hidden=false;document.querySelector('#ai-copy-code').hidden=false;m.textContent='صدر كود '+r.aiPack.files+' ملف AI.';}catch(err){m.textContent=err.message;}finally{b.disabled=false;}};
 document.querySelector('#ai-copy-code').onclick=async()=>{try{await navigator.clipboard.writeText(document.querySelector('#ai-issued-code').value);notify('تم نسخ كود AI.');}catch{document.querySelector('#ai-issued-code').select();}};

 document.querySelector('#issue-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter,m=document.querySelector('#issue-message');b.disabled=true;document.querySelector('#issued-code').hidden=true;document.querySelector('#copy-code').hidden=true;try{const r=await request({action:'issue',months:Number(document.querySelector('#admin-plan').value),paid:Number(document.querySelector('#amount-paid').value),reference:document.querySelector('#payment-ref').value,confirmed:document.querySelector('#confirmed-payment').checked},document.querySelector('#admin-secret').value);document.querySelector('#issued-code').value=r.token;document.querySelector('#issued-code').hidden=false;document.querySelector('#copy-code').hidden=false;m.textContent='صدر الكود؛ ينتهي في '+new Date(r.membership.expires*1000).toLocaleDateString('ar-EG');}catch(err){m.textContent=err.message;}finally{b.disabled=false;}};
 document.querySelector('#copy-code').onclick=async()=>{try{await navigator.clipboard.writeText(document.querySelector('#issued-code').value);notify('تم نسخ الكود.');}catch{document.querySelector('#issued-code').select();}};
}
