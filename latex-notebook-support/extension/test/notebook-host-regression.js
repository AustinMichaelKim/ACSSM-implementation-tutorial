'use strict';
/** Real VS Code Notebook API integration. Commands are invoked through the API;
 * this suite does not claim to send physical keyboard events. */
const vscode=require('vscode');
const delay=(ms=80)=>new Promise(resolve=>setTimeout(resolve,ms));
class TypingPrerequisiteError extends Error {}
function check(ok,message){if(!ok)throw new Error(message);}
exports.run=async function(diagnostics,options={}) {
 const results=[];let notebookEditor,editor,current;
 const original=vscode.window.activeNotebookEditor;
 function snapshot(label) {
  const doc=editor.document,s=editor.selection;
  const result={label,text:doc.getText(),selectedText:doc.getText(s),start:doc.offsetAt(s.start),end:doc.offsetAt(s.end),languageId:doc.languageId,uri:doc.uri.toString()};
  current.steps.push(result);return result;
 }
 async function command(name,args) {
  check(vscode.window.activeTextEditor===editor,'Text editor focus changed before '+name);
  await vscode.commands.executeCommand(name,args);await delay();
  check(vscode.window.activeTextEditor===editor,'Text editor focus changed after '+name);
 }
 async function type(text,manual=false){
  const before=snapshot('before typing');
  if(manual)await command('default:type',{text});else for(const c of text)await command('type',{text:c});
  const after=snapshot('after typing');
  if(text&&before.text===after.text&&before.start===after.start&&before.end===after.end)throw new TypingPrerequisiteError('Typing command did not reach the Notebook cell renderer; actualTextEditor alone does not prove DOM focus');
 }
 async function tab(mode='snippet'){await command(mode==='prefix'?'latexSmartTab.expandSnippet':mode==='plain'?'latexSmartTab.navigatePlain':'latexSmartTab.navigateSnippet');return snapshot('Tab '+mode);}
 async function open(kind=vscode.NotebookCellKind.Markup,language='markdown',content='') {
  const data=new vscode.NotebookData([new vscode.NotebookCellData(kind,content,language)]);
  const document=await vscode.workspace.openNotebookDocument('jupyter-notebook',data);
  notebookEditor=await vscode.window.showNotebookDocument(document,{preview:false});
  notebookEditor.selection=new vscode.NotebookRange(0,1);
  await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
  await vscode.commands.executeCommand('notebook.cell.edit');await delay(200);
  for(let i=0;i<30;i++) {
   editor=vscode.window.activeTextEditor;
   if(editor?.document.uri.toString()===document.cellAt(0).document.uri.toString())return;
   await delay();
  }
  throw Error('Could not focus the actual notebook cell text editor');
 }
 async function ensureTypingFocus(){
  for(let attempt=0;attempt<20;attempt++) {
   await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
   await vscode.commands.executeCommand('notebook.cell.edit');await delay(100);
   const before=editor.document.getText();
   await vscode.commands.executeCommand('type',{text:'q'});await delay();
   if(editor.document.getText()!==before) {
    await vscode.commands.executeCommand('undo');await delay();
    if(editor.document.getText()!==before)throw new TypingPrerequisiteError('Notebook typing-focus probe could not be undone');
    return;
   }
  }
  throw new TypingPrerequisiteError('Could not establish Notebook renderer text focus');
 }
 async function one(name,fn,kind,language,content) {
  current={name,status:'failed',steps:[],method:'real Notebook/TextEditor API commands; not physical keys'};
  try {
   await open(kind,language,content);await ensureTypingFocus();diagnostics.resetEvents();
   await fn();current.status='passed';
  } catch(error) {current.status=error instanceof TypingPrerequisiteError?'skipped':'failed';current.error=String(error.stack||error);}
  finally {
   current.events=diagnostics.readEvents();diagnostics.stopRecording();results.push(current);
   if(options.onCase)options.onCase(results);
   if(notebookEditor&&!notebookEditor.notebook.isClosed) {
    await vscode.commands.executeCommand('leaveSnippet');
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');await delay();
   }
  }
 }
 try {
  await one('notebook-only-startup-and-display-prefix-outside-math',async()=>{
   check(vscode.window.activeTextEditor.document.languageId==='markdown','Cell language was changed');
   await type('dm');await tab('prefix');const s=snapshot('dm');
   check(s.text.replace(/\r\n/g,'\n').startsWith('\\[\n')&&s.text.includes('\\]'),'Original display wrapper did not expand outside math');
  });
  await one('dm-L-theta-prefix-stays-inside-display',async()=>{
   await type('dm');await tab('prefix');await type('L()',true);await command('cursorLeft');
   await type(';th');await tab('prefix');const before=snapshot('theta expanded');
   check(before.text.includes('L(\\theta{})'),'Semicolon prefix did not expand exactly');
   const first=await tab();check(first.start===before.start+1&&first.end===first.start,'Tab escaped display before typed )');
   const second=await tab();check(second.start===before.text.length,'Tab did not leave display at final $0');
  });
  for(const pair of ['()','[]','{}'])await one('pd-exact-x-selection-'+pair,async()=>{
   await type('pd');await tab('prefix');await type('f'+pair,true);await command('cursorLeft');
   await type('bv');await tab('prefix');await type('z');const before=snapshot('z');
   const inner=await tab();check(inner.start===before.start+1&&inner.end===inner.start,'Nested bm brace skipped');
   const outer=await tab();check(outer.start===inner.start+1&&outer.end===outer.start,'Typed closer skipped');
   const x=await tab();check(x.selectedText==='x','Expected only x; got '+JSON.stringify(x.selectedText));
   check(!current.events?.some(e=>e.event==='selectFollowingArgument'),'Whole-argument fallback');
   await command('jumpToPrevSnippetPlaceholder');const previous=snapshot('Shift+Tab API');
   check(previous.start!==x.start||previous.end!==x.end,'Previous placeholder failed');
   let roundTrip=false;for(let i=0;i<16;i++){await command('jumpToNextSnippetPlaceholder');const s=snapshot('Next native');if(s.start===x.start&&s.end===x.end){roundTrip=true;break;}}
   check(roundTrip,'Native session lost after typed closer');
  });
  await one('named-latex-snippet-in-markdown',async()=>{
   await command('latexSmartTab.insertSnippetTemplate',{name:'Bold vector',langId:'latex'});
   await type('z');const s=snapshot('named');check(s.text==='\\bm{z}','Named latex definition was not resolved');
  });
  await one('native-mirrored-placeholder-and-variable-transform',async()=>{
   await command('latexSmartTab.insertSnippetTemplate',{snippet:'${1:foo} $1 ${1/(.*)/${1:/upcase}/} ${2:end}$0'});
   await type('bar');let s=snapshot('mirrors');check(s.text.startsWith('bar bar '),'Mirrored edits were lost');
   await command('jumpToNextSnippetPlaceholder');s=snapshot('transform after advance');
   check(s.text.includes('BAR'),'Native transform was not evaluated');check(s.selectedText==='end','Default placeholder not selected');
  });
  await one('selected-text-wrapper-uses-native-variable',async()=>{
   await type('chosen',true);const d=editor.document;editor.selection=new vscode.Selection(d.positionAt(0),d.positionAt(6));await delay();
   await command('latexSmartTab.insertSnippetTemplate',{snippet:'\\text{${TM_SELECTED_TEXT}}$0'});
   check(snapshot('wrapped').text==='\\text{chosen}','TM_SELECTED_TEXT not preserved');
  });
  await one('undo-redo-after-notebook-prefix',async()=>{
   await type('pd');await tab('prefix');await type('f()',true);await command('cursorLeft');
   await type('bv');await tab('prefix');await type('z');await tab();await tab();const before=snapshot('before undo');check(before.text.includes('\\frac{')&&before.text.includes('z'),'Undo fixture was never inserted');
   await command('undo');snapshot('undo');await command('redo');check(snapshot('redo').text===before.text,'Undo/redo changed source');
  });
  for(const [language,kind] of [['python',vscode.NotebookCellKind.Code],['latex',vscode.NotebookCellKind.Code]])await one('code-cell-excluded-'+language,async()=>{
   const before=snapshot('before');await command('latexSmartTab.insertSnippetTemplate',{snippet:'SHOULD_NOT_INSERT'});
   check(snapshot('after').text===before.text,'Direct command modified an excluded code cell');
  },kind,language,'unchanged');
  await one('language-change-clears-notebook-target',async()=>{
   await type('dm');await tab('prefix');check(snapshot('dm before language change').text.includes('\\['),'dm did not expand before language-change test');
   editor=await vscode.window.showTextDocument(await vscode.languages.setTextDocumentLanguage(editor.document,'plaintext'));
   const before=snapshot('language changed');await command('latexSmartTab.insertSnippetTemplate',{snippet:'SHOULD_NOT_INSERT'});
   check(snapshot('after').text===before.text,'Stale state edited a cell after language change');
  });
 } finally {
  diagnostics.stopRecording();
  if(original&&!original.notebook.isClosed)await vscode.window.showNotebookDocument(original.notebook);
 }
 const report={schemaVersion:1,actualExtensionHost:/^\d+\.\d+\.\d+/.test(vscode.version),physicalKeyboard:false,
  vscodeVersion:vscode.version,extensionVersion:vscode.extensions.getExtension('local-latex.latex-smart-tab-dispatcher')?.packageJSON.version,
  passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status==='failed').length,skipped:results.filter(x=>x.status==='skipped').length,total:results.length,results};
 if(options.showReport!==false)await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({language:'json',content:JSON.stringify(report,null,2)}));
 return report;
};
