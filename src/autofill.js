
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
async function docxStructure(file){
  const z=await JSZip.loadAsync(await file.arrayBuffer());
  const parts=Object.keys(z.files).filter(n=>/^word\/(document|header\d+|footer\d+)\.xml$/.test(n)).sort();
  const out=[];
  for(const name of parts){
    const xml=await z.file(name).async('text');
    const title=name.includes('header')?'هيدر':name.includes('footer')?'فوتر':'المستند';
    out.push('=== '+title+' ===');
    const rows=xml.match(/<w:tr[\s\S]*?<\/w:tr>/g)||[];
    rows.forEach((row,ri)=>{
      const cells=row.match(/<w:tc[\s\S]*?<\/w:tc>/g)||[];
      const texts=cells.map(c=>visible(c)).filter(Boolean);
      if(texts.length)out.push('[صف جدول '+(ri+1)+'] '+texts.map((t,i)=>'خلية '+(i+1)+': '+t).join(' | '));
    });
    const paras=xml.match(/<w:p[\s\S]*?<\/w:p>/g)||[];
    paras.forEach((p,pi)=>{
      const t=visible(p);
      if(t)out.push('[سطر '+(pi+1)+'] '+t);
    });
  }
  return out.join('\n').slice(0,40000);
}
async function readTarget(file){
  const e=X(file.name);
  if(e==='docx')return {kind:'docx',text:await docxStructure(file)};
  if(e==='pdf'){
    const p=await PDFDocument.load(await file.arrayBuffer());
    const fs=p.getForm().getFields();
    if(!fs.length)throw Error('PDF لازم يكون نموذج حقول قابل للتعبئة.');
    return {kind:'pdf',text:fs.map((f,i)=>'حقل '+(i+1)+': '+f.getName()).join('\n')};
  }
  if(['txt','md'].includes(e))return {kind:'text',text:await file.text()};
  throw Error('النموذج يدعم DOCX أو PDF Form أو TXT/MD.');
}
async function askAI(source,target,trialCode=''){
  const code=String(trialCode||'').trim();
  if(!hasPremium()&&!code)throw Error('اكتب كود التجربة أو فعّل اشتراك Pro.');
  const headers={'Content-Type':'application/json'};
  if(hasPremium())headers.Authorization='Bearer '+membershipToken();
  const r=await fetch('/api/advanced',{method:'POST',headers,body:JSON.stringify({action:'autofill',sourceText:source.slice(0,80000),targetText:target.slice(0,40000),trialCode:hasPremium()?'':code})});
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
  const sz=(pr.match(/<w:sz[^>]*w:val="([^"]+)"/)||[])[1];
  const color=(pr.match(/<w:color[^>]*w:val="([^"]+)"/)||[])[1];
  const font=(pr.match(/<w:rFonts[^>]*(?:w:ascii|w:cs|w:hAnsi)="([^"]+)"/)||[])[1];
  return {size:sz?Number(sz)/2:null,color:color&&color!=='auto'?'#'+color:null,font:font||null};
}
const run=(v,pr)=>'<w:r>'+pr+'<w:t xml:space="preserve">'+xEsc(v)+'</w:t></w:r>';
const blank=s=>!String(s||'').trim()||/^[\s._\-–—…:：/\\|()\[\]{}]+$/.test(String(s||'').trim());
const placeholder=s=>{
  const t=N(s);
  return blank(s)||/^(اكتب|ادخل|أدخل|يكتب|يُكتب|اكتب هنا|ادخل هنا|أدخل هنا|القيمة|value|enter|type here|n\/a|na)$/.test(t)||/^\{\{.+\}\}$/.test(String(s||'').trim())||/^\[.+\]$/.test(String(s||'').trim());
};
function matchScore(text,aliases){
  const t=N(text);
  let best=0;
  for(const a of aliases){
    if(!a)continue;
    if(t===a)best=Math.max(best,120);
    else if(t.startsWith(a)||t.endsWith(a))best=Math.max(best,105);
    else if(t.includes(a))best=Math.max(best,90);
    else if(a.includes(t)&&t.length>=4)best=Math.max(best,70);
  }
  return best;
}
function replaceTextPreserveStyle(container,value){
  const runs=container.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g)||[];
  let best=null;
  for(const r of runs){
    const txt=visible(r);
    if(placeholder(txt)){best=r;break}
  }
  if(best){
    const pr=rPr(best);
    const replaced=best.replace(/<w:t[^>]*>[\s\S]*?<\/w:t>/, '<w:t xml:space="preserve">'+xEsc(value)+'</w:t>');
    return {xml:container.replace(best,replaced),pr,method:'استبدال النص الإرشادي داخل نفس Run'};
  }
  return null;
}
function cellCandidateScore(cell,distance){
  const txt=visible(cell);
  let score=0;
  if(!txt)score+=90;
  else if(placeholder(txt))score+=80;
  else if(txt.length<=2)score+=25;
  else score-=80;
  score-=distance*8;
  if(/<w:tcPr>[\s\S]*?<\/w:tcPr>/.test(cell))score+=4;
  return score;
}
function chooseTargetCell(cells,labelIndex){
  const candidates=[];
  for(let i=0;i<cells.length;i++){
    if(i===labelIndex)continue;
    const distance=Math.abs(i-labelIndex);
    if(distance>2)continue;
    candidates.push({index:i,score:cellCandidateScore(cells[i],distance)+(i===labelIndex+1?10:0)});
  }
  candidates.sort((a,b)=>b.score-a.score);
  return candidates[0]&&candidates[0].score>0?candidates[0]:null;
}
function writeIntoCell(cell,labelCell,value){
  const direct=replaceTextPreserveStyle(cell,value);
  if(direct)return direct;
  const paragraphs=cell.match(/<w:p[\s\S]*?<\/w:p>/g)||[];
  const p=paragraphs[0]||'';
  const targetPr=rPr(cell);
  const labelPr=cleanPr(rPr(labelCell));
  const pr=targetPr||labelPr;
  if(p){
    const pp=pPr(p);
    const open=(p.match(/^<w:p[^>]*>/)||['<w:p>'])[0];
    const newP=open+pp+run(value,pr)+'</w:p>';
    return {xml:cell.replace(p,newP),pr,method:targetPr?'كتابة داخل فقرة الخانة بنفس تنسيقها':'كتابة داخل الخانة بتنسيق مشتق من الحقل'};
  }
  return {xml:cell.replace('</w:tc>','<w:p>'+run(value,pr)+'</w:p></w:tc>'),pr,method:'إنشاء فقرة داخل الخانة'};
}
function writeIntoParagraph(p,value){
  const direct=replaceTextPreserveStyle(p,value);
  if(direct)return direct;
  const pr=cleanPr(rPr(p));
  return {xml:p.replace('</w:p>',run(' '+value,pr)+'</w:p>'),pr,method:'إضافة القيمة بعد اسم الحقل في نفس السطر'};
}
function locationPartName(name){
  if(name.includes('header'))return 'الهيدر';
  if(name.includes('footer'))return 'الفوتر';
  return 'المستند';
}
async function fillDocx(file,fields){
  const z=await JSZip.loadAsync(await file.arrayBuffer());
  const partNames=Object.keys(z.files).filter(n=>/^word\/(document|header\d+|footer\d+)\.xml$/.test(n)).sort();
  if(!partNames.includes('word/document.xml'))throw Error('تعذر قراءة Word.');
  const placements=[];

  for(const f of fields){
    if(!f.enabled||!f.value.trim())continue;
    const aliases=[N(f.anchor),N(f.label)].filter(Boolean);
    let bestMatch=null;

    for(const partName of partNames){
      const entry=z.file(partName);
      let xml=await entry.async('text');
      const rows=xml.match(/<w:tr[\s\S]*?<\/w:tr>/g)||[];

      rows.forEach((row,rowIndex)=>{
        const cells=row.match(/<w:tc[\s\S]*?<\/w:tc>/g)||[];
        cells.forEach((cell,cellIndex)=>{
          const score=matchScore(visible(cell),aliases);
          if(score<=0)return;
          const target=chooseTargetCell(cells,cellIndex);
          if(!target)return;
          const total=score+target.score;
          if(!bestMatch||total>bestMatch.total){
            bestMatch={kind:'table',partName,row,rowIndex,cells,labelIndex:cellIndex,targetIndex:target.index,total};
          }
        });
      });

      const paras=xml.match(/<w:p[\s\S]*?<\/w:p>/g)||[];
      paras.forEach((p,pIndex)=>{
        const score=matchScore(visible(p),aliases);
        if(score<95)return;
        const total=score-18;
        if(!bestMatch||total>bestMatch.total){
          bestMatch={kind:'paragraph',partName,p,pIndex,total};
        }
      });
    }

    if(!bestMatch){
      placements.push({label:f.label,where:'لم نجد مكانًا موثوقًا',confidence:0,method:'تم منع الكتابة العشوائية'});
      continue;
    }

    const entry=z.file(bestMatch.partName);
    let xml=await entry.async('text');

    if(bestMatch.kind==='table'){
      const rows=xml.match(/<w:tr[\s\S]*?<\/w:tr>/g)||[];
      const row=rows[bestMatch.rowIndex];
      const cells=row.match(/<w:tc[\s\S]*?<\/w:tc>/g)||[];
      const labelCell=cells[bestMatch.labelIndex];
      const targetCell=cells[bestMatch.targetIndex];

      const written=writeIntoCell(targetCell,labelCell,f.value);
      const newRow=row.replace(targetCell,written.xml);
      xml=xml.replace(row,newRow);
      z.file(bestMatch.partName,xml);

      placements.push(Object.assign({
        label:f.label,
        where:locationPartName(bestMatch.partName)+' · جدول · الخلية المقابلة مباشرة',
        confidence:Math.min(99,Math.round(bestMatch.total/2)),
        method:written.method
      },styleMeta(written.pr)));
    }else{
      const paras=xml.match(/<w:p[\s\S]*?<\/w:p>/g)||[];
      const p=paras[bestMatch.pIndex];
      const written=writeIntoParagraph(p,f.value);
      xml=xml.replace(p,written.xml);
      z.file(bestMatch.partName,xml);

      placements.push(Object.assign({
        label:f.label,
        where:locationPartName(bestMatch.partName)+' · نفس السطر بعد اسم الحقل',
        confidence:Math.min(95,Math.round(bestMatch.total/1.2)),
        method:written.method
      },styleMeta(written.pr)));
    }
  }

  return {blob:await z.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),placements};
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
    '<div class="af-action">'+(!hasPremium()?'<label class="af-trial-wrap"><span>عندك كود تجربة؟</span><input id="af-trial" class="af-trial" type="password" autocomplete="off" placeholder="اكتب كود التجربة"></label>':'')+'<button class="primary" id="af-analyze" disabled>'+icon('Sparkles')+'فهم الملفين وتوزيع البيانات تلقائيًا</button><span id="af-status"></span></div>'+
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
      const place=p.confidence?('دقة المكان '+p.confidence+'%'):'';
      const method=p.method||'';
      return '<div class="af-field '+(f.confidence<.65?'low':'')+'"><label><input type="checkbox" data-en="'+i+'" '+(f.enabled?'checked':'')+' '+(!f.value?'disabled':'')+'><strong>'+E(f.label)+'</strong></label><input data-v="'+i+'" value="'+E(f.value)+'" placeholder="غير موجود"><div class="af-meta"><span>'+(f.verified?'✓ مثبت من المصدر':'⚠ يحتاج مراجعة')+' · دقة البيانات '+Math.round(f.confidence*100)+'%</span><span>'+E(p.where||'سيتم تحديد المكان عند المعاينة')+(place?' · '+E(place):'')+'</span>'+(method?'<span>طريقة الكتابة: '+E(method)+'</span>':'')+(style?'<span>'+E(style)+'</span>':'')+'</div></div>';
    }).join('');
    q('#af-fields').querySelectorAll('[data-en]').forEach(x=>x.onchange=()=>fields[Number(x.dataset.en)].enabled=x.checked);
    q('#af-fields').querySelectorAll('[data-v]').forEach(x=>x.oninput=()=>{const f=fields[Number(x.dataset.v)];f.value=x.value;f.enabled=Boolean(x.value.trim())&&f.confidence>=.55});
  }
  q('#af-analyze').onclick=async()=>{
    error('');lock(true,'جاري قراءة الملفات…');
    try{
      source=await readSource(dataFile,status);if(!source.trim())throw Error('ملف البيانات لا يحتوي نصًا مقروءًا.');
      target=await readTarget(targetFile);lock(true,'جاري مطابقة كل خانة بمصدرها…');
      const trialCode=q('#af-trial')?.value.trim()||'';
      const aiResult=await askAI(source,target.text,trialCode);
      fields=verify(aiResult.fields,source);if(!fields.length)throw Error('لم أجد خانات قابلة للتعبئة.');
      filled=await build();placements=filled.placements||[];q('#af-review').hidden=false;render();
      status(aiResult.trial&&aiResult.credits?'تم التحليل بنجاح — متبقي '+String(aiResult.credits.remaining)+' من 3 تجارب.':'تم التحليل. راجع البيانات ثم اعرض المعاينة.');
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
