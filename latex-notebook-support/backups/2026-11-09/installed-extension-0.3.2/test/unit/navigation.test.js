'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createHost}=require('../support/model-host');
const root=path.resolve(__dirname,'../..');
function run(name,fn,config={}) {test(name,async()=>{const h=createHost(root,config);h.exports.resetEvents();try{await fn(h);assert.deepEqual(h.messages,[]);}finally{h.dispose();}});}
async function roundTrip(h) {
 const expected=h.snapshot();await h.command('jumpToPrevSnippetPlaceholder');
 assert.notDeepEqual([h.snapshot().start,h.snapshot().end],[expected.start,expected.end]);
 for(let i=0;i<12;i++) {await h.command('jumpToNextSnippetPlaceholder');if(h.snapshot().start===expected.start&&h.snapshot().end===expected.end)break;}
 assert.equal(h.snapshot().start,expected.start);assert.equal(h.snapshot().end,expected.end);assert.equal(h.snapshot().nativeAlive,true);
}
for(const prefix of [';th',';al',';si'])run('display math Greek prefix '+prefix,async h=>{
 h.snippets[prefix]='\\'+({';th':'theta',';al':'alpha',';si':'sigma'}[prefix])+'{}$0';
 await h.insert(h.snippets.dm);await h.type('L(');await h.type(prefix);await h.tab();
 const before=h.snapshot(),expected=before.text.indexOf(')')+1;await h.tab();
 assert.equal(h.snapshot().text,before.text);assert.equal(h.snapshot().start,expected);assert.equal(h.snapshot().end,expected);assert.equal(h.snapshot().nativeAlive,true);
 await h.tab();assert.equal(h.snapshot().start,before.text.length);assert.equal(h.snapshot().nativeAlive,false);
});
run('ordinary parentheses retain native outer session',async h=>{
 await h.insert(h.snippets.dm);await h.type('L(x');const before=h.snapshot();await h.tab();
 assert.equal(h.snapshot().start,before.start+1);assert.equal(h.snapshot().text,before.text);assert.equal(h.snapshot().nativeAlive,true);
 await h.tab();assert.equal(h.snapshot().nativeAlive,false);assert.equal(h.snapshot().start,before.text.length);
});
for(const wrapped of [false,true])for(const pair of ['', '()', '[]', '{}'])for(const nested of ['', 'bm', 'hat'])run(`pd wrapped=${wrapped} pair=${pair||'none'} nested=${nested||'none'}`,async h=>{
 if(wrapped)await h.insert(h.snippets.dm);
 await h.insert(h.snippets.pd);
 if(pair){await h.type('f');await h.type(pair[0]);}
 if(nested)await h.insert('\\'+nested+'{$1}$0');
 await h.type('z');const before=h.snapshot();
 if(nested){await h.tab();assert.equal(h.snapshot().start,before.start+1);assert.equal(h.snapshot().selected,'');assert.equal(h.snapshot().nativeAlive,true);}
 if(pair){const at=h.snapshot().start;await h.tab();assert.equal(h.snapshot().start,at+1);assert.equal(h.snapshot().selected,'');assert.equal(h.snapshot().nativeAlive,true);}
 await h.tab();assert.equal(h.snapshot().selected,'x');assert.equal(h.snapshot().text,before.text);
 assert.equal(h.exports.readEvents().some(e=>e.event==='selectFollowingArgument'),false);
 await roundTrip(h);
});
for(const pair of ['()','[]','{}'])run('manual pair '+pair,async h=>{
 await h.insert(h.snippets.pd);await h.type('f');await h.command('default:type',{text:pair});await h.command('cursorLeft');
 await h.insert(h.snippets.bv);await h.type('z');await h.tab();let at=h.snapshot().start;
 await h.tab();assert.equal(h.snapshot().start,at+1);await h.tab();assert.equal(h.snapshot().selected,'x');await roundTrip(h);
});
for(const field of ['${2:y}','${2}'])run('generic argument literal prefix/suffix '+field,async h=>{
 await h.insert('\\operator{${1:a}}{prefix '+field+' suffix}$0');await h.type('f(');await h.insert('\\mathrm{$1}$0');await h.type('z');
 await h.tab();await h.tab();await h.tab();const s=h.snapshot();
 assert.equal(s.start,s.text.indexOf('prefix ')+7);assert.equal(s.selected,field.includes(':')?'y':'');assert.equal(s.nativeAlive,true);await roundTrip(h);
});
run('40 typed nesting levels do not create extra native groups',async h=>{
 await h.insert(h.snippets.pd);await h.type('f'+'('.repeat(40));await h.insert(h.snippets.bv);await h.type('z');await h.tab();
 const count=h.session.groups.length,text=h.snapshot().text;
 for(let i=0;i<40;i++){const at=h.snapshot().start;await h.tab();assert.equal(h.snapshot().start,at+1);assert.equal(h.session.groups.length,count);}
 await h.tab();assert.equal(h.snapshot().selected,'x');assert.equal(h.snapshot().text,text);
});
run('coincident continuation and final fields do not cost an extra Tab',async h=>{
 await h.insert(h.snippets.dm);await h.insert(h.snippets.pd);await h.type('f(');await h.insert('\\bm{$1}${2}$0');await h.type('z');
 await h.tab();assert.equal(h.snapshot().text[h.snapshot().start],')');await h.tab();assert.equal(h.snapshot().text[h.snapshot().start],'}');await h.tab();assert.equal(h.snapshot().selected,'x');
});
run('subscript inner brace before fraction denominator',async h=>{
 await h.insert(h.snippets.ff);await h.command('default:type',{text:'x_{1}'});await h.command('cursorLeft');const at=h.snapshot().start;
 await h.tab();assert.equal(h.snapshot().start,at+1);assert.equal(h.snapshot().nativeAlive,true);
 await h.tab();assert.equal(h.snapshot().selected,'denominator');
});
run('typed adjacent braces are not mistaken for native command arguments',async h=>{
 await h.insert(h.snippets.dm);await h.command('default:type',{text:'{a}{b}'});h.at(h.snapshot().start-4);
 const at=h.snapshot().start;await h.tab();assert.equal(h.snapshot().start,at+1);assert.equal(h.snapshot().selected,'');assert.equal(h.snapshot().nativeAlive,true);
});
run('snippet-owned left/right pair uses native continuation',async h=>{
 await h.insert(h.snippets.dm);await h.insert(h.snippets.lrp);await h.type('x');await h.tab();
 assert.equal(h.snapshot().start,h.snapshot().text.indexOf('\\right)')+'\\right)'.length);assert.equal(h.snapshot().nativeAlive,true);
 await h.tab();assert.equal(h.snapshot().nativeAlive,false);
});
run('typed closer before a following literal expression stops at one token',async h=>{
 await h.insert(h.snippets.dm);await h.type('L(');await h.insert('\\theta{}$0');const before=h.snapshot();
 await h.tab();await h.command('default:type',{text:'+a'});assert.equal(h.snapshot().text,before.text.replace(')',' )').replace(' )',')+a'));assert.equal(h.snapshot().nativeAlive,true);
});
for(const length of [99,100,101,250,1000])run('prefix expansion on compact line '+length,async h=>{
 const initial='x'.repeat(length-3)+'}ff';h.newEditor(initial);h.at(initial.length);await h.tab();const s=h.snapshot();
 assert.equal(s.text,initial.slice(0,-2)+'\\frac{numerator}{denominator}');assert.equal(s.selected,'numerator');
});
run('unmatched long prefix leaves no probe whitespace',async h=>{
 const initial='x'.repeat(250)+'}zz';h.newEditor(initial);h.at(initial.length);await h.tab();assert.equal(h.snapshot().text,initial+'    ');
});
run('long-prefix recovery off falls back to ordinary Tab',async h=>{
 const initial='x'.repeat(120)+'}ff';h.newEditor(initial);h.at(initial.length);await h.tab();assert.equal(h.snapshot().text,initial+'    ');
},{recoverLongLineSnippetPrefixes:false});
run('native session survives nested long-line prefix expansion',async h=>{
 await h.insert(h.snippets.pd);await h.command('default:type',{text:'x'.repeat(250)+'}bv'});await h.tab();await h.type('z');await h.tab();await h.tab();assert.equal(h.snapshot().selected,'x');assert.equal(h.snapshot().nativeAlive,true);
});
for(const [label,body,expected]of[
 ['terminal','${1:x}$0','x '],['earlier','\\frac{${1:n}}{${2:d}}$0','\\frac{ }{d}'],
 ['nonterminal closer','\\bar{${1:X}}${2}$0','\\bar{ }']
])run('Space semantics '+label,async h=>{await h.insert(body);await h.command('latexSmartTab.insertContinuationSpace');assert.equal(h.snapshot().text,expected);});
run('Space replaces an edited/reselected default',async h=>{
 await h.insert('${1:x}$0');await h.type('z');h.at(0,1);await h.command('latexSmartTab.insertContinuationSpace');assert.equal(h.snapshot().text,' ');
});
run('Space replaces a plain manual selection',async h=>{
 h.newEditor('manual');h.at(0,6);await h.command('latexSmartTab.insertContinuationSpace');assert.equal(h.snapshot().text,' ');
});
for(const eol of ['\n','\r\n'])for(const eof of [false,true])run('plain block '+JSON.stringify([eol,eof]),async h=>{
 const initial='  \\['+eol+'    x'+eol+'  \\]'+(eof?'':eol+'\t  next');
 h.newEditor(initial);h.at(initial.indexOf(eol+'  \\]'));
 await h.command('latexSmartTab.navigatePlain');const s=h.snapshot();
 assert.equal(s.text,eof?initial+eol+'  ':initial);
 assert.equal(s.start,eof?s.text.length:s.text.indexOf('next'));
});
run('inline block closer stop is normalized to a new physical line',async h=>{
 await h.insert('\\[\n  $1\n\\]$0');await h.type('x');await h.tab();assert.equal(h.snapshot().text,'\\[\n  x\n\\]\n');assert.equal(h.snapshot().start,h.snapshot().text.length);
});
run('block exit config off remains after closer',async h=>{
 h.newEditor('\\[\nx\n\\]\n');h.at(4);await h.command('latexSmartTab.navigatePlain');assert.equal(h.snapshot().start,7);
},{exitBlockClosersToNextLine:false});
run('plain sequential recovery remains generic',async h=>{
 h.newEditor('\\command{a}{prefix y suffix}');h.at(10);await h.command('latexSmartTab.navigatePlain');assert.equal(h.snapshot().selected,'prefix y suffix');
});
run('sequential native argument without a field does not rewind or guess',async h=>{
 await h.insert('\\cmd{${1:a}}{literal}${2:z}$0');await h.type('x');await h.tab();assert.equal(h.snapshot().selected,'z');assert.equal(h.snapshot().nativeAlive,true);
 assert.equal(h.exports.readEvents().some(e=>e.event==='selectFollowingArgument'),false);
});
run('queued Tab commands are ordered',async h=>{
 await h.insert(h.snippets.pd);await h.type('f(');await h.insert(h.snippets.bv);await h.type('z');await h.tab();
 await Promise.all([h.command('latexSmartTab.navigateSnippet'),h.command('latexSmartTab.navigateSnippet')]);assert.equal(h.snapshot().selected,'x');
});
run('queued command is abandoned after focus change',async h=>{
 await h.insert(h.snippets.dm);await h.type('L(x');const old=h.editor,oldText=old.document.getText();
 const task=h.command('latexSmartTab.navigateSnippet');h.newEditor('do not touch');await task;
 assert.equal(old.document.getText(),oldText);assert.equal(h.snapshot().text,'do not touch');
});
test('rejected identity edit never falls through to outer dm $0',async()=>{
 const h=createHost(root);try {
 await h.insert(h.snippets.dm);await h.type('L(');await h.insert(h.snippets[';th']);const before=h.snapshot();h.editFailure=true;
 await h.tab();assert.deepEqual(h.snapshot(),before);assert.equal(h.messages.length,1);
 }finally{h.dispose();}
});
run('concurrent typing is not overwritten by a snapshot restore',async h=>{
 await h.insert(h.snippets.dm);await h.type('L(');await h.insert(h.snippets[';th']);const before=h.snapshot();
 const edit=h.editor.edit.bind(h.editor);h.editor.edit=async(...args)=>{const ok=await edit(...args);await h.command('default:type',{text:'q'});return ok;};
 await h.tab();assert.equal(h.snapshot().text,before.text.replace(')',')q'));assert.equal(h.snapshot().nativeAlive,true);
});
run('multi-selection navigation delegates without collapsing cursors',async h=>{
 await h.insert('${1:a} $1 ${2:b}$0');assert.equal(h.editor.selections.length,2);
 await h.command('latexSmartTab.navigateSnippet');assert.equal(h.snapshot().selected,'b');assert.equal(h.calls.includes('jumpToNextSnippetPlaceholder'),true);
});
run('unicode context keeps UTF-16 offsets consistent',async h=>{
 await h.insert(h.snippets.dm);await h.type('한글😀L(');await h.insert(h.snippets[';th']);const at=h.snapshot().start;
 await h.tab();assert.equal(h.snapshot().start,at+1);assert.equal(h.snapshot().nativeAlive,true);
});
run('nested display exit keeps an outer following field alive',async h=>{
 await h.insert('${1}\nnext: ${2:x}$0');await h.insert('\\[\n  $1\n\\]$0');await h.type('z');await h.tab();
 assert.equal(h.snapshot().start,h.snapshot().text.indexOf('next:'));assert.equal(h.snapshot().nativeAlive,true);
 await h.tab();assert.equal(h.snapshot().selected,'x');assert.equal(h.snapshot().nativeAlive,true);
});
run('comments do not terminate a sequential argument early',async h=>{
 await h.insert('\\cmd{${1:a}}% } fake brace\n{prefix % } another fake brace\n${2:y} suffix}$0');await h.type('x');await h.tab();assert.equal(h.snapshot().selected,'y');await roundTrip(h);
});
test('focus change during long-prefix probe still removes only its temporary space',async()=>{
 const h=createHost(root);try{
 const initial='x'.repeat(120)+'}ff';h.newEditor(initial);h.at(initial.length);const old=h.editor;
 const edit=old.edit.bind(old);let calls=0;
 old.edit=async(...args)=>{const ok=await edit(...args);if(++calls===1)h.newEditor('other document');return ok;};
 await h.command('latexSmartTab.navigatePlain');assert.equal(old.document.getText(),initial);assert.equal(h.snapshot().text,'other document');
 }finally{h.dispose();}
});
run('nested sum plus bar reaches denominator without hidden final stops',async h=>{
 await h.insert(h.snippets.ff);await h.insert('\\sum_{${1:i}}^{${2:n}} ${3:x}$0');
 await h.type('a');await h.tab();await h.type('b');await h.tab();await h.insert('\\bar{${1:X}}${2}$0');await h.type('Z');
 await h.tab();assert.equal(h.snapshot().text[h.snapshot().start],'}');await h.tab();assert.equal(h.snapshot().selected,'denominator');await roundTrip(h);
});
run('ordinary derivative with command-bearing denominator preserves only its field',async h=>{
 await h.insert('\\frac{\\mathrm{d}${1:f}}{\\mathrm{d}${2:x}}${3}$0');await h.type('f(');await h.insert(h.snippets.bv);await h.type('z');
 await h.tab();await h.tab();await h.tab();assert.equal(h.snapshot().selected,'x');await roundTrip(h);
});
run('continued typing after a snippet closer does not erase its ownership',async h=>{
 await h.insert(h.snippets.pd);await h.type('f(');await h.insert(h.snippets.bv);await h.type('z');await h.tab();
 await h.command('default:type',{text:'+t'});await h.tab();await h.tab();assert.equal(h.snapshot().selected,'x');await roundTrip(h);
});
