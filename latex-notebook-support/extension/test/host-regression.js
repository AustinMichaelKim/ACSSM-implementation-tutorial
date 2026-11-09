'use strict';
/** Real Extension Host suite. Uses new untitled documents only, leaves user
 * settings and files unchanged, and never calls TextEditor.insertSnippet
 * (that API starts a new native session instead of merging on current VS Code).
 * The optional CLI driver sends actual OS Tab events; the in-editor command
 * uses API commands and records physicalTabTest:false. */
const vscode=require('vscode');
let running=false;
const delay=(ms=35)=>new Promise(resolve=>setTimeout(resolve,ms));
class PrerequisiteError extends Error {}
function check(condition,message){if(!condition)throw new Error(message);}
function snap(editor,label){
 const d=editor.document,s=editor.selection;
 return {label,text:d.getText(),selectedText:d.getText(s),start:d.offsetAt(s.start),end:d.offsetAt(s.end),
  cursor:{line:s.active.line,character:s.active.character},documentVersion:d.version};
}
exports.run=async function(diagnostics,options={}) {
 if(running)throw new Error('Regression checks are already running');
 running=true;
 const original=vscode.window.activeTextEditor,results=[];
 let editor,current,aborted=false;
 async function command(name,args) {
  check(vscode.window.activeTextEditor===editor,'Focus changed; stopped before '+name);
  await vscode.commands.executeCommand(name,args);await delay();
  check(vscode.window.activeTextEditor===editor,'Focus changed during '+name);
 }
 async function insert(snippet){
  const beforeVersion=editor.document.version;
  await command('latexSmartTab.insertSnippetTemplate',{snippet});
  if(editor.document.version===beforeVersion)throw new PrerequisiteError('Snippet insertion command did not reach the renderer; fixture was not created');
 }
 async function type(text,manual=false){
  const before=snap(editor,'before typing');
  if(manual)await command('default:type',{text});else for(const character of text)await command('type',{text:character});
  const after=snap(editor,'after typing');
  if(text&&before.text===after.text&&before.start===after.start&&before.end===after.end)throw new PrerequisiteError('Typing command did not reach the text editor renderer; actualTextEditor alone does not prove DOM focus');
 }
 function snapshot(label){const s=snap(editor,label);current.steps.push(s);return s;}
 async function tab(mode='snippet'){
  if(options.pressPhysicalTab){
   check(vscode.window.activeTextEditor===editor,'Focus changed before physical Tab');
   await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');await delay();
   const count=diagnostics.readEvents().filter(e=>e.event==='context:keybinding').length;
   await options.pressPhysicalTab();await delay(100);
   check(vscode.window.activeTextEditor===editor,'Focus changed during physical Tab');
   check(diagnostics.readEvents().filter(e=>e.event==='context:keybinding').length>count,
     'Physical Tab did not route through a Smart Tab keybinding');
  }else await command(mode==='prefix'?'latexSmartTab.expandSnippet':mode==='plain'?'latexSmartTab.navigatePlain':'latexSmartTab.navigateSnippet');
  return snapshot('Tab ('+mode+')');
 }
 async function pair(pairString,manual=false) {
  if(manual){await type(pairString,true);await command('cursorLeft');}
  else{
   await type(pairString[0]);
   const at=editor.document.offsetAt(editor.selection.active);
   if(editor.document.getText()[at]!==pairString[1])throw new PrerequisiteError('Current editor did not auto-close '+pairString+'; settings were not changed');
  }
 }
 async function roundTrip(){
  const target=snapshot('native target');
  await command('jumpToPrevSnippetPlaceholder');const previous=snapshot('native previous');
  check(previous.start!==target.start||previous.end!==target.end,'Native previous did not move; session survival not demonstrated');
  for(let i=0;i<16;i++){
   await command('jumpToNextSnippetPlaceholder');const s=snapshot('native next '+i);
   if(s.start===target.start&&s.end===target.end)break;
  }
  const after=snapshot('native round trip');
  check(after.start===target.start&&after.end===target.end,'Native next failed to return to the exact field');
  current.nativeSessionRoundTrip=true;
 }
 async function ensureTypingFocus(){
  for(let attempt=0;attempt<20;attempt++) {
   await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');await delay(100);
   const before=editor.document.getText();
   await vscode.commands.executeCommand('type',{text:'q'});await delay();
   if(editor.document.getText()!==before) {
    await vscode.commands.executeCommand('undo');await delay();
    if(editor.document.getText()!==before)throw new PrerequisiteError('Typing focus probe could not be undone');
    return;
   }
  }
  throw new PrerequisiteError('Could not establish renderer text focus');
 }
 async function one(name,fn,content=''){
  if(aborted)return;
  editor=await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({language:'latex',content}),{preview:false});
  await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');await delay(150);diagnostics.resetEvents();
  current={name,status:'failed',method:options.pressPhysicalTab?'OS Tab + VS Code API setup':'real VS Code API commands; not physical Tab',steps:[]};
  try{await ensureTypingFocus();diagnostics.resetEvents();await fn();current.status='passed';}
  catch(error){current.status=error instanceof PrerequisiteError?'skipped':'failed';current.error=String(error.message||error);}
  finally{
   current.events=diagnostics.readEvents();results.push(current);diagnostics.stopRecording();
   if(vscode.window.activeTextEditor===editor){
    await vscode.commands.executeCommand('leaveSnippet');
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');await delay();
   }else{aborted=true;current.focusChanged=true;}
  }
 }
 const dm='\\[\n    $1\n\\]\n$0';
 const pd='\\frac{\\partial ${1:f}}{\\partial ${2:x}}$0';
 try {
  for(const manual of [false,true])await one('theta-display-'+(manual?'manual':'auto'),async()=>{
   await insert(dm);await type('L');await pair('()',manual);await insert('\\theta{}$0');
   const before=snapshot('theta expanded'),destination=before.start+1;
   const first=await tab();check(first.text===before.text,'Delimiter escape changed source text');
   check(first.start===destination&&first.end===destination,'Expected only the ) boundary, not display exit');
   const second=await tab();check(second.start===before.text.length&&second.end===second.start,'Next Tab did not exit display');
  });
  await one('theta-outer-following-field',async()=>{
   await insert('\\[\n    $1${2:FOLLOW}\n\\]\n$0');await type('L');await pair('()',true);await insert('\\theta{}$0');
   const before=snapshot('theta');let s=await tab();check(s.start===before.start+1,'Missing parenthesis stop');
   s=await tab();check(s.selectedText==='FOLLOW','A genuine following native field was lost');await roundTrip();
  });
  await one('plain-parentheses-inside-dm-without-nesting',async()=>{
   await insert('\\[\n    $1${2:FOLLOW}\n\\]\n$0');await type('L');await pair('()',true);await type('x');
   const before=snapshot('x');const s=await tab();check(s.start===before.start+1,'Plain typed parenthesis was skipped');
   const next=await tab();check(next.selectedText==='FOLLOW','Inside-placeholder escape cancelled native state');await roundTrip();
  });
  const cases=[
   {name:'pd-auto',pair:'()',nested:'bm'}, {name:'pd-no-parentheses',nested:'bm'},
   {name:'pd-no-nesting',pair:'()',manual:true}, {name:'pd-hat',pair:'()',nested:'hat',manual:true},
   {name:'pd-manual',pair:'()',nested:'bm',manual:true}, {name:'pd-wrapped',pair:'()',nested:'bm',manual:true,wrapped:true},
   ...['()','[]','{}'].map(pair=>({name:'generic-'+pair,pair,nested:'mathrm',manual:true,generic:true})),
   {name:'generic-empty-field',pair:'()',nested:'mathrm',manual:true,generic:true,empty:true},
   {name:'coincident-continuation',pair:'()',nested:'bm',manual:true,continuation:true}
  ];
  for(const item of cases)await one(item.name,async()=>{
   if(item.wrapped)await insert(dm);
   await insert(item.generic?'\\operator{${1:a}}{prefix '+(item.empty?'${2}':'${2:y}')+' suffix}$0':pd);
   if(item.pair){await type('f');await pair(item.pair,!!item.manual);}
   if(item.nested)await insert('\\'+item.nested+'{$1}'+(item.continuation?'${2}':'')+'$0');
   await type('z');const before=snapshot('z entered');let expected=before.start;
   if(item.nested){expected++;const s=await tab();check(s.start===expected&&s.end===expected,'First Tab must stop after nested command brace');}
   if(item.pair){expected++;const s=await tab();check(s.start===expected&&s.end===expected,'Next Tab must stop after the typed pair, not at the next argument');}
   const final=await tab();
   check(final.text===before.text,'Navigation modified source text');
   check(final.selectedText===(item.empty?'':item.generic?'y':'x'),'Wrong final selection: '+JSON.stringify(final.selectedText));
   if(item.generic)check(final.start===final.text.indexOf('prefix ')+7,'Wrong field inside literal argument prefix/suffix');
   check(!diagnostics.readEvents().some(e=>e.event==='selectFollowingArgument'),'Whole-argument fallback was used');
   await roundTrip();
  });
  await one('40-nested-typed-closers',async()=>{
   await insert(pd);await type('f');await type('('.repeat(40)+')'.repeat(40),true);
   for(let i=0;i<40;i++)await command('cursorLeft');
   await insert('\\bm{$1}$0');await type('z');await tab();const before=snapshot('after bm');
   for(let i=1;i<=40;i++){const s=await tab();check(s.start===before.start+i&&s.end===s.start,'Closer '+i+' was skipped');check(s.text===before.text,'Source changed');}
   const s=await tab();check(s.selectedText==='x','Deep pair navigation lost x');await roundTrip();
  });
  await one('subscript-inner-before-fraction',async()=>{
   await insert('\\frac{${1:numerator}}{${2:denominator}}${3}$0');await type('x_{1}',true);await command('cursorLeft');const at=snapshot('index').start;
   let s=await tab();check(s.start===at+1&&s.end===s.start,'Inner index brace was skipped');
   s=await tab();check(s.selectedText==='denominator','Did not reach denominator');await roundTrip();
  });
  await one('typed-adjacent-braces-are-not-native-arguments',async()=>{
   await insert(dm);await type('{a}{b}',true);for(let i=0;i<4;i++)await command('cursorLeft');const at=snapshot('inside typed pair').start;
   const s=await tab();check(s.start===at+1&&s.end===s.start,'Typed }{ incorrectly jumped to outer field');
  });
  await one('left-right-continuation',async()=>{
   await insert(dm);await insert('\\left(${1}\\right)${2}$0');await type('x');const before=snapshot('x');
   const first=await tab();check(first.start===before.text.indexOf('\\right)')+'\\right)'.length,'Wrong right) destination');
   const second=await tab();check(second.start===before.text.length,'Coincident final stop cost an extra Tab');
  });
  for(const [name,snippet,expected]of[
   ['terminal','${1:x}$0','x '],['earlier','\\frac{${1:n}}{${2:d}}$0','\\frac{ }{d}'],
   ['before-closer','\\bar{${1:X}}${2}$0','\\bar{ }']
  ])await one('space-'+name,async()=>{await insert(snippet);await command('latexSmartTab.insertContinuationSpace');check(snapshot('Space').text===expected,'Unexpected Space replacement behavior');});
  await one('space-edited-default',async()=>{
   await insert('${1:x}$0');await type('z');const d=editor.document;editor.selection=new vscode.Selection(d.positionAt(0),d.positionAt(1));await delay();
   await command('latexSmartTab.insertContinuationSpace');check(snapshot('Space').text===' ','Edited selection was preserved incorrectly');
  });
  for(const [content,start,end]of[['(z)',2,3],['[z]',2,3],['{z}',2,3],['\\[\n z\n\\]\n',6,9]])await one('plain-'+JSON.stringify(content),async()=>{
   const p=editor.document.positionAt(start);editor.selection=new vscode.Selection(p,p);await delay();
   const s=await tab('plain');check(s.start===end&&s.end===end,'Wrong plain delimiter destination');check(s.text===content,'Plain navigation changed text');
  },content);
  for(const eol of ['\n','\r\n'])await one('block-at-EOF-'+JSON.stringify(eol),async()=>{
   const d=editor.document,before=d.getText(),at=before.indexOf(eol+'  \\]');editor.selection=new vscode.Selection(d.positionAt(at),d.positionAt(at));await delay();
   const s=await tab('plain');check(s.text===before+eol+'  ','EOF exit did not preserve EOL and indentation');check(s.start===s.text.length,'EOF cursor not at next-line indentation');
  },'  \\['+eol+'   x'+eol+'  \\]');
  await one('native-block-final-on-closing-line',async()=>{
   await insert('\\[\n  $1\n\\]$0');await type('x');const s=await tab();check(s.text.replace(/\r\n/g,'\n')==='\\[\n  x\n\\]\n'&&s.start===s.text.length,'Block final $0 did not move to next physical line');
  });
  await one('nested-block-keeps-outer-field',async()=>{
   await insert('${1}\nnext: ${2:x}$0');await insert('\\[\n  $1\n\\]$0');await type('z');let s=await tab();check(s.start===s.text.indexOf('next:'),'Unexpected block exit position');
   s=await tab();check(s.selectedText==='x','Block normalization lost outer native field');await roundTrip();
  });
  await one('undo-redo-source-integrity-after-boundary-hop',async()=>{
   await insert(pd);await type('f');await pair('()',true);await insert('\\bm{$1}$0');await type('z');await tab();await tab();const before=snapshot('after pair escape');
   await command('undo');snapshot('undo');await command('redo');const after=snapshot('redo');check(after.text===before.text,'Undo/redo left a duplicated or missing delimiter');
   current.nativeSessionAfterUndo='Not asserted: native snippet restoration is not a public API guarantee';
  });
  await one('mirrored-native-fields',async()=>{
   await insert('${1:a} $1 ${2:b}$0');check(editor.selections.length===2,'Fixture did not create mirrored selections');
   await command('latexSmartTab.navigateSnippet');check(snapshot('native multi-field next').selectedText==='b','Multi-selection route did not reach next native field');
  });
  await one('unicode-context',async()=>{
   await insert(dm);await type('한글😀L');await pair('()',true);await insert('\\theta{}$0');const at=snapshot('unicode theta').start;
   const s=await tab();check(s.start===at+1&&s.end===s.start,'UTF-16 offset mismatch');
  });
  // Static prefix tests use an isolated fixture extension in CLI mode. In the
  // installed command they require the user's existing ff / ;th definitions.
  let fractionPrefixAvailable=false,thetaPrefixAvailable=false;
  await one('static-prefix-ff-prerequisite',async()=>{
   await type('ff');await tab('prefix');const s=snapshot('ff expanded');
   fractionPrefixAvailable=s.text.startsWith('\\frac{');
   if(!fractionPrefixAvailable&&!options.fixturesInstalled)throw new PrerequisiteError('Existing ff static snippet was not found; user settings/snippets were not changed');
   check(fractionPrefixAvailable,'Isolated ff fixture did not expand');
  });
  await one('static-prefix-theta-prerequisite',async()=>{
   await type(';th');await tab('prefix');thetaPrefixAvailable=snapshot(';th expanded').text==='\\theta{}';
   if(!thetaPrefixAvailable&&!options.fixturesInstalled)throw new PrerequisiteError('Existing ;th static snippet was not found');
   check(thetaPrefixAvailable,'Isolated ;th fixture did not expand');
  });
  for(const length of [99,100,101,250,1000])await one('long-static-prefix-'+length,async()=>{
   if(!fractionPrefixAvailable)throw new PrerequisiteError('ff prerequisite unavailable');
   const initial=editor.document.getText();const p=editor.document.positionAt(initial.length);editor.selection=new vscode.Selection(p,p);await delay();
   await tab(length>100?'plain':'prefix');const s=snapshot('expanded');
   check(s.text.startsWith(initial.slice(0,-2)+'\\frac{'),'Long-line prefix did not expand or left a probe space');check(s.selectedText.length>0,'First fraction field was not selected');
  },'x'.repeat(length-3)+'}ff');
  await one('real-theta-prefix-inside-dm',async()=>{
   if(!thetaPrefixAvailable)throw new PrerequisiteError(';th prerequisite unavailable');
   await insert(dm);await type('L');await pair('()',true);await type(';th');await tab('prefix');const before=snapshot('real ;th');
   const s=await tab();check(s.start===before.start+1&&s.end===s.start,'Actual ;th expansion bypassed the parenthesis stop');
  });
 } finally {
  diagnostics.stopRecording();running=false;
  if(!aborted&&original&&!original.document.isClosed)await vscode.window.showTextDocument(original.document);
 }
 const report={schemaVersion:2,actualExtensionHost:/^\d+\.\d+\.\d+/.test(vscode.version),physicalTabTest:Boolean(options.pressPhysicalTab),
  vscodeVersion:vscode.version,extensionVersion:vscode.extensions.getExtension('local-latex.latex-smart-tab-dispatcher')?.packageJSON.version,
  fixtures:options.fixturesInstalled?'isolated fixture extension + explicit templates':'explicit templates; optional existing user ff and ;th snippets',
  settingsModified:false,userFilesModified:false,aborted,
  passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status==='failed').length,
  skipped:results.filter(x=>x.status==='skipped').length,total:results.length,results};
 if(options.showReport!==false&&!aborted)await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({language:'json',content:JSON.stringify(report,null,2)}));
 return report;
};
