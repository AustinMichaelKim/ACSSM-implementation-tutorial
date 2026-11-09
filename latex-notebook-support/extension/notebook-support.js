'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

/** Resolve membership by the cell document URI, never by the active cell index. */
function findNotebookCell(vscode, document) {
  const key = document.uri.toString();
  for (const notebook of vscode.workspace.notebookDocuments || []) {
    for (const cell of notebook.getCells()) {
      if (cell.document.uri.toString() === key) return { notebook, cell };
    }
  }
  return undefined;
}
function isNotebookMarkdown(vscode, document) {
  if (!document || document.isClosed || document.languageId !== 'markdown') return false;
  const found = findNotebookCell(vscode, document);
  return Boolean(found && !found.notebook.isClosed &&
    found.notebook.notebookType === 'jupyter-notebook' &&
    found.cell.kind === vscode.NotebookCellKind.Markup);
}
function isTargetDocument(vscode, document) {
  if (!document || document.isClosed) return false;
  const found = findNotebookCell(vscode, document);
  if (found) return isNotebookMarkdown(vscode, document);
  // An opening/removed notebook cell must not fall through as a TeX file.
  if (document.uri.scheme === 'vscode-notebook-cell') return false;
  return document.languageId === 'latex';
}

/** JSONC scanner: preserve strings/escapes while removing comments and trailing commas. */
function parseJsonc(text) {
  let stripped = '', inString = false, escaped = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inString) {
      stripped += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') { inString = true; stripped += c; }
    else if (c === '/' && next === '/') {
      stripped += '  '; i++;
      while (i + 1 < text.length && !/[\r\n]/.test(text[i + 1])) { stripped += ' '; i++; }
    } else if (c === '/' && next === '*') {
      stripped += '  '; i++;
      let closed = false;
      while (++i < text.length) {
        if (text[i] === '*' && text[i + 1] === '/') { stripped += '  '; i++; closed = true; break; }
        stripped += /[\r\n]/.test(text[i]) ? text[i] : ' ';
      }
      if (!closed) throw new SyntaxError('Unterminated JSONC comment');
    } else stripped += c;
  }
  let result = ''; inString = false; escaped = false;
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i];
    if (inString) {
      result += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') { inString = true; result += c; }
    else if (c === ',' && /^\s*[}\]]/.test(stripped.slice(i + 1))) result += ' ';
    else result += c;
  }
  return JSON.parse(result);
}
function normalizeSnippets(definitions) {
  if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions)) {
    throw new TypeError('LaTeX snippet source must be a JSON object');
  }
  return Object.entries(definitions).filter(([, definition]) => definition &&
    (typeof definition.body === 'string' || Array.isArray(definition.body))).map(([name, definition]) => ({
      name,
      prefixes: (Array.isArray(definition.prefix) ? definition.prefix : [definition.prefix])
        .filter(prefix => typeof prefix === 'string' && prefix.length > 0),
      body: Array.isArray(definition.body) ? definition.body.join('\n') : definition.body,
      description: Array.isArray(definition.description) ? definition.description.join('\n') : definition.description,
      definition
    }));
}
function findPrefix(entries, before) {
  let best;
  for (const entry of entries) for (const prefix of entry.prefixes) {
    if (before.endsWith(prefix) && (!best || prefix.length > best.prefix.length)) best = { entry, prefix };
  }
  return best;
}

function createNotebookSupport(vscode, context, hooks) {
  const cache = new Map(), disposables = [];
  let lastError;
  const fallback = path.join(__dirname, 'snippets', 'latex.json');
  function entries(document) {
    const configured = vscode.workspace.getConfiguration('latexSmartTab', document && document.uri)
      .get('notebookSnippetSource', '');
    let source = configured || fallback;
    try {
      if (source.startsWith('file:')) source = fileURLToPath(source);
      if (!path.isAbsolute(source)) throw new Error('notebookSnippetSource must be an absolute extension-host path');
      const stamp = fs.statSync(source);
      const signature = `${stamp.mtimeMs}:${stamp.ctimeMs}:${stamp.size}`;
      const previous = cache.get(source);
      if (previous && previous.signature === signature) return previous.entries;
      const loaded = normalizeSnippets(parseJsonc(fs.readFileSync(source, 'utf8')));
      cache.set(source, { signature, entries: loaded }); lastError = undefined;
      return loaded;
    } catch (error) {
      const message = `Smart Tab: cannot read LaTeX snippets (${source}): ${error.message}`;
      if (message !== lastError) { lastError = message; vscode.window.setStatusBarMessage(message, 10000); }
      // Never silently substitute the packaged snapshot for a broken explicit source.
      return [];
    }
  }
  function match(editor) {
    if (!editor || !isNotebookMarkdown(vscode, editor.document) ||
        editor.selections.length !== 1 || !editor.selection.isEmpty) return undefined;
    const pos = editor.selection.active;
    return findPrefix(entries(editor.document), editor.document.lineAt(pos.line).text.slice(0, pos.character));
  }
  async function expand(editor) {
    const found = match(editor);
    if (!found) return false;
    const end = editor.selection.active;
    const range = new vscode.Range(new vscode.Position(end.line, end.character - found.prefix.length), end);
    return hooks.insert(editor, found.entry.body, range);
  }
  function resolve(args, document) {
    if (typeof args === 'string') return args;
    if (args && typeof args.snippet === 'string') return args.snippet;
    if (args && typeof args.name === 'string') {
      const entry = entries(document).find(item => item.name === args.name);
      return entry && entry.body;
    }
    return undefined;
  }
  function updateContext() {
    const editor = vscode.window.activeTextEditor;
    const found = match(editor);
    void vscode.commands.executeCommand('setContext', 'latexSmartTab.notebookHasSnippetCompletions', Boolean(found));
  }
  function listen(owner, event, listener) {
    if (typeof owner[event] === 'function') disposables.push(owner[event](listener));
  }
  listen(vscode.window, 'onDidChangeActiveTextEditor', updateContext);
  listen(vscode.window, 'onDidChangeTextEditorSelection', updateContext);
  listen(vscode.workspace, 'onDidChangeTextDocument', updateContext);
  listen(vscode.workspace, 'onDidOpenNotebookDocument', updateContext);
  listen(vscode.workspace, 'onDidChangeNotebookDocument', updateContext);
  listen(vscode.workspace, 'onDidCloseNotebookDocument', updateContext);
  listen(vscode.workspace, 'onDidChangeConfiguration', event => {
    if (event.affectsConfiguration('latexSmartTab.notebookSnippetSource')) { cache.clear(); updateContext(); }
  });
  disposables.push(vscode.commands.registerCommand('latexSmartTab.reloadNotebookSnippets', () => {
    cache.clear(); updateContext();
    return entries(vscode.window.activeTextEditor && vscode.window.activeTextEditor.document).length;
  }));
  disposables.push(vscode.commands.registerCommand('latexSmartTab.insertNotebookSnippet', async args => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isNotebookMarkdown(vscode, editor.document)) return false;
    let body = resolve(args, editor.document);
    if (body === undefined && !args) {
      const items = entries(editor.document).map(entry => ({ label: entry.name,
        description: entry.prefixes.join(', '), detail: entry.description, body: entry.body }));
      const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Insert a LaTeX snippet in this Markdown cell' });
      if (!picked || vscode.window.activeTextEditor !== editor || !isNotebookMarkdown(vscode, editor.document)) return false;
      body = picked.body;
    }
    if (body === undefined) return false;
    return hooks.insert(editor, body);
  }));
  disposables.push(vscode.commands.registerCommand('latexSmartTab.captureNotebookCompletion', record => {
    const editor = vscode.window.activeTextEditor;
    if (editor && record && hooks.captureCompletion) hooks.captureCompletion(editor, record);
  }));
  // No scheme/pattern: with notebookType these would refer to the notebook URI.
  disposables.push(vscode.languages.registerCompletionItemProvider(
    { language: 'markdown', notebookType: 'jupyter-notebook' },
    { provideCompletionItems(document, position) {
      if (!isNotebookMarkdown(vscode, document)) return [];
      // Keep the profile's LaTeX suggestion timing without changing Markdown or Code-cell settings.
      const latexEditor = vscode.workspace.getConfiguration('editor', { uri: document.uri, languageId: 'latex' });
      if (latexEditor.get('snippetSuggestions', 'inline') === 'none') return [];
      const before = document.lineAt(position.line).text.slice(0, position.character);
      const result = [];
      for (const entry of entries(document)) for (const prefix of entry.prefixes) {
        // Exact prefix completions also preserve punctuation such as ;th.
        if (!before.endsWith(prefix)) continue;
        const item = new vscode.CompletionItem(prefix, vscode.CompletionItemKind.Snippet);
        item.detail = entry.description || entry.name;
        item.documentation = entry.body;
        item.insertText = new vscode.SnippetString(entry.body);
        item.range = new vscode.Range(new vscode.Position(position.line, position.character - prefix.length), position);
        item.command = { command: 'latexSmartTab.captureNotebookCompletion', title: 'Track accepted LaTeX snippet',
          arguments: [{ uri: document.uri.toString(), version: document.version,
            documentLength: document.getText().length,
            startOffset: document.offsetAt(item.range.start), endOffset: document.offsetAt(item.range.end) }] };
        result.push(item);
      }
      return result;
    } }, ';'));
  updateContext();
  return { isNotebookMarkdown: document => isNotebookMarkdown(vscode, document),
    match, expand, resolve, updateContext,
    dispose() { for (const disposable of disposables) disposable.dispose(); cache.clear(); } };
}
module.exports = { findNotebookCell, isNotebookMarkdown, isTargetDocument, parseJsonc,
  normalizeSnippets, findPrefix, createNotebookSupport };
