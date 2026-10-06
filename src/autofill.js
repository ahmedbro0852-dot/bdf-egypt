
import './autofill.css';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument } from 'pdf-lib';
import { hasAiPack, aiPackToken } from './subscription.js';
import {saveCloudFiles,uploadCloudBlob} from './cloud-files.js';

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
    const controls=xml.match(/<w:sdt(?:\s[^>]*)?>[\s\S]*?<\/w:sdt>/g)||[];
    controls.forEach((block,ci)=>{
      const alias=(block.match(/<w:alias[^>]*w:val="([^"]+)"/i)||[])[1]||'';
      const tag=(block.match(/<w:tag[^>]*w:val="([^"]+)"/i)||[])[1]||'';
      const text=visible(block);
      if(alias||tag||text)out.push('[حقل Word '+(ci+1)+'] الاسم: '+(alias||tag||'بدون اسم')+(tag&&tag!==alias?' | الوسم: '+tag:'')+(text?' | القيمة الحالية: '+text:''));
    });
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
  if(!hasAiPack()&&!code)throw Error('فعّل Pro AI أو اكتب كود التجربة.');
  const headers={'Content-Type':'application/json'};
  if(hasAiPack())headers.Authorization='Bearer '+aiPackToken();
  const r=await fetch('/api/advanced',{method:'POST',headers,body:JSON.stringify({action:'autofill',sourceText:source.slice(0,80000),targetText:target.slice(0,40000),trialCode:hasAiPack()?'':code})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(d.error||'تعذر تحليل الملفين.');
  return d;
}
const latinDigits=s=>String(s||'').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
const auditToken=s=>latinDigits(String(s||'')).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}@]+/gu,'');
const countToken=(text,value)=>{
  const hay=auditToken(text),needle=auditToken(value);
  if(!needle||needle.length<2)return 0;
  let count=0,pos=0;
  while((pos=hay.indexOf(needle,pos))>=0){count++;pos+=Math.max(1,needle.length);}
  return count;
};
function sourceEvidence(value,quote,source){
  if(!String(value||'').trim())return {ok:true,score:1,type:'فارغ'};
  const ns=N(source),nv=N(value),nq=N(quote);
  if(nv&&ns.includes(nv))return {ok:true,score:1,type:'مطابقة حرفية'};
  const token=auditToken(value);
  if(token.length>=3&&auditToken(source).includes(token))return {ok:true,score:.96,type:'مطابقة بعد توحيد التنسيق'};
  if(nq&&ns.includes(nq)&&(nq.includes(nv)||auditToken(nq).includes(token)))return {ok:true,score:.9,type:'مثبت داخل مقتطف المصدر'};
  return {ok:false,score:.35,type:'غير مثبت بوضوح'};
}
function verify(fields,source){
  const prepared=(fields||[]).map((f,index)=>{
    const value=String(f.value||'').trim();
    const quote=String(f.source_hint||'').trim();
    const evidence=sourceEvidence(value,quote,source);
    const aiConfidence=Math.max(0,Math.min(1,Number(f.confidence||0)));
    const confidence=value?Math.min(aiConfidence,evidence.score):aiConfidence;
    return {
      label:String(f.label||'').trim(),
      anchor:String(f.anchor||f.label||'').trim(),
      value,
      source_hint:quote,
      confidence,
      aiConfidence,
      evidenceType:evidence.type,
      evidenceScore:evidence.score,
      verified:evidence.ok,
      enabled:Boolean(value)&&evidence.ok&&confidence>=.62,
      originalIndex:index,
      conflict:''
    };
  }).filter(f=>f.label);

  const byAnchor=new Map();
  prepared.forEach((f,i)=>{
    const key=N(f.anchor||f.label);
    if(!key)return;
    if(!byAnchor.has(key))byAnchor.set(key,[]);
    byAnchor.get(key).push({f,i});
  });
  for(const group of byAnchor.values()){
    const enabled=group.filter(x=>x.f.enabled);
    const distinct=new Set(enabled.map(x=>auditToken(x.f.value)));
    if(enabled.length>1&&distinct.size>1){
      enabled.sort((a,b)=>b.f.confidence-a.f.confidence);
      enabled.slice(1).forEach(x=>{
        x.f.enabled=false;
        x.f.conflict='نفس خانة النموذج اتربطت بأكثر من قيمة؛ تم إيقاف الأقل ثقة.';
      });
    }
  }
  return prepared;
}
const xEsc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const xDec=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
const visible=xml=>xDec((xml.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g)||[]).map(x=>x.replace(/<w:t(?:\s[^>]*)?>/,'').replace(/<\/w:t>/,'')).join(' ')).replace(/\s+/g,' ').trim();
const rPr=xml=>(xml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)||[])[0]||'';
const pPr=xml=>(xml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)||[])[0]||'';
const cleanPr=pr=>pr.replace(/<w:b(?:\s*\/>|>[\s\S]*?<\/w:b>)/g,'').replace(/<w:bCs(?:\s*\/>|>[\s\S]*?<\/w:bCs>)/g,'');
function visiblePr(primary='',fallback=''){
  let pr=String(primary||'');
  const fb=String(fallback||'');
  // Word can keep hidden/white/very-small formatting inside an otherwise blank cell.
  pr=pr
    .replace(/<w:(?:vanish|webHidden|specVanish)(?:\s[^>]*)?\/>/g,'')
    .replace(/<w:(?:vanish|webHidden|specVanish)[^>]*>[\s\S]*?<\/w:(?:vanish|webHidden|specVanish)>/g,'')
    .replace(/<w:highlight[^>]*w:val="(?:white|none)"[^>]*\/>/gi,'')
    .replace(/<w:shd[^>]*w:fill="(?:FFFFFF|ffffff|auto)"[^>]*\/>/g,'');

  const color=(pr.match(/<w:color[^>]*w:val="([^"]+)"/i)||[])[1];
  if(color&&/^(?:fff(?:fff)?|ffffff|fefefe|fdfdfd)$/i.test(color)){
    pr=pr.replace(/<w:color[^>]*\/>/gi,'');
    const fbColor=(fb.match(/<w:color[^>]*w:val="([^"]+)"/i)||[])[0];
    pr+=fbColor||'<w:color w:val="000000"/>';
  }

  const sizeMatch=(pr.match(/<w:sz[^>]*w:val="([^"]+)"/i)||[])[1];
  if(sizeMatch&&Number(sizeMatch)<16){
    pr=pr.replace(/<w:sz[^>]*\/>/gi,'').replace(/<w:szCs[^>]*\/>/gi,'');
    const fbSz=(fb.match(/<w:sz[^>]*w:val="([^"]+)"/i)||[])[0];
    const fbSzCs=(fb.match(/<w:szCs[^>]*w:val="([^"]+)"/i)||[])[0];
    pr+=(fbSz||'<w:sz w:val="22"/>')+(fbSzCs||'<w:szCs w:val="22"/>');
  }

  if(!/<w:rFonts\b/i.test(pr)){
    const font=(fb.match(/<w:rFonts[^>]*\/>/i)||[])[0];
    if(font)pr+=font;
  }
  if(!/<w:sz\b/i.test(pr)){
    const size=(fb.match(/<w:sz[^>]*\/>/i)||[])[0];
    const sizeCs=(fb.match(/<w:szCs[^>]*\/>/i)||[])[0];
    pr+=(size||'<w:sz w:val="22"/>')+(sizeCs||'<w:szCs w:val="22"/>');
  }
  if(!/<w:color\b/i.test(pr)){
    const colorFallback=(fb.match(/<w:color[^>]*\/>/i)||[])[0];
    pr+=colorFallback||'<w:color w:val="000000"/>';
  }
  return pr;
}
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
function replaceTextPreserveStyle(container,value,fallbackPr=''){
  const runs=container.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g)||[];
  let best=null;
  for(const r of runs){
    const txt=visible(r);
    if(placeholder(txt)){best=r;break}
  }
  if(best){
    const pr=visiblePr(rPr(best),fallbackPr);
    const replaced=run(value,pr);
    return {xml:container.replace(best,replaced),pr,method:'استبدال النص الإرشادي مع تثبيت تنسيق مرئي'};
  }
  return null;
}
function cellCandidateScore(cell,distance){
  const txt=visible(cell);
  let score=0;
  if(/<w:vMerge(?:\s*\/|[^>]*w:val="continue"[^>]*\/)>/i.test(cell))score-=120;
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
  const labelPr=cleanPr(rPr(labelCell));
  const direct=replaceTextPreserveStyle(cell,value,labelPr);
  if(direct)return direct;
  const paragraphs=cell.match(/<w:p[\s\S]*?<\/w:p>/g)||[];
  const p=paragraphs[0]||'';
  const targetPr=rPr(cell);
  const pr=visiblePr(targetPr,labelPr);
  if(p){
    const pp=pPr(p);
    const open=(p.match(/^<w:p[^>]*>/)||['<w:p>'])[0];
    const newP=open+pp+run(value,pr)+'</w:p>';
    return {xml:cell.replace(p,newP),pr,method:targetPr?'كتابة داخل فقرة الخانة بنفس تنسيقها':'كتابة داخل الخانة بتنسيق مشتق من الحقل'};
  }
  return {xml:cell.replace('</w:tc>','<w:p>'+run(value,pr)+'</w:p></w:tc>'),pr,method:'إنشاء فقرة داخل الخانة'};
}
function writeIntoParagraph(p,value){
  const base=cleanPr(rPr(p));
  const direct=replaceTextPreserveStyle(p,value,base);
  if(direct)return direct;
  const pr=visiblePr(base,base);
  return {xml:p.replace('</w:p>',run(' '+value,pr)+'</w:p>'),pr,method:'إضافة القيمة بعد اسم الحقل بتنسيق مرئي آمن'};
}
function contentControlMeta(block){
  return {
    alias:(block.match(/<w:alias[^>]*w:val="([^"]+)"/i)||[])[1]||'',
    tag:(block.match(/<w:tag[^>]*w:val="([^"]+)"/i)||[])[1]||'',
    text:visible(block)
  };
}
function writeIntoContentControl(block,value){
  const content=(block.match(/<w:sdtContent>[\s\S]*?<\/w:sdtContent>/)||[])[0]||'';
  if(!content)return null;
  const runs=content.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g)||[];
  const firstRun=runs[0]||'';
  const pr=visiblePr(rPr(firstRun),rPr(block));
  let newContent='';
  if(firstRun){
    const replacement=run(value,pr);
    newContent=content.replace(firstRun,replacement);
    const leftovers=(newContent.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g)||[]).slice(1);
    for(const r of leftovers){
      if(visible(r))newContent=newContent.replace(r,r.replace(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g,'<w:t></w:t>'));
    }
  }else{
    newContent=content.replace('</w:sdtContent>','<w:p>'+run(value,pr)+'</w:p></w:sdtContent>');
  }
  return {xml:block.replace(content,newContent),pr,method:'تعبئة حقل Word المخصص مباشرة'};
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
  const usedLocations=new Set();

  for(const f of fields){
    if(!f.enabled||!f.value.trim())continue;
    const aliases=[N(f.anchor),N(f.label)].filter(Boolean);
    let bestMatch=null;

    for(const partName of partNames){
      const entry=z.file(partName);
      const xml=await entry.async('text');

      const controls=xml.match(/<w:sdt(?:\s[^>]*)?>[\s\S]*?<\/w:sdt>/g)||[];
      controls.forEach((block,index)=>{
        const key=partName+':sdt:'+index;
        if(usedLocations.has(key))return;
        const meta=contentControlMeta(block);
        const score=Math.max(matchScore(meta.alias,aliases)+35,matchScore(meta.tag,aliases)+30,matchScore(meta.text,aliases));
        if(score<95)return;
        if(!bestMatch||score>bestMatch.total)bestMatch={kind:'sdt',partName,index,total:score};
      });

      const rows=xml.match(/<w:tr[\s\S]*?<\/w:tr>/g)||[];
      rows.forEach((row,rowIndex)=>{
        const cells=row.match(/<w:tc[\s\S]*?<\/w:tc>/g)||[];
        cells.forEach((cell,cellIndex)=>{
          const score=matchScore(visible(cell),aliases);
          if(score<=0)return;
          const target=chooseTargetCell(cells,cellIndex);
          if(!target)return;
          const key=partName+':table:'+rowIndex+':'+target.index;
          if(usedLocations.has(key))return;
          const total=score+target.score;
          if(!bestMatch||total>bestMatch.total){
            bestMatch={kind:'table',partName,rowIndex,labelIndex:cellIndex,targetIndex:target.index,total,key};
          }
        });
      });

      const paras=xml.match(/<w:p[\s\S]*?<\/w:p>/g)||[];
      paras.forEach((p,pIndex)=>{
        const key=partName+':paragraph:'+pIndex;
        if(usedLocations.has(key))return;
        const score=matchScore(visible(p),aliases);
        if(score<105)return;
        const total=score-22;
        if(!bestMatch||total>bestMatch.total){
          bestMatch={kind:'paragraph',partName,pIndex,total,key};
        }
      });
    }

    if(!bestMatch){
      placements.push({label:f.label,where:'لم نجد مكانًا موثوقًا أو المكان مستخدم لحقل آخر',confidence:0,method:'تم منع الكتابة العشوائية أو المكررة'});
      continue;
    }

    const entry=z.file(bestMatch.partName);
    let xml=await entry.async('text');

    if(bestMatch.kind==='sdt'){
      const controls=xml.match(/<w:sdt(?:\s[^>]*)?>[\s\S]*?<\/w:sdt>/g)||[];
      const block=controls[bestMatch.index];
      const written=block?writeIntoContentControl(block,f.value):null;
      if(!written){
        placements.push({label:f.label,where:'حقل Word مخصص لكن تعذر الكتابة داخله',confidence:0,method:'لم يتم تعديل الملف'});
        continue;
      }
      xml=xml.replace(block,written.xml);
      z.file(bestMatch.partName,xml);
      const key=bestMatch.partName+':sdt:'+bestMatch.index;
      usedLocations.add(key);
      placements.push(Object.assign({
        label:f.label,
        where:locationPartName(bestMatch.partName)+' · حقل Word مخصص',
        confidence:Math.min(99,Math.round(bestMatch.total/1.5)),
        method:written.method
      },styleMeta(written.pr)));
    }else if(bestMatch.kind==='table'){
      const rows=xml.match(/<w:tr[\s\S]*?<\/w:tr>/g)||[];
      const row=rows[bestMatch.rowIndex];
      const cells=row.match(/<w:tc[\s\S]*?<\/w:tc>/g)||[];
      const labelCell=cells[bestMatch.labelIndex];
      const targetCell=cells[bestMatch.targetIndex];
      const written=writeIntoCell(targetCell,labelCell,f.value);
      const newRow=row.replace(targetCell,written.xml);
      xml=xml.replace(row,newRow);
      z.file(bestMatch.partName,xml);
      usedLocations.add(bestMatch.key);
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
      usedLocations.add(bestMatch.key);
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
async function validateDocxOutput(blob,fields,originalFile,placements=[]){
  const active=fields.filter(f=>f.enabled&&String(f.value||'').trim());
  try{
    const zip=await JSZip.loadAsync(await blob.arrayBuffer());
    const doc=zip.file('word/document.xml');
    const types=zip.file('[Content_Types].xml');
    let structuralOk=Boolean(doc&&types);
    if(doc){
      const xml=await doc.async('text');
      try{
        const parsed=new DOMParser().parseFromString(xml,'application/xml');
        if(parsed.querySelector('parsererror'))structuralOk=false;
      }catch{structuralOk=false}
    }

    const [before,after]=await Promise.all([
      docxText(originalFile),
      docxText(new File([blob],'output.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}))
    ]);

    const groups=new Map();
    active.forEach(f=>{
      const key=auditToken(f.value);
      if(!key)return;
      if(!groups.has(key))groups.set(key,{value:f.value,expected:0,fields:[]});
      const g=groups.get(key);g.expected++;g.fields.push(f.label);
    });

    const missing=[],extra=[];
    for(const g of groups.values()){
      const beforeCount=countToken(before,g.value);
      const afterCount=countToken(after,g.value);
      const added=Math.max(0,afterCount-beforeCount);
      g.beforeCount=beforeCount;g.afterCount=afterCount;g.added=added;
      if(added<g.expected)missing.push(g);
      if(added>g.expected)extra.push(g);
    }

    const successfulPlacements=placements.filter(p=>Number(p.confidence||0)>0&&!String(p.where||'').startsWith('لم')).length;
    const placementMissing=Math.max(0,active.length-successfulPlacements);
    const lowEvidence=active.filter(f=>Number(f.evidenceScore||0)<.95);
    const conflicts=fields.filter(f=>f.conflict);
    const warnings=[];
    if(extra.length)warnings.push('تم رصد قيمة مكررة أكثر من العدد المتوقع في الملف النهائي.');
    if(lowEvidence.length)warnings.push('بعض القيم ثبتت بعد توحيد تنسيق الأرقام/المسافات وليست مطابقة حرفية.');
    if(conflicts.length)warnings.push('تم إيقاف تعارضات ربط بين أكثر من قيمة ونفس الخانة.');
    if(!structuralOk)warnings.push('بنية ملف Word النهائية غير سليمة.');

    const hardIssues=missing.length+placementMissing+(structuralOk?0:1);
    const score=Math.max(0,100-hardIssues*25-extra.length*5-lowEvidence.length*2);
    return {
      ok:hardIssues===0,
      score,
      structuralOk,
      missing,
      extra,
      placementMissing,
      successfulPlacements,
      activeCount:active.length,
      lowEvidence,
      conflicts,
      warnings,
      groups:[...groups.values()]
    };
  }catch{
    return {
      ok:false,score:0,structuralOk:false,
      missing:active.map(f=>({value:f.value,expected:1,added:0,fields:[f.label]})),
      extra:[],placementMissing:active.length,successfulPlacements:0,activeCount:active.length,
      lowEvidence:[],conflicts:fields.filter(f=>f.conflict),warnings:['تعذر فتح ملف Word النهائي للتدقيق.'],groups:[]
    };
  }
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
  let dataFile=null,targetFile=null,source='',target=null,fields=[],filled=null,placements=[],audit=null,coverage=null,busy=false,savedInputs=false;
  root.innerHTML='<div class="modal-backdrop"><section class="workspace af-workspace" role="dialog" aria-modal="true">'+
    '<header class="workspace-header"><span class="service-logo service-logo-ai"><strong>AI</strong><span>'+icon('FileInput')+'</span></span><div><div class="workspace-title-row"><h2>تعبئة ونقل البيانات الذكي</h2><span class="workspace-tier pro">PRO</span></div><p>ارفع ملف البيانات والنموذج، وراجع النتيجة داخل BDF Egypt قبل التنزيل.</p></div><button class="icon-btn" id="af-close">'+icon('X')+'</button></header>'+
    '<div class="af-body"><div class="af-upload-grid">'+
    '<section class="af-box"><b>1</b><h3>ملف البيانات</h3><p>PDF · Word · Excel · CSV · JSON · PowerPoint · صور</p><button class="primary" id="af-data-btn" type="button">'+icon('Upload')+'رفع ملف البيانات</button><input id="af-data" type="file" accept=".pdf,.docx,.txt,.md,.csv,.json,.xlsx,.xls,.pptx,.png,.jpg,.jpeg,.webp" hidden><small id="af-data-name">لم يتم اختيار ملف</small></section>'+
    '<section class="af-box"><b>2</b><h3>النموذج المطلوب تعبئته</h3><p>Word DOCX · PDF Form · TXT/Markdown</p><button class="primary" id="af-target-btn" type="button">'+icon('FileUp')+'رفع النموذج</button><input id="af-target" type="file" accept=".docx,.pdf,.txt,.md" hidden><small id="af-target-name">لم يتم اختيار ملف</small></section></div>'+
    '<div class="af-action">'+(!hasAiPack()?'<label class="af-trial-wrap"><span>عندك كود تجربة؟</span><input id="af-trial" class="af-trial" type="password" autocomplete="off" placeholder="اكتب كود التجربة"></label>':'')+(hasAiPack()?'<span class="af-credit-badge">رصيد ملفات AI مفعّل</span>':'')+'<button class="primary" id="af-analyze" disabled>'+icon('Sparkles')+'فهم الملفين وتوزيع البيانات تلقائيًا</button><span id="af-status"></span></div>'+
    '<div id="af-review" hidden><div class="af-stats" id="af-stats"></div><div id="af-audit" class="af-audit" hidden></div><div class="af-head"><div><h3>راجع القيمة ومكانها وتنسيقها</h3><p>القيم غير المثبتة من المصدر لا تتفعل تلقائيًا.</p></div><button class="secondary" id="af-preview">'+icon('Eye')+'معاينة</button></div><div id="af-fields" class="af-fields"></div>'+
    '<div class="af-preview-wrap"><div class="af-preview-head"><strong>المعاينة داخل BDF Egypt</strong><span id="af-preview-note"></span></div><div id="af-preview-box" class="af-preview"><div class="af-empty">اضغط معاينة قبل التنزيل.</div></div></div>'+
    '<div class="af-export"><label>صيغة التحميل<select id="af-format"><option value="same">نفس صيغة النموذج</option><option value="pdf">PDF</option><option value="docx">Word DOCX</option><option value="txt">TXT</option><option value="json">JSON</option><option value="csv">CSV</option></select></label><button class="primary" id="af-download">'+icon('Download')+'تنزيل الملف النهائي</button></div></div><div class="error" id="af-error" hidden></div></div></section></div>';
  refreshIcons();
  const q=s=>root.querySelector(s),status=s=>{q('#af-status').textContent=s||''},error=s=>{q('#af-error').hidden=!s;q('#af-error').textContent=s||''};
  const lock=(v,s)=>{busy=v;status(s||'');q('#af-analyze').disabled=v||!dataFile||!targetFile;if(q('#af-preview'))q('#af-preview').disabled=v;if(q('#af-download'))q('#af-download').disabled=v};
  const baseName=()=>String(targetFile?.name||'BDF-Egypt').replace(/\.[^.]+$/,'')+'-filled';
  q('#af-close').onclick=()=>{if(busy){toast('انتظر انتهاء العملية.');return}revoke();onClose()};
  q('#af-data-btn').onclick=()=>q('#af-data').click();q('#af-target-btn').onclick=()=>q('#af-target').click();
  q('#af-data').onchange=e=>{dataFile=e.target.files?.[0]||null;coverage=null;audit=null;q('#af-data-name').textContent=dataFile?dataFile.name:'لم يتم اختيار ملف';q('#af-review').hidden=true;lock(false,'')};
  q('#af-target').onchange=e=>{targetFile=e.target.files?.[0]||null;coverage=null;audit=null;q('#af-target-name').textContent=targetFile?targetFile.name:'لم يتم اختيار ملف';q('#af-review').hidden=true;lock(false,'')};
  async function build(){
    if(!coverage?.complete || (coverage?.missed_relevant_facts||[]).length){
      throw Error('تدقيق تغطية المصدر لم يكتمل؛ تم إيقاف الملف بدل إخراج نقل ناقص.');
    }
    if(target.kind==='docx'){
      const out=Object.assign(await fillDocx(targetFile,fields),{kind:'docx'});
      audit=await validateDocxOutput(out.blob,fields,targetFile,out.placements||[]);
      if(!audit.ok){
        const details=[
          audit.missing?.length?('قيم ناقصة: '+audit.missing.map(x=>x.fields.join('/')).join('، ')):'',
          audit.placementMissing?('أماكن كتابة غير مؤكدة: '+audit.placementMissing):''
        ].filter(Boolean).join(' · ');
        throw Error('تدقيق Word أوقف الملف لأنه غير مطابق 100%.'+(details?' '+details:''));
      }
      return out;
    }
    audit=null;
    const out=target.kind==='pdf'
      ?Object.assign(await fillPdf(targetFile,fields),{kind:'pdf'})
      :Object.assign(fillText(target.text,fields),{kind:'text'});
    const active=fields.filter(f=>f.enabled&&String(f.value||'').trim());
    const failed=(out.placements||[]).filter(p=>String(p.where||'').startsWith('لم')||String(p.where||'').startsWith('تعذر'));
    if((out.placements||[]).length<active.length||failed.length){
      const names=failed.map(x=>x.label).filter(Boolean).join('، ');
      throw Error('تدقيق الناتج أوقف الملف لأن بعض القيم لم تُكتب فعليًا.'+(names?' الخانات: '+names:''));
    }
    return out;
  }
  function renderAudit(){
    const box=q('#af-audit');if(!box)return;
    if(!audit){box.hidden=true;box.innerHTML='';return;}
    const ok=audit.ok;
    const exact=fields.filter(f=>f.enabled&&f.evidenceType==='مطابقة حرفية').length;
    const normalized=fields.filter(f=>f.enabled&&f.evidenceType!=='مطابقة حرفية').length;
    const warnings=audit.warnings||[];
    box.hidden=false;
    box.className='af-audit '+(ok?'good':'bad');
    box.innerHTML='<div class="af-audit-top"><strong>'+(ok?'✓ تدقيق الملف ناجح':'⚠ التدقيق وجد مشكلة')+'</strong><b>'+Math.round(audit.score||0)+'%</b></div>'+
      '<div class="af-audit-grid"><span><strong>'+audit.activeCount+'</strong> خانة مفعلة</span><span><strong>'+audit.successfulPlacements+'</strong> مكان كتابة مؤكد</span><span><strong>'+exact+'</strong> قيمة مطابقة حرفيًا</span><span><strong>'+normalized+'</strong> قيمة بعد توحيد التنسيق</span></div>'+
      (warnings.length?'<div class="af-audit-warnings">'+warnings.map(x=>'<p>• '+E(x)+'</p>').join('')+'</div>':'<p class="af-audit-clean">تمت مقارنة المصدر والنموذج والملف النهائي، والقيم أضيفت بالعدد المتوقع.</p>');
  }
  function render(){
    const ok=fields.filter(f=>f.enabled).length,low=fields.filter(f=>f.value&&(!f.verified||f.confidence<.75||f.conflict)).length,miss=fields.filter(f=>!f.value).length;
    q('#af-stats').innerHTML='<div><strong>'+ok+'</strong><span>جاهز</span></div><div><strong>'+low+'</strong><span>مراجعة</span></div><div><strong>'+miss+'</strong><span>غير موجود</span></div>';
    q('#af-fields').innerHTML=fields.map((f,i)=>{
      const p=placements.find(x=>x.label===f.label)||{};
      const style=[p.font?('الخط '+p.font):'',p.size?('الحجم '+p.size+'pt'):'',p.color?('اللون '+p.color):''].filter(Boolean).join(' · ');
      const place=p.confidence?('دقة المكان '+p.confidence+'%'):'';
      const method=p.method||'';
      const evidence=f.evidenceType||'غير مدقق';
      return '<div class="af-field '+((!f.verified||f.confidence<.75||f.conflict)?'low':'')+'"><label><input type="checkbox" data-en="'+i+'" '+(f.enabled?'checked':'')+' '+(!f.value?'disabled':'')+'><strong>'+E(f.label)+'</strong></label><input data-v="'+i+'" value="'+E(f.value)+'" placeholder="غير موجود"><div class="af-meta"><span>'+(f.verified?'✓ '+E(evidence):'⚠ غير مثبت من المصدر')+' · دقة البيانات '+Math.round(f.confidence*100)+'%</span>'+(f.conflict?'<span>⚠ '+E(f.conflict)+'</span>':'')+'<span>'+E(p.where||'سيتم تحديد المكان عند المعاينة')+(place?' · '+E(place):'')+'</span>'+(method?'<span>طريقة الكتابة: '+E(method)+'</span>':'')+(style?'<span>'+E(style)+'</span>':'')+'</div></div>';
    }).join('');
    q('#af-fields').querySelectorAll('[data-en]').forEach(x=>x.onchange=()=>{const f=fields[Number(x.dataset.en)];const allowed=f.verified&&!f.conflict&&f.confidence>=.62&&Boolean(f.value.trim());f.enabled=x.checked&&allowed;x.checked=f.enabled;if(x.checked&&!allowed)x.checked=false;if(!allowed&&x===document.activeElement)toast('القيمة لازم تكون مثبتة من المصدر ومن غير تعارض قبل تفعيلها.');});
    q('#af-fields').querySelectorAll('[data-v]').forEach(x=>x.oninput=()=>{const f=fields[Number(x.dataset.v)];f.value=x.value;const ev=sourceEvidence(f.value,f.source_hint,source);f.verified=ev.ok;f.evidenceType=ev.type;f.evidenceScore=ev.score;f.enabled=Boolean(x.value.trim())&&ev.ok&&f.confidence>=.62;});
    renderAudit();
  }
  q('#af-analyze').onclick=async()=>{
    error('');lock(true,'جاري قراءة الملفات…');
    try{
      source=await readSource(dataFile,status);if(!source.trim())throw Error('ملف البيانات لا يحتوي نصًا مقروءًا.');
      target=await readTarget(targetFile);lock(true,'جاري مطابقة كل خانة بمصدرها…');
      const trialCode=q('#af-trial')?.value.trim()||'';
      const aiResult=await askAI(source,target.text,trialCode);
      coverage=aiResult.coverage||null;
      if(!coverage?.complete || (coverage?.missed_relevant_facts||[]).length)throw Error('لم ينجح تدقيق التغطية الكاملة للمصدر؛ لن يتم إخراج ملف ناقص.');
      fields=verify(aiResult.fields,source);if(!fields.length)throw Error('لم أجد خانات قابلة للتعبئة.');
      filled=await build();placements=filled.placements||[];renderAudit();if(!savedInputs){const saved=await saveCloudFiles([dataFile,targetFile],'autofill','input');savedInputs=!saved.skipped;}q('#af-review').hidden=false;render();
      status(aiResult.filePack&&aiResult.credits?'تم التحليل بنجاح — متبقي '+String(aiResult.credits.remaining)+' ملف في رصيد AI.':aiResult.trial&&aiResult.credits?'تم التحليل بنجاح — متبقي '+String(aiResult.credits.remaining)+' من '+String(aiResult.credits.limit)+' محاولات.':'تم التحليل. راجع البيانات ثم اعرض المعاينة.');
    }catch(e){error(e.message||'تعذر التحليل.')}finally{lock(false,status())}
  };
  q('#af-preview').onclick=async()=>{
    error('');lock(true,'جاري تجهيز المعاينة…');
    try{
      filled=await build();placements=filled.placements||[];render();renderAudit();revoke();
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
      filled=await build();const fmt=q('#af-format').value,b=baseName();const saveAndDl=async(blob,name)=>{try{await uploadCloudBlob(blob,name,{toolId:'autofill',kind:'output'});}catch{}dl(blob,name);};
      if(fmt==='same')await saveAndDl(filled.blob,b+(filled.kind==='docx'?'.docx':filled.kind==='pdf'?'.pdf':'.txt'));
      else if(fmt==='json')await saveAndDl(new Blob([JSON.stringify(Object.fromEntries(fields.filter(f=>f.enabled).map(f=>[f.label,f.value])),null,2)],{type:'application/json;charset=utf-8'}),b+'.json');
      else if(fmt==='csv')await saveAndDl(csv(fields),b+'.csv');
      else if(fmt==='txt')await saveAndDl(new Blob([fields.filter(f=>f.enabled).map(f=>f.label+': '+f.value).join('\n')],{type:'text/plain;charset=utf-8'}),b+'.txt');
      else if(fmt==='pdf'){
        if(filled.kind==='pdf')await saveAndDl(filled.blob,b+'.pdf');
        else await saveAndDl(await pdfFromHtml(filled.kind==='docx'?await previewDocx(filled.blob):'<pre>'+E(filled.text||'')+'</pre>'),b+'.pdf');
      }else if(fmt==='docx'){
        if(filled.kind==='docx')await saveAndDl(filled.blob,b+'.docx');
        else{
          const D=await import('docx'),doc=new D.Document({sections:[{children:fields.filter(f=>f.enabled).map(f=>new D.Paragraph({children:[new D.TextRun({text:f.label+': ',bold:true}),new D.TextRun(f.value)]}))}]});
          await saveAndDl(await D.Packer.toBlob(doc),b+'.docx');
        }
      }
      status(filled.kind==='docx'?'تم تجهيز ملف Word والتحقق من وجود البيانات داخله فعليًا.':'تم تجهيز الملف.');
    }catch(e){error(e.message||'تعذر تجهيز الملف.')}finally{lock(false,'')}
  };
  return ()=>revoke();
}
