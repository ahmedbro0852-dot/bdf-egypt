import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import JSZip from 'jszip';
import {DOMParser as XMLParser} from '@xmldom/xmldom';
class DOMParser { parseFromString(xml,type){const doc=new XMLParser({onError:()=>{throw Error('invalid XML')}}).parseFromString(xml,type);return {querySelector:tag=>doc.getElementsByTagName(tag)[0]||null};} }
import {PDFDocument} from 'pdf-lib';
import * as DOCX from 'docx';
// Run the actual transfer functions in isolation from UI-only imports.
const source=await fs.readFile(new URL('../src/autofill.js',import.meta.url),'utf8');
const context=vm.createContext({JSZip,PDFDocument,Blob,File,URL,console,DOMParser,DOCX});
vm.runInContext(source.slice(source.indexOf('const E='),source.indexOf('async function previewDocx')).replace(/^export /gm,'')+'\nglobalThis.transfer={fillDocx,fillText,sourceEvidence,verify,askAI,validateDocxOutput,readAiDocument,aiDocumentOutput};',context);
const {fillDocx,fillText,sourceEvidence,verify,askAI,validateDocxOutput,readAiDocument,aiDocumentOutput}=context.transfer;
const para=t=>`<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>${t}</w:t></w:r></w:p>`;
const cell=t=>`<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${para(t)}</w:tc>`;
const row=cells=>`<w:tr><w:trPr><w:cantSplit/></w:trPr>${cells.join('')}</w:tr>`;
const file=async body=>{const z=new JSZip();z.file('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);z.file('[Content_Types].xml','<Types/>');return new File([await z.generateAsync({type:'uint8array'})],'form.docx');};
const field=(label,value)=>({label,anchor:label,value,enabled:true});
// Identical empty cells on both sides of a label: write into the selected cell only.
let f=await file(`<w:tbl>${row([cell(''),cell('الاسم'),cell('')])}${row([cell('الهاتف'),cell('')])}</w:tbl>`);
let result=await fillDocx(f,[field('الاسم','أحمد سالم'),field('الهاتف','01012345678')]);
let xml=await (await JSZip.loadAsync(await result.blob.arrayBuffer())).file('word/document.xml').async('text');
let rows=xml.match(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g);
let cells=rows[0].match(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g);
assert(!cells[0].includes('أحمد'));assert(cells[2].includes('أحمد سالم'));assert(rows[1].includes('01012345678'));
assert(!/<\/w:rPr><w:(sz|color|rFonts)/.test(xml),'run formatting must remain inside rPr');
assert(xml.includes('<w:trPr>'));assert(xml.includes('<w:pPr>'));assert(xml.includes('<w:tcPr>'));
await fs.writeFile('/tmp/bdf-transfer-output.xml',xml);
// Same labels in different rows require a manual choice instead of guessing.
f=await file(`<w:tbl>${row([cell('الاسم'),cell('')])}${row([cell('الاسم'),cell('')])}</w:tbl>`);
result=await fillDocx(f,[field('الاسم','أحمد')]);assert.equal(result.placements[0].confidence,0);assert.equal(result.placements[0].choices.length,2);
result=await fillDocx(f,[{...field('الاسم','أحمد'),manualLocation:result.placements[0].choices[1].id}]);
xml=await (await JSZip.loadAsync(await result.blob.arrayBuffer())).file('word/document.xml').async('text');rows=xml.match(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g);assert(!rows[0].includes('أحمد'));assert(rows[1].includes('أحمد'));
// Numeric substrings and concatenating unrelated numbers cannot prove a value.
assert.equal(sourceEvidence('1234','','رقم 12345').ok,false);assert.equal(sourceEvidence('1234','','12 34').ok,false);assert.equal(sourceEvidence('1234','','رقم ١٢٣٤').ok,true);
let out=fillText('الاسم: ____\nالاسم الكامل القديم: ثابت\nالهاتف: {{الهاتف}}',[field('الاسم','أحمد'),field('الهاتف','01012345678')]);assert(out.text.includes('الاسم: أحمد'));assert(out.text.includes('الاسم الكامل القديم: ثابت'));assert(out.text.includes('الهاتف: 01012345678'));
assert.equal(fillText('الاسم:\nالاسم:',[field('الاسم','أحمد')]).placements[0].where.startsWith('لم'),true);
const conflicts=verify([{...field('الاسم','أحمد'),confidence:1},{...field('الاسم','محمد'),confidence:1}],'أحمد محمد');assert(conflicts.every(x=>!x.enabled));
await assert.rejects(askAI('a'.repeat(80001),'الاسم'),/٨٠ ألف/);
console.log('PASS: Word properties, identical cells, ambiguous/manual destinations, numeric evidence, text fields, conflicts and input limits');

// Regression: the uploaded scattered source and 22-row target form.
const fixture=JSON.parse(await fs.readFile(new URL('./fixtures/scattered-transfer.json',import.meta.url),'utf8'));
const proven=fixture.fields.map(f=>({...f,source_hint:fixture.source.split('\n').find(line=>sourceEvidence(f.value,'',line).ok)}));
assert(verify(proven,fixture.source).every(f=>f.enabled));
assert.equal(sourceEvidence('أحمد','اقتباس مخترع أحمد','أحمد').ok,false);
const template=await fs.readFile(new URL('../../upload/02_نموذج_فارغ_للتعبئة(1).docx',import.meta.url)).catch(async()=>await (await file('<w:tbl>'+row([cell('م'),cell('الحقل المطلوب'),cell('القيمة المستخرجة')])+fixture.fields.map((f,i)=>row([cell(String(i+1)),cell(f.label),cell('____________________________')])).join('')+'</w:tbl>')).arrayBuffer());
if(template){
 const filled=await fillDocx(new File([template],'uploaded.docx'),proven.map(f=>({...f,enabled:true})));
 const checked=verify(proven,fixture.source);
 const audit=await validateDocxOutput(filled.blob,checked,new File([template],'uploaded.docx'),filled.placements);
 assert(audit.ok,JSON.stringify(audit));
 const incorrect=filled.placements.map(p=>({...p,location:{...p.location,targetIndex:0}}));
 assert.equal((await validateDocxOutput(filled.blob,checked,new File([template],'uploaded.docx'),incorrect)).ok,false);
 assert.equal(filled.placements.length,22);
 assert(filled.placements.every(p=>p.confidence>=.9));
 const actual=await (await JSZip.loadAsync(await filled.blob.arrayBuffer())).file('word/document.xml').async('text');
 for(const f of proven)assert(actual.includes(f.value),'missing '+f.label);
 console.log('PASS: actual uploaded Word template filled with all 22 verified values');
}

const plain=await readAiDocument(new File(['نص عربي ١٥'], 'sample.txt'));
assert.equal(plain,'نص عربي ١٥');
const docResult=await aiDocumentOutput('عنوان عربي\nEnglish text 15\nفقرة عربية ثانية');
const docXml=await (await JSZip.loadAsync(await docResult.arrayBuffer())).file('word/document.xml').async('text');
assert(docXml.includes('عنوان عربي'));assert(docXml.includes('English text 15'));assert(docXml.includes('فقرة عربية ثانية'));
const extracted=await readAiDocument(new File([docResult],'ai-output.docx'));
assert(extracted.includes('English text 15'));assert(extracted.includes('عنوان عربي'));
console.log('PASS: AI accepts TXT and DOCX; editable Word output preserves Arabic and English text');
