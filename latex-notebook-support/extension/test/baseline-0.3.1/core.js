'use strict';

/**
 * Map an offset through a VS Code TextDocument change set.
 * Changes are expressed in offsets from the pre-change document.
 * `affinity` controls whether an insertion exactly at the boundary belongs
 * to the left or right side of that boundary.
 */
function mapOffset(offset, changes, affinity) {
  const sorted = [...changes].sort((a, b) => {
    if (a.rangeOffset !== b.rangeOffset) {
      return a.rangeOffset - b.rangeOffset;
    }
    return a.rangeLength - b.rangeLength;
  });

  let delta = 0;

  for (const change of sorted) {
    const start = change.rangeOffset;
    const oldLength = change.rangeLength;
    const end = start + oldLength;
    const newLength = change.text.length;

    if (offset < start) {
      break;
    }

    if (oldLength === 0 && offset === start) {
      return start + delta + (affinity === 'right' ? newLength : 0);
    }

    if (offset >= start && offset < end) {
      return start + delta + (affinity === 'right' ? newLength : 0);
    }

    delta += newLength - oldLength;
  }

  return offset + delta;
}

/** Placeholder ranges grow when text is inserted exactly at their end. */
function transformRange(range, changes) {
  let startOffset = mapOffset(range.startOffset, changes, 'left');
  let endOffset = mapOffset(range.endOffset, changes, 'right');

  if (endOffset < startOffset) {
    endOffset = startOffset;
  }

  return { startOffset, endOffset };
}

/**
 * A concrete token marker moves as a unit when text is inserted immediately
 * before it. Both boundaries therefore use right affinity.
 */
function transformTokenRange(range, changes) {
  let startOffset = mapOffset(range.startOffset, changes, 'right');
  let endOffset = mapOffset(range.endOffset, changes, 'right');

  if (endOffset < startOffset) {
    endOffset = startOffset;
  }

  return { startOffset, endOffset };
}



/**
 * Reproduce the one edge case in VS Code's static snippet Tab-completion
 * prefix scanner that matters to Smart Tab. VS Code examines at most the last
 * 100 characters before the cursor. When that window contains no whitespace
 * and the line is longer than the window, `getNonWhitespacePrefix` returns an
 * empty string even if a valid short snippet prefix is immediately before the
 * cursor.
 *
 * Return the final prefix-like token that can be isolated with a temporary
 * whitespace boundary, but only when the native 100-character scanner is
 * known to fail for this reason. The caller can insert a transient space at
 * `startCharacter`, invoke native `insertSnippet`, and remove the space again.
 */
function findLongLineSnippetPrefixProbe(
  lineText,
  cursorCharacter,
  prefixCharacters,
  nativeScanLimit = 100
) {
  if (
    typeof lineText !== 'string' ||
    !Number.isInteger(cursorCharacter) ||
    cursorCharacter <= 0 ||
    cursorCharacter > lineText.length ||
    typeof prefixCharacters !== 'string' ||
    prefixCharacters.length === 0 ||
    !Number.isInteger(nativeScanLimit) ||
    nativeScanLimit <= 0
  ) {
    return undefined;
  }

  const beforeCursor = lineText.slice(0, cursorCharacter);
  const minimumCharacter = Math.max(0, beforeCursor.length - nativeScanLimit);

  // On a short line VS Code returns the whole prefix. If whitespace occurs in
  // the last 100 characters it returns the text after that whitespace. In both
  // cases the native context key should already be correct, so probing would
  // only add unnecessary edits.
  if (minimumCharacter === 0) {
    return undefined;
  }
  for (
    let character = beforeCursor.length - 1;
    character >= minimumCharacter;
    character -= 1
  ) {
    if (/\s/.test(beforeCursor[character])) {
      return undefined;
    }
  }

  const allowed = new Set(prefixCharacters.split(''));
  let startCharacter = beforeCursor.length;
  while (
    startCharacter > 0 &&
    allowed.has(beforeCursor[startCharacter - 1])
  ) {
    startCharacter -= 1;
  }

  if (startCharacter === beforeCursor.length) {
    return undefined;
  }

  // A prefix written as `\\foo` is a LaTeX command, not a user snippet token.
  // Do not split the command by inserting a temporary space after the slash.
  if (startCharacter > 0 && beforeCursor[startCharacter - 1] === '\\') {
    return undefined;
  }

  const prefix = beforeCursor.slice(startCharacter);
  if (prefix.length === 0 || prefix.length >= nativeScanLimit) {
    return undefined;
  }

  return {
    prefix,
    startCharacter,
    endCharacter: beforeCursor.length
  };
}

function normalizeClosingTokens(tokens) {
  return [...new Set(tokens.filter((token) => typeof token === 'string' && token.length > 0))]
    .sort((left, right) => right.length - left.length);
}

/** Return the immediate closing-token match to the right of the cursor. */
function findInlineClosingMatch(
  lineText,
  cursorCharacter,
  closingTokens,
  skipBlankChar
) {
  const rightOfCursor = lineText.slice(cursorCharacter);
  const blankCount = skipBlankChar
    ? (rightOfCursor.match(/^\s*/) || [''])[0].length
    : 0;
  const startCharacter = cursorCharacter + blankCount;
  const candidate = lineText.slice(startCharacter);

  for (const token of closingTokens) {
    if (!candidate.startsWith(token)) {
      continue;
    }

    const endCharacter = startCharacter + token.length;
    return {
      token,
      startCharacter,
      endCharacter,
      targetCharacter: endCharacter
    };
  }

  return undefined;
}

/**
 * Return the character index immediately after the next closing token on the
 * current line, or undefined. When maxEndCharacter is finite, a token is only
 * eligible if it is fully contained inside that boundary.
 */
function findInlineClosingTarget(
  lineText,
  cursorCharacter,
  closingTokens,
  skipBlankChar,
  maxEndCharacter = Number.POSITIVE_INFINITY
) {
  const match = findInlineClosingMatch(
    lineText,
    cursorCharacter,
    closingTokens,
    skipBlankChar
  );

  if (!match || match.targetCharacter > maxEndCharacter) {
    return undefined;
  }

  return match.targetCharacter;
}

/**
 * Find closing tokens inside newly inserted ordinary text. Longest tokens win,
 * so `\\right)` is recorded once instead of also recording its final `)`.
 */
function findClosingTokensInInsertedText(text, closingTokens) {
  const tokens = normalizeClosingTokens(closingTokens);
  const matches = [];

  for (let index = 0; index < text.length;) {
    let matchedToken;

    for (const token of tokens) {
      if (text.startsWith(token, index)) {
        matchedToken = token;
        break;
      }
    }

    if (!matchedToken) {
      index += 1;
      continue;
    }

    matches.push({
      token: matchedToken,
      startOffset: index,
      endOffset: index + matchedToken.length
    });
    index += matchedToken.length;
  }

  return matches;
}

/** Return true when only whitespace or a LaTeX comment follows a token. */
function hasOnlyIgnorableLineTail(text) {
  const trimmed = text.trimStart();
  return trimmed === '' || trimmed.startsWith('%');
}

/**
 * Classify a closing token as a standalone block closer. We intentionally
 * require the token to be the first non-whitespace item on the line. This
 * keeps inline structures such as `A = \begin{bmatrix}...\end{bmatrix}^T`
 * on the same line even if their closing token is configured elsewhere.
 */
function isStandaloneBlockCloser(
  lineText,
  startCharacter,
  endCharacter,
  token,
  blockClosingTokens
) {
  if (!blockClosingTokens.includes(token)) {
    return false;
  }

  if (lineText.slice(0, startCharacter).trim() !== '') {
    return false;
  }

  return hasOnlyIgnorableLineTail(lineText.slice(endCharacter));
}

/** Place the cursor at the editable indentation boundary of an existing line. */
function nextLineEntryCharacter(lineText) {
  const match = lineText.match(/^\s*/);
  return match ? match[0].length : 0;
}

module.exports = {
  mapOffset,
  transformRange,
  transformTokenRange,
  normalizeClosingTokens,
  findLongLineSnippetPrefixProbe,
  findInlineClosingMatch,
  findInlineClosingTarget,
  findClosingTokensInInsertedText,
  hasOnlyIgnorableLineTail,
  isStandaloneBlockCloser,
  nextLineEntryCharacter
};
