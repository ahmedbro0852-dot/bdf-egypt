import './file-editor.css';
import mammoth from 'mammoth';
import DOMPurify from 'dompurify';
import html2canvas from 'html2canvas';
import * as DOCX from 'docx';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {PDFDocument} from 'pdf-lib';

pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;

const ext=name=>(String(name||'').split('.').pop()||'').toLowerCase();
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const base=name=>String(name||'BDF-Egypt').replace(/\.[^.]+$/,'')||'BDF-Egypt';
const textToHtml=text=>String(text||'').split(/\r?\n/).map(line=>line.trim()?'<p>'+esc(line)+'</p>':'<p><br></p>').join('');

async function pdfToHtml(file,setStatus){
  const doc=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  const pages=[];
  try{
    for(let i=1;i<=doc.numPages;i++){
      setStatus('فتح صفحة '+i+' من '+doc.numPages+'…');
      const p=await doc.getPage(i);
      const content=await p.getTextContent();
      const lines=[];let line='';
      for(const item of content.items||[]){
        line+=(item.str||'')+' ';
        if(item.hasEOL){if(line.trim())lines.push(line.trim());line='';}
      }
      if(line.trim())lines.push(line.trim());
      pages.push('<section class="fe-page" data-page="'+i+'"><h3>صفحة '+i+'</h3>'+lines.map(x=>'<p>'+esc(x)+'</p>').join('')+'</section>');
    }
  }finally{await doc.destroy();}
  return pages.join('');
}

async function readEditable(file,setStatus){
  const e=ext(file.name);
  if(file.size>50*1024*1024)throw Error('الحد الحالي للمحرر 50 MB.');
  if(e==='txt'||e==='md')return {html:textToHtml(await file.text()),kind:e};
  if(e==='docx'){
    setStatus('فتح ملف Word…');
    const out=await mammoth.convertToHtml({arrayBuffer:await file.arrayBuffer()});
    return {html:DOMPurify.sanitize(out.value||''),kind:'docx'};
  }
  if(e==='pdf')return {html:await pdfToHtml(file,setStatus),kind:'pdf'};
  throw Error('الصيغة غير مدعومة. استخدم PDF أو Word DOCX أو TXT/Markdown.');
}

function cleanEditorHtml(editor){
  return DOMPurify.sanitize(editor.innerHTML,{
    ALLOWED_TAGS:['p','div','br','strong','b','em','i','u','s','h1','h2','h3','h4','ul','ol','li','blockquote','section','span'],
    ALLOWED_ATTR:['dir','data-page']
  });
}
function plainText(editor){return String(editor.innerText||'').replace(/\u00a0/g,' ').replace(/\n{3,}/g,'\n\n').trim();}
function download(blob,name){
  const u=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=u;a.download=name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(u),2500);
}
async function toDocx(editor){
  const text=plainText(editor);
  const paras=text.split(/\n/).map(line=>new DOCX.Paragraph({
    bidirectional:true,
    children:[new DOCX.TextRun({text:line||' ',font:'Arial',size:24,rightToLeft:true})]
  }));
  const doc=new DOCX.Document({sections:[{properties:{},children:paras.length?paras:[new DOCX.Paragraph('')]}]});
  return DOCX.Packer.toBlob(doc);
}
async function toPdf(editor){
  const clone=document.createElement('div');
  clone.className='fe-print';
  clone.dir='auto';
  clone.innerHTML=cleanEditorHtml(editor);
  document.body.append(clone);
  try{
    const canvas=await html2canvas(clone,{scale:1.7,backgroundColor:'#ffffff',logging:false,useCORS:true});
    const pdf=await PDFDocument.create();
    const pageW=595,pageH=842;
    const slicePx=Math.max(1,Math.floor(canvas.width*pageH/pageW));
    for(let y=0;y<canvas.height;y+=slicePx){
      const part=document.createElement('canvas');
      part.width=canvas.width;part.height=Math.min(slicePx,canvas.height-y);
      part.getContext('2d').drawImage(canvas,0,y,canvas.width,part.height,0,0,part.width,part.height);
      const blob=await new Promise(res=>part.toBlob(res,'image/png'));
      const image=await pdf.embedPng(await blob.arrayBuffer());
      const page=pdf.addPage([pageW,pageH]);
      const h=Math.min(pageH,part.height*pageW/part.width);
      page.drawImage(image,{x:0,y:pageH-h,width:pageW,height:h});
    }
    return new Blob([await pdf.save()],{type:'application/pdf'});
  }finally{clone.remove();}
}

export function openFileEditor(ctx){
  const {root,icon,refreshIcons,onClose}=ctx;
  let file=null,originalKind='',busy=false,dirty=false;
  root.innerHTML='<div class="modal-backdrop"><section class="workspace fe-workspace" role="dialog" aria-modal="true">'+
    '<header class="workspace-header"><span class="service-logo"><span>'+icon('FilePenLine')+'</span></span><div><div class="workspace-title-row"><h2>فتح وتعديل ملف</h2><span class="workspace-tier free">مجاني</span></div><p>افتح PDF أو Word أو TXT وعدّل المحتوى ثم نزّله من جديد.</p></div><button class="icon-btn" id="fe-close">'+icon('X')+'</button></header>'+
    '<div class="fe-body"><div class="fe-open"><button class="primary" id="fe-pick">'+icon('FolderOpen')+'فتح ملف</button><input id="fe-file" type="file" accept=".pdf,.docx,.txt,.md" hidden><span id="fe-name">لم يتم اختيار ملف</span><span id="fe-status"></span></div>'+
    '<div class="fe-note" id="fe-note">Word وPDF يفتحان كمحتوى قابل للتعديل. عند إعادة الحفظ قد يختلف التنسيق المعقّد عن الأصل.</div>'+
    '<div class="fe-toolbar" id="fe-toolbar">'+
      '<button type="button" data-cmd="bold" title="غامق"><b>B</b></button>'+
      '<button type="button" data-cmd="italic" title="مائل"><i>I</i></button>'+
      '<button type="button" data-cmd="underline" title="تحته خط"><u>U</u></button>'+
      '<button type="button" data-cmd="insertUnorderedList" title="قائمة">• قائمة</button>'+
      '<button type="button" data-block="h2">عنوان</button>'+
      '<button type="button" data-block="p">نص عادي</button>'+
      '<button type="button" id="fe-undo">'+icon('Undo2')+'</button><button type="button" id="fe-redo">'+icon('Redo2')+'</button>'+
    '</div>'+
    '<div id="fe-editor" class="fe-editor" contenteditable="true" spellcheck="true" dir="auto" data-placeholder="افتح ملفًا أو ابدأ الكتابة هنا…"></div>'+
    '<div class="fe-footer"><label>صيغة التنزيل<select id="fe-format"><option value="same">نفس الصيغة قدر الإمكان</option><option value="docx">Word DOCX</option><option value="pdf">PDF</option><option value="txt">TXT</option></select></label><button class="primary" id="fe-download">'+icon('Download')+'تنزيل النسخة المعدلة</button></div>'+
    '<div class="error" id="fe-error" hidden></div></div></section></div>';
  refreshIcons();
  const q=s=>root.querySelector(s),status=s=>q('#fe-status').textContent=s||'',error=s=>{q('#fe-error').hidden=!s;q('#fe-error').textContent=s||''};
  const lock=v=>{busy=v;q('#fe-pick').disabled=v;q('#fe-download').disabled=v;q('#fe-close').disabled=v;};
  const editor=q('#fe-editor');

  q('#fe-pick').onclick=()=>q('#fe-file').click();
  q('#fe-file').onchange=async e=>{
    const next=e.target.files?.[0]||null;if(!next)return;
    error('');lock(true);status('جاري فتح الملف…');
    try{
      const opened=await readEditable(next,status);
      file=next;originalKind=opened.kind;editor.innerHTML=opened.html||'<p><br></p>';
      q('#fe-name').textContent=next.name;dirty=false;
      q('#fe-note').textContent=originalKind==='pdf'
        ?'تم فتح نص PDF للتعديل. النسخة الجديدة تعيد إنشاء المحتوى وقد لا تحافظ على التصميم الأصلي 100%.'
        :originalKind==='docx'
        ?'تم فتح Word للتعديل. النص الأساسي قابل للتعديل، لكن التنسيقات المعقدة والجداول قد تتغير عند الحفظ.'
        :'تم فتح الملف ويمكن تعديله مباشرة.';
      status('الملف جاهز للتعديل.');
    }catch(err){error(err.message||'تعذر فتح الملف.');status('');}
    finally{lock(false);}
  };
  editor.addEventListener('input',()=>{dirty=true;});
  q('#fe-toolbar').querySelectorAll('[data-cmd]').forEach(b=>b.onclick=()=>{editor.focus();document.execCommand(b.dataset.cmd,false,null);dirty=true;});
  q('#fe-toolbar').querySelectorAll('[data-block]').forEach(b=>b.onclick=()=>{editor.focus();document.execCommand('formatBlock',false,b.dataset.block);dirty=true;});
  q('#fe-undo').onclick=()=>{editor.focus();document.execCommand('undo');};
  q('#fe-redo').onclick=()=>{editor.focus();document.execCommand('redo');};

  q('#fe-download').onclick=async()=>{
    error('');lock(true);status('جاري تجهيز الملف…');
    try{
      const fmt=q('#fe-format').value;
      let chosen=fmt==='same'?(originalKind||'docx'):fmt;
      if(chosen==='md')chosen='txt';
      const name=base(file?.name||'BDF-Egypt')+'-edited';
      if(chosen==='txt'){
        download(new Blob([plainText(editor)],{type:'text/plain;charset=utf-8'}),name+'.txt');
      }else if(chosen==='docx'){
        download(await toDocx(editor),name+'.docx');
      }else if(chosen==='pdf'){
        download(await toPdf(editor),name+'.pdf');
      }else{
        download(await toDocx(editor),name+'.docx');
      }
      dirty=false;status('تم تجهيز النسخة المعدلة.');
    }catch(err){error(err.message||'تعذر تجهيز الملف المعدل.');status('');}
    finally{lock(false);}
  };
  q('#fe-close').onclick=()=>{if(busy)return;if(dirty&&!confirm('عندك تعديلات غير محفوظة. إغلاق الأداة؟'))return;onClose();};
  return ()=>{};
}
