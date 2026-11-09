'use strict';
const fs=require('node:fs'),path=require('node:path'),vscode=require('vscode');
exports.run=async()=>{
 const extension=vscode.extensions.getExtension('local-latex.latex-smart-tab-dispatcher');
 if(!extension)throw new Error('Smart Tab development extension was not loaded');
 await extension.activate();
 const options={showReport:false,fixturesInstalled:true};
 if(process.env.SMART_TAB_PHYSICAL==='1') {
  const {execFileSync}=require('node:child_process');
  execFileSync('xdotool',['--version']);
  options.pressPhysicalTab=async()=>execFileSync('xdotool',['key','--clearmodifiers','Tab']);
 }
 const report=await require('./host-regression').run(extension.exports,options);
 const output=process.env.SMART_TAB_REPORT||path.join(__dirname,'../host-results.json');
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 console.log(`HOST: ${report.passed}/${report.total}, failures=${report.failed}, skipped=${report.skipped}, physical=${report.physicalTabTest}`);
 if(report.failed||report.skipped||report.aborted)throw new Error('Host acceptance suite did not pass completely; inspect '+output);
};
