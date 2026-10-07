// Extract searchable text, then OCR only image pages that have no text layer.
export async function readAiPdfPages(doc,{render,createWorker,imageCodes,onProgress=()=>{}}){
 const pages=[];let worker;
 try{
  for(let i=1;i<=doc.numPages;i++){
   const page=await doc.getPage(i),content=await page.getTextContent();
   const lines=[];let line='';
   for(const item of content.items){line+=item.str+' ';if(item.hasEOL){lines.push(line.trim());line='';}}
   if(line.trim())lines.push(line.trim());
   let text=lines.join('\n');
   if(!text.trim()){
    const ops=await page.getOperatorList();
    if(ops.fnArray.some(op=>imageCodes.includes(op))){
     worker ||= await createWorker();
     const canvas=await render(doc,i-1);
     try{text=String((await worker.recognize(canvas)).data?.text||'').trim();}
     finally{canvas.width=0;canvas.height=0;}
     if(!text)throw Error('تعذر قراءة نص الصفحة '+i+' حتى باستخدام OCR. ارفع مسحًا أوضح؛ لم يتم تجاهل الصفحة.');
    }
   }
   pages.push(text);
   if(pages.reduce((n,p)=>n+p.length,0)>60000)throw Error('النص المستخرج يتجاوز ٦٠ ألف حرف؛ قسّم المستند.');
   onProgress(Math.round(i/doc.numPages*35));
  }
  return pages;
 }finally{
  if(worker)try{await worker.terminate();}catch{}
 }
}
