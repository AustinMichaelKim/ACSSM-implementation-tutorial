/* Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License; see LICENSE-VSCODE.txt.
 * Adapted from src/vs/editor/common/model/intervalTree.ts:
 * blob ada8cbdffd181260c7244b6f59873631a21e7b96, retrieved 2026-09-28.
 * Changes: TypeScript annotations removed; interval-tree metadata accessors
 * replaced by plain object fields. This is a marker kernel, NOT an editor host.
 */
'use strict';
const TrackedRangeStickiness = {
  AlwaysGrowsWhenTypingAtEdges: 0, NeverGrowsWhenTypingAtEdges: 1,
  GrowsOnlyWhenTypingBefore: 2, GrowsOnlyWhenTypingAfter: 3
};
const MarkerMoveSemantics = { MarkerDefined: 0, ForceMove: 1, ForceStay: 2 };
function adjustMarkerBeforeColumn(markerOffset, markerStickToPreviousCharacter, checkOffset, moveSemantics) {
  if (markerOffset < checkOffset) return true;
  if (markerOffset > checkOffset) return false;
  if (moveSemantics === MarkerMoveSemantics.ForceMove) return false;
  if (moveSemantics === MarkerMoveSemantics.ForceStay) return true;
  return markerStickToPreviousCharacter;
}
function nodeAcceptEdit(node, start, end, textLength, forceMoveMarkers) {
  const nodeStickiness = node.stickiness;
  const startStickToPreviousCharacter = (
    nodeStickiness === TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges ||
    nodeStickiness === TrackedRangeStickiness.GrowsOnlyWhenTypingBefore
  );
  const endStickToPreviousCharacter = (
    nodeStickiness === TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges ||
    nodeStickiness === TrackedRangeStickiness.GrowsOnlyWhenTypingBefore
  );
  const deletingCnt = end - start;
  const insertingCnt = textLength;
  const commonLength = Math.min(deletingCnt, insertingCnt);
  const nodeStart = node.start;
  let startDone = false;
  const nodeEnd = node.end;
  let endDone = false;
  if (start <= nodeStart && nodeEnd <= end && node.collapseOnReplaceEdit) {
    node.start = start; startDone = true;
    node.end = start; endDone = true;
  }
  {
    const moveSemantics = forceMoveMarkers ? MarkerMoveSemantics.ForceMove :
      deletingCnt > 0 ? MarkerMoveSemantics.ForceStay : MarkerMoveSemantics.MarkerDefined;
    if (!startDone && adjustMarkerBeforeColumn(nodeStart, startStickToPreviousCharacter, start, moveSemantics)) startDone = true;
    if (!endDone && adjustMarkerBeforeColumn(nodeEnd, endStickToPreviousCharacter, start, moveSemantics)) endDone = true;
  }
  if (commonLength > 0 && !forceMoveMarkers) {
    const moveSemantics = deletingCnt > insertingCnt ? MarkerMoveSemantics.ForceStay : MarkerMoveSemantics.MarkerDefined;
    if (!startDone && adjustMarkerBeforeColumn(nodeStart, startStickToPreviousCharacter, start + commonLength, moveSemantics)) startDone = true;
    if (!endDone && adjustMarkerBeforeColumn(nodeEnd, endStickToPreviousCharacter, start + commonLength, moveSemantics)) endDone = true;
  }
  {
    const moveSemantics = forceMoveMarkers ? MarkerMoveSemantics.ForceMove : MarkerMoveSemantics.MarkerDefined;
    if (!startDone && adjustMarkerBeforeColumn(nodeStart, startStickToPreviousCharacter, end, moveSemantics)) {
      node.start = start + insertingCnt; startDone = true;
    }
    if (!endDone && adjustMarkerBeforeColumn(nodeEnd, endStickToPreviousCharacter, end, moveSemantics)) {
      node.end = start + insertingCnt; endDone = true;
    }
  }
  const deltaColumn = insertingCnt - deletingCnt;
  if (!startDone) node.start = Math.max(0, nodeStart + deltaColumn);
  if (!endDone) node.end = Math.max(0, nodeEnd + deltaColumn);
  if (node.start > node.end) node.end = node.start;
}
module.exports = { nodeAcceptEdit, TrackedRangeStickiness };
