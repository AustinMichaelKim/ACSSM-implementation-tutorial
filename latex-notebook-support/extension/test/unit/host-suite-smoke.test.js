'use strict';
/** Fixture/script smoke test only. Electron, UI and actual Extension Host RPC
 * are NOT executed. The real suite must report actualExtensionHost:false here. */
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const {createHost}=require('../support/model-host');
test('real-host suite fixture logic smoke-tested in model, never labelled real host',async()=>{
 const root=path.resolve(__dirname,'../..'),h=createHost(root),vscode=h.vscode;
 vscode.workspace.openTextDocument=async options=>options;
 vscode.window.showTextDocument=async doc=>h.newEditor(typeof doc.getText==='function'?doc.getText():doc.content||'');
 vscode.extensions={getExtension:()=>({packageJSON:{version:'0.3.2'},exports:h.exports})};
 const command=vscode.commands.executeCommand;
 vscode.commands.executeCommand=async(name,...args)=>{
  if(name==='workbench.action.revertAndCloseActiveEditor'){h.editor.document.isClosed=true;vscode.window.activeTextEditor=undefined;return;}
  if(name==='workbench.action.focusActiveEditorGroup')return;
  return command(name,...args);
 };
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'test/host-regression.js'),'utf8'),{
  module,exports:module.exports,require:name=>name==='vscode'?vscode:require(name),
  setTimeout:callback=>setTimeout(callback,0),console
 },{filename:'model-smoke/host-regression.js'});
 try {
  const report=await module.exports.run(h.exports,{showReport:false,fixturesInstalled:true});
  assert.equal(report.actualExtensionHost,false);assert.equal(report.physicalTabTest,false);
  assert.equal(report.aborted,false);
  assert.equal(report.failed,0,JSON.stringify(report.results.filter(x=>x.status==='failed').map(x=>({name:x.name,error:x.error}))));
  assert.equal(report.skipped,0);assert.ok(report.total>=40);
  if(process.env.SMART_TAB_MODEL_SMOKE_REPORT)fs.writeFileSync(process.env.SMART_TAB_MODEL_SMOKE_REPORT,JSON.stringify({
   environment:'behavioral-model-smoke-NOT-real-VS-Code',actualExtensionHost:false,physicalTabTest:false,
   total:report.total,passed:report.passed,failed:report.failed,skipped:report.skipped,
   cases:report.results.map(({name,status,error})=>({name,status,error}))
  },null,2));
 } finally {h.dispose();}
});
