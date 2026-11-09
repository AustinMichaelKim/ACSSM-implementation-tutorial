'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../../core');
const {nodeAcceptEdit}=require('../support/vscode-markers');
const {planBoundaryHop}=require('../../boundary-hop');

for(const [name,affinity,expected] of [['left','left',4],['right','right',7]]) {
 test('offset affinity '+name,()=>assert.equal(core.mapOffset(4,[{rangeOffset:4,rangeLength:0,text:'abc'}],affinity),expected));
}
test('placeholder grows at both edges',()=>{
 assert.deepEqual(core.transformRange({startOffset:2,endOffset:4},[{rangeOffset:4,rangeLength:0,text:'x'}]),{startOffset:2,endOffset:5});
 assert.deepEqual(core.transformRange({startOffset:2,endOffset:4},[{rangeOffset:2,rangeLength:0,text:'x'}]),{startOffset:2,endOffset:5});
});
test('concrete closer does not absorb insertion after its end',()=>assert.deepEqual(core.transformTokenRange({startOffset:2,endOffset:3},[{rangeOffset:3,rangeLength:0,text:'abc'}]),{startOffset:2,endOffset:3}));
test('concrete closer shifts at its start',()=>assert.deepEqual(core.transformTokenRange({startOffset:2,endOffset:3},[{rangeOffset:2,rangeLength:0,text:'abc'}]),{startOffset:5,endOffset:6}));
test('multiple old-coordinate changes accumulate',()=>assert.equal(core.mapOffset(20,[{rangeOffset:10,rangeLength:2,text:''},{rangeOffset:2,rangeLength:0,text:'abc'}],'right'),21));
test('token deletion collapses rather than inventing negative ranges',()=>assert.deepEqual(core.transformTokenRange({startOffset:2,endOffset:3},[{rangeOffset:2,rangeLength:1,text:''}]),{startOffset:2,endOffset:2}));
test('token normalization rejects nonstrings and duplicates; longest wins',()=>assert.deepEqual(core.normalizeClosingTokens([')',null,')','\\right)','',false]),['\\right)',')']));
for(const [line,at,expected] of [
 ['x)',1,')'],['x  )',1,')'],['x\\right)',1,'\\right)'],['x\\rangle',1,'\\rangle'],
 ['% x)',3,undefined],['x\\}',2,undefined],['x\\rangles',1,undefined],['x\\\\]',1,undefined],
 ['x\\% )',4,')'],['x\\\\ )',4,')']
])test('token lexical guard '+JSON.stringify([line,at]),()=>assert.equal(core.findInlineClosingMatch(line,at,['\\right)','\\rangle','\\]',')','}',']'],true)?.token,expected));
test('skipBlankChar false does not cross spaces',()=>assert.equal(core.findInlineClosingMatch('x )',1,[')'],false),undefined));
test('bounded closer cannot cross active field end',()=>assert.equal(core.findInlineClosingTarget('x)',1,[')'],true,1),undefined));
test('inserted token scanner ignores comments and escaped suffixes',()=>assert.deepEqual(core.findClosingTokensInInsertedText('\\right) % ) }\n\\} )',['\\right)',')','}']).map(x=>x.token),['\\right)',')']));
const allowed='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_;';
for(const length of [99,100,101,250,1000])test('long-prefix probe length '+length,()=>{
 const text='x'.repeat(length-3)+'}ff';
 const result=core.findLongLineSnippetPrefixProbe(text,text.length,allowed);
 assert.equal(Boolean(result),length>100);if(result)assert.equal(result.prefix,'ff');
});
for(const text of ['x'.repeat(110)+'\\ff','x'.repeat(110)+' ff','x'.repeat(110)+'}','f'.repeat(120)])test('long-prefix conservative rejection '+text.slice(-8),()=>assert.equal(core.findLongLineSnippetPrefixProbe(text,text.length,allowed),undefined));
test('semicolon prefix survives long-line probe',()=>assert.equal(core.findLongLineSnippetPrefixProbe('x'.repeat(120)+'};th',124,allowed)?.prefix,';th'));
for(const [line,start,end,token,expected] of [
 ['  \\]',2,4,'\\]',true],['  \\] % done',2,4,'\\]',true],['a\\]',1,3,'\\]',false],
 ['  \\]x',2,4,'\\]',false],['\\end{bmatrix}',0,13,'\\end{bmatrix}',false]
])test('standalone block '+line,()=>assert.equal(core.isStandaloneBlockCloser(line,start,end,token,['\\]']),expected));
test('entry character honors tabs and indentation',()=>assert.equal(core.nextLineEntryCharacter('\t  text'),3));
test('hop plan rejects invalid boundaries',()=>{
 for(const [text,a,b]of[['x',0,0],['x',1,0],['x',0,2],['x',-1,1],['x',0.5,1],[null,0,1]])assert.equal(planBoundaryHop(text,a,b),undefined);
});
test('upstream marker kernel: one atomic delete+insert reanchors point and caret',()=>{
 for(let p=0;p<50;p++)for(let n=1;n<=20;n++) {
  const point={start:p,end:p,stickiness:0};
  const caret={start:p,end:p,stickiness:1};
  const nextField={start:p+n+5,end:p+n+6,stickiness:1};
  for(const node of [point,caret,nextField]) {
   nodeAcceptEdit(node,p,p+n,0,true);nodeAcceptEdit(node,p,p,n,true);
  }
  assert.equal(point.start,p+n);assert.equal(point.end,p+n);
  assert.equal(caret.start,p+n);assert.equal(caret.end,p+n);
  assert.equal(nextField.start,p+n+5);assert.equal(nextField.end,p+n+6);
 }
});
test('same-text replace is NOT equivalent to insert+delete',()=>{
 const point={start:4,end:4,stickiness:0};nodeAcceptEdit(point,4,5,1,false);assert.equal(point.end,4);
});
test('boundary operation is text identity for 1000 UTF-16 ranges',()=>{
 const text='α😀한글\\theta{} ) ] }\n'.repeat(20);
 for(let i=0;i<1000;i++) {
  const a=(i*31)%(text.length-1),b=Math.min(text.length,a+1+(i%17));const plan=planBoundaryHop(text,a,b);
  const deleted=text.slice(0,a)+text.slice(b);const restored=deleted.slice(0,a)+plan.literal+deleted.slice(a);
  assert.equal(restored,text);
 }
});
