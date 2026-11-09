'use strict';
/** Behavioral contract model. It is intentionally NOT labelled a real VS Code
 * Extension Host. It uses the upstream marker-edit kernel, models native
 * parent-placeholder removal on merge, and invalidates sessions after cursor
 * moves outside their surviving fields. UI, RPC scheduling, transforms and
 * arbitrary snippet variables are outside this model. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { nodeAcceptEdit } = require('./vscode-markers');

class Position {
  constructor(line, character) { this.line = line; this.character = character; }
  isEqual(p) { return this.line === p.line && this.character === p.character; }
  isBefore(p) { return this.line < p.line || (this.line === p.line && this.character < p.character); }
  translate(lineDelta=0, characterDelta=0) { return new Position(this.line + lineDelta, this.character + characterDelta); }
}
class Range {
  constructor(a, b, c, d) {
    if (typeof a === 'number') { a = new Position(a,b); b = new Position(c,d); }
    this.start = a.isBefore(b) ? a : b; this.end = a.isBefore(b) ? b : a;
  }
  get isEmpty() { return this.start.isEqual(this.end); }
}
class Selection extends Range {
  constructor(a,b,c,d) {
    if (typeof a === 'number') { a = new Position(a,b); b = new Position(c,d); }
    super(a,b); this.anchor = a; this.active = b;
  }
}
function emitter() {
  const listeners = new Set();
  return { event: callback => { listeners.add(callback); return { dispose: () => listeners.delete(callback) }; },
    fire: value => { for (const fn of [...listeners]) fn(value); } };
}
let serial = 0;
class Document {
  constructor(text='') {
    this.text = text; this.version = 1; this.isClosed = false; this.languageId = 'latex';
    this.eol = text.includes('\r\n') ? 2 : 1;
    const id=++serial; this.uri = { toString: () => 'untitled:model-'+id };
  }
  getText(range) { return range ? this.text.slice(this.offsetAt(range.start), this.offsetAt(range.end)) : this.text; }
  get lineCount() { return this.text.split('\n').length; }
  positionAt(offset) {
    offset=Math.max(0,Math.min(this.text.length,offset)); const before=this.text.slice(0,offset);
    const line=(before.match(/\n/g)||[]).length; const start=before.lastIndexOf('\n')+1;
    return new Position(line, offset-start);
  }
  offsetAt(position) {
    const lines=this.text.split('\n'); let offset=0;
    for(let i=0;i<Math.min(position.line,lines.length-1);i++) offset+=lines[i].length+1;
    return Math.min(this.text.length,offset+Math.min(position.character,(lines[position.line]||'').replace(/\r$/,'').length));
  }
  lineAt(line) {
    const text=(this.text.split('\n')[line]||'').replace(/\r$/,'');
    return { text,range:new Range(new Position(line,0),new Position(line,text.length)),lineNumber:line,
      isEmptyOrWhitespace:!text.trim(),firstNonWhitespaceCharacterIndex:(text.match(/^\s*/)||[''])[0].length };
  }
  validateRange(range) { return new Range(this.positionAt(this.offsetAt(range.start)), this.positionAt(this.offsetAt(range.end))); }
}

// Fixture parser, not a replacement for VS Code's parser in the extension.
// Supported: numeric tabstops/defaults/choices, repeats, nested defaults, escapes.
function parseSnippet(template) {
  let i=0, text=''; const entries=[], values=new Map();
  function parse(untilBrace=false) {
    while(i<template.length) {
      const c=template[i];
      if(untilBrace && c==='}') { i++; return; }
      if(c==='\\' && /[\\$}]/.test(template[i+1]||'')) { text+=template[i+1];i+=2;continue; }
      if(c==='$') {
        const simple=/^\$(\d+)/.exec(template.slice(i));
        const complex=/^\$\{(\d+)([:}|])/.exec(template.slice(i));
        if(simple || complex) {
          const match=simple||complex, id=Number(match[1]), start=text.length;
          i+=match[0].length;
          if(complex && match[2]===':') parse(true);
          else if(complex && match[2]==='|') {
            const end=template.indexOf('|}',i); if(end<0) throw Error('Malformed fixture choice');
            text+=template.slice(i,end).split(',')[0]; i=end+2;
          } else if(values.has(id)) text+=values.get(id);
          if(!values.has(id)) values.set(id,text.slice(start));
          entries.push({id,start,end:text.length});continue;
        }
      }
      text+=c;i++;
    }
  }
  parse();
  if(!entries.some(x=>x.id===0)) entries.push({id:0,start:text.length,end:text.length});
  const ids=[...new Set(entries.map(x=>x.id))].sort((a,b)=>a===0?1:b===0?-1:a-b);
  return {text,groups:ids.map(id=>({id,rootFinal:id===0,ranges:entries.filter(x=>x.id===id).map(({start,end})=>({start,end}))}))};
}

function createHost(extensionDirectory, config={}) {
  const changes=emitter(),selections=emitter(),closes=emitter();
  const handlers=new Map(), calls=[],messages=[];
  const host={calls,messages,config,handlers,events:[],lastEdit:undefined,editFailure:false,session:undefined,undo:[],redo:[]};
  const vscode={Position,Range,Selection,EndOfLine:{LF:1,CRLF:2},version:'MODEL-NOT-VSCODE',
    ProgressLocation:{Notification:15},window:{activeTextEditor:undefined,
      onDidChangeTextEditorSelection:selections.event,setStatusBarMessage:text=>messages.push(text)},
    workspace:{getConfiguration:()=>({get:(name,fallback)=>Object.hasOwn(config,name)?config[name]:fallback}),
      onDidChangeTextDocument:changes.event,onDidCloseTextDocument:closes.event},
    commands:{registerCommand:(name,fn)=>{handlers.set(name,fn);return {dispose:()=>handlers.delete(name)};},executeCommand:async(name,...args)=>{
      calls.push(name); if(handlers.has(name)) return handlers.get(name)(...args); return builtin(name,args[0]);
    }}};
  host.vscode=vscode;
  function validateSession() {
    const session=host.session,editor=vscode.window.activeTextEditor;
    if(!session || !editor) return;
    if(session.groups[session.index]?.rootFinal) {host.session=undefined;return;}
    for(const selection of editor.selections) {
      const a=editor.document.offsetAt(selection.start),b=editor.document.offsetAt(selection.end);
      if(!session.groups.some(g=>g.ranges.some(r=>r.start<=a&&b<=r.end))) {host.session=undefined;return;}
    }
  }
  function setOffsets(editor,a,b=a,validate=true) {
    editor._selections=[new Selection(editor.document.positionAt(a),editor.document.positionAt(b))];
    if(validate) validateSession();selections.fire({textEditor:editor,selections:editor._selections,kind:3});
  }
  function setGroup(editor) {
    const session=host.session;if(!session)return;
    const group=session.groups[session.index];
    editor._selections=group.ranges.map(r=>new Selection(editor.document.positionAt(r.start),editor.document.positionAt(r.end)));
    validateSession();selections.fire({textEditor:editor,selections:editor._selections,kind:3});
  }
  function applyEdits(editor,edits,{validate=true,typing=false,explicitCursor,restoring=false}={}) {
    const doc=editor.document,old=doc.text;
    const sorted=[...edits].sort((a,b)=>b.end-a.end||b.start-a.start);
    const caretRanges=editor.selections.map(s=>({start:doc.offsetAt(s.start),end:doc.offsetAt(s.end),stickiness:1}));
    const fields=host.session?.groups.flatMap((g,i)=>g.ranges.map(r=>({r,active:i===host.session.index})))||[];
    for(const edit of sorted) {
      for(const {r,active} of fields) {
        r.stickiness=active?0:1;
        nodeAcceptEdit(r,edit.start,edit.end,edit.text.length,edit.force);
      }
      for(const r of caretRanges) nodeAcceptEdit(r,edit.start,edit.end,edit.text.length,edit.force);
      doc.text=doc.text.slice(0,edit.start)+edit.text+doc.text.slice(edit.end);
    }
    if(doc.text!==old&&!restoring){host.undo.push(old);host.redo.length=0;}
    doc.version++;
    const contentChanges=edits.map(e=>({rangeOffset:e.start,rangeLength:e.end-e.start,text:e.text,
      range:new Range(positionIn(old,e.start),positionIn(old,e.end))}));
    changes.fire({document:doc,contentChanges});
    if(explicitCursor!==undefined) setOffsets(editor,explicitCursor,explicitCursor,false);
    else {
      editor._selections=caretRanges.map(r=>new Selection(doc.positionAt(r.start),doc.positionAt(r.end)));
      // Native insertion at a collapsed caret remains collapsed.
      if(typing) for(const s of editor._selections) s.anchor=s.active;
      selections.fire({textEditor:editor,selections:editor._selections,kind:3});
    }
    if(validate) validateSession();
  }
  function positionIn(text,offset) {const d=new Document(text);return d.positionAt(offset);}
  host.newEditor=(text='')=>{
    host.session=undefined;host.undo=[];host.redo=[];
    const editor={document:new Document(text),_selections:[new Selection(new Position(0,0),new Position(0,0))],
      options:{tabSize:4,insertSpaces:true},revealRange:()=>{},
      async edit(callback,options) {
        const edits=[];
        const collect=(range,text,force)=>edits.push({start:this.document.offsetAt(range.start),end:this.document.offsetAt(range.end),text:text||'',force});
        callback({insert:(p,text)=>collect(new Range(p,p),text,true),delete:r=>collect(r,'',true),replace:(r,text)=>collect(r,text,false)});
        const ascending=[...edits].sort((a,b)=>a.end-b.end||a.start-b.start);
        for(let i=0;i<ascending.length-1;i++) if(ascending[i+1].start<ascending[i].end) throw Error('Overlapping ranges');
        host.lastEdit={edits,options};
        if(host.editFailure) return false;
        applyEdits(this,edits);return true;
      }};
    Object.defineProperty(editor,'selection',{get(){return this._selections[0];},set(s){this._selections=[s];validateSession();selections.fire({textEditor:this,selections:this._selections,kind:3});}});
    Object.defineProperty(editor,'selections',{get(){return this._selections;},set(ss){this._selections=ss;validateSession();selections.fire({textEditor:this,selections:ss,kind:3});}});
    vscode.window.activeTextEditor=editor;host.editor=editor;return editor;
  };
  function insertTemplate(template, replacement) {
    const editor=host.editor,doc=editor.document;
    const a=replacement?.start??doc.offsetAt(editor.selection.start),b=replacement?.end??doc.offsetAt(editor.selection.end);
    const parsed=parseSnippet(template),session=host.session,index=session?.index;
    applyEdits(editor,[{start:a,end:b,text:parsed.text,force:false}],{validate:false,explicitCursor:a});
    const groups=parsed.groups.map(g=>({...g,rootFinal:session?false:g.rootFinal,ranges:g.ranges.map(r=>({...r,start:r.start+a,end:r.end+a}))}));
    if(session) {session.groups.splice(index,1,...groups);session.index=index;host.session=session;}
    else host.session={groups,index:0};
    setGroup(editor);
  }
  function prefixMatch(ignoreScanLimit=false) {
    const e=host.editor;if(!e.selection.isEmpty)return;
    const before=e.document.lineAt(e.selection.active.line).text.slice(0,e.selection.active.character);
    if(!ignoreScanLimit && before.length>100 && !/\s/.test(before.slice(-100)))return;
    return Object.keys(host.snippets).sort((a,b)=>b.length-a.length).find(prefix=>before.endsWith(prefix));
  }
  async function builtin(name,args) {
    const editor=host.editor,doc=editor?.document;
    if(['hideSuggestWidget','editor.action.inlineSuggest.hide'].includes(name))return;
    if(name==='editor.action.insertSnippet')return insertTemplate(args.snippet);
    if(name==='insertSnippet') {
      const match=prefixMatch();if(!match)return;
      const end=doc.offsetAt(editor.selection.active);return insertTemplate(host.snippets[match],{start:end-match.length,end});
    }
    if(name==='jumpToNextSnippetPlaceholder'||name==='jumpToPrevSnippetPlaceholder') {
      if(!host.session)return;
      const delta=name==='jumpToNextSnippetPlaceholder'?1:-1;
      host.session.index=Math.max(0,Math.min(host.session.groups.length-1,host.session.index+delta));
      setGroup(editor);return;
    }
    if(name==='undo'||name==='redo') {
      const stack=name==='undo'?host.undo:host.redo, other=name==='undo'?host.redo:host.undo;
      if(!stack.length)return;const text=stack.pop();other.push(doc.text);host.session=undefined;
      applyEdits(editor,[{start:0,end:doc.text.length,text,force:true}],{restoring:true,explicitCursor:0});return;
    }
    if(name==='leaveSnippet') {host.session=undefined;return;}
    if(name==='cursorLeft'||name==='cursorRight') {
      const current=doc.offsetAt(editor.selection.active);setOffsets(editor,current+(name==='cursorLeft'?-1:1));return;
    }
    if(name==='type'||name==='default:type'||name==='tab') {
      const input=name==='tab'?'    ':args.text;
      const a=doc.offsetAt(editor.selection.start),b=doc.offsetAt(editor.selection.end);
      const pair=name==='type' && input.length===1 ? {'(':')','[':']','{':'}'}[input] : undefined;
      applyEdits(editor,[{start:a,end:b,text:input+(pair||''),force:false}],{validate:false,explicitCursor:a+input.length});
      validateSession();return;
    }
    throw Error('Unsupported model command '+name);
  }
  host.snippets={dm:'\\[\n    $1\n\\]\n$0',';th':'\\theta{}$0',pd:'\\frac{\\partial ${1:f}}{\\partial ${2:x}}$0',bv:'\\bm{$1}$0',
    ff:'\\frac{${1:numerator}}{${2:denominator}}${3}$0',lrp:'\\left(${1}\\right)${2}$0'};
  host.command=(name,args)=>vscode.commands.executeCommand(name,args);
  host.type=async text=>{for(const c of text)await host.command('type',{text:c});};
  host.insert=snippet=>host.command('latexSmartTab.insertSnippetTemplate',{snippet});
  host.tab=()=>{
    if(prefixMatch())return host.command('latexSmartTab.expandSnippet');
    return host.command(host.session?'latexSmartTab.navigateSnippet':'latexSmartTab.navigatePlain');
  };
  host.at=(offset,end=offset)=>setOffsets(host.editor,offset,end);
  host.snapshot=()=>({text:host.editor.document.getText(),start:host.editor.document.offsetAt(host.editor.selection.start),end:host.editor.document.offsetAt(host.editor.selection.end),
    selected:host.editor.document.getText(host.editor.selection),nativeAlive:!!host.session});
  const module={exports:{}};
  const source=fs.readFileSync(path.join(extensionDirectory,'extension.js'),'utf8');
  const context={require:name=>name==='vscode'?vscode:require(path.resolve(extensionDirectory,name)),module,exports:module.exports,console,setTimeout,clearTimeout};
  vm.runInNewContext(source,context,{filename:path.join(extensionDirectory,'extension.js')});
  host.exports=module.exports.activate({subscriptions:[],extension:{packageJSON:{version:JSON.parse(fs.readFileSync(path.join(extensionDirectory,'package.json'),'utf8')).version}}});
  host.dispose=()=>module.exports.deactivate();
  host.newEditor();
  return host;
}
module.exports={createHost,parseSnippet,Position,Range,Selection};
