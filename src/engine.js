import {PDFDocument,degrees,rgb,StandardFonts} from 'pdf-lib';
export function pageRange(value,total,{duplicates=false}={}){
 if(!value.trim())return Array.from({length:total},(_,i)=>i);
 const result=[];for(const part of value.replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/،/g,',').split(',')){
 const m=part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);if(!m)throw Error('اكتب الصفحات مثل: 1,3,5-8');
 const a=Number(m[1]),b=Number(m[2]||a);if(a<1||b<1||a>total||b>total||a>b)throw Error(`الصفحات لازم تكون بين 1 و${total}، والنطاق تصاعدي.`);
 for(let i=a;i<=b;i++)result.push(i-1);
 }return duplicates?result:[...new Set(result)];
}
export async function loadPdf(file){try{return await PDFDocument.load(await file.arrayBuffer());}catch(e){throw Error(/encrypt/i.test(e.message)?'الملف محمي. استخدم أداة فتح PDF بكلمة المرور أولًا.':'تعذر قراءة الملف. تأكد أنه PDF سليم وغير محمي.');}}
export async function mergeFiles(files){const out=await PDFDocument.create();for(const f of files){const d=await loadPdf(f);const p=await out.copyPages(d,d.getPageIndices());p.forEach(x=>out.addPage(x));}return out;}
export async function selectPages(doc,indices){const out=await PDFDocument.create();(await out.copyPages(doc,indices)).forEach(x=>out.addPage(x));return out;}
export function rotatePages(doc,angle,indices=doc.getPageIndices()){for(const i of indices){const p=doc.getPage(i);p.setRotation(degrees((p.getRotation().angle+Number(angle))%360));}}
export async function numberPages(doc,position='bottom',start=1){const font=await doc.embedFont(StandardFonts.Helvetica);doc.getPages().forEach((p,i)=>{const text=String(i+Number(start));p.drawText(text,{x:(p.getWidth()-font.widthOfTextAtSize(text,12))/2,y:position==='top'?p.getHeight()-26:18,size:12,font,color:rgb(.25,.3,.35)});});}
export function safeName(name){return name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,140);}
