'use strict';
const fs=require('node:fs'),path=require('node:path'),vscode=require('vscode');
async function run(){
 await new Promise(resolve=>setTimeout(resolve,5000));
 const extension=vscode.extensions.getExtension('local-latex.latex-smart-tab-dispatcher');
 if(!extension)throw new Error('Smart Tab development extension was not loaded');
 let startup;
 if(process.env.SMART_TAB_SKIP_NOTEBOOK!=='1') {
  const notebook=await vscode.workspace.openNotebookDocument('jupyter-notebook',new vscode.NotebookData([new vscode.NotebookCellData(vscode.NotebookCellKind.Markup,'','markdown')]));
  await vscode.window.showNotebookDocument(notebook,{preview:false});
  for(let i=0;i<50&&!extension.isActive;i++)await new Promise(resolve=>setTimeout(resolve,100));
  startup={notebookOpenedBeforeTex:true,activeWithoutExplicitActivate:extension.isActive};
  if(!extension.isActive)throw new Error('Extension did not activate with only a Jupyter Notebook open');
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
 }
 await extension.activate();
 const options={showReport:false,fixturesInstalled:true};
 if(process.env.SMART_TAB_PHYSICAL==='1') {
  const {execFileSync}=require('node:child_process');
  execFileSync('xdotool',['--version']);
  options.pressPhysicalTab=async()=>execFileSync('xdotool',['key','--clearmodifiers','Tab']);
 }
 let notebookReport;
 if(process.env.SMART_TAB_SKIP_NOTEBOOK!=='1') {
  const notebookOutput=process.env.SMART_TAB_NOTEBOOK_REPORT||path.join(__dirname,'../notebook-host-results.json');
  try {notebookReport=await require('./notebook-host-regression').run(extension.exports,{showReport:false,onCase:results=>fs.writeFileSync(notebookOutput,JSON.stringify({status:'running',actualExtensionHost:true,physicalKeyboard:false,results},null,2)+'\n')});}
  catch(error){notebookReport={actualExtensionHost:true,physicalKeyboard:false,failed:1,total:0,error:String(error.stack||error)};}
  notebookReport.startup=startup;
  fs.writeFileSync(notebookOutput,JSON.stringify(notebookReport,null,2)+'\n');
  console.log(`NOTEBOOK HOST: ${notebookReport.passed}/${notebookReport.total}, failures=${notebookReport.failed}, physical=false`);
 }
 if(process.env.SMART_TAB_NOTEBOOK_ONLY==='1'){if(notebookReport?.failed||notebookReport?.skipped)throw new Error('Notebook suite incomplete');return;}
 const report=await require('./host-regression').run(extension.exports,options);
 const output=process.env.SMART_TAB_REPORT||path.join(__dirname,'../host-results.json');
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 console.log(`HOST: ${report.passed}/${report.total}, failures=${report.failed}, skipped=${report.skipped}, physical=${report.physicalTabTest}`);
 if(notebookReport?.failed||notebookReport?.skipped||report.failed||report.skipped||report.aborted)throw new Error('Host acceptance suite did not pass completely; inspect '+output);
}
exports.run=async()=>{
 try {return await run();}
 catch(error){
  const fatal={actualExtensionHost:true,error:String(error.stack||error)};
  fs.writeFileSync(path.join(__dirname,'../host-fatal.json'),JSON.stringify(fatal,null,2));
  try {fs.writeFileSync((process.env.SMART_TAB_REPORT||path.join(__dirname,'../host-results.json'))+'.fatal.json',JSON.stringify(fatal,null,2));}catch{}
  console.error(error);throw error;
 }
};
