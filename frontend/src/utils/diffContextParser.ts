export interface ParsedDiffLine {
  oldLine: number | null;
  newLine: number | null;
  type: 'header' | 'addition' | 'deletion' | 'context';
  text: string;
  isExpanded?: boolean;
}

export interface DiffHunkGap {
  id: string;
  filePath: string;
  type: 'top' | 'between' | 'bottom';
  gapStartNew: number;
  gapEndNew: number;
  gapStartOld: number;
  gapEndOld: number;
  gapSize: number;
  symbolContext?: string;
}

export type UnifiedDiffItem =
  | { kind: 'line'; line: ParsedDiffLine }
  | { kind: 'gap'; gap: DiffHunkGap };

export interface SideBySideRow {
  leftLineNum: number | null;
  leftText: string;
  leftType: 'deletion' | 'context' | 'empty' | 'header';
  rightLineNum: number | null;
  rightText: string;
  rightType: 'addition' | 'context' | 'empty' | 'header';
  isExpanded?: boolean;
}

export type SideBySideDiffItem =
  | { kind: 'row'; row: SideBySideRow }
  | { kind: 'gap'; gap: DiffHunkGap };

interface RawHunk {
  oldStart: number;
  oldLen: number;
  newStart: number;
  newLen: number;
  symbolContext: string;
  lines: string[];
}

/**
 * Splits a unified patch into individual hunks while extracting Git headers and metadata.
 */
function extractHunks(patch: string): RawHunk[] {
  if (!patch) return [];
  const lines = patch.split('\n');
  const hunks: RawHunk[] = [];
  let currentHunk: RawHunk | null = null;

  for (const rawLine of lines) {
    if (rawLine.startsWith('@@')) {
      const match = rawLine.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/);
      if (match) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }
        currentHunk = {
          oldStart: parseInt(match[1], 10),
          oldLen: match[2] !== undefined ? parseInt(match[2], 10) : 1,
          newStart: parseInt(match[3], 10),
          newLen: match[4] !== undefined ? parseInt(match[4], 10) : 1,
          symbolContext: (match[5] || '').trim(),
          lines: []
        };
      }
      continue;
    }

    if (!currentHunk) {
      // Pre-hunk metadata
      continue;
    }

    if (rawLine.startsWith('\\')) {
      // "\ No newline at end of file"
      continue;
    }

    currentHunk.lines.push(rawLine);
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return hunks;
}

/**
 * Slices a gap range into loaded expanded lines and unexpanded gap segments.
 */
function emitGapSegments(
  filePath: string,
  type: 'top' | 'between' | 'bottom',
  gapStartNew: number,
  gapEndNew: number,
  gapStartOld: number,
  gapEndOld: number,
  symbolContext: string | undefined,
  expandedLines?: Record<number, string>
): UnifiedDiffItem[] {
  const items: UnifiedDiffItem[] = [];
  if (gapEndNew < gapStartNew) return items;

  let cur = gapStartNew;
  while (cur <= gapEndNew) {
    if (expandedLines && expandedLines[cur] !== undefined) {
      // Find contiguous block of loaded expanded lines
      let loadedEnd = cur;
      while (loadedEnd + 1 <= gapEndNew && expandedLines[loadedEnd + 1] !== undefined) {
        loadedEnd++;
      }

      for (let i = cur; i <= loadedEnd; i++) {
        const offset = i - gapStartNew;
        items.push({
          kind: 'line',
          line: {
            oldLine: gapStartOld + offset,
            newLine: i,
            type: 'context',
            text: expandedLines[i],
            isExpanded: true
          }
        });
      }
      cur = loadedEnd + 1;
    } else {
      // Find contiguous block of unexpanded lines
      let unexpEnd = cur;
      while (unexpEnd + 1 <= gapEndNew && (!expandedLines || expandedLines[unexpEnd + 1] === undefined)) {
        unexpEnd++;
      }

      const offsetStart = cur - gapStartNew;
      const offsetEnd = unexpEnd - gapStartNew;
      items.push({
        kind: 'gap',
        gap: {
          id: `${filePath}:${type}-${cur}-${unexpEnd}`,
          filePath,
          type,
          gapStartNew: cur,
          gapEndNew: unexpEnd,
          gapStartOld: gapStartOld + offsetStart,
          gapEndOld: gapStartOld + offsetEnd,
          gapSize: unexpEnd - cur + 1,
          symbolContext: type === 'between' ? symbolContext : undefined
        }
      });
      cur = unexpEnd + 1;
    }
  }

  return items;
}

/**
 * Parses unified diff string into a sequence of diff lines and interactive gap boundaries.
 */
export function parseUnifiedPatchWithGaps(
  patch: string,
  filePath: string,
  expandedLines?: Record<number, string>,
  totalLines?: number
): UnifiedDiffItem[] {
  const hunks = extractHunks(patch);
  if (hunks.length === 0) return [];

  const items: UnifiedDiffItem[] = [];
  let prevNewEnd = 0;
  let prevOldEnd = 0;

  for (let i = 0; i < hunks.length; i++) {
    const hunk = hunks[i];

    if (i === 0) {
      // Check for top-of-file gap
      if (hunk.newStart > 1) {
        const topGap = emitGapSegments(
          filePath,
          'top',
          1,
          hunk.newStart - 1,
          1,
          hunk.oldStart - 1,
          undefined,
          expandedLines
        );
        items.push(...topGap);
      }
    } else {
      // Check for gap between previous hunk and current hunk
      const gapStartNew = prevNewEnd + 1;
      const gapEndNew = hunk.newStart - 1;
      const gapStartOld = prevOldEnd + 1;
      const gapEndOld = hunk.oldStart - 1;

      if (gapEndNew >= gapStartNew) {
        const betweenGap = emitGapSegments(
          filePath,
          'between',
          gapStartNew,
          gapEndNew,
          gapStartOld,
          gapEndOld,
          hunk.symbolContext,
          expandedLines
        );
        items.push(...betweenGap);
      }
    }

    // Process lines inside current hunk
    let currOld = hunk.oldStart;
    let currNew = hunk.newStart;

    for (const rawLine of hunk.lines) {
      if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
        items.push({
          kind: 'line',
          line: {
            oldLine: null,
            newLine: currNew,
            type: 'addition',
            text: rawLine
          }
        });
        currNew++;
      } else if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
        items.push({
          kind: 'line',
          line: {
            oldLine: currOld,
            newLine: null,
            type: 'deletion',
            text: rawLine
          }
        });
        currOld++;
      } else {
        items.push({
          kind: 'line',
          line: {
            oldLine: currOld,
            newLine: currNew,
            type: 'context',
            text: rawLine
          }
        });
        currOld++;
        currNew++;
      }
    }

    prevOldEnd = currOld - 1;
    prevNewEnd = currNew - 1;
  }

  // Check for bottom-of-file gap
  if (totalLines && totalLines > prevNewEnd) {
    const bottomGap = emitGapSegments(
      filePath,
      'bottom',
      prevNewEnd + 1,
      totalLines,
      prevOldEnd + 1,
      prevOldEnd + (totalLines - prevNewEnd),
      undefined,
      expandedLines
    );
    items.push(...bottomGap);
  } else if (!totalLines && prevNewEnd > 0) {
    // If totalLines unknown, render bottom expander prompt starting at prevNewEnd + 1
    const bottomUnexpEnd = prevNewEnd + 20;
    const bottomGap = emitGapSegments(
      filePath,
      'bottom',
      prevNewEnd + 1,
      bottomUnexpEnd,
      prevOldEnd + 1,
      prevOldEnd + 20,
      undefined,
      expandedLines
    );
    items.push(...bottomGap);
  }

  return items;
}

/**
 * Parses side-by-side patch into aligned 2-column rows and full-width gap items.
 */
export function parseSideBySidePatchWithGaps(
  patch: string,
  filePath: string,
  expandedLines?: Record<number, string>,
  totalLines?: number
): SideBySideDiffItem[] {
  const unifiedItems = parseUnifiedPatchWithGaps(patch, filePath, expandedLines, totalLines);
  const rows: SideBySideDiffItem[] = [];

  let pendingDeletions: ParsedDiffLine[] = [];
  let pendingAdditions: ParsedDiffLine[] = [];

  const flushPending = () => {
    const maxLen = Math.max(pendingDeletions.length, pendingAdditions.length);
    for (let i = 0; i < maxLen; i++) {
      const del = pendingDeletions[i];
      const add = pendingAdditions[i];
      rows.push({
        kind: 'row',
        row: {
          leftLineNum: del ? del.oldLine : null,
          leftText: del ? del.text : '',
          leftType: del ? 'deletion' : 'empty',
          rightLineNum: add ? add.newLine : null,
          rightText: add ? add.text : '',
          rightType: add ? 'addition' : 'empty',
        }
      });
    }
    pendingDeletions = [];
    pendingAdditions = [];
  };

  for (const item of unifiedItems) {
    if (item.kind === 'gap') {
      flushPending();
      rows.push(item);
      continue;
    }

    const { line } = item;
    if (line.type === 'addition') {
      pendingAdditions.push(line);
    } else if (line.type === 'deletion') {
      pendingDeletions.push(line);
    } else {
      flushPending();
      rows.push({
        kind: 'row',
        row: {
          leftLineNum: line.oldLine,
          leftText: line.text,
          leftType: 'context',
          rightLineNum: line.newLine,
          rightText: line.text,
          rightType: 'context',
          isExpanded: line.isExpanded
        }
      });
    }
  }

  flushPending();
  return rows;
}
