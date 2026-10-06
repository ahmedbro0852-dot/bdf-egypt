import './style.css';
import {createIcons,icons} from 'lucide';
import {tools,categories} from './catalog.js';
import {loadPdf} from './engine.js';
import {initSubscriptions,hasPremium,membershipToken,premiumOptions,bindPremium,batchIds,openPricing,openAdmin,usageLimits} from './subscription.js';
import {initAuth,currentUser,signIn,signUp,signInGoogle,signOut,googleEnabled,sendPasswordReset} from './auth.js';
import {openAutofill} from './autofill.js';
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=name=>`<i data-lucide="${name.replace(/([a-z0-9])([A-Z])/g,'$1-$2').toLowerCase()}"></i>`;
const refreshIcons=()=>createIcons({icons});
const storage={get(k,f){try{return JSON.parse(localStorage.getItem(k))??f;}catch{return f;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}};
let category='all',query='',favorites=storage.get('bdf:favorites',[]),recent=storage.get('bdf:recent',[]),files=[],active=null,busy=false,signatureDirty=false,session=0,urls=[],specialCleanup=null;
if(storage.get('bdf:dark',false))document.documentElement.classList.add('dark');
const navIcons=['Grid2X2','Layers','ArrowLeftRight','Pencil','Minimize2','ShieldCheck','Sparkles'];
$('#app').innerHTML=`<header class="header"><a class="brand" href="/" aria-label="BDF Egypt الرئيسية"><img class="brand-logo" src="/logo.svg" alt="" aria-hidden="true"><span dir="ltr">BDF<span>EGYPT</span></span></a><div class="header-actions"><button class="account-button" id="account">${icon('UserRound')}<span>تسجيل الدخول</span></button><button class="pricing-button" id="pricing">الباقات · من ٤٢ ج</button><button class="icon-btn" id="theme" aria-label="تغيير الوضع الفاتح والداكن">${icon('Moon')}</button><button class="icon-btn mobile-menu" id="menu" aria-label="عرض الأقسام">${icon('Menu')}</button></div></header>
<div class="layout"><aside class="sidebar" id="sidebar"><span class="nav-label">كل أدوات PDF</span><nav>${categories.map(([id,label],i)=>`<button data-cat="${id}" class="nav-item ${i===0?'selected':''}">${icon(navIcons[i])}<span>${label}</span>${i===0?`<span class="count">${tools.length}</span>`:''}</button>`).join('')}<button data-cat="favorites" class="nav-item">${icon('Star')}<span>أدواتي المفضلة</span></button></nav><div class="sidebar-bottom"><div class="local-mark">${icon('ShieldCheck')}<strong>ملفاتك تحت سيطرتك</strong></div><p>معظم الأدوات تعمل على جهازك. الحماية وفتح الملفات تستخدم معالجة مؤقتة على الخادم.</p><button class="text-button" id="privacy">تفاصيل الخصوصية</button><div class="sidebar-footer" dir="ltr">MADE FOR YOUR EVERYDAY FILES</div></div></aside>
<main><section class="intro"><div><h1>كل أدوات PDF اللي تحتاجها</h1><p>دمج، تقسيم، ضغط، تحويل وتعديل الملفات بسهولة.</p></div></section>
<section class="tool-section"><div class="section-top"><div><h2 id="section-title">كل أدوات PDF <span>${tools.length}</span></h2><p id="section-desc">اختار الأداة اللي محتاجها وابدأ فورًا.</p></div><div class="search">${icon('Search')}<input id="search" placeholder="بتدور على أداة إيه؟" aria-label="ابحث عن أداة"><kbd>/</kbd></div></div><div class="mobile-categories">${categories.map(([id,label])=>`<button data-cat="${id}" class="chip ${id==='all'?'selected':''}">${label}</button>`).join('')}</div><div class="tools-grid" id="tools-grid"></div></section>
<section class="recent-section" id="recent-section"></section><footer class="main-footer"><span dir="ltr">© ${new Date().getFullYear()} BDF EGYPT</span><span>أدوات واضحة. شغل أسرع.</span><button class="text-button" id="help">مساعدة</button></footer></main></div><div id="modal-root"></div><div class="toast" id="toast" role="status"></div>`;
function serviceLogo(t){
  const labels={
    'pdf-word':'DOCX','word-pdf':'DOCX','pdf-excel':'XLSX','excel-pdf':'XLSX',
    'pdf-ppt':'PPTX','ppt-pdf':'PPTX','pdf-images':'JPG','images-pdf':'JPG',
    'scan':'SCAN','image-tools':'IMG','ocr':'OCR','searchable':'OCR',
    'summarize':'AI','translate':'AI','autofill':'AI','html-pdf':'HTML','text':'TXT'
  };
  const label=labels[t.id]||'PDF';
  return `<span class="service-logo service-logo-${label.toLowerCase()}"><strong>${label}</strong><span>${icon(t.icon)}</span></span>`;
}
function card(t){const badge=proIds.includes(t.id)?'<span class="tool-badge pro-access">PRO</span>':'<span class="tool-badge free-access">مجاني</span>';return `<article class="tool-card">${badge}<a href="/tools/${t.id}" data-tool="${t.id}">${serviceLogo(t)}<h3>${t.title}</h3><p>${t.description}</p><span class="card-bottom">${proIds.includes(t.id)?(serviceAdvancedIds.includes(t.id)?'Pro · خدمة متقدمة':'ضمن Pro'):'مجاني'}<span class="mini-dot ${t.color}"></span></span></a><button class="favorite ${favorites.includes(t.id)?'on':''}" data-favorite="${t.id}" aria-label="${favorites.includes(t.id)?'إزالة':'إضافة'} ${t.title} ${favorites.includes(t.id)?'من':'إلى'} المفضلة" aria-pressed="${favorites.includes(t.id)}">${icon('Star')}</button></article>`;}
function renderGrid(){const filtered=tools.filter(t=>(category==='all'||category==='favorites'&&favorites.includes(t.id)||t.category===category)&&[t.title,t.description,t.id].join(' ').toLowerCase().includes(query.toLowerCase()));$('#tools-grid').innerHTML=filtered.length?filtered.map(card).join(''):`<div class="empty-search">${icon(category==='favorites'?'Star':'Search')}<h3>${category==='favorites'&&!query?'لسه مفيش أدوات مفضلة':'مفيش نتائج مطابقة'}</h3><p>${category==='favorites'?'اضغط النجمة على أي أداة عشان تلاقيها هنا.':'جرّب اسمًا تاني أو اعرض كل الأدوات.'}</p></div>`;$('#section-title').innerHTML=`${category==='favorites'?'أدواتي المفضلة':categories.find(c=>c[0]===category)?.[1]||'كل الأدوات'} <span>${filtered.length}</span>`;refreshIcons();}
function renderRecent(){$('#recent-section').innerHTML=recent.length?`<h2>استخدمتها مؤخرًا</h2><div class="recent-tools">${recent.map(id=>tools.find(t=>t.id===id)).filter(Boolean).map(t=>`<button class="recent-chip" data-tool="${t.id}">${icon(t.icon)}${t.title}</button>`).join('')}<button class="text-button" id="clear-recent">مسح السجل</button></div>`:'';refreshIcons();}
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('visible');setTimeout(()=>$('#toast').classList.remove('visible'),3500);}
function setCategory(id){category=id;document.querySelectorAll('[data-cat]').forEach(b=>b.classList.toggle('selected',b.dataset.cat===id));$('#sidebar').classList.remove('open');renderGrid();}
const accept={pdf:'.pdf',docx:'.docx',pptx:'.pptx',excel:'.xlsx,.xls,.csv',image:'image/jpeg,image/png,image/webp',ocr:'.pdf,image/jpeg,image/png,image/webp',html:'.html,.htm,.txt'};
const proIds=[
  'compress',
  'pdf-word','word-pdf','pdf-excel','excel-pdf','pdf-ppt','ppt-pdf',
  'protect','unlock',
  'ocr','pdfa','searchable','summarize','translate','autofill',
  'compare','image-tools','workflow'
];
const serviceAdvancedIds=['pdfa','searchable','summarize','translate','autofill'];
let capabilities={conversion:false,ai:false};
fetch('/api/advanced').then(r=>r.ok?r.json():{}).then(data=>capabilities=data).catch(()=>{});
const multipleIds=['merge','images-pdf','scan','workflow','compare','ocr','image-tools'];
const field=(name,label,value='',type='text',extra='')=>`<label class="field">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const select=(name,label,values)=>`<label class="field">${label}<select name="${name}">${values.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label>`;
const rangeField=()=>field('pages','الصفحات أو الترتيب','','text','dir="ltr" placeholder="1,3,5-8"')+'<p class="field-hint">اتركه فارغًا لكل الصفحات. استخدم فاصلة بين الأرقام.</p>';
function options(t){switch(t.id){
case 'pdfa':case 'searchable':return '<p class="notice">هذه الأداة تحتاج خادم التحويل المتقدم. عند تفعيله يتم إرسال الملف للمعالجة المؤقتة. خدمة PDF/A تنشئ PDF/A-2b، وOCR يضيف طبقة نص قابلة للبحث.</p>';
case 'summarize':return '<p class="notice">يتطلب تفعيل مزود الذكاء الاصطناعي. يتم إرسال النص المستخرج للمزود. الملخص قد يتضمن أخطاء ويحتاج مراجعة.</p>';
case 'translate':return select('language','لغة الترجمة',[['Arabic','العربية'],['English','الإنجليزية'],['French','الفرنسية'],['German','الألمانية']])+'<p class="notice">يتطلب تفعيل مزود الذكاء الاصطناعي. الترجمة للنص المستخرج فقط، وتنزل في ملف TXT دون تنسيق PDF الأصلي.</p>';

case 'split':return select('mode','طريقة التقسيم',[['each','كل صفحة في ملف داخل ZIP'],['range','الصفحات المختارة في ملف واحد']])+rangeField();
case 'extract':case 'organize':case 'remove':return rangeField()+(t.id==='organize'?'<p class="field-hint">اكتب الترتيب المطلوب مثل 3,1,2. تكرار الرقم يكرّر الصفحة.</p>':'');
case 'rotate':return select('rotation','زاوية الدوران',[['90','90° مع عقارب الساعة'],['180','180°'],['270','90° عكس عقارب الساعة']])+rangeField();
case 'compress':return select('quality','جودة الصور',[['.75','متوسطة · حجم أقل'],['.92','عالية · تفاصيل أكثر'],['.45','منخفضة · حجم أصغر']])+select('scale','دقة الصفحات',[['1.25','متوسطة'],['2','عالية'],['1','صغيرة']])+'<p class="notice">الضغط يحوّل الصفحات إلى صور؛ البحث والنسخ والروابط لن تبقى. بعض الملفات الصغيرة قد يزيد حجمها.</p>';
case 'grayscale':return '<p class="notice">يتم تحويل الصفحات إلى صور رمادية. النص لن يبقى قابلًا للتحديد.</p>';
case 'word-pdf':case 'ppt-pdf':case 'excel-pdf':return '<p class="notice">التحويل يعيد تنسيق النصوص والصور، وقد تختلف الجداول والخطوط وتوزيع الصفحات عن الأصل. ملفات Office القديمة غير مدعومة، ما عدا XLS.</p>';
case 'pdf-word':return '<p class="notice">يستخرج النصوص في فقرات قابلة للتعديل. الصور والتنسيق الأصلي والجداول لا تُحفظ. للملفات المصوّرة استخدم OCR.</p>';
case 'pdf-excel':return '<p class="notice">يستخرج كل سطر نصي في صف؛ لا يعيد بناء الجداول تلقائيًا. للملفات المصوّرة استخدم OCR.</p>';
case 'pdf-ppt':return '<p class="notice">كل صفحة تصبح صورة داخل شريحة. النصوص داخل الشريحة لا تكون قابلة للتعديل.</p>';
case 'pdf-images':return select('format','صيغة الصور',[['jpg','JPG'],['png','PNG']])+select('scale','الدقة',[['1.5','متوسطة'],['2','عالية'],['3','عالية جدًا']]);
case 'images-pdf':case 'scan':return select('orientation','اتجاه الصفحة',[['portrait','رأسي A4'],['landscape','أفقي A4']])+field('margin','هامش الصفحة بالنقاط',20,'number','min="0" max="100"')+(t.id==='scan'?'<button type="button" id="camera" class="secondary">'+icon('Camera')+'التقاط صورة</button><input id="camera-input" type="file" accept="image/*" capture="environment" hidden>':'');
case 'watermark':return field('text','نص العلامة المائية','BDF Egypt')+select('opacity','وضوح العلامة',[['.25','خفيف 25%'],['.5','متوسط 50%'],['.8','واضح 80%']]);
case 'numbers':return select('position','مكان الأرقام',[['bottom','أسفل المنتصف'],['top','أعلى المنتصف']])+field('start','ابدأ الترقيم من',1,'number','min="1" max="99999"');
case 'crop':return field('margin','قص من كل حافة · بالنقاط',20,'number','min="0" max="250"')+'<p class="notice">القص يخفي الهوامش من العرض، ولا يحذف محتواها بشكل آمن. للمعلومات الحساسة استخدم الحجب.</p>';
case 'edit':return field('text','النص المراد إضافته','','text','placeholder="اكتب ملاحظتك هنا"')+field('color','لون النص','#111111','color')+'<label class="field">أو أضف صورة<input name="overlay" type="file" accept="image/png,image/jpeg,image/webp"></label>'+placement();
case 'sign':return '<label class="field">ارسم توقيعك<canvas id="signature" width="600" height="200" aria-label="مساحة رسم التوقيع"></canvas></label><button type="button" id="clear-signature" class="text-button">مسح التوقيع</button>'+placement()+'<p class="field-hint">توقيع مرسوم، وليس توقيعًا رقميًا معتمدًا بشهادة.</p>';
case 'redact':return field('page','رقم الصفحة',1,'number','min="1"')+field('x','بداية المنطقة من اليسار %',10,'number','min="0" max="99"')+field('y','بداية المنطقة من الأعلى %',10,'number','min="0" max="99"')+field('width','عرض المنطقة %',50,'number','min="1" max="100"')+field('height','ارتفاع المنطقة %',10,'number','min="1" max="100"')+'<p class="notice">يتحوّل المستند كله إلى صور. المنطقة المحددة تُحذف من محتوى الناتج. راجع الناتج قبل مشاركته.</p>';
case 'protect':case 'unlock':return field('password',t.id==='protect'?'كلمة المرور الجديدة':'كلمة مرور المستند','','password','autocomplete="new-password"')+'<p class="notice">تُرسل نسخة الملف وكلمة المرور عبر HTTPS لمعالجتها مؤقتًا على الخادم. لا نخزن الملف. الحد 2.8 MB.</p>';
case 'ocr':return select('language','لغة المستند',[['ara+eng','العربية والإنجليزية'],['ara','العربية'],['eng','الإنجليزية']])+'<p class="notice">يتم تنزيل محرك التعرف وبيانات اللغة أول مرة. المعالجة على جهازك وقد تستغرق عدة دقائق. راجع النص الناتج.</p>';
case 'text':return select('format','صيغة النص',[['txt','TXT · نص عادي'],['md','Markdown · عناوين الصفحات']]);
case 'html-pdf':return '<label class="field">النص أو HTML<textarea name="html" rows="10" placeholder="اكتب النص هنا أو اختر ملف HTML أو TXT..."></textarea></label><p class="field-hint">الصور المضمنة فقط مدعومة. لا يحوّل روابط مواقع الإنترنت.</p>';
case 'blank':return field('count','عدد الصفحات',1,'number','min="1" max="200"');
case 'metadata':return field('title','العنوان')+field('author','المؤلف')+field('subject','الموضوع')+field('keywords','كلمات مفتاحية تفصلها فاصلة');
case 'forms':return '<div id="form-fields"><p class="field-hint">اختر الملف لعرض حقول النموذج الموجودة.</p></div><p class="notice">دعم الحقول يعتمد على نوع النموذج. حقول النص بالخط الافتراضي تدعم الإنجليزية؛ لإضافة العربية استخدم أداة إضافة النص.</p>';
case 'flatten':return '<p class="notice">تثبيت الحقول يمنع تعديلها كحقول نموذج. احتفظ بنسخة من الأصل.</p>';
case 'repair':return '<p class="notice">يعيد حفظ الملفات القابلة للقراءة. لا يضمن استعادة ملف شديد التلف أو بيانات مفقودة.</p>';
case 'compare':return '<p class="notice">مقارنة النصوص فقط، ولا تكشف اختلاف الصور أو التصميم. الناتج تقرير نصي.</p>';
case 'image-tools':return select('format','الصيغة',[['jpg','JPG'],['png','PNG'],['webp','WebP']])+field('maxWidth','أقصى عرض بالبكسل',1600,'number','min="100" max="8000"')+select('quality','الجودة',[['.85','عالية 85%'],['.6','متوسطة 60%'],['.4','صغيرة 40%']]);
case 'workflow':return select('rotation','التدوير بعد الدمج',[['0','بدون تدوير'],['90','90°'],['180','180°'],['270','270°']])+select('numbering','إضافة أرقام الصفحات',[['yes','نعم'],['no','لا']]);
default:return '<p class="field-hint">اختر الملفات واضبط ترتيبها من القائمة، ثم ابدأ.</p>';}}
function placement(){return field('page','رقم الصفحة',1,'number','min="1"')+field('x','المسافة من اليسار %',10,'number','min="0" max="90"')+field('y','المسافة من الأعلى %',75,'number','min="0" max="90"')+field('width','العرض من الصفحة %',40,'number','min="5" max="90"');}
function closeModal(){if(busy){toast('انتظر انتهاء العملية قبل إغلاق الأداة.');return;}session++;if(specialCleanup){try{specialCleanup();}catch{}specialCleanup=null;}$('#modal-root').innerHTML='';document.body.classList.remove('modal-open');active=null;files=[];urls.forEach(URL.revokeObjectURL);urls=[];if(location.pathname!=='/')history.pushState({},'', '/');}
function openTool(id,push=true){const t=tools.find(x=>x.id===id);if(!t)return;if(busy)return;if(t.id==='autofill'){session++;files=[];active=t;signatureDirty=false;urls.forEach(URL.revokeObjectURL);urls=[];if(specialCleanup){try{specialCleanup();}catch{}specialCleanup=null;}if(push)history.pushState({},'', '/tools/'+id);recent=[id,...recent.filter(x=>x!==id)].slice(0,5);storage.set('bdf:recent',recent);renderRecent();document.body.classList.add('modal-open');specialCleanup=openAutofill({root:$('#modal-root'),icon,refreshIcons,toast,onClose:closeModal});return;}session++;files=[];active=t;signatureDirty=false;urls.forEach(URL.revokeObjectURL);urls=[];if(push)history.pushState({},'', '/tools/'+id);recent=[id,...recent.filter(x=>x!==id)].slice(0,5);storage.set('bdf:recent',recent);renderRecent();document.body.classList.add('modal-open');$('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="workspace" role="dialog" aria-modal="true" aria-labelledby="tool-heading"><header class="workspace-header">${serviceLogo(t)}<div><div class="workspace-title-row"><h2 id="tool-heading">${t.title}</h2><span class="workspace-tier ${proIds.includes(t.id)?'pro':'free'}">${proIds.includes(t.id)?'Pro':'مجاني'}</span></div><p>${t.description}</p></div><button class="icon-btn" id="close-modal" aria-label="إغلاق الأداة">${icon('X')}</button></header><div class="workspace-body"><div class="file-area"><div class="dropzone" id="dropzone"><span class="upload-icon">${icon('Upload')}</span><h3>${t.input==='none'?'أنشئ مستندك الجديد':'اسحب الملفات هنا'}</h3><p>${t.input==='none'?'حدّد عدد الصفحات من الإعدادات':t.input==='html'?'أو اكتب المحتوى في الإعدادات':'أو اختارها من جهازك'}</p>${t.input!=='none'?`<button class="primary" id="pick-files">${icon('Plus')}اختيار ${multipleIds.includes(id)?'الملفات':'ملف'}</button><small>${accept[t.input]?.replaceAll('image/','').replaceAll(',',' · ')||''} · حتى 100 MB إجماليًا</small><input id="file-input" type="file" accept="${accept[t.input]||''}" ${multipleIds.includes(id)?'multiple':''} hidden>`:''}</div><div class="file-list" id="file-list"></div><div class="page-preview" id="page-preview"></div><div class="result" id="result" aria-live="polite"></div><div class="error" id="error" role="alert" hidden></div></div><form class="options" id="options"><h3>${icon('SlidersHorizontal')}الإعدادات</h3>${options(t)}${premiumOptions(id)}<div class="run-area"><button class="primary run-btn" id="run" type="submit">${icon('Zap')}ابدأ ${t.title}</button><div id="progress" hidden><progress max="100" value="0"></progress><p id="progress-label">جارٍ تجهيز الملف...</p></div><p class="local-caption">${icon(['protect','unlock'].includes(id)?'Server':'Laptop')}${['protect','unlock'].includes(id)?'معالجة مؤقتة على الخادم':'المعالجة داخل متصفحك'}</p></div></form></div></section></div>`;refreshIcons();$('#close-modal').onclick=closeModal;$('#options').onsubmit=run;$('#file-input')?.addEventListener('change',e=>addFiles(e.target.files));$('#pick-files')?.addEventListener('click',()=>$('#file-input').click());$('#camera')?.addEventListener('click',()=>$('#camera-input').click());$('#camera-input')?.addEventListener('change',e=>addFiles(e.target.files));const dz=$('#dropzone');dz.ondragover=e=>{e.preventDefault();if(!busy)dz.classList.add('dragover');};dz.ondragleave=()=>dz.classList.remove('dragover');dz.ondrop=e=>{e.preventDefault();dz.classList.remove('dragover');if(t.input!=='none')addFiles(e.dataTransfer.files);};if(id==='sign')setupSignature();if(serviceAdvancedIds.includes(id)&&!capabilities[['summarize','translate'].includes(id)?'ai':'conversion']){$('#run').disabled=true;$('#run').textContent='الخدمة تحتاج تفعيل';}bindPremium(id,storage,()=>{const enabled=hasPremium()&&$('#batch-mode')?.checked;$('#file-input').multiple=!!enabled;if(!enabled&&files.length>1){files=files.slice(0,1);renderFiles();}});$('#close-modal').focus();}
async function addFiles(incoming){if(busy)return;const t=active;if(!t)return;let arr=[...incoming];const patterns={pdf:/\.pdf$/i,docx:/\.docx$/i,pptx:/\.pptx$/i,excel:/\.(xlsx|xls|csv)$/i,image:/\.(png|jpe?g|webp)$/i,ocr:/\.(pdf|png|jpe?g|webp)$/i,html:/\.(html?|txt)$/i};if(arr.some(f=>!patterns[t.input]?.test(f.name))){toast('نوع الملف غير مدعوم في هذه الأداة.');return;}if(arr.some(f=>f.size===0)){toast('الملف فارغ.');return;}const multiple=multipleIds.includes(t.id)||(hasPremium()&&batchIds.includes(t.id)&&$('#batch-mode')?.checked);if(!multiple)arr=arr.slice(0,1);const merged=multiple?[...files,...arr]:arr;const limits=usageLimits();if(merged.length>limits.files||merged.reduce((n,f)=>n+f.size,0)>limits.mb*1024*1024){toast(`حد ${hasPremium()?'Pro':'المجاني'} الحالي: ${limits.files} ملفات و${limits.mb} MB إجماليًا.`);return;}if(t.id==='compare'&&merged.length>2){toast('المقارنة تحتاج ملفين فقط.');return;}files=merged;$('#result').innerHTML='';$('#error').hidden=true;renderFiles();const token=session;$('#page-preview').innerHTML='';if(files[0]?.name.match(/\.pdf$/i)&&!['unlock','protect'].includes(t.id)){try{const {readVisual,renderPage}=await import('./process.js');const doc=await readVisual(files[0]);if(token!==session){await doc.destroy();return;}$('#page-preview').innerHTML=`<div class="preview-heading"><strong>معاينة الصفحة الأولى</strong><span>${doc.numPages} صفحة</span></div><div id="preview-canvas"></div>`;const canvas=await renderPage(doc,0,.65);await doc.destroy();if(token===session)$('#preview-canvas')?.append(canvas);}catch{if(token===session)$('#page-preview').innerHTML='<p class="field-hint">المعاينة غير متاحة. تأكد من صلاحية الملف، أو افتحه بكلمة مروره أولًا.</p>';}}
if(t.id==='forms'){try{const doc=await loadPdf(files[0]);if(token!==session)return;const form=doc.getForm();$('#form-fields').innerHTML=form.getFields().map(f=>{const name='field:'+f.getName();if(f.getText)return field(name,f.getName(),f.getText()||'');if(f.isChecked)return select(name,f.getName(),f.isChecked()?[['yes','محدد'],['no','غير محدد']]:[['no','غير محدد'],['yes','محدد']]);if(f.getOptions)return select(name,f.getName(),f.getOptions().map(x=>[x,x]));return '<p class="field-hint">حقل غير مدعوم: '+esc(f.getName())+'</p>';}).join('')||'<p class="field-hint">لا توجد حقول نموذج قابلة للتعبئة.</p>';}catch(e){if(token===session)$('#form-fields').textContent=e.message;}}
}
function renderFiles(){$('#file-list').innerHTML=files.length?`<div class="list-heading"><strong>${files.length} ${files.length===1?'ملف':'ملفات'}</strong><span>${formatSize(files.reduce((a,b)=>a+b.size,0))}</span></div>`+files.map((f,i)=>`<div class="file-row"><span class="file-symbol">${icon('FileText')}</span><div class="file-info"><strong dir="auto">${esc(f.name)}</strong><small>${formatSize(f.size)}</small></div><div class="file-actions"><button class="icon-btn" data-move="${i}" data-direction="-1" aria-label="نقل الملف للأعلى" ${i===0?'disabled':''}>${icon('ChevronUp')}</button><button class="icon-btn" data-move="${i}" data-direction="1" aria-label="نقل الملف للأسفل" ${i===files.length-1?'disabled':''}>${icon('ChevronDown')}</button><button class="icon-btn" data-remove="${i}" aria-label="حذف ${esc(f.name)}">${icon('X')}</button></div></div>`).join(''):'';refreshIcons();}
function formatSize(n){return n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:`${(n/1048576).toFixed(1)} MB`;}
function setupSignature(){const c=$('#signature'),ctx=c.getContext('2d');ctx.strokeStyle='#17252b';ctx.lineWidth=3;ctx.lineCap='round';let drawing=false;function point(e){const r=c.getBoundingClientRect();return[(e.clientX-r.left)*c.width/r.width,(e.clientY-r.top)*c.height/r.height];}c.onpointerdown=e=>{drawing=true;signatureDirty=true;c.setPointerCapture(e.pointerId);ctx.beginPath();ctx.moveTo(...point(e));};c.onpointermove=e=>{if(drawing){ctx.lineTo(...point(e));ctx.stroke();}};c.onpointerup=c.onpointercancel=()=>drawing=false;$('#clear-signature').onclick=()=>{ctx.clearRect(0,0,c.width,c.height);signatureDirty=false;};}
async function run(e){e.preventDefault();if(busy)return;const form=$('#options');if(!form.reportValidity())return;const o=Object.fromEntries(new FormData(form));if((o.batchMode||proIds.includes(active.id))&&!hasPremium()){toast('هذه الأداة ضمن Pro. افتح الباقات لتفعيلها.');openPricing();return;}if(o.batchMode&&!files.length){toast('أضف ملفًا واحدًا على الأقل.');return;}o.membershipToken=membershipToken();if(o.overlay instanceof File&&!o.overlay.size)delete o.overlay;if(active.id==='redact'&&(Number(o.x)+Number(o.width)>100||Number(o.y)+Number(o.height)>100)){toast('منطقة الحجب لازم تكون داخل حدود الصفحة.');return;}busy=true;$('#error').hidden=true;$('#result').innerHTML='';$('#progress').hidden=false;form.querySelectorAll('input,select,textarea,button').forEach(x=>x.disabled=true);$('#pick-files')?.setAttribute('disabled','');$('#close-modal').disabled=true;const started=performance.now();try{let sig;if(active.id==='sign'&&signatureDirty)sig=await new Promise(r=>$('#signature').toBlob(r,'image/png'));const {execute}=await import('./process.js');const result=[];const batches=o.batchMode&&batchIds.includes(active.id)?files.map(f=>[f]):[files];for(let i=0;i<batches.length;i++){const output=await execute(active.id,batches[i],o,n=>{const percent=Math.round((i+n/100)/batches.length*100);$('progress').value=percent;$('#progress-label').textContent=`جارٍ المعالجة… ${percent}%`;},sig);result.push(...output.map(r=>({...r,name:batches.length>1?(i+1)+'-'+batches[i][0].name.replace(/\.[^.]+$/,'')+'-'+r.name:r.name})));}$('progress').value=100;const total=result.reduce((a,r)=>a+new Blob([r.data]).size,0);const input=files.reduce((a,f)=>a+f.size,0);$('#result').innerHTML=`<div class="success-icon">${icon('Check')}</div><h3>ملفك جاهز!</h3><p>${formatSize(total)} · ${(performance.now()-started)/1000<1?'أقل من ثانية':Math.round((performance.now()-started)/1000)+' ثانية'}${active.id==='compress'&&input?` · ${total<input?'حجم أقل بنسبة '+Math.round((1-total/input)*100)+'%':'الناتج أكبر من الأصل؛ جرّب جودة أقل أو احتفظ بالأصل'}`:''}</p>${result.map((r,i)=>{const url=URL.createObjectURL(new Blob([r.data],{type:r.type}));urls.push(url);return `<a class="primary download" href="${url}" download="${esc(r.name)}">${icon('Download')}تنزيل ${esc(r.name)}</a>`;}).join('')}${result[0].preview?`<details><summary>عرض النص الناتج</summary><pre dir="auto">${esc(result[0].preview)}</pre></details>`:''}<button class="text-button" id="new-task">بدء عملية جديدة</button>`;refreshIcons();$('#new-task').onclick=()=>openTool(active.id,false);$('#result').scrollIntoView({behavior:'smooth',block:'nearest'});}catch(err){$('#error').textContent=err.message||'حصل خطأ أثناء المعالجة. جرّب ملفًا أصغر.';$('#error').hidden=false;}finally{busy=false;form.querySelectorAll('input,select,textarea,button').forEach(x=>x.disabled=false);$('#pick-files')?.removeAttribute('disabled');$('#close-modal').disabled=false;$('#progress').hidden=true;}}
function infoModal(title,content){if(busy)return;document.body.classList.add('modal-open');$('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="info-modal" role="dialog" aria-modal="true" aria-label="${title}"><button id="close-modal" class="icon-btn" aria-label="إغلاق">${icon('X')}</button><h2>${title}</h2>${content}</section></div>`;$('#close-modal').onclick=closeModal;refreshIcons();$('#close-modal').focus();}
function updateAccountButton(){
  const user=currentUser();
  const btn=$('#account');
  if(!btn)return;
  btn.innerHTML=user?`${icon('CircleUserRound')}<span>${esc(user.email||'حسابي')}</span>`:`${icon('UserRound')}<span>تسجيل الدخول</span>`;
  refreshIcons();
}
function openAuthPanel(push=true,authError=''){
  if(push)history.pushState({},'', '/login');
  const user=currentUser();
  if(user){
    infoModal('حسابي',`<div class="account-summary"><span class="account-avatar">${icon('UserRound')}</span><div><strong dir="ltr">${esc(user.email||'')}</strong><p>أنت مسجل الدخول في BDF Egypt.</p></div></div><button class="secondary auth-wide" id="logout-account">${icon('LogOut')}تسجيل الخروج</button>`);
    refreshIcons();
    $('#logout-account').onclick=async()=>{await signOut();updateAccountButton();closeModal();};
    return;
  }
  const googleReady=googleEnabled();
  infoModal('الدخول إلى BDF Egypt',`<div class="auth-shell">
    <div class="auth-tabs" role="tablist">
      <button class="auth-tab active" type="button" data-auth-mode="login">تسجيل الدخول</button>
      <button class="auth-tab" type="button" data-auth-mode="signup">حساب جديد</button>
    </div>
    <button type="button" class="google-button" id="google-login" ${googleReady?'':'disabled'}><span class="google-mark">G</span>${googleReady?'المتابعة باستخدام Google':'Google غير مفعّل حاليًا'}</button>
    <div class="auth-divider"><span>أو بالبريد</span></div>
    <form id="login-form" class="auth-form">
      <label>البريد الإلكتروني<input id="auth-email" type="email" required autocomplete="email" dir="ltr" placeholder="name@example.com"></label>
      <label>كلمة المرور<input id="auth-password" type="password" required minlength="6" autocomplete="current-password" dir="ltr" placeholder="6 أحرف على الأقل"></label>
      <button class="primary auth-wide" id="auth-submit" type="submit">دخول</button>
      <button class="auth-link" type="button" id="forgot-password">نسيت كلمة المرور؟</button>
      <p class="auth-helper" id="auth-helper">لو عندك حساب قديم استخدم نفس البريد وكلمة المرور.</p>
      <p class="auth-message" id="auth-message" role="status">${authError?esc(authError):''}</p>
    </form>
  </div>`);
  let mode='login';
  const setMode=next=>{
    mode=next;
    document.querySelectorAll('[data-auth-mode]').forEach(b=>b.classList.toggle('active',b.dataset.authMode===mode));
    const submit=$('#auth-submit'),pass=$('#auth-password'),forgot=$('#forgot-password'),helper=$('#auth-helper');
    if(mode==='signup'){
      submit.textContent='إنشاء الحساب';
      pass.autocomplete='new-password';
      forgot.hidden=true;
      helper.textContent='اكتب بريدك وكلمة مرور جديدة، والحساب يتعمل في خطوة واحدة.';
    }else{
      submit.textContent='دخول';
      pass.autocomplete='current-password';
      forgot.hidden=false;
      helper.textContent='لو عندك حساب قديم استخدم نفس البريد وكلمة المرور.';
    }
    $('#auth-message').textContent='';
  };
  document.querySelectorAll('[data-auth-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.authMode));
  $('#google-login').onclick=async()=>{const msg=$('#auth-message');try{await signInGoogle();}catch(err){msg.textContent=err.message;}};
  $('#forgot-password').onclick=async()=>{const email=$('#auth-email').value.trim(),msg=$('#auth-message');if(!email){msg.textContent='اكتب بريدك الإلكتروني الأول.';$('#auth-email').focus();return;}msg.textContent='جارٍ إرسال رابط الاستعادة...';try{await sendPasswordReset(email);msg.textContent='تم إرسال رابط استعادة كلمة المرور. راجع بريدك.';}catch(err){msg.textContent=err.message;}};
  $('#login-form').onsubmit=async e=>{
    e.preventDefault();
    const email=$('#auth-email').value.trim(),password=$('#auth-password').value,msg=$('#auth-message'),btn=$('#auth-submit');
    if(!email||password.length<6){msg.textContent='اكتب بريدًا صحيحًا وكلمة مرور 6 أحرف على الأقل.';return;}
    btn.disabled=true;
    msg.textContent=mode==='signup'?'جارٍ إنشاء الحساب...':'جارٍ تسجيل الدخول...';
    try{
      if(mode==='signup'){
        const r=await signUp(email,password);
        if(r.existing&&!r.signedIn){msg.textContent='البريد ده عنده حساب بالفعل، لكن الباسورد مختلف. استخدم الباسورد القديم أو اضغط نسيت كلمة المرور.';setMode('login');$('#auth-password').focus();return;}
      }else{
        await signIn(email,password);
      }
      updateAccountButton();
      openAuthPanel(false);
    }catch(err){msg.textContent=err.message;}
    finally{btn.disabled=false;}
  };
}

document.addEventListener('click',e=>{const tool=e.target.closest('[data-tool]');if(tool){e.preventDefault();openTool(tool.dataset.tool);return;}const cat=e.target.closest('[data-cat]');if(cat)setCategory(cat.dataset.cat);const fav=e.target.closest('[data-favorite]');if(fav){const id=fav.dataset.favorite;favorites=favorites.includes(id)?favorites.filter(x=>x!==id):[...favorites,id];storage.set('bdf:favorites',favorites);renderGrid();}const move=e.target.closest('[data-move]');if(move&&!busy){const i=Number(move.dataset.move),j=i+Number(move.dataset.direction);[files[i],files[j]]=[files[j],files[i]];renderFiles();$('#page-preview').innerHTML='';}const remove=e.target.closest('[data-remove]');if(remove&&!busy){files.splice(Number(remove.dataset.remove),1);renderFiles();$('#page-preview').innerHTML='';if(active?.id==='forms')$('#form-fields').innerHTML='<p class="field-hint">اختر الملف لعرض حقول النموذج.</p>';}if(e.target.closest('#clear-recent')){recent=[];storage.set('bdf:recent',recent);renderRecent();}});
$('#account').onclick=()=>openAuthPanel();$('#theme').onclick=()=>{document.documentElement.classList.toggle('dark');storage.set('bdf:dark',document.documentElement.classList.contains('dark'));};$('#menu').onclick=()=>$('#sidebar').classList.toggle('open');$('#search').oninput=e=>{query=e.target.value;renderGrid();};$('#privacy').onclick=()=>infoModal('الخصوصية ومعالجة الملفات','<p>أدوات الدمج والتقسيم والتحويل والتوقيع والضغط وOCR تعالج الملفات داخل المتصفح، ولا ترسل المستندات إلى خادمنا.</p><p>أداتا الحماية وفتح الملفات ترسلان الملف وكلمة المرور عبر HTTPS إلى خادم Vercel. تُستخدم البيانات في الذاكرة أثناء الطلب ولا تُحفظ في ملفات أو قاعدة بيانات.</p><p>عند استخدام OCR ينزل المتصفح محرك التعرف وبيانات اللغة من ملفات الموقع نفسه. ملفاتك تُعالج محليًا.</p><p>نحفظ أسماء الأدوات المفضلة والمستخدمة مؤخرًا وتفضيل المظهر وكود الاشتراك وإعدادات الأدوات المحفوظة في جهازك فقط. كود الاشتراك يُرسل للخادم للتحقق، ولا نطلب بيانات حساب مستخدم. إغلاق الأداة يمسح روابط التنزيل المؤقتة. أدواتنا لا تتجاوز كلمات المرور المجهولة.</p>');$('#help').onclick=()=>infoModal('مساعدة سريعة','<p>١. اختار الأداة المناسبة، ثم أضف ملفك.</p><p>٢. راجع المعاينة واضبط الخيارات. لترتيب الملفات استخدم زري الأعلى والأسفل.</p><p>٣. اضغط ابدأ، وانتظر ظهور زر تنزيل الناتج.</p><p>النطاقات مثل 1,3,5-8 تعني الصفحات ١ و٣ ومن ٥ إلى ٨. تحويلات Office تقريبية. OCR يعمل على المستندات المصوّرة، بينما استخراج النص يعمل على PDF المكتوب.</p><p>الحد المحلي 100 MB و40 ملفًا. الملفات الكبيرة أو كثيرة الصفحات قد تحتاج ذاكرة أعلى. الحماية وفتح الملفات محدودتان بـ2.8 MB.</p><p>التوقيع المرئي لا يستخدم شهادة رقمية. مقارنة الملفات تعتمد على النص فقط.</p>');
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();if(e.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)&&!active){e.preventDefault();$('#search').focus();}if(e.key==='Tab'&&document.body.classList.contains('modal-open')){const nodes=[...document.querySelectorAll('#modal-root button:not([disabled]),#modal-root input:not([hidden]):not([disabled]),#modal-root select:not([disabled]),#modal-root textarea:not([disabled]),#modal-root a[href]')].filter(n=>n.offsetParent!==null);if(!nodes.length)return;const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});window.addEventListener('popstate',()=>{if(busy){history.pushState({},'', '/tools/'+active.id);return;}if(location.pathname==='/login'){openAuthPanel(false);return;}if(location.pathname==='/pricing'){openPricing(false);return;}if(location.pathname==='/admin'){openAdmin();return;}const id=location.pathname.split('/')[2];if(id)openTool(id,false);else closeModal();});window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue='';}});
renderGrid();renderRecent();const direct=location.pathname.split('/')[2];if(direct)openTool(direct,false);

Promise.all([initSubscriptions(infoModal,toast),initAuth()]).then(([,auth])=>{updateAccountButton();if(location.pathname==='/login')openAuthPanel(false,auth?.error||'');if(active&&hasPremium()&&!files.length)openTool(active.id,false);});
