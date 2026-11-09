'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {findNotebookCell,isNotebookMarkdown,isTargetDocument,parseJsonc,normalizeSnippets,findPrefix}=require('../../notebook-support');
const {createHost}=require('../support/model-host');
const root=path.resolve(__dirname,'../..');
function document(languageId,uri='file:///sample',scheme='file'){return {languageId,uri:{scheme,toString:()=>uri},isClosed:false};}
function vscodeFor(cells,type='jupyter-notebook'){
 const notebook={notebookType:type,isClosed:false,getCells:()=>cells};
 return {NotebookCellKind:{Markup:1,Code:2},workspace:{notebookDocuments:[notebook]},window:{activeNotebookEditor:{notebook:{notebookType:'wrong'}}}};
}
test('notebook target follows actual cell document URI, not active notebook or selected index',()=>{
 const target=document('markdown','cell:42','vscode-notebook-cell'),other=document('markdown','cell:17','vscode-notebook-cell');
 const cells=[{kind:2,document:other},{kind:1,document:target}],vscode=vscodeFor(cells);
 const wrapper=document('markdown','cell:42','vscode-notebook-cell');
 assert.equal(findNotebookCell(vscode,wrapper).cell,cells[1]);
 assert.equal(isNotebookMarkdown(vscode,wrapper),true);assert.equal(isTargetDocument(vscode,wrapper),true);
 assert.equal(isNotebookMarkdown(vscode,other),false);
});
for(const [name,language,kind,type,expected] of [
 ['Jupyter Markup markdown','markdown',1,'jupyter-notebook',true],
 ['Jupyter Code markdown','markdown',2,'jupyter-notebook',false],
 ['Jupyter Code latex','latex',2,'jupyter-notebook',false],
 ['Jupyter Code python','python',2,'jupyter-notebook',false],
 ['other notebook Markup','markdown',1,'other-notebook',false],
 ['wrong language Markup','latex',1,'jupyter-notebook',false]
])test(name,()=>{const d=document(language,'cell:1','vscode-notebook-cell'),vscode=vscodeFor([{kind,document:d}],type);assert.equal(isTargetDocument(vscode,d),expected);});
test('ordinary Markdown/Python and orphan notebook documents excluded; normal LaTeX remains enabled',()=>{
 const v=vscodeFor([]);
 for(const d of [document('markdown'),document('python'),document('latex','cell:gone','vscode-notebook-cell')])assert.equal(isTargetDocument(v,d),false);
 assert.equal(isTargetDocument(v,document('latex')),true);assert.equal(isTargetDocument(v,document('latex','untitled:1','untitled')),true);
});
test('closed cell or notebook is excluded',()=>{
 const d=document('markdown','cell:1','vscode-notebook-cell'),v=vscodeFor([{kind:1,document:d}]);
 d.isClosed=true;assert.equal(isTargetDocument(v,d),false);d.isClosed=false;
 v.workspace.notebookDocuments[0].isClosed=true;assert.equal(isTargetDocument(v,d),false);
});
test('JSONC retains all native snippet syntax, strings, comments in bodies and trailing string commas',()=>{
 const definition={prefix:[';th','theta'],body:['\\[','${1:foo} $1 ${2|one,two|} $TM_SELECTED_TEXT','${1/(.*)/${1:/upcase}/g} $0','https://example.test/a/*x*/?a=1,}'],description:'설명,} // string /* literal */'};
 const text='\uFEFF{ /* user comments */ "entry": '+JSON.stringify(definition)+', // keep strings\n}';
 const parsed=parseJsonc(text);assert.deepEqual(parsed,{entry:definition});
 const [entry]=normalizeSnippets(parsed);assert.equal(entry.body,definition.body.join('\n'));assert.deepEqual(entry.definition,definition);assert.deepEqual(entry.prefixes,definition.prefix);
 assert.equal(entry.description,definition.description);
});
test('JSONC rejects broken input instead of inventing a replacement snippet',()=>{
 for(const s of ['{/* missing','{"a": "unterminated}', '{"a":1,,}'])assert.throws(()=>parseJsonc(s));
});
test('entire bundled source retains every prefix, body, description and raw definition',()=>{
 const definitions=parseJsonc(fs.readFileSync(path.join(root,'snippets/latex.json'),'utf8'));
 const entries=normalizeSnippets(definitions);assert.equal(entries.length,Object.keys(definitions).length);assert.ok(entries.length>=60);
 for(const entry of entries) {
  const raw=definitions[entry.name];assert.deepEqual(entry.definition,raw);
  assert.deepEqual(entry.prefixes,(Array.isArray(raw.prefix)?raw.prefix:[raw.prefix]).filter(Boolean));
  assert.equal(entry.body,Array.isArray(raw.body)?raw.body.join('\n'):raw.body);assert.equal(entry.description,raw.description);
 }
 const dm=entries.find(e=>e.prefixes.includes('dm'));assert.ok(dm.body.startsWith('\\[\n'));assert.ok(dm.body.includes('\\]'));
 const pd=entries.find(e=>e.prefixes.includes('pd'));assert.ok(pd.body.includes('\\partial ${2:x}'));assert.ok(pd.body.includes('${3}$0'));
});
test('exact semicolon prefix and long compact lines preserve punctuation replacement range',()=>{
 const entries=normalizeSnippets({theta:{prefix:';th',body:'\\theta{}$0'},short:{prefix:'th',body:'short'},dm:{prefix:'dm',body:'wrapper'}});
 assert.equal(findPrefix(entries,'L(;th').prefix,';th');assert.equal(findPrefix(entries,'x'.repeat(5000)+';th').prefix,';th');
 assert.equal(findPrefix(entries,'L(;t'),undefined);assert.equal(findPrefix(entries,'plain prose dm').prefix,'dm');
});
function run(name,fn,config={}) {test(name,async()=>{const h=createHost(root,config,{notebookSupport:true});try {h.newNotebookEditor();h.exports.resetEvents();await fn(h);assert.deepEqual(h.messages,[]);}finally{h.dispose();}});}
run('Notebook dm prefix expands outside math and semicolon nesting retains parenthesis stop',async h=>{
 await h.type('dm');await h.command('latexSmartTab.expandSnippet');assert.ok(h.snapshot().text.startsWith('\\[\n'));
 await h.type('L(');await h.type(';th');await h.command('latexSmartTab.expandSnippet');const before=h.snapshot();
 assert.ok(before.text.includes('L(\\theta{})'));
 await h.command('latexSmartTab.navigateSnippet');assert.equal(h.snapshot().start,before.start+1);assert.equal(h.snapshot().nativeAlive,true);
 await h.command('latexSmartTab.navigateSnippet');assert.equal(h.snapshot().start,before.text.length);assert.equal(h.snapshot().nativeAlive,false);
});
for(const pair of ['()','[]','{}'])run('Notebook actual pd/bv source reaches only x after '+pair,async h=>{
 await h.type('pd');await h.command('latexSmartTab.expandSnippet');await h.type('f'+pair[0]);await h.type('bv');await h.command('latexSmartTab.expandSnippet');await h.type('z');
 const before=h.snapshot();await h.command('latexSmartTab.navigateSnippet');assert.equal(h.snapshot().start,before.start+1);
 await h.command('latexSmartTab.navigateSnippet');assert.equal(h.snapshot().start,before.start+2);
 await h.command('latexSmartTab.navigateSnippet');assert.equal(h.snapshot().selected,'x');assert.equal(h.snapshot().nativeAlive,true);
 assert.equal(h.exports.readEvents().some(e=>e.event==='selectFollowingArgument'),false);
 const target=h.snapshot();await h.command('jumpToPrevSnippetPlaceholder');assert.notEqual(h.snapshot().start,target.start);
 for(let i=0;i<12;i++){await h.command('jumpToNextSnippetPlaceholder');if(h.snapshot().start===target.start)break;}
 assert.equal(h.snapshot().start,target.start);assert.equal(h.snapshot().selected,'x');
});
run('Notebook named original LaTeX snippet uses original body',async h=>{
 await h.command('latexSmartTab.insertSnippetTemplate',{name:'Bold vector',langId:'latex'});await h.type('z');assert.equal(h.snapshot().text,'\\bm{z}');
});
run('Notebook live source reload preserves dynamic additions without generated copies',async h=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'latex-live-test-')),source=path.join(temp,'latex.json');
 try {
  fs.writeFileSync(source,'{// user comment\n"custom":{"prefix":";zz","body":"CUSTOM ${1:first}$0"},}');h.config.notebookSnippetSource=source;
  await h.command('latexSmartTab.reloadNotebookSnippets');await h.type(';zz');await h.command('latexSmartTab.expandSnippet');assert.equal(h.snapshot().selected,'first');
  await h.command('leaveSnippet');h.newNotebookEditor();
  fs.writeFileSync(source,'{"new":{"prefix":"dm","body":"SECOND ${1:value}$0"}}');
  await h.type('dm');await h.command('latexSmartTab.expandSnippet');assert.equal(h.snapshot().text,'SECOND value');assert.equal(h.snapshot().selected,'value');
 } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
run('Notebook completion registration has notebookType and no scheme/pattern restriction',async h=>{
 assert.deepEqual(h.completion.selector,{language:'markdown',notebookType:'jupyter-notebook'});assert.equal(Object.hasOwn(h.completion.selector,'scheme'),false);assert.equal(Object.hasOwn(h.completion.selector,'pattern'),false);
 await h.type(';th');const items=await h.completion.provider.provideCompletionItems(h.editor.document,h.editor.selection.active);
 const item=items.find(x=>x.label===';th');assert.ok(item);assert.equal(item.insertText.value,'\\theta{}$0');assert.equal(h.editor.document.getText(item.range),';th');
 h.newEditor(';th',{languageId:'markdown'});h.at(3);assert.deepEqual(h.completion.provider.provideCompletionItems(h.editor.document,h.editor.selection.active),[]);
});
run('Notebook completion follows existing LaTeX snippetSuggestions none setting',async h=>{
 await h.type(';th');assert.deepEqual(h.completion.provider.provideCompletionItems(h.editor.document,h.editor.selection.active),[]);
},{snippetSuggestions:'none'});
run('Switching Markdown cells never applies source state to new document',async h=>{
 await h.type('dm');await h.command('latexSmartTab.expandSnippet');await h.type('L(x');const first=h.editor,source=first.document.getText();
 const pending=h.command('latexSmartTab.navigateSnippet');h.newNotebookEditor('other');await pending;assert.equal(first.document.getText(),source);assert.equal(h.snapshot().text,'other');
});
run('Code cell, ordinary md and py direct insert command cannot modify contents',async h=>{
 for(const [kind,lang] of [[2,'python'],[2,'latex'],[2,'markdown']]) {
  h.newNotebookEditor('unchanged',kind,lang);await h.insert('BAD');assert.equal(h.snapshot().text,'unchanged');
 }
 for(const lang of ['markdown','python']){h.newEditor('unchanged',{languageId:lang});await h.insert('BAD');assert.equal(h.snapshot().text,'unchanged');}
});
run('Cell kind change and close invalidate Notebook snippet routing',async h=>{
 const {cell,notebook}=h.newNotebookEditor();await h.type('pd');await h.command('latexSmartTab.expandSnippet');const before=h.snapshot().text;
 cell.kind=2;h.changeNotebook(notebook);await h.insert('BAD');assert.equal(h.snapshot().text,before);
 cell.kind=1;h.closeNotebook(notebook);await h.insert('BAD');assert.equal(h.snapshot().text,before);
});
run('Stale true prefix context falls back to ordinary Tab outside snippet mode',async h=>{
 await h.type('text');await h.command('latexSmartTab.expandSnippet',{inSnippetMode:false});assert.equal(h.snapshot().text,'text    ');
});
run('Stale true prefix context advances the current native placeholder',async h=>{
 await h.insert('${1:a}-${2:b}$0');await h.type('q');await h.command('latexSmartTab.expandSnippet',{inSnippetMode:true});assert.equal(h.snapshot().selected,'b');
});
run('Stale false prefix context still expands before plain or snippet navigation',async h=>{
 await h.type('dm');await h.command('latexSmartTab.navigatePlain');assert.ok(h.snapshot().text.startsWith('\\[\n'));
 await h.type(';th');await h.command('latexSmartTab.navigateSnippet');assert.ok(h.snapshot().text.includes('\\theta{}'));
});
test('Concurrent document mutation during notebook insertion never overwrites new typing',async()=>{
 const h=createHost(root,{}, {notebookSupport:true});
 try {
  h.newNotebookEditor();const execute=h.vscode.commands.executeCommand;let changed=false;
  h.vscode.commands.executeCommand=async(name,...args)=>{
   if(name==='hideSuggestWidget'&&!changed){changed=true;await execute('default:type',{text:'q'});}
   return execute(name,...args);
  };
  await h.insert('BAD');assert.equal(h.snapshot().text,'q');assert.equal(h.messages.length,1);
  assert.match(h.messages[0],/changed|stopped safely/i);
 }finally{h.dispose();}
});
