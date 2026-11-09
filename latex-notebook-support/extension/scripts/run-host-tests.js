'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
async function main(){
 let runTests;
 try {({runTests}=require('@vscode/test-electron'));}
 catch {throw new Error('Install the test runner first: npm install --no-save @vscode/test-electron (requires network). Or run LaTeX Smart Tab: Run Regression Checks in the installed VS Code.');}
 const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'smart-tab-host-'));
 const userData=path.join(temp,'user-data'),extensions=path.join(temp,'extensions');
 fs.mkdirSync(path.join(userData,'User'),{recursive:true});fs.mkdirSync(extensions,{recursive:true});
 fs.cpSync(path.join(root,'test/fixtures-extension'),path.join(extensions,'local-latex.smart-tab-test-fixtures-0.0.0'),{recursive:true});
 fs.writeFileSync(path.join(userData,'User/settings.json'),JSON.stringify({
  'editor.tabCompletion':'onlySnippets','editor.snippetSuggestions':'none','editor.acceptSuggestionOnEnter':'on',
  'editor.autoClosingBrackets':'always','editor.autoClosingQuotes':'always',
  'workbench.startupEditor':'none','window.restoreWindows':'none','security.workspace.trust.enabled':false,
  'extensions.autoUpdate':false,'extensions.autoCheckUpdates':false
 },null,2));
 const opts={extensionDevelopmentPath:root,extensionTestsPath:path.join(root,'test/host-entry.js'),
  launchArgs:['--no-sandbox','--disable-gpu','--skip-welcome','--skip-release-notes','--disable-workspace-trust',
   '--user-data-dir',userData,'--extensions-dir',extensions],
  extensionTestsEnv:{SMART_TAB_REPORT:process.env.SMART_TAB_REPORT||path.join(root,'host-results.json'),SMART_TAB_PHYSICAL:process.env.SMART_TAB_PHYSICAL||'0'}};
 if(process.env.VSCODE_EXECUTABLE)opts.vscodeExecutablePath=process.env.VSCODE_EXECUTABLE;
 else opts.version=process.env.VSCODE_VERSION||'stable';
 try{await runTests(opts);}finally{fs.rmSync(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
