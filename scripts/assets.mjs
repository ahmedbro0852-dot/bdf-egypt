import {cp,mkdir} from 'node:fs/promises';
for(const folder of ['cmaps','standard_fonts','wasm']){await mkdir('public/'+folder,{recursive:true});await cp('node_modules/pdfjs-dist/'+folder,'public/'+folder,{recursive:true});}
