'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createHost}=require('../support/model-host');
const original=path.resolve(__dirname,'../baseline-0.3.1');
test('CONTROL: original 0.3.1 reproduces theta -> outside dm',async()=>{
 const h=createHost(original);try{await h.insert(h.snippets.dm);await h.type('L(');await h.insert(h.snippets[';th']);const expected=h.snapshot().start+1;
 await h.tab();assert.notEqual(h.snapshot().start,expected);assert.equal(h.snapshot().nativeAlive,false);assert.equal(h.snapshot().start,h.snapshot().text.length);}finally{h.dispose();}
});
test('CONTROL: original 0.3.1 skips parenthesis stop in pd',async()=>{
 const h=createHost(original);try{await h.insert(h.snippets.pd);await h.type('f(');await h.insert(h.snippets.bv);await h.type('z');await h.tab();await h.tab();assert.equal(h.snapshot().selected,'x');}finally{h.dispose();}
});
test('CONTROL: original inside-placeholder next/prev probe cancels root session',async()=>{
 const h=createHost(original);try{await h.insert(h.snippets.dm);await h.type('L(x');await h.tab();assert.equal(h.snapshot().nativeAlive,false);}finally{h.dispose();}
});
test('CONTROL: diagnostic-style manual cursor crossing loses x topology',async()=>{
 const h=createHost(original);try{await h.insert(h.snippets.pd);await h.type('f(');await h.insert(h.snippets.bv);await h.type('z');await h.command('jumpToNextSnippetPlaceholder');
 // Replay the documented unsafe 0.3.0 move, not a claim to execute its binary.
 h.at(h.snapshot().start+1);assert.equal(h.snapshot().nativeAlive,false);await h.command('latexSmartTab.navigatePlain');assert.equal(h.snapshot().selected,'\\partial x');}finally{h.dispose();}
});
test('CONTROL: original token end affinity absorbs unrelated text',()=>{
 const old=require('../baseline-0.3.1/core');assert.equal(old.transformTokenRange({startOffset:2,endOffset:3},[{rangeOffset:3,rangeLength:0,text:'x'}]).endOffset,4);
});
