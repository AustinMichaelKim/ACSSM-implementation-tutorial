'use strict';

/**
 * Atomically re-anchor a native snippet boundary without changing LaTeX text.
 *
 * TextEditorEdit.insert/delete set forceMoveMarkers=true in VS Code. Two
 * boundary-touching operations are valid, non-overlapping edits:
 *     insert [p,p) = literal; delete [p,q) = existing identical literal.
 * Applied right-to-left, the original literal is deleted and reinserted.
 * Native point markers and the caret at p relocate to q. No new native
 * placeholder is introduced, and no manual selection is made outside one.
 *
 * Do not replace this pair with editBuilder.replace(range, sameText): replace
 * uses a different marker affinity. Do not split it into two editor.edit calls:
 * that would expose transient duplicate text and introduce a typing race.
 *
 * This is source-based on VS Code's public TextEditorEdit implementation; the
 * shipped Extension Host suite verifies the actual caret/session behavior.
 * See VERIFICATION.json for whether that suite has actually been executed.
 */
function planBoundaryHop(text, from, to) {
  if (typeof text !== 'string' || !Number.isInteger(from) || !Number.isInteger(to) ||
      from < 0 || to <= from || to > text.length) return undefined;
  return { from, to, literal: text.slice(from, to) };
}

function cursorAt(editor, offset) {
  return editor.selection.isEmpty && editor.document.offsetAt(editor.selection.active) === offset;
}

async function settleCursor(vscode, editor, offset) {
  if (cursorAt(editor, offset)) return true;
  // API edit completion and selection-notification delivery are separate RPCs.
  return new Promise(resolve => {
    let done = false;
    let timer;
    const finish = value => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      subscription.dispose();
      resolve(value);
    };
    const subscription = vscode.window.onDidChangeTextEditorSelection(event => {
      if (event.textEditor === editor && cursorAt(editor, offset)) finish(true);
    });
    timer = setTimeout(() => finish(cursorAt(editor, offset)), 150);
    if (cursorAt(editor, offset)) finish(true);
  });
}

async function hopBoundary(vscode, editor, target, transactions) {
  if (vscode.window.activeTextEditor !== editor || editor.selections.length !== 1 ||
      !editor.selection.isEmpty || editor.document.isClosed) {
    return { handled: false, reason: 'Boundary hop requires the same active single-cursor editor' };
  }
  const document = editor.document;
  const text = document.getText();
  const version = document.version;
  const plan = planBoundaryHop(text, document.offsetAt(editor.selection.active), document.offsetAt(target));
  if (!plan) return { handled: false, reason: 'Invalid boundary destination' };
  const key = document.uri.toString();
  const transaction = { text, version, from: plan.from, to: plan.to, observed: false };
  transactions.set(key, transaction);
  try {
    const start = document.positionAt(plan.from);
    const end = document.positionAt(plan.to);
    const applied = await editor.edit(builder => {
      // The empty insertion range ends exactly where the deletion starts.
      builder.insert(start, plan.literal);
      builder.delete(new vscode.Range(start, end));
    }, { undoStopBefore: false, undoStopAfter: false });
    if (!applied) return { handled: false, reason: 'VS Code rejected the atomic boundary edit; cursor not forced' };
    // Never restore a whole-document snapshot: that could overwrite typing by
    // the user or another extension. The transaction itself has zero text delta.
    if (vscode.window.activeTextEditor !== editor || document.isClosed ||
        document.getText() !== text || document.version > version + 1) {
      return { handled: true, concurrentEdit: true, from: plan.from, to: plan.to };
    }
    const arrived = await settleCursor(vscode, editor, plan.to);
    if (!arrived) return { handled: false, reason: 'Native caret did not follow the boundary edit; stopped instead of forcing selection' };
    return { handled: true, from: plan.from, to: plan.to, sourceTextUnchanged: true };
  } finally {
    if (transactions.get(key) === transaction) transactions.delete(key);
  }
}

module.exports = { planBoundaryHop, hopBoundary };
