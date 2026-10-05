import {cp,mkdir} from 'node:fs/promises';
for(const folder of ['cmaps','standard_fonts','wasm']){await mkdir('public/'+folder,{recursive:true});await cp('node_modules/pdfjs-dist/'+folder,'public/'+folder,{recursive:true});}
await mkdir('public/ocr/core',{recursive:true});
await mkdir('public/ocr/lang',{recursive:true});
await cp('node_modules/tesseract.js/dist/worker.min.js','public/ocr/worker.min.js');
await cp('node_modules/tesseract.js-core','public/ocr/core',{recursive:true});
for(const lang of ['ara','eng'])await cp(`node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`,`public/ocr/lang/${lang}.traineddata.gz`);
