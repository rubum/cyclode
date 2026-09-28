/**
 * Safe, high-performance Grep and Regular Expression matching utility for Cyclode.
 * Supports literal text, case sensitivity flags, explicit/implicit regular expressions,
 * patch content line searching, and safe compilation fallbacks.
 */

export interface GrepMatcherOptions {
  isRegex?: boolean;
  caseSensitive?: boolean;
  searchDiffContent?: boolean;
}

export interface GrepLineMatch {
  lineIndex: number;
  lineText: string;
  isAddition: boolean;
  isDeletion: boolean;
}

export interface PatchGrepResult {
  hasMatch: boolean;
  matchingLinesCount: number;
  matchedLineIndices: number[];
  matchingLines: GrepLineMatch[];
}

export interface GrepMatcher {
  rawQuery: string;
  isRegex: boolean;
  caseSensitive: boolean;
  isValid: boolean;
  error: string | null;
  regex: RegExp | null;
  test: (text: string | null | undefined) => boolean;
  matchCount: (text: string | null | undefined) => number;
  highlightSegments: (text: string) => { text: string; matched: boolean }[];
  grepPatch: (patchText: string | null | undefined) => PatchGrepResult;
}

/**
 * Escapes special regex characters for safe literal matching.
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Constructs a resilient GrepMatcher instance from a search query string.
 */
export function createGrepMatcher(query: string, options: GrepMatcherOptions = {}): GrepMatcher {
  const trimmed = query.trim();
  const caseSensitive = options.caseSensitive ?? false;
  let isRegex = options.isRegex ?? false;

  if (!trimmed) {
    return {
      rawQuery: '',
      isRegex: false,
      caseSensitive: false,
      isValid: true,
      error: null,
      regex: null,
      test: () => true,
      matchCount: () => 0,
      highlightSegments: (text) => [{ text, matched: false }],
      grepPatch: () => ({
        hasMatch: false,
        matchingLinesCount: 0,
        matchedLineIndices: [],
        matchingLines: [],
      }),
    };
  }

  // Check for slash-enclosed regex syntax e.g. /pattern/i
  let patternStr = trimmed;
  let flags = caseSensitive ? 'g' : 'gi';

  const slashMatch = trimmed.match(/^\/(.+)\/([gimsuy]*)$/);
  if (slashMatch) {
    patternStr = slashMatch[1];
    isRegex = true;
    const specifiedFlags = slashMatch[2];
    flags = specifiedFlags.includes('g') ? specifiedFlags : `${specifiedFlags}g`;
    if (!caseSensitive && !flags.includes('i')) {
      flags += 'i';
    }
  }

  let compiledRegex: RegExp | null = null;
  let isValid = true;
  let error: string | null = null;

  if (isRegex) {
    try {
      compiledRegex = new RegExp(patternStr, flags);
    } catch (err: any) {
      isValid = false;
      error = err.message || 'Invalid regular expression';
      // Graceful fallback to escaped literal regex so typing never throws
      try {
        compiledRegex = new RegExp(escapeRegExp(patternStr), flags);
      } catch {
        compiledRegex = null;
      }
    }
  } else {
    try {
      compiledRegex = new RegExp(escapeRegExp(patternStr), flags);
    } catch {
      compiledRegex = null;
    }
  }

  const test = (text: string | null | undefined): boolean => {
    if (!trimmed) return true;
    if (!text) return false;
    if (compiledRegex) {
      // Reset regex index for global flags
      compiledRegex.lastIndex = 0;
      return compiledRegex.test(text);
    }
    const target = caseSensitive ? text : text.toLowerCase();
    const needle = caseSensitive ? trimmed : trimmed.toLowerCase();
    return target.includes(needle);
  };

  const matchCount = (text: string | null | undefined): number => {
    if (!trimmed || !text) return 0;
    if (compiledRegex) {
      compiledRegex.lastIndex = 0;
      const matches = text.match(compiledRegex);
      return matches ? matches.length : 0;
    }
    const target = caseSensitive ? text : text.toLowerCase();
    const needle = caseSensitive ? trimmed : trimmed.toLowerCase();
    let count = 0;
    let pos = target.indexOf(needle);
    while (pos !== -1) {
      count++;
      pos = target.indexOf(needle, pos + needle.length);
    }
    return count;
  };

  const highlightSegments = (text: string): { text: string; matched: boolean }[] => {
    if (!trimmed || !text) return [{ text: text || '', matched: false }];
    if (!compiledRegex) {
      return [{ text, matched: false }];
    }

    const segments: { text: string; matched: boolean }[] = [];
    compiledRegex.lastIndex = 0;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    // Safety guard against infinite regex loops with zero-length matches
    let iterations = 0;
    const maxIterations = 500;

    while ((match = compiledRegex.exec(text)) !== null && iterations++ < maxIterations) {
      if (match.index > lastIndex) {
        segments.push({
          text: text.slice(lastIndex, match.index),
          matched: false,
        });
      }
      segments.push({
        text: match[0],
        matched: true,
      });
      lastIndex = match.index + match[0].length;
      if (match[0].length === 0) {
        compiledRegex.lastIndex++;
      }
    }

    if (lastIndex < text.length) {
      segments.push({
        text: text.slice(lastIndex),
        matched: false,
      });
    }

    return segments.length > 0 ? segments : [{ text, matched: false }];
  };

  const grepPatch = (patchText: string | null | undefined): PatchGrepResult => {
    if (!trimmed || !patchText) {
      return {
        hasMatch: false,
        matchingLinesCount: 0,
        matchedLineIndices: [],
        matchingLines: [],
      };
    }

    const lines = patchText.split('\n');
    const matchedLineIndices: number[] = [];
    const matchingLines: GrepLineMatch[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (test(line)) {
        matchedLineIndices.push(i);
        matchingLines.push({
          lineIndex: i,
          lineText: line,
          isAddition: line.startsWith('+') && !line.startsWith('+++'),
          isDeletion: line.startsWith('-') && !line.startsWith('---'),
        });
      }
    }

    return {
      hasMatch: matchedLineIndices.length > 0,
      matchingLinesCount: matchedLineIndices.length,
      matchedLineIndices,
      matchingLines,
    };
  };

  return {
    rawQuery: query,
    isRegex,
    caseSensitive,
    isValid,
    error,
    regex: compiledRegex,
    test,
    matchCount,
    highlightSegments,
    grepPatch,
  };
}
