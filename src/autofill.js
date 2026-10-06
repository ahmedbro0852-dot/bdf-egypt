
import './autofill.css';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument } from 'pdf-lib';
import { membershipToken, hasPremium, openPricing } from './subscription.js';

pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
const E=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const N=s=>String(s||'').normalize('NFKC').replace(/[ـ_\s:：\-–—]+/g,' ').trim().toLowerCase();
const X=n=>(n.split('.').pop()||'').toLowerCase();
let objectUrls=[];
const revoke=()=>{objectUrls.forEach(URL.revokeObjectURL);objectUrls=[]};

async function pdfText(file){
  const d=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  const pages=[];
  try{
    for(let i=1;i<=d.numPages;i++){
      const c=await(await d.getPage(i)).getTextContent();
      pages.push((c.items||[]).map(x=>x.str||'').join(' ').replace(/\s+/g,' ').trim());
    }
  }finally{await d.destroy()}
  return pages.map((p,i)=>'[صفحة '+(i+1)+']\n'+p).join('\n\n');
}
async function docxText(file){
  const m=(await import('mammoth')).default||await import('mammoth');
  return String((await m.extractRawText({arrayBuffer:await file.arrayBuffer()})).value||'');
}
async function officeText(file){
  const e=X(file.name);
  if(['xlsx','xls','csv'].includes(e)){
    const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});
    return wb.SheetNames.map(n=>'[ورقة: '+n+']\n'+XLSX.utils.sheet_to_csv(wb.Sheets[n],{blankrows:false})).join('\n\n');
  }
  if(e==='pptx'){
    const z=await JSZip.loadAsync(await file.arrayBuffer());
    const names=Object.keys(z.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).sort();
    const out=[];
    for(const n of names){
      const xml=await z.file(n).async('text');
      out.push([...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m=>m[1]).join(' '));
    }
    return out.join('\n\n');
  }
  return '';
}
async function imageText(file,setStatus){
  const {createWorker}=await import('tesseract.js');
  let worker;
  try{
    worker=await createWorker('ara+eng',1,{workerPath:'/ocr/worker.min.js',corePath:'/ocr/core',langPath:'/ocr/lang',logger:m=>{if(m.status==='recognizing text')setStatus('OCR '+Math.round((m.progress||0)*100)+'%')}});
    return String((await worker.recognize(file)).data.text||'');
  }finally{if(worker)await worker.terminate()}
}
async function readSource(file,setStatus){
  if(file.size>100*1024*1024)throw Error('الحد الحالي 100 MB.');
  const e=X(file.name);
  if(e==='pdf')return pdfText(file);
  if(e==='docx')return docxText(file);
  if(['xlsx','xls','csv','pptx'].includes(e))return officeText(file);
  if(['png','jpg','jpeg','webp'].includes(e))return imageText(file,setStatus);
  if(['txt','md','json'].includes(e))return file.text();
  throw Error('صيغة ملف البيانات غير مدعومة.');
}
async function readTarget(file){
  const e=X(file.name);
  if(e==='docx')return {kind:'docx',text:await docxText(file)};
  if(e==='pdf'){
    const p=await PDFDocument.load(await file.arrayBuffer());
    const fs=p.getForm().getFields();
    if(!fs.length)throw Error('PDF لازم يكون نموذج حقول قابل للتعبئة.');
    return {kind:'pdf',text:fs.map(f=>'حقل: '+f.getName()).join('\n')};
  }
  if(['txt','md'].includes(e))return {kind:'text',text:await file.text()};
  throw Error('النموذج يدعم DOCX أو PDF Form أو TXT/MD.');
}
async function askAI(source,target){
  if(!hasPremium()){
    openPricing();
    throw Error('الأداة ضمن Pro لأنها تستخدم الذكاء الاصطناعي.');
  }
  const r=await fetch('/api/advanced',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+membershipToken()},body:JSON.stringify({action:'autofill',sourceText:source.slice(0,80000),targetText:target.slice(0,40000)})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(d.error||'تعذر تحليل الملفين.');
  return d;
}
function verify(fields,source){
  const ns=N(source);
  return (fields||[]).map(f=>{
    const value=String(f.value||'').trim();
    const quote=String(f.source_hint||'').trim();
    const present=!value||ns.includes(N(value))||(quote&&ns.includes(N(quote)));
    const confidence=Math.max(0,Math.min(1,Number(f.confidence||0)));
    return {label:String(f.label||'').trim(),anchor:String(f.anchor||f.label||'').trim(),value:value,source_hint:quote,confidence:present?confidence:Math.min(confidence,.49),verified:present,enabled:Boolean(value)&&present&&confidence>=.55};
  }).filter(f=>f.label);
}
const xEsc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const xDec=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
const visible=xml=>xDec((xml.match(/<w:t[^>]*>[\s\S]*?<\/w:t>/g)||[]).map(x=>x.replace(/<w:t[^>]*>/,'').replace(/<\/w:t>/,'')).join(' ')).replace(/\s+/g,' ').trim();
const rPr=xml=>(xml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)||[])[0]||'';
const pPr=xml=>(xml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)||[])[0]||'';
const cleanPr=pr=>pr.replace(/<w:b(?:\s*\/>|>[\s\S]*?<\/w:b>)/g,'').replace(/<w:bCs(?:\s*\/>|>[\s\S]*?<\/w:bCs>)/g,'');
function styleMeta(pr){
  const s=(pr.match(/<w:sz[^>]*w:val="([^"]+)"/)||[])[1],c=(pr.match(/<w:color[^>]*w:val="([^"]+)"/)||[])[1],f=(pr.match(/<w:rFonts[^>]*(?:w:ascii|w:cs|w:hAnsi)="([^"]+)"/)||[])[1];
  return {size:s?Number(s)/2:null,color:c&&c!=='auto'?'#'+c:null,font:f||null};
}
const run=(v,pr)=>'<w:r>'+pr+'<w:t xml:space="preserve">'+xEsc(v)+'</w:t></w:r>';
const blank=s=>!s||/^[\s._\-–—:：/\\|()\[\]]*$/.test(s);

async function fillDocx(file,fields){
  const z=await JSZip.loadAsync(await file.arrayBuffer()),entry=z.file('word/document.xml');
  if(!entry)throw Error('تعذر قراءة Word.');
  let xml=await entry.async('text');
  const placements=[];
  for(const f of fields){
    if(!f.enabled||!f.value.trim())continue;
    const aliases=[N(f.anchor),N(f.label)].filter(Boolean);
    let done=false;
    const rows=xml.match(/<w:tr[\s\S]*?<\/w:tr>/g)||[];
    for(const row of rows){
      const cells=row.match(/<w:tc[\s\S]*?<\/w:tc>/g)||[];let li=-1;
      for(let i=0;i<cells.length;i++){const t=N(visible(cells[i]));if(aliases.some(a=>t.includes(a))){li=i;break}}
      if(li<0)continue;
      const cand=[li+1,li-1].filter(i=>i>=0&&i<cells.length&&i!==li);
      if(!cand.length)continue;
      cand.sort((a,b)=>(blank(visible(cells[b]))?1:0)-(blank(visible(cells[a]))?1:0));
      const ti=cand[0],tc=cells[ti],lc=cells[li];
      if(!blank(visible(tc))&&visible(tc).length>3)continue;
      const pr=rPr(tc)||cleanPr(rPr(lc)),ps=tc.match(/<w:p[\s\S]*?<\/w:p>/);
      const np='<w:p>'+(ps?pPr(ps[0]):'')+run(f.value,pr)+'</w:p>';
      const nc=ps?tc.replace(ps[0],np):tc.replace('</w:tc>',np+'</w:tc>');
      xml=xml.replace(row,row.replace(tc,nc));
      placements.push(Object.assign({label:f.label,where:'الخلية المقابلة في نفس الصف'},styleMeta(pr)));done=true;break;
    }
    if(done)continue;
    const ps=xml.match(/<w:p[\s\S]*?<\/w:p>/g)||[];
    for(const p of ps){
      const t=N(visible(p));if(!aliases.some(a=>t.includes(a)))continue;
      const pr=cleanPr(rPr(p));
      xml=xml.replace(p,p.replace('</w:p>',run(' '+f.value,pr)+'</w:p>'));
      placements.push(Object.assign({label:f.label,where:'بعد اسم الحقل في نفس السطر'},styleMeta(pr)));done=true;break;
    }
    if(!done)placements.push({label:f.label,where:'لم نجد مكانًا موثوقًا'});
  }
  z.file('word/document.xml',xml);
  return {blob:await z.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),placements:placements};
}
async function fillPdf(file,fields){
  const p=await PDFDocument.load(await file.arrayBuffer()),form=p.getForm(),list=form.getFields(),placements=[];
  for(const f of fields){
    if(!f.enabled||!f.value.trim())continue;
    const aliases=[N(f.anchor),N(f.label)].filter(Boolean);
    const t=list.find(x=>aliases.some(a=>N(x.getName()).includes(a)||a.includes(N(x.getName()))));
    if(!t){placements.push({label:f.label,where:'لم نجد حقل PDF مطابق'});continue}
    try{
      if(typeof t.setText==='function')t.setText(f.value);
      else if(typeof t.check==='function'){/^(1|yes|true|نعم)$/i.test(f.value)?t.check():t.uncheck?.()}
      else if(typeof t.select==='function')t.select(f.value);
      placements.push({label:f.label,where:'حقل PDF: '+t.getName()});
    }catch{placements.push({label:f.label,where:'تعذر تعبئة '+t.getName()})}
  }
  try{form.updateFieldAppearances()}catch{}
  return {blob:new Blob([await p.save()],{type:'application/pdf'}),placements:placements};
}
function fillText(template,fields){
  let out=template;const placements=[];
  for(const f of fields){
    if(!f.enabled||!f.value.trim())continue;
    let done=false;
    for(const a of [f.anchor,f.label].filter(Boolean)){
      const i=out.toLowerCase().indexOf(a.toLowerCase());
      if(i>=0){const e=i+a.length;out=out.slice(0,e)+' '+f.value+out.slice(e);placements.push({label:f.label,where:'بعد اسم الحقل'});done=true;break}
    }
    if(!done)placements.push({label:f.label,where:'لم نجد مكانًا موثوقًا'});
  }
  return {text:out,blob:new Blob([out],{type:'text/plain;charset=utf-8'}),placements:placements};
}
async function previewDocx(blob){
  const m=(await import('mammoth')).default||await import('mammoth'),D=(await import('dompurify')).default;
  return D.sanitize((await m.convertToHtml({arrayBuffer:await blob.arrayBuffer()})).value||'',{FORBID_TAGS:['script','iframe','object','embed','form']});
}
async function pdfFromHtml(html){
  const D=(await import('dompurify')).default,h2c=(await import('html2canvas')).default;
  const h=document.createElement('div');h.className='af-print';h.innerHTML=D.sanitize(html);document.body.append(h);
  try{
    const c=await h2c(h,{scale:1.5,backgroundColor:'#fff',logging:false}),pdf=await PDFDocument.create(),sliceH=Math.floor(c.width*842/595);
    for(let y=0;y<c.height;y+=sliceH){
      const s=document.createElement('canvas');s.width=c.width;s.height=Math.min(sliceH,c.height-y);s.getContext('2d').drawImage(c,0,y,c.width,s.height,0,0,c.width,s.height);
      const b=await new Promise(res=>s.toBlob(res,'image/png')),im=await pdf.embedPng(await b.arrayBuffer()),p=pdf.addPage([595,842]),hh=Math.min(842,s.height*595/s.width);
      p.drawImage(im,{x:0,y:842-hh,width:595,height:hh});
    }
    return new Blob([await pdf.save()],{type:'application/pdf'});
  }finally{h.remove()}
}
function dl(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),2000)}
function csv(fields){const rows=[['field','value','confidence'],...fields.filter(f=>f.enabled).map(f=>[f.label,f.value,String(Math.round(f.confidence*100))])];return new Blob(['\ufeff'+rows.map(r=>r.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})}

export function openAutofill(ctx){
  const root=ctx.root,icon=ctx.icon,refreshIcons=ctx.refreshIcons,toast=ctx.toast,onClose=ctx.onClose;
  revoke();
  let dataFile=null,targetFile=null,source='',target=null,fields=[],filled=null,placements=[],busy=false;
  root.innerHTML='<div class="modal-backdrop"><section class="workspace af-workspace" role="dialog" aria-modal="true">'+
    '<header class="workspace-header"><span class="service-logo service-logo-ai"><strong>AI</strong><span>'+icon('FileInput')+'</span></span><div><div class="workspace-title-row"><h2>تعبئة ونقل البيانات الذكي</h2><span class="workspace-tier pro">PRO</span></div><p>ارفع ملف البيانات والنموذج، وراجع النتيجة داخل BDF Egypt قبل التنزيل.</p></div><button class="icon-btn" id="af-close">'+icon('X')+'</button></header>'+
    '<div class="af-body"><div class="af-upload-grid">'+
    '<section class="af-box"><b>1</b><h3>ملف البيانات</h3><p>PDF · Word · Excel · CSV · JSON · PowerPoint · صور</p><button class="primary" id="af-data-btn" type="button">'+icon('Upload')+'رفع ملف البيانات</button><input id="af-data" type="file" accept=".pdf,.docx,.txt,.md,.csv,.json,.xlsx,.xls,.pptx,.png,.jpg,.jpeg,.webp" hidden><small id="af-data-name">لم يتم اختيار ملف</small></section>'+
    '<section class="af-box"><b>2</b><h3>النموذج المطلوب تعبئته</h3><p>Word DOCX · PDF Form · TXT/Markdown</p><button class="primary" id="af-target-btn" type="button">'+icon('FileUp')+'رفع النموذج</button><input id="af-target" type="file" accept=".docx,.pdf,.txt,.md" hidden><small id="af-target-name">لم يتم اختيار ملف</small></section></div>'+
    '<div class="af-action"><button class="primary" id="af-analyze" disabled>'+icon('Sparkles')+'فهم الملفين وتوزيع البيانات تلقائيًا</button><span id="af-status"></span></div>'+
    '<div id="af-review" hidden><div class="af-stats" id="af-stats"></div><div class="af-head"><div><h3>راجع القيمة ومكانها وتنسيقها</h3><p>القيم غير المثبتة من المصدر لا تتفعل تلقائيًا.</p></div><button class="secondary" id="af-preview">'+icon('Eye')+'معاينة</button></div><div id="af-fields" class="af-fields"></div>'+
    '<div class="af-preview-wrap"><div class="af-preview-head"><strong>المعاينة داخل BDF Egypt</strong><span id="af-preview-note"></span></div><div id="af-preview-box" class="af-preview"><div class="af-empty">اضغط معاينة قبل التنزيل.</div></div></div>'+
    '<div class="af-export"><label>صيغة التحميل<select id="af-format"><option value="same">نفس صيغة النموذج</option><option value="pdf">PDF</option><option value="docx">Word DOCX</option><option value="txt">TXT</option><option value="json">JSON</option><option value="csv">CSV</option></select></label><button class="primary" id="af-download">'+icon('Download')+'تنزيل الملف النهائي</button></div></div><div class="error" id="af-error" hidden></div></div></section></div>';
  refreshIcons();
  const q=s=>root.querySelector(s),status=s=>{q('#af-status').textContent=s||''},error=s=>{q('#af-error').hidden=!s;q('#af-error').textContent=s||''};
  const lock=(v,s)=>{busy=v;status(s||'');q('#af-analyze').disabled=v||!dataFile||!targetFile;if(q('#af-preview'))q('#af-preview').disabled=v;if(q('#af-download'))q('#af-download').disabled=v};
  const baseName=()=>String(targetFile?.name||'BDF-Egypt').replace(/\.[^.]+$/,'')+'-filled';
  q('#af-close').onclick=()=>{if(busy){toast('انتظر انتهاء العملية.');return}revoke();onClose()};
  q('#af-data-btn').onclick=()=>q('#af-data').click();q('#af-target-btn').onclick=()=>q('#af-target').click();
  q('#af-data').onchange=e=>{dataFile=e.target.files?.[0]||null;q('#af-data-name').textContent=dataFile?dataFile.name:'لم يتم اختيار ملف';q('#af-review').hidden=true;lock(false,'')};
  q('#af-target').onchange=e=>{targetFile=e.target.files?.[0]||null;q('#af-target-name').textContent=targetFile?targetFile.name:'لم يتم اختيار ملف';q('#af-review').hidden=true;lock(false,'')};
  async function build(){
    if(target.kind==='docx')return Object.assign(await fillDocx(targetFile,fields),{kind:'docx'});
    if(target.kind==='pdf')return Object.assign(await fillPdf(targetFile,fields),{kind:'pdf'});
    return Object.assign(fillText(target.text,fields),{kind:'text'});
  }
  function render(){
    const ok=fields.filter(f=>f.enabled).length,low=fields.filter(f=>f.value&&f.confidence<.65).length,miss=fields.filter(f=>!f.value).length;
    q('#af-stats').innerHTML='<div><strong>'+ok+'</strong><span>جاهز</span></div><div><strong>'+low+'</strong><span>مراجعة</span></div><div><strong>'+miss+'</strong><span>غير موجود</span></div>';
    q('#af-fields').innerHTML=fields.map((f,i)=>{
      const p=placements.find(x=>x.label===f.label)||{};
      const style=[p.font?('الخط '+p.font):'',p.size?('الحجم '+p.size+'pt'):'',p.color?('اللون '+p.color):''].filter(Boolean).join(' · ');
      return '<div class="af-field '+(f.confidence<.65?'low':'')+'"><label><input type="checkbox" data-en="'+i+'" '+(f.enabled?'checked':'')+' '+(!f.value?'disabled':'')+'><strong>'+E(f.label)+'</strong></label><input data-v="'+i+'" value="'+E(f.value)+'" placeholder="غير موجود"><div class="af-meta"><span>'+(f.verified?'✓ مثبت من المصدر':'⚠ يحتاج مراجعة')+' · '+Math.round(f.confidence*100)+'%</span><span>'+E(p.where||'سيتم تحديد المكان عند المعاينة')+'</span>'+(style?'<span>'+E(style)+'</span>':'')+'</div></div>';
    }).join('');
    q('#af-fields').querySelectorAll('[data-en]').forEach(x=>x.onchange=()=>fields[Number(x.dataset.en)].enabled=x.checked);
    q('#af-fields').querySelectorAll('[data-v]').forEach(x=>x.oninput=()=>{const f=fields[Number(x.dataset.v)];f.value=x.value;f.enabled=Boolean(x.value.trim())&&f.confidence>=.55});
  }
  q('#af-analyze').onclick=async()=>{
    error('');lock(true,'جاري قراءة الملفات…');
    try{
      source=await readSource(dataFile,status);if(!source.trim())throw Error('ملف البيانات لا يحتوي نصًا مقروءًا.');
      target=await readTarget(targetFile);lock(true,'جاري مطابقة كل خانة بمصدرها…');
      fields=verify((await askAI(source,target.text)).fields,source);if(!fields.length)throw Error('لم أجد خانات قابلة للتعبئة.');
      filled=await build();placements=filled.placements||[];q('#af-review').hidden=false;render();status('تم التحليل. راجع البيانات ثم اعرض المعاينة.');
    }catch(e){error(e.message||'تعذر التحليل.')}finally{lock(false,status())}
  };
  q('#af-preview').onclick=async()=>{
    error('');lock(true,'جاري تجهيز المعاينة…');
    try{
      filled=await build();placements=filled.placements||[];render();revoke();
      const box=q('#af-preview-box');
      if(filled.kind==='docx'){box.innerHTML='<div class="af-doc">'+await previewDocx(filled.blob)+'</div>';q('#af-preview-note').textContent='Word بعد التعبئة'}
      else if(filled.kind==='pdf'){const u=URL.createObjectURL(filled.blob);objectUrls.push(u);box.innerHTML='<iframe class="af-pdf" src="'+u+'" title="معاينة PDF"></iframe>';q('#af-preview-note').textContent='PDF النهائي'}
      else{box.innerHTML='<pre>'+E(filled.text||'')+'</pre>';q('#af-preview-note').textContent='النص النهائي'}
      status('المعاينة جاهزة.');
    }catch(e){error(e.message||'تعذر تجهيز المعاينة.')}finally{lock(false,'')}
  };
  q('#af-download').onclick=async()=>{
    error('');lock(true,'جاري تجهيز الملف…');
    try{
      filled=await build();const fmt=q('#af-format').value,b=baseName();
      if(fmt==='same')dl(filled.blob,b+(filled.kind==='docx'?'.docx':filled.kind==='pdf'?'.pdf':'.txt'));
      else if(fmt==='json')dl(new Blob([JSON.stringify(Object.fromEntries(fields.filter(f=>f.enabled).map(f=>[f.label,f.value])),null,2)],{type:'application/json;charset=utf-8'}),b+'.json');
      else if(fmt==='csv')dl(csv(fields),b+'.csv');
      else if(fmt==='txt')dl(new Blob([fields.filter(f=>f.enabled).map(f=>f.label+': '+f.value).join('\n')],{type:'text/plain;charset=utf-8'}),b+'.txt');
      else if(fmt==='pdf'){
        if(filled.kind==='pdf')dl(filled.blob,b+'.pdf');
        else dl(await pdfFromHtml(filled.kind==='docx'?await previewDocx(filled.blob):'<pre>'+E(filled.text||'')+'</pre>'),b+'.pdf');
      }else if(fmt==='docx'){
        if(filled.kind==='docx')dl(filled.blob,b+'.docx');
        else{
          const D=await import('docx'),doc=new D.Document({sections:[{children:fields.filter(f=>f.enabled).map(f=>new D.Paragraph({children:[new D.TextRun({text:f.label+': ',bold:true}),new D.TextRun(f.value)]}))}]});
          dl(await D.Packer.toBlob(doc),b+'.docx');
        }
      }
      status('تم تجهيز الملف.');
    }catch(e){error(e.message||'تعذر تجهيز الملف.')}finally{lock(false,'')}
  };
  return ()=>revoke();
}
