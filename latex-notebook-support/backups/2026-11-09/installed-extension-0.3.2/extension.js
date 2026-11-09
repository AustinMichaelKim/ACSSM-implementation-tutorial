'use strict';

const vscode = require('vscode');
const { hopBoundary } = require('./boundary-hop');

const __events = [];
let __enabled = false;
let __documentUri;
function __trace(event, detail) {
  if (!__enabled) return;
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'latex') return;
  if (__documentUri && editor.document.uri.toString() !== __documentUri) return;
  const match = getImmediateInlineClosingMatch(editor);
  __events.push({ event, detail, time: Date.now(),
    documentVersion: editor.document.version,
    text: editor.document.getText(), selection: selectionOffsets(editor),
    selectedText: editor.document.getText(editor.selection),
    editorHasSelection: !editor.selection.isEmpty,
    trackedPlaceholder: trackedPlaceholder && { ...trackedPlaceholder },
    usablePlaceholder: getTrackedPlaceholder(editor),
    closer: match && { token: match.token, start: match.startOffset,
      end: match.endOffset, typed: isTypedClosingMatch(editor, match),
      snippetOwned: isSnippetOwnedClosingMatch(editor, match) }
  });
  if (__events.length > 2000) __events.shift();
}

const {
  mapOffset,
  transformRange,
  transformTokenRange,
  normalizeClosingTokens,
  findLongLineSnippetPrefixProbe,
  findInlineClosingMatch,
  findClosingTokensInInsertedText,
  hasOnlyIgnorableLineTail,
  isStandaloneBlockCloser,
  nextLineEntryCharacter
} = require('./core');

const DEFAULT_CLOSING_TOKENS = [
  '\\end{displaymath}',
  '\\end{equation*}',
  '\\end{equation}',
  '\\end{alignat*}',
  '\\end{alignat}',
  '\\end{align*}',
  '\\end{aligned}',
  '\\end{align}',
  '\\end{flalign*}',
  '\\end{flalign}',
  '\\end{gather*}',
  '\\end{gather}',
  '\\end{multline*}',
  '\\end{multline}',
  '\\end{bmatrix}',
  '\\end{pmatrix}',
  '\\end{vmatrix}',
  '\\end{Vmatrix}',
  '\\end{cases}',
  '\\right\\rangle',
  '\\right\\}',
  '\\right)',
  '\\right]',
  '\\rangle',
  '\\)',
  '\\]',
  '}',
  ')',
  ']'
];

const DEFAULT_BLOCK_CLOSING_TOKENS = [
  '\\]',
  '\\end{displaymath}',
  '\\end{equation*}',
  '\\end{equation}',
  '\\end{alignat*}',
  '\\end{alignat}',
  '\\end{align*}',
  '\\end{align}',
  '\\end{flalign*}',
  '\\end{flalign}',
  '\\end{gather*}',
  '\\end{gather}',
  '\\end{multline*}',
  '\\end{multline}'
];

const NATIVE_SNIPPET_PREFIX_SCAN_LIMIT = 100;
const DEFAULT_PREFIX_PROBE_CHARACTERS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_;';

/**
 * VS Code does not expose the active snippet placeholder through the public
 * extension API. We therefore capture the selection after our snippet and
 * tab-stop commands and update its offsets as text is edited.
 */
let trackedPlaceholder;

/**
 * Closers inserted by ordinary typing, paste, completion, or VS Code's
 * auto-closing-pair feature. Snippet-template closers are deliberately not
 * recorded. This lets an outer manually typed pair such as
 *
 *     (\\frac{x}{y} | )
 *
 * win over an outer snippet tab stop, while generated argument braces in
 * \\frac{$1}{$2} remain normal snippet boundaries.
 */
const typedClosersByDocument = new Map();
/**
 * Closing tokens inserted by snippets expanded through this extension.
 *
 * These markers are kept separately from ordinary/auto-paired closers so the
 * lexical recovery for round parentheses cannot mistake a snippet-owned
 * `)`/`\\right)` for a manually typed outer pair. Without this distinction an
 * `lrp` snippet leaves its coincident `$0` behind, producing a visually empty
 * extra Tab before the surrounding snippet can advance.
 */
const snippetClosersByDocument = new Map();

/**
 * Text spans inserted by snippets expanded through this extension. All
 * reviewed snippets place their final `$0` at the end of the inserted text.
 * The tracked end lets Space distinguish an untouched terminal default such
 * as `${4:x}$0` from an earlier default followed by real snippet structure.
 */
const snippetRangesByDocument = new Map();
let snippetInsertionDepth = 0;
// An identity edit changes native tracked-range affinity, not source text.
// Do not interpret its delete+insert pair as ordinary user changes.
const boundaryTransactions = new Map();
const transientProbesByDocument = new Map();
let commandQueue = Promise.resolve();
let operationEditor;

function serializeEditorCommand(handler) {
  return (...args) => {
    const requestedEditor = vscode.window.activeTextEditor;
    const task = commandQueue.then(async () => {
      if (!requestedEditor || vscode.window.activeTextEditor !== requestedEditor || requestedEditor.document.isClosed) return false;
      operationEditor = requestedEditor;
      if (args[0] && typeof args[0].inSnippetMode === 'boolean') {
        __trace('context:keybinding', args[0]);
      }
      try { return await handler(...args); }
      catch (error) {
        __trace('command:error', { message: String(error.message || error) });
        vscode.window.setStatusBarMessage('Smart Tab stopped safely: ' + String(error.message || error), 5000);
        return false;
      } finally { operationEditor = undefined; }
    });
    commandQueue = task.catch(() => undefined);
    return task;
  };
}

function documentKey(document) {
  return document.uri.toString();
}

function sameDocument(editor, tracked) {
  return Boolean(
    editor &&
      tracked &&
      editor.document.uri.toString() === tracked.documentUri
  );
}

function documentLength(document) {
  return document.getText().length;
}

function clamp(value, lower, upper) {
  return Math.max(lower, Math.min(upper, value));
}

function captureCurrentPlaceholder(editor) {
  __trace("captureCurrentPlaceholder");
  if (!editor || editor.selections.length !== 1) {
    trackedPlaceholder = undefined;
    return;
  }

  const selection = editor.selection;
  const startOffset = editor.document.offsetAt(selection.start);
  const endOffset = editor.document.offsetAt(selection.end);

  trackedPlaceholder = {
    documentUri: editor.document.uri.toString(),
    startOffset,
    endOffset,
    documentVersion: editor.document.version,
    editedSinceCapture: false
  };
}

function clearTrackedPlaceholder(editor) {
  __trace("clearTrackedPlaceholder");
  if (!editor || sameDocument(editor, trackedPlaceholder)) {
    trackedPlaceholder = undefined;
  }
}

function changeTouchesRange(change, startOffset, endOffset) {
  const changeStart = change.rangeOffset;
  const changeEnd = change.rangeOffset + change.rangeLength;

  if (change.rangeLength === 0) {
    return changeStart >= startOffset && changeStart <= endOffset;
  }

  if (startOffset === endOffset) {
    return changeStart <= startOffset && changeEnd >= endOffset;
  }

  return changeStart < endOffset && changeEnd > startOffset;
}

function updateTrackedPlaceholder(event) {
  if (
    !trackedPlaceholder ||
    event.document.uri.toString() !== trackedPlaceholder.documentUri
  ) {
    return;
  }

  const editedSinceCapture = Boolean(
    trackedPlaceholder.editedSinceCapture ||
      event.contentChanges.some((change) =>
        changeTouchesRange(
          change,
          trackedPlaceholder.startOffset,
          trackedPlaceholder.endOffset
        )
      )
  );
  const transformed = transformRange(trackedPlaceholder, event.contentChanges);
  const length = documentLength(event.document);

  trackedPlaceholder.startOffset = clamp(transformed.startOffset, 0, length);
  trackedPlaceholder.endOffset = clamp(
    Math.max(transformed.endOffset, trackedPlaceholder.startOffset),
    trackedPlaceholder.startOffset,
    length
  );
  trackedPlaceholder.documentVersion = event.document.version;
  trackedPlaceholder.editedSinceCapture = editedSinceCapture;
}

function getTrackedPlaceholder(editor) {
  if (!sameDocument(editor, trackedPlaceholder)) {
    return undefined;
  }

  const length = documentLength(editor.document);
  const startOffset = clamp(trackedPlaceholder.startOffset, 0, length);
  const endOffset = clamp(
    Math.max(trackedPlaceholder.endOffset, startOffset),
    startOffset,
    length
  );
  const cursorOffset = editor.document.offsetAt(editor.selection.active);

  // Do not apply stale bounds after a manual cursor move.
  if (cursorOffset < startOffset || cursorOffset > endOffset) {
    return undefined;
  }

  return {
    startOffset,
    endOffset,
    editedSinceCapture: Boolean(trackedPlaceholder.editedSinceCapture)
  };
}

function readConfigForResource(resource) {
  const config = vscode.workspace.getConfiguration('latexSmartTab', resource);
  const configuredTokens = config.get('closingTokens', DEFAULT_CLOSING_TOKENS);
  const configuredBlockTokens = config.get(
    'blockClosingTokens',
    DEFAULT_BLOCK_CLOSING_TOKENS
  );

  return {
    skipBlankChar: config.get('skipBlankChar', true),
    enableMultilineMode: config.get('enableMultilineMode', true),
    escapeTypedClosersAcrossPlaceholder: config.get(
      'escapeTypedClosersAcrossPlaceholder',
      true
    ),
    recoverSequentialArguments: config.get(
      'recoverSequentialArguments',
      true
    ),
    recoverLongLineSnippetPrefixes: config.get(
      'recoverLongLineSnippetPrefixes',
      true
    ),
    prefixProbeCharacters: config.get(
      'prefixProbeCharacters',
      DEFAULT_PREFIX_PROBE_CHARACTERS
    ),
    preserveUntouchedTerminalDefaultOnSpace: config.get(
      'preserveUntouchedTerminalDefaultOnSpace',
      true
    ),
    exitBlockClosersToNextLine: config.get(
      'exitBlockClosersToNextLine',
      true
    ),
    blockClosingTokens: normalizeClosingTokens(
      Array.isArray(configuredBlockTokens)
        ? configuredBlockTokens
        : DEFAULT_BLOCK_CLOSING_TOKENS
    ),
    closingTokens: normalizeClosingTokens(
      Array.isArray(configuredTokens)
        ? configuredTokens
        : DEFAULT_CLOSING_TOKENS
    )
  };
}

function readConfig(editor) {
  return readConfigForResource(editor.document.uri);
}

function newOffsetForChange(change, precedingDelta) {
  return change.rangeOffset + precedingDelta;
}

function validateCloserMarker(document, marker) {
  if (
    marker.startOffset < 0 ||
    marker.endOffset > documentLength(document) ||
    marker.endOffset <= marker.startOffset
  ) {
    return false;
  }

  const start = document.positionAt(marker.startOffset);
  const end = document.positionAt(marker.endOffset);
  return document.getText(new vscode.Range(start, end)) === marker.token;
}

function transformExistingCloserMarkers(event, markerMap) {
  const key = documentKey(event.document);
  const existing = markerMap.get(key) || [];
  const transformed = [];

  for (const marker of existing) {
    const range = transformTokenRange(marker, event.contentChanges);
    const next = {
      token: marker.token,
      startOffset: range.startOffset,
      endOffset: range.endOffset
    };

    if (validateCloserMarker(event.document, next)) {
      transformed.push(next);
    }
  }

  return transformed;
}

function appendInsertedCloserMarkers(event, markers) {
  const config = readConfigForResource(event.document.uri);
  const sortedChanges = [...event.contentChanges].sort((left, right) => {
    if (left.rangeOffset !== right.rangeOffset) {
      return left.rangeOffset - right.rangeOffset;
    }
    return left.rangeLength - right.rangeLength;
  });

  let precedingDelta = 0;
  for (const change of sortedChanges) {
    const insertionStart = newOffsetForChange(change, precedingDelta);
    const matches = findClosingTokensInInsertedText(
      change.text,
      config.closingTokens
    );

    for (const match of matches) {
      const marker = {
        token: match.token,
        startOffset: insertionStart + match.startOffset,
        endOffset: insertionStart + match.endOffset
      };
      if (validateCloserMarker(event.document, marker)) {
        markers.push(marker);
      }
    }

    precedingDelta += change.text.length - change.rangeLength;
  }
}

function storeCloserMarkers(markerMap, key, markers) {
  // Remove duplicates and keep memory bounded for long editing sessions.
  const deduplicated = [];
  const seen = new Set();
  for (const marker of markers) {
    const identity = `${marker.startOffset}:${marker.endOffset}:${marker.token}`;
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    deduplicated.push(marker);
  }

  markerMap.set(key, deduplicated.slice(-2000));
}

function validateSnippetRange(document, range) {
  return Boolean(
    range.startOffset >= 0 &&
      range.endOffset <= documentLength(document) &&
      range.endOffset > range.startOffset
  );
}

function transformExistingSnippetRanges(event) {
  const key = documentKey(event.document);
  const existing = snippetRangesByDocument.get(key) || [];
  const transformed = [];

  for (const range of existing) {
    const next = transformRange(range, event.contentChanges);
    if (validateSnippetRange(event.document, next)) {
      transformed.push(next);
    }
  }

  return transformed;
}

function appendInsertedSnippetRanges(event, ranges) {
  const sortedChanges = [...event.contentChanges].sort((left, right) => {
    if (left.rangeOffset !== right.rangeOffset) {
      return left.rangeOffset - right.rangeOffset;
    }
    return left.rangeLength - right.rangeLength;
  });

  let precedingDelta = 0;
  for (const change of sortedChanges) {
    const insertionStart = newOffsetForChange(change, precedingDelta);
    if (change.text.length > 0) {
      const range = {
        startOffset: insertionStart,
        endOffset: insertionStart + change.text.length
      };
      if (validateSnippetRange(event.document, range)) {
        ranges.push(range);
      }
    }
    precedingDelta += change.text.length - change.rangeLength;
  }
}

function storeSnippetRanges(key, ranges) {
  const deduplicated = [];
  const seen = new Set();

  for (const range of ranges) {
    const identity = `${range.startOffset}:${range.endOffset}`;
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    deduplicated.push(range);
  }

  snippetRangesByDocument.set(key, deduplicated.slice(-2000));
}

/**
 * Update ordinary/snippet-owned closing-token markers and inserted-snippet
 * spans through a document edit, then record newly inserted structures in the
 * correct collection.
 */
function updateCloserMarkers(event) {
  if (event.document.languageId !== 'latex') {
    return;
  }

  const key = documentKey(event.document);
  const typedMarkers = transformExistingCloserMarkers(
    event,
    typedClosersByDocument
  );
  const snippetMarkers = transformExistingCloserMarkers(
    event,
    snippetClosersByDocument
  );
  const snippetRanges = transformExistingSnippetRanges(event);

  if (snippetInsertionDepth > 0) {
    appendInsertedCloserMarkers(event, snippetMarkers);
    appendInsertedSnippetRanges(event, snippetRanges);
  } else {
    appendInsertedCloserMarkers(event, typedMarkers);
  }

  storeCloserMarkers(typedClosersByDocument, key, typedMarkers);
  storeCloserMarkers(snippetClosersByDocument, key, snippetMarkers);
  storeSnippetRanges(key, snippetRanges);
}

/** Track only our temporary long-prefix separator, including intervening edits. */
function updateTransientProbe(event) {
  const record = transientProbesByDocument.get(documentKey(event.document));
  if (!record) return;
  record.restoreOffset = mapOffset(record.restoreOffset, event.contentChanges, 'right');
  if (record.awaitingCreation) {
    const change = event.contentChanges.find(change => change.rangeOffset === record.startOffset &&
      change.rangeLength === 0 && change.text === ' ');
    if (event.document.version === record.creationVersion + 1 && change) {
      record.awaitingCreation = false;
      record.endOffset = record.startOffset + 1;
      record.valid = true;
    }
    return;
  }
  if (!record.valid) return;
  Object.assign(record, transformTokenRange(record, event.contentChanges));
  record.valid = record.endOffset - record.startOffset === 1 &&
    event.document.getText(new vscode.Range(event.document.positionAt(record.startOffset),
      event.document.positionAt(record.endOffset))) === ' ';
}

function handleDocumentChange(event) {
  const transaction = boundaryTransactions.get(documentKey(event.document));
  if (transaction && event.document.getText() === transaction.text &&
      event.document.version === transaction.version + 1) {
    transaction.observed = true;
    if (sameDocument({ document: event.document }, trackedPlaceholder)) {
      trackedPlaceholder.documentVersion = event.document.version;
    }
    __trace('boundaryHop:identity-event', { from: transaction.from, to: transaction.to });
    return;
  }
  updateTransientProbe(event);
  updateTrackedPlaceholder(event);
  updateCloserMarkers(event);
}

function positionWithinMaximum(editor, position, maximumEndOffset) {
  if (maximumEndOffset === undefined) {
    return true;
  }
  return editor.document.offsetAt(position) <= maximumEndOffset;
}

function createClosingTarget(
  editor,
  lineNumber,
  lineText,
  token,
  startCharacter,
  endCharacter,
  config,
  discoveredOnLaterLine = false
) {
  const start = new vscode.Position(lineNumber, startCharacter);
  const tokenEnd = new vscode.Position(lineNumber, endCharacter);
  const exitsToNextLine = Boolean(
    config.exitBlockClosersToNextLine &&
      isStandaloneBlockCloser(
        lineText,
        startCharacter,
        endCharacter,
        token,
        config.blockClosingTokens
      )
  );

  return {
    token,
    start,
    tokenEnd,
    target: tokenEnd,
    startOffset: editor.document.offsetAt(start),
    endOffset: editor.document.offsetAt(tokenEnd),
    closingLine: lineNumber,
    discoveredOnLaterLine,
    exitsToNextLine
  };
}

function getImmediateInlineClosingMatch(editor) {
  const selection = editor.selection;
  if (!selection.isEmpty) {
    return undefined;
  }

  const position = selection.active;
  const config = readConfig(editor);
  const lineText = editor.document.lineAt(position.line).text;
  const match = findInlineClosingMatch(
    lineText,
    position.character,
    config.closingTokens,
    config.skipBlankChar
  );

  if (!match) {
    return undefined;
  }

  return createClosingTarget(
    editor,
    position.line,
    lineText,
    match.token,
    match.startCharacter,
    match.endCharacter,
    config,
    false
  );
}

/**
 * Detect whether the immediate closing token was inserted by ordinary editing
 * rather than by a snippet template. A one-character marker at the end also
 * counts for a longer LaTeX closer such as `\\right)`.
 */
function isRecordedClosingMatch(editor, match, markerMap) {
  const markers = markerMap.get(documentKey(editor.document)) || [];

  return markers.some(
    (marker) =>
      marker.endOffset === match.endOffset &&
      marker.startOffset >= match.startOffset &&
      marker.endOffset <= match.endOffset
  );
}

function isTypedClosingMatch(editor, match) {
  return isRecordedClosingMatch(editor, match, typedClosersByDocument);
}

function isSnippetOwnedClosingMatch(editor, match) {
  return isRecordedClosingMatch(editor, match, snippetClosersByDocument);
}


/**
 * Return the following `{...}` argument when the current closer is the `}` of
 * a sequential LaTeX argument boundary such as `}{` in `\\frac{...}{...}`.
 *
 * This is intentionally a small lexical recovery, not a full TeX parser. It
 * permits whitespace/newlines between arguments, ignores escaped braces, and
 * balances nested braces inside the next argument. The result lets Smart Tab distinguish a
 * semantically useful next field from a visually different but useless cursor
 * position between `}` and `{`.
 */
function findFollowingBracedArgument(editor, match) {
  if (!match || match.token !== '}') {
    return undefined;
  }

  const documentText = editor.document.getText();
  let openOffset = match.endOffset;

  // Whitespace and TeX comments may separate consecutive arguments.
  while (openOffset < documentText.length) {
    if (/\s/.test(documentText[openOffset])) { openOffset += 1; continue; }
    if (documentText[openOffset] === '%' && !isEscapedCharacter(documentText, openOffset)) {
      const newline = documentText.indexOf('\n', openOffset);
      if (newline < 0) return undefined;
      openOffset = newline + 1;
      continue;
    }
    break;
  }

  if (
    documentText[openOffset] !== '{' ||
    isEscapedCharacter(documentText, openOffset)
  ) {
    return undefined;
  }

  let depth = 1;
  let closeOffset = openOffset + 1;

  for (; closeOffset < documentText.length; closeOffset += 1) {
    const character = documentText[closeOffset];
    if (character === '%' && !isEscapedCharacter(documentText, closeOffset)) {
      const newline = documentText.indexOf('\n', closeOffset);
      if (newline < 0) return undefined;
      closeOffset = newline;
      continue;
    }
    if (
      (character === '{' || character === '}') &&
      isEscapedCharacter(documentText, closeOffset)
    ) {
      continue;
    }

    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        break;
      }
    }
  }

  if (depth !== 0) {
    return undefined;
  }

  const contentStart = editor.document.positionAt(openOffset + 1);
  const contentEnd = editor.document.positionAt(closeOffset);

  return {
    open: editor.document.positionAt(openOffset),
    contentStart,
    contentEnd,
    close: editor.document.positionAt(closeOffset),
    startOffset: openOffset + 1,
    endOffset: closeOffset
  };
}

function selectionOffsets(editor) {
  return {
    startOffset: editor.document.offsetAt(editor.selection.start),
    endOffset: editor.document.offsetAt(editor.selection.end),
    activeOffset: editor.document.offsetAt(editor.selection.active)
  };
}

function selectionIsInsideArgument(editor, argument) {
  const selection = selectionOffsets(editor);
  const contained =
    selection.startOffset >= argument.startOffset &&
    selection.endOffset <= argument.endOffset;

  if (!contained) {
    return false;
  }

  // This predicate is evaluated only AFTER native next/previous navigation.
  // A zero-width native field in `{prefix ${2} suffix}` is as legitimate as
  // a selected default. The `}{` gap lies before argument.startOffset.
  return true;
}

function selectFollowingArgument(editor, argument) {
  __trace("selectFollowingArgument");
  const selection = new vscode.Selection(
    argument.contentStart,
    argument.contentEnd
  );
  editor.selection = selection;
  editor.revealRange(new vscode.Range(argument.contentStart, argument.contentEnd));
}

/**
 * Advance through nested/coincident native stops until the selection actually
 * reaches the following `{...}` argument. Unlike `jumpToNextDistinctPlaceholder`,
 * this does not treat the visually distinct `}{` gap as success.
 */
async function jumpToFollowingArgumentPlaceholder(editor, argument, maximumJumps = 32) {
  __trace('jumpToFollowingArgumentPlaceholder');
  for (let jump = 0; jump < maximumJumps; jump += 1) {
    if (!(await executeSilently('jumpToNextSnippetPlaceholder'))) return false;
    await waitForSelectionState();
    if (selectionIsInsideArgument(editor, argument)) return true;
    const selection = selectionOffsets(editor);
    if (selection.startOffset > argument.endOffset) {
      // There need not be a placeholder in every LaTeX argument. Keep the
      // genuine next native destination. Rewinding $0 cannot resurrect a
      // session which has ended, and selecting a lexical argument destroys
      // its literal prefix/suffix distinction.
      __trace('native:argument-skipped', { argument });
      return true;
    }
  }
  __trace('native:argument-unavailable', { argument });
  return false;
}

/**
 * Prefer VS Code's native placeholder navigation at a sequential LaTeX
 * argument boundary. If nested `$0` stops or a collapsed native session still
 * fail to reach the next argument, recover by selecting its balanced content.
 *
 * Returning true means the boundary was recognized and fully handled.
 */
async function advanceSequentialArgument(editor, match, useNativeNavigation) {
  __trace("advanceSequentialArgument");
  const argument = findFollowingBracedArgument(editor, match);
  if (!argument) {
    return false;
  }

  if (useNativeNavigation) {
    const reachedNativeArgument = await jumpToFollowingArgumentPlaceholder(
      editor,
      argument
    );
    if (reachedNativeArgument) captureCurrentPlaceholder(editor);
    // A live-snippet request must NEVER guess that the complete argument is
    // the missing placeholder. In pd it is `\\partial x`, not `${2:x}`.
    // Failure is handled without moving the cursor or broadening a selection.
    return true;
  }

  // Fallback for a native session that has already collapsed. This restores a
  // useful editable field even though VS Code no longer exposes the original
  // placeholder object through its public extension API.
  selectFollowingArgument(editor, argument);
  captureCurrentPlaceholder(editor);
  return true;
}

function isEscapedCharacter(text, index) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

/**
 * Recovery for text that existed before extension activation/reload. Ordinary
 * round parentheses are unambiguous enough to recognize lexically; generated
 * LaTeX argument braces are intentionally not treated this way.
 */
function hasUnmatchedRoundOpeningBeforeCursor(editor, match) {
  if (match.token !== ')' && match.token !== '\\right)') {
    return false;
  }

  const position = editor.selection.active;
  const line = editor.document.lineAt(position.line).text;
  let balance = 0;

  for (let index = 0; index < position.character; index += 1) {
    const character = line[index];
    if ((character === '(' || character === ')') && isEscapedCharacter(line, index)) {
      continue;
    }
    if (character === '(') {
      balance += 1;
    } else if (character === ')' && balance > 0) {
      balance -= 1;
    }
  }

  return balance > 0;
}

/**
 * A closer may cross the current nested placeholder only when it came from
 * ordinary typing/auto-pairing (or is recoverable as a pre-existing ordinary
 * round pair). A closer known to have been inserted by a snippet template is
 * structural and must be left to native placeholder navigation.
 */
function shouldEscapeAcrossPlaceholder(editor, match, config) {
  if (!config.escapeTypedClosersAcrossPlaceholder) {
    return false;
  }

  if (isSnippetOwnedClosingMatch(editor, match)) {
    return false;
  }

  return (
    isTypedClosingMatch(editor, match) ||
    hasUnmatchedRoundOpeningBeforeCursor(editor, match)
  );
}

/**
 * Find one closing token constrained to the current placeholder. Multiline
 * search is only attempted when the remainder of the current line is blank.
 */
function detectClosingTarget(editor, maximumEndOffset) {
  const selection = editor.selection;
  if (!selection.isEmpty) {
    return undefined;
  }

  const position = selection.active;
  const config = readConfig(editor);
  const lineText = editor.document.lineAt(position.line).text;

  let maximumEndCharacter = Number.POSITIVE_INFINITY;
  if (maximumEndOffset !== undefined) {
    const maximumPosition = editor.document.positionAt(maximumEndOffset);
    if (maximumPosition.line === position.line) {
      maximumEndCharacter = maximumPosition.character;
    } else if (maximumPosition.line < position.line) {
      return undefined;
    }
  }

  const inlineMatch = findInlineClosingMatch(
    lineText,
    position.character,
    config.closingTokens,
    config.skipBlankChar
  );

  if (inlineMatch && inlineMatch.endCharacter <= maximumEndCharacter) {
    const target = createClosingTarget(
      editor,
      position.line,
      lineText,
      inlineMatch.token,
      inlineMatch.startCharacter,
      inlineMatch.endCharacter,
      config,
      false
    );

    return positionWithinMaximum(editor, target.tokenEnd, maximumEndOffset)
      ? target
      : undefined;
  }

  const rightOfCursor = lineText.slice(position.character);
  if (
    !config.enableMultilineMode ||
    !hasOnlyIgnorableLineTail(rightOfCursor)
  ) {
    return undefined;
  }

  for (
    let line = position.line + 1;
    line < editor.document.lineCount;
    line += 1
  ) {
    const nextLineText = editor.document.lineAt(line).text;
    const trimmedNextLine = nextLineText.trimStart();
    if (trimmedNextLine === '' || trimmedNextLine.startsWith('%')) {
      continue;
    }

    const leadingBlankCount = (nextLineText.match(/^\s*/) || [''])[0].length;
    const candidate = nextLineText.slice(leadingBlankCount);

    for (const close of config.closingTokens) {
      if (!candidate.startsWith(close)) {
        continue;
      }

      const target = createClosingTarget(
        editor,
        line,
        nextLineText,
        close,
        leadingBlankCount,
        leadingBlankCount + close.length,
        config,
        true
      );

      return positionWithinMaximum(editor, target.tokenEnd, maximumEndOffset)
        ? target
        : undefined;
    }

    break;
  }

  return undefined;
}

async function executeSilently(command, ...args) {
  if (operationEditor && vscode.window.activeTextEditor !== operationEditor) {
    throw new Error('Active editor changed during navigation');
  }
  try {
    __trace('native:before', command);
    await vscode.commands.executeCommand(command, ...args);
    __trace('native:after', command);
    return true;
  } catch (_error) {
    __trace('native:error', {command, message: String(_error)});
    return false;
  }
}

async function hideSuggestions() {
  await executeSilently('hideSuggestWidget');
  await executeSilently('editor.action.inlineSuggest.hide');
}

function moveCursor(editor, target) {
  if (operationEditor && vscode.window.activeTextEditor !== editor) {
    throw new Error('Active editor changed before cursor movement');
  }
  __trace("moveCursor");
  editor.selection = new vscode.Selection(target, target);
  editor.revealRange(new vscode.Range(target, target));
}

function waitForSelectionState() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function selectionSnapshot(editor) {
  const selection = editor.selection;
  return {
    anchorLine: selection.anchor.line,
    anchorCharacter: selection.anchor.character,
    activeLine: selection.active.line,
    activeCharacter: selection.active.character,
    isEmpty: selection.isEmpty
  };
}

function sameSelection(left, right) {
  return (
    left.anchorLine === right.anchorLine &&
    left.anchorCharacter === right.anchorCharacter &&
    left.activeLine === right.activeLine &&
    left.activeCharacter === right.activeCharacter
  );
}

function sameActivePosition(left, right) {
  return (
    left.activeLine === right.activeLine &&
    left.activeCharacter === right.activeCharacter
  );
}

/**
 * Decide whether native snippet navigation changed only the internal tab-stop
 * state without changing the user's visible insertion point.
 *
 * Besides literally identical zero-width selections, VS Code has one important
 * visually coincident transition: an untouched default placeholder such as
 * `${4:x}` is initially selected, and its following `$0` is a collapsed cursor
 * at the same active/end position. The selection range changes, but the caret
 * does not move. Treat that collapse as a hidden stop and keep advancing.
 */
function isVisuallyCoincidentTransition(previous, current) {
  if (sameSelection(previous, current)) {
    return true;
  }

  return (
    !previous.isEmpty &&
    current.isEmpty &&
    sameActivePosition(previous, current)
  );
}

/**
 * VS Code merges a snippet inserted inside another snippet into one session.
 * Each nested snippet keeps its own `$0`, and several of those final tab stops
 * can occupy exactly the same zero-width editor position. An untouched final
 * default placeholder can also collapse to a `$0` at the same visible caret.
 * A single native `jumpToNextSnippetPlaceholder` then advances internal state
 * while appearing to do nothing.
 *
 * Keep advancing through those visually coincident transitions and stop at the
 * first placeholder that moves the visible caret or selects a different field.
 * The finite guard prevents a stale command/context state from spinning
 * indefinitely.
 */
async function jumpToNextDistinctPlaceholder(editor, maximumJumps = 32) {
  __trace("jumpToNextDistinctPlaceholder");
  let previous = selectionSnapshot(editor);

  for (let jump = 0; jump < maximumJumps; jump += 1) {
    await executeSilently('jumpToNextSnippetPlaceholder');
    await waitForSelectionState();

    const current = selectionSnapshot(editor);
    if (!isVisuallyCoincidentTransition(previous, current)) {
      return true;
    }

    previous = current;
  }

  return false;
}

function documentEol(document) {
  return document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
}

/**
 * Resolve the visible cursor destination for a closing token. Inline tokens
 * stop immediately after themselves. A standalone display-math closer such as
 * `\\]` or `\\end{align*}` exits to the editable position on its next
 * physical line. When the closer is the final line of the document, create
 * that line using the closer line's indentation.
 */
async function resolveClosingDestination(editor, closingTarget) {
  if (!closingTarget.exitsToNextLine) {
    return closingTarget.tokenEnd;
  }

  const nextLineNumber = closingTarget.closingLine + 1;
  if (nextLineNumber < editor.document.lineCount) {
    const nextLineText = editor.document.lineAt(nextLineNumber).text;
    return new vscode.Position(
      nextLineNumber,
      nextLineEntryCharacter(nextLineText)
    );
  }

  const closingLine = editor.document.lineAt(closingTarget.closingLine);
  const indentation = (closingLine.text.match(/^\s*/) || [''])[0];
  const inserted = await editor.edit(
    (editBuilder) => {
      editBuilder.insert(
        closingLine.range.end,
        `${documentEol(editor.document)}${indentation}`
      );
    },
    { undoStopBefore: true, undoStopAfter: true }
  );

  if (!inserted) {
    return closingTarget.tokenEnd;
  }

  await waitForSelectionState();
  return new vscode.Position(nextLineNumber, indentation.length);
}

async function moveAcrossClosingTarget(editor, closingTarget) {
  const destination = await resolveClosingDestination(editor, closingTarget);
  moveCursor(editor, destination);
  return destination;
}

/** Keep a surviving outer native session when leaving a display block. */
async function escapeBlockInSnippet(editor, closingTarget) {
  const destination = await resolveClosingDestination(editor, closingTarget);
  if (!isCollapsedAt(editor, destination)) {
    await escapeInnerTokenAndSynchronize(editor, destination);
  }
  captureCurrentPlaceholder(editor);
}

/** A native $0 may be located after \\] rather than on its following line. */
async function normalizeNativeBlockExit(editor) {
  if (!editor.selection.isEmpty || editor.selections.length !== 1) return;
  const config = readConfig(editor);
  if (!config.exitBlockClosersToNextLine) return;
  const position = editor.selection.active;
  const line = editor.document.lineAt(position.line).text;
  for (const token of config.blockClosingTokens) {
    const start = position.character - token.length;
    if (start < 0 || line.slice(start, position.character) !== token ||
        !isStandaloneBlockCloser(line, start, position.character, token, config.blockClosingTokens)) continue;
    const closingTarget = createClosingTarget(editor, position.line, line,
      token, start, position.character, config);
    await escapeBlockInSnippet(editor, closingTarget);
    return;
  }
}

function isCollapsedAt(editor, target) {
  return Boolean(
    editor &&
      editor.selection.isEmpty &&
      editor.selection.active.isEqual(target)
  );
}

/**
 * Move one non-snippet delimiter without leaving the native tracked field.
 * No next/previous probing, no replacement snippet, and no additional `$0`.
 * The text-neutral atomic edit relocates native edge markers first; VS Code
 * moves its caret as part of that same edit. See boundary-hop.js and AUDIT.md.
 */
async function escapeInnerTokenAndSynchronize(editor, target) {
  __trace('boundaryHop:start');
  const result = await hopBoundary(vscode, editor, target, boundaryTransactions);
  if (!result.handled) {
    __trace('boundaryHop:rejected', result);
    throw new Error(result.reason || 'Boundary edit rejected; no fallback jump was made');
  }
  if (!result.concurrentEdit) captureCurrentPlaceholder(editor);
  __trace('boundaryHop:complete', result);
  return true;
}

/**
 * VS Code's `hasSnippetCompletions` context key uses a native prefix scanner
 * capped at 100 characters. On a compact LaTeX line with no whitespace in that
 * window, a valid short prefix at the caret is invisible and the Tab key is
 * routed to delimiter navigation instead.
 *
 * When that exact native failure condition is detected, create a temporary
 * whitespace boundary immediately before the final prefix-like token, force a
 * cursor-selection refresh, invoke native `insertSnippet`, then remove the
 * boundary. The document is left byte-for-byte unchanged when no snippet
 * matches; when one does match, only the snippet expansion remains.
 */
async function tryExpandLongLineSnippetPrefix(editor) {
  if (!editor || editor.document.languageId !== 'latex' ||
      editor.selections.length !== 1 || !editor.selection.isEmpty) return false;
  const config = readConfig(editor);
  if (!config.recoverLongLineSnippetPrefixes) return false;
  const position = editor.selection.active;
  const probe = findLongLineSnippetPrefixProbe(editor.document.lineAt(position.line).text,
    position.character, typeof config.prefixProbeCharacters === 'string'
      ? config.prefixProbeCharacters : DEFAULT_PREFIX_PROBE_CHARACTERS,
    NATIVE_SNIPPET_PREFIX_SCAN_LIMIT);
  if (!probe) return false;
  await hideSuggestions();
  const document = editor.document;
  const key = documentKey(document);
  const boundary = new vscode.Position(position.line, probe.startCharacter);
  const record = { startOffset: document.offsetAt(boundary), endOffset: document.offsetAt(boundary),
    restoreOffset: document.offsetAt(position), creationVersion: document.version,
    awaitingCreation: true, valid: false };
  transientProbesByDocument.set(key, record);
  let expanded = false;
  let inserted = false;
  try {
    inserted = await editor.edit(builder => builder.insert(boundary, ' '),
      { undoStopBefore: false, undoStopAfter: false });
    if (!inserted) return false;
    await waitForSelectionState();
    if (!record.valid) throw new Error('Prefix probe was changed concurrently; no speculative expansion');
    moveCursor(editor, document.positionAt(record.endOffset));
    await waitForSelectionState();
    moveCursor(editor, document.positionAt(record.restoreOffset));
    await waitForSelectionState();
    const beforeVersion = document.version;
    const beforeSelection = selectionSnapshot(editor);
    snippetInsertionDepth += 1;
    try {
      await executeSilently('insertSnippet');
      await waitForSelectionState();
    } finally { snippetInsertionDepth = Math.max(0, snippetInsertionDepth - 1); }
    expanded = document.version !== beforeVersion || !sameSelection(beforeSelection, selectionSnapshot(editor));
  } finally {
    // Cleanup belongs to the originating document even if focus has changed.
    // Only a still-valid marker for our exact inserted space may be deleted.
    try {
      if (inserted && record.valid && !document.isClosed) {
        const range = new vscode.Range(document.positionAt(record.startOffset), document.positionAt(record.endOffset));
        if (document.getText(range) === ' ') {
          const removed = await editor.edit(builder => builder.delete(range),
            { undoStopBefore: false, undoStopAfter: false });
          if (!removed) throw new Error('Temporary prefix boundary cleanup was rejected');
          await waitForSelectionState();
        }
      }
    } finally { if (transientProbesByDocument.get(key) === record) transientProbesByDocument.delete(key); }
  }
  if (vscode.window.activeTextEditor !== editor) throw new Error('Active editor changed during prefix recovery');
  if (expanded) { captureCurrentPlaceholder(editor); return true; }
  moveCursor(editor, document.positionAt(clamp(record.restoreOffset, 0, documentLength(document))));
  await waitForSelectionState();
  return false;
}

/** Highest priority: exact static snippet prefix + Tab. */
async function expandSnippet() {
  __trace("expandSnippet");
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'latex') {
    return;
  }

  await hideSuggestions();

  const beforeVersion = editor.document.version;
  const beforeSelection = new vscode.Selection(
    editor.selection.anchor,
    editor.selection.active
  );

  snippetInsertionDepth += 1;
  try {
    await executeSilently('insertSnippet');
    await waitForSelectionState();
  } finally {
    snippetInsertionDepth = Math.max(0, snippetInsertionDepth - 1);
  }

  const selectionChanged =
    !beforeSelection.anchor.isEqual(editor.selection.anchor) ||
    !beforeSelection.active.isEqual(editor.selection.active);

  if (editor.document.version !== beforeVersion || selectionChanged) {
    captureCurrentPlaceholder(editor);
  }
}

/**
 * Insert a snippet from an explicit keybinding while marking its structural
 * delimiters as snippet-owned. Use this instead of binding
 * `editor.action.insertSnippet` directly for shortcuts such as `_{$1}$0`.
 */
async function insertSnippetTemplate(args) {
  __trace("insertSnippetTemplate");
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'latex') {
    return;
  }

  const snippet =
    typeof args === 'string'
      ? args
      : args && typeof args.snippet === 'string'
        ? args.snippet
        : undefined;

  if (!snippet) {
    return;
  }

  await hideSuggestions();

  const beforeVersion = editor.document.version;
  const beforeSelection = new vscode.Selection(
    editor.selection.anchor,
    editor.selection.active
  );

  snippetInsertionDepth += 1;
  try {
    await executeSilently('editor.action.insertSnippet', { snippet });
    await waitForSelectionState();
  } finally {
    snippetInsertionDepth = Math.max(0, snippetInsertionDepth - 1);
  }

  const selectionChanged =
    !beforeSelection.anchor.isEqual(editor.selection.anchor) ||
    !beforeSelection.active.isEqual(editor.selection.active);

  if (editor.document.version !== beforeVersion || selectionChanged) {
    captureCurrentPlaceholder(editor);
  }
}

/**
 * Return true only when the current non-empty selection is exactly the
 * untouched placeholder range last captured by Smart Tab. This avoids
 * changing normal Space replacement semantics for arbitrary/manual selections
 * and for a placeholder whose contents were already edited.
 */
function selectionExactlyMatchesUntouchedTrackedPlaceholder(editor) {
  if (!editor || editor.selection.isEmpty || editor.selections.length !== 1) {
    return false;
  }

  const placeholder = getTrackedPlaceholder(editor);
  if (!placeholder || placeholder.editedSinceCapture) {
    return false;
  }

  const selection = selectionOffsets(editor);
  return (
    selection.startOffset === placeholder.startOffset &&
    selection.endOffset === placeholder.endOffset
  );
}

/**
 * A selected default is terminal only when its right edge is also the tracked
 * end of a snippet inserted through Smart Tab. Examples are `${4:x}$0` in
 * `intt` and `${3:a_i}$0` in `summ`. Earlier fields such as `a`, `b`, or a
 * fraction numerator end before their creating snippet's structural text and
 * therefore retain native replacement behavior when Space is pressed.
 */
function selectionEndsAtRecordedSnippetEnd(editor) {
  if (!editor || editor.selection.isEmpty) {
    return false;
  }

  const selection = selectionOffsets(editor);
  const ranges = snippetRangesByDocument.get(documentKey(editor.document)) || [];

  return ranges.some(
    (range) =>
      range.startOffset <= selection.startOffset &&
      range.endOffset === selection.endOffset
  );
}

/** Use VS Code's unmodified typing path so fallback behavior remains native. */
async function typeDefaultText(text) {
  await executeSilently('default:type', { text });
}

/**
 * Space is used as an explicit "keep this default and continue" gesture only
 * for an untouched terminal default. Collapse the selection to its right edge
 * and insert a literal space without deleting the default. In every other
 * selected placeholder, Space follows normal VS Code semantics and replaces
 * the selected text.
 */
async function insertContinuationSpace() {
  const editor = vscode.window.activeTextEditor;

  if (!editor || editor.document.languageId !== 'latex') {
    await typeDefaultText(' ');
    return;
  }

  const config = readConfig(editor);
  const shouldPreserve = Boolean(
    config.preserveUntouchedTerminalDefaultOnSpace &&
      selectionExactlyMatchesUntouchedTrackedPlaceholder(editor) &&
      selectionEndsAtRecordedSnippetEnd(editor)
  );

  if (!shouldPreserve) {
    await typeDefaultText(' ');
    return;
  }

  await hideSuggestions();

  const insertionOffset = editor.document.offsetAt(editor.selection.end);
  const insertionPosition = editor.selection.end;

  // Collapsing at the selected placeholder's end keeps the native snippet
  // session active. The following edit grows that terminal placeholder instead
  // of replacing its untouched default.
  moveCursor(editor, insertionPosition);
  await waitForSelectionState();

  const inserted = await editor.edit(
    (editBuilder) => editBuilder.insert(insertionPosition, ' '),
    { undoStopBefore: false, undoStopAfter: false }
  );

  if (!inserted) {
    await typeDefaultText(' ');
    return;
  }

  await waitForSelectionState();
  const destination = editor.document.positionAt(insertionOffset + 1);
  moveCursor(editor, destination);

  // onDidChangeTextDocument normally grows and marks this range as edited.
  // These assignments are idempotent safeguards for hosts/tests that deliver
  // the document-change event after this command resolves.
  if (sameDocument(editor, trackedPlaceholder)) {
    trackedPlaceholder.endOffset = Math.max(
      trackedPlaceholder.endOffset,
      insertionOffset + 1
    );
    trackedPlaceholder.documentVersion = editor.document.version;
    trackedPlaceholder.editedSinceCapture = true;
  }
}

/** Active native session: exact prefix, one typed closer, then real fields. */
async function navigateSnippet() {
  __trace('navigateSnippet');
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'latex') return;
  if (editor.selections.length !== 1) {
    // Mirrored fields and multi-cursor input belong to the native engine.
    await executeSilently('jumpToNextSnippetPlaceholder');
    clearTrackedPlaceholder(editor);
    return;
  }
  if (await tryExpandLongLineSnippetPrefix(editor)) return;
  await hideSuggestions();
  const config = readConfig(editor);
  const placeholder = getTrackedPlaceholder(editor);
  const immediate = getImmediateInlineClosingMatch(editor);
  if (immediate) {
    const owned = isSnippetOwnedClosingMatch(editor, immediate);
    const inside = Boolean(placeholder && immediate.endOffset <= placeholder.endOffset);
    const typed = !owned && (inside || shouldEscapeAcrossPlaceholder(editor, immediate, config));
    if (typed) {
      __trace('branch:typed-closer');
      if (immediate.exitsToNextLine) {
        await escapeBlockInSnippet(editor, immediate);
      } else {
        await escapeInnerTokenAndSynchronize(editor, immediate.tokenEnd);
      }
      return;
    }
    if (owned) {
      __trace('branch:snippetOwnedCloser');
      if (config.recoverSequentialArguments &&
          await advanceSequentialArgument(editor, immediate, true)) return;
      await jumpToNextDistinctPlaceholder(editor);
      // Normalize only a collapsed native stop exactly after this block;
      // never overwrite a selected following field or a later destination.
      await normalizeNativeBlockExit(editor);
      captureCurrentPlaceholder(editor);
      return;
    }
  }
  if (placeholder) {
    const bounded = detectClosingTarget(editor, placeholder.endOffset);
    if (bounded) {
      if (bounded.exitsToNextLine) {
        await escapeBlockInSnippet(editor, bounded);
      } else {
        await escapeInnerTokenAndSynchronize(editor, bounded.tokenEnd);
      }
      return;
    }
  }
  await jumpToNextDistinctPlaceholder(editor);
  await normalizeNativeBlockExit(editor);
  captureCurrentPlaceholder(editor);
}

/** Outside snippet mode: ordinary TabOut-style escape, then ordinary Tab. */
async function navigatePlain() {
  __trace("navigatePlain");
  const editor = vscode.window.activeTextEditor;

  if (!editor || editor.document.languageId !== 'latex') {
    await executeSilently('tab');
    return;
  }

  if (editor.selections.length !== 1) {
    await executeSilently('tab');
    clearTrackedPlaceholder(editor);
    return;
  }
  if (await tryExpandLongLineSnippetPrefix(editor)) {
    return;
  }

  clearTrackedPlaceholder(editor);
  await hideSuggestions();

  const config = readConfig(editor);
  const closingTarget = detectClosingTarget(editor, undefined);
  if (closingTarget) {
    // If VS Code already dropped snippet mode after deeply nested `$0` stops,
    // preserve the useful `\\command{...}{next}` workflow rather than leaving
    // the cursor stranded between `}{` with no remaining native tab stop.
    if (
      config.recoverSequentialArguments &&
      (await advanceSequentialArgument(editor, closingTarget, false))
    ) {
      return;
    }

    await moveAcrossClosingTarget(editor, closingTarget);
    return;
  }

  await executeSilently('tab');
}

function activate(context) {
  context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(() => __trace('selection:event')));
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'latexSmartTab.expandSnippet',
      serializeEditorCommand(expandSnippet)
    ),
    vscode.commands.registerCommand(
      'latexSmartTab.insertSnippetTemplate',
      serializeEditorCommand(insertSnippetTemplate)
    ),
    vscode.commands.registerCommand(
      'latexSmartTab.insertContinuationSpace',
      serializeEditorCommand(insertContinuationSpace)
    ),
    vscode.commands.registerCommand(
      'latexSmartTab.navigateSnippet',
      serializeEditorCommand(navigateSnippet)
    ),
    vscode.commands.registerCommand(
      'latexSmartTab.navigatePlain',
      serializeEditorCommand(navigatePlain)
    ),
    vscode.workspace.onDidChangeTextDocument(handleDocumentChange),
    vscode.workspace.onDidCloseTextDocument((document) => {
      const key = documentKey(document);
      boundaryTransactions.delete(key);
      transientProbesByDocument.delete(key);
      typedClosersByDocument.delete(key);
      snippetClosersByDocument.delete(key);
      snippetRangesByDocument.delete(key);
      if (
        trackedPlaceholder &&
        document.uri.toString() === trackedPlaceholder.documentUri
      ) {
        trackedPlaceholder = undefined;
      }
    })
  );
}


function __readEvents() { return JSON.parse(JSON.stringify(__events)); }
function deactivate() {
  trackedPlaceholder = undefined;
  typedClosersByDocument.clear();
  snippetClosersByDocument.clear();
  snippetRangesByDocument.clear();
  snippetInsertionDepth = 0;
  boundaryTransactions.clear();
  transientProbesByDocument.clear();
  operationEditor = undefined;
}


const __activate = activate;
module.exports = { activate(context) {
  __activate(context);
  function resetEvents() {
    __events.length = 0;
    __enabled = true;
    __documentUri = vscode.window.activeTextEditor?.document.uri.toString();
  }
  function stopRecording() { __enabled = false; }
  context.subscriptions.push(
    vscode.commands.registerCommand('latexSmartTab.diagnosticsStart', () => {
      if (!vscode.window.activeTextEditor || vscode.window.activeTextEditor.document.languageId !== 'latex') return;
      resetEvents();
      __trace('recording:start', {vscodeVersion:vscode.version,
        extensionVersion:context.extension.packageJSON.version,
        config:readConfig(vscode.window.activeTextEditor)});
      vscode.window.setStatusBarMessage('Smart Tab: diagnostic recording started', 3000);
    }),
    vscode.commands.registerCommand('latexSmartTab.diagnosticsMark', state => {
      __trace('context:keyboard', state || {inSnippetMode:'unavailable',hasNextTabstop:'unavailable'});
    }),
    vscode.commands.registerCommand('latexSmartTab.runRegressionChecks', async () => {
      return vscode.window.withProgress({location:vscode.ProgressLocation.Notification,
        title:'Smart Tab: checking real snippet navigation; please leave the test editors focused',cancellable:false},
        () => require('./test/host-regression').run({readEvents:__readEvents,resetEvents,stopRecording}));
    }),
    vscode.commands.registerCommand('latexSmartTab.diagnosticsExport', async () => {
      __trace('recording:end');
      __enabled = false;
      const document = await vscode.workspace.openTextDocument({language:'json',content:JSON.stringify({
        diagnosticOnly:true, vscodeVersion:vscode.version, extensionVersion:context.extension.packageJSON.version,
        explanation:'Native context values are recorded only at context:keyboard events. No native context values are inferred from selections.',
        events:__readEvents()
      },null,2)});
      await vscode.window.showTextDocument(document);
    })
  );
  return { readEvents: __readEvents, resetEvents, stopRecording };
}, deactivate };

