/**
 * Safe, high-performance Grep and Regular Expression matching utility for Cyclode.
 * Supports literal text, case sensitivity flags, explicit/implicit regular expressions,
 * patch content line searching, and safe compilation fallbacks.
 */

export interface GrepMatcherOptions {
  isRegex?: boolean;
  caseSensitive?: boolean;
  searchDiffContent?: boolean;
  isAst?: boolean;
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
  isAst: boolean;
  isValid: boolean;
  error: string | null;
  regex: RegExp | null;
  highlightRegex: RegExp | null;
  targetSymbol?: string;
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
 * Helper to parse AST query syntax (e.g., @router, class: Foo, func: bar, def: baz)
 * into test patterns and highlight tokens.
 */
export function parseAstQuery(query: string): {
  isAst: boolean;
  targetSymbol?: string;
  testPattern?: string;
  highlightPattern?: string;
} {
  const trimmed = query.trim();
  if (!trimmed) return { isAst: false };

  // Decorator query: @router, @app.get, @inject
  if (trimmed.startsWith('@')) {
    const symbol = trimmed.slice(1).trim();
    if (!symbol) {
      return { isAst: true, testPattern: '@', highlightPattern: '@' };
    }
    const escaped = escapeRegExp(symbol);
    return {
      isAst: true,
      targetSymbol: symbol,
      testPattern: `(?:@\\s*${escaped}|${escaped})`,
      highlightPattern: `@?\\s*${escaped}`,
    };
  }

  // Class / Type / Interface query: class: User, extends: Base, interface: Config
  const classMatch = trimmed.match(/^(?:class|extends|interface|struct|type):\s*(.+)$/i);
  if (classMatch) {
    const symbol = classMatch[1].trim();
    if (!symbol) return { isAst: true, testPattern: 'class', highlightPattern: 'class' };
    const escaped = escapeRegExp(symbol);
    return {
      isAst: true,
      targetSymbol: symbol,
      testPattern: `(?:class|struct|interface|type)\\s+[A-Za-z0-9_$]*${escaped}|${escaped}`,
      highlightPattern: escaped,
    };
  }

  // Function / Method query: func: handle_request, def: compute, fn: process
  const funcMatch = trimmed.match(/^(?:func|fn|def|method|action):\s*(.+)$/i);
  if (funcMatch) {
    const symbol = funcMatch[1].trim();
    if (!symbol) return { isAst: true, testPattern: 'def|function|func', highlightPattern: 'def|function|func' };
    const escaped = escapeRegExp(symbol);
    return {
      isAst: true,
      targetSymbol: symbol,
      testPattern: `(?:def|async\\s+def|function|fn|func|const|let|var)\\s+[A-Za-z0-9_$]*${escaped}|${escaped}`,
      highlightPattern: escaped,
    };
  }

  // Variable / Const / Let query: const: API_URL, var: count
  const varMatch = trimmed.match(/^(?:var|const|let|val):\s*(.+)$/i);
  if (varMatch) {
    const symbol = varMatch[1].trim();
    if (!symbol) return { isAst: true, testPattern: 'const|let|var', highlightPattern: 'const|let|var' };
    const escaped = escapeRegExp(symbol);
    return {
      isAst: true,
      targetSymbol: symbol,
      testPattern: `(?:const|let|var|val)\\s+${escaped}|${escaped}`,
      highlightPattern: escaped,
    };
  }

  // Symbol query: symbol: Identifier
  const symMatch = trimmed.match(/^(?:symbol|sym|id):\s*(.+)$/i);
  if (symMatch) {
    const symbol = symMatch[1].trim();
    const escaped = escapeRegExp(symbol);
    return {
      isAst: true,
      targetSymbol: symbol,
      testPattern: `\\b${escaped}\\b`,
      highlightPattern: `\\b${escaped}\\b`,
    };
  }

  // Endpoint / Route query: endpoint: /api/tasks, route: /users
  const routeMatch = trimmed.match(/^(?:endpoint|route|path):\s*(.+)$/i);
  if (routeMatch) {
    const routePath = routeMatch[1].trim();
    const escaped = escapeRegExp(routePath);
    return {
      isAst: true,
      targetSymbol: routePath,
      testPattern: `["']${escaped}|${escaped}`,
      highlightPattern: escaped,
    };
  }

  return { isAst: false };
}

/**
 * Constructs a resilient GrepMatcher instance from a search query string.
 */
export function createGrepMatcher(query: string, options: GrepMatcherOptions = {}): GrepMatcher {
  const trimmed = query.trim();
  const caseSensitive = options.caseSensitive ?? false;
  let isRegex = options.isRegex ?? false;
  let isAst = options.isAst ?? false;

  if (!trimmed) {
    return {
      rawQuery: '',
      isRegex: false,
      caseSensitive: false,
      isAst: false,
      isValid: true,
      error: null,
      regex: null,
      highlightRegex: null,
      test: () => true,
      matchCount: () => 0,
      highlightSegments: (text) => [{ text: text || '', matched: false }],
      grepPatch: () => ({
        hasMatch: false,
        matchingLinesCount: 0,
        matchedLineIndices: [],
        matchingLines: [],
      }),
    };
  }

  const astInfo = parseAstQuery(trimmed);
  if (astInfo.isAst) {
    isAst = true;
  }

  // Check for slash-enclosed regex syntax e.g. /pattern/i
  let patternStr = trimmed;
  let highlightPatternStr = trimmed;
  let flags = caseSensitive ? 'g' : 'gi';

  const slashMatch = trimmed.match(/^\/(.+)\/([gimsuy]*)$/);
  if (slashMatch) {
    patternStr = slashMatch[1];
    highlightPatternStr = patternStr;
    isRegex = true;
    const specifiedFlags = slashMatch[2];
    flags = specifiedFlags.includes('g') ? specifiedFlags : `${specifiedFlags}g`;
    if (!caseSensitive && !flags.includes('i')) {
      flags += 'i';
    }
  } else if (astInfo.isAst && astInfo.testPattern) {
    patternStr = astInfo.testPattern;
    highlightPatternStr = astInfo.highlightPattern || astInfo.targetSymbol || trimmed;
    isRegex = true;
  }

  let compiledRegex: RegExp | null = null;
  let compiledHighlightRegex: RegExp | null = null;
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

    try {
      compiledHighlightRegex = new RegExp(highlightPatternStr, flags);
    } catch {
      try {
        compiledHighlightRegex = new RegExp(escapeRegExp(highlightPatternStr), flags);
      } catch {
        compiledHighlightRegex = compiledRegex;
      }
    }
  } else {
    try {
      compiledRegex = new RegExp(escapeRegExp(patternStr), flags);
      compiledHighlightRegex = compiledRegex;
    } catch {
      compiledRegex = null;
      compiledHighlightRegex = null;
    }
  }

  const test = (text: string | null | undefined): boolean => {
    if (!trimmed) return true;
    if (!text) return false;
    if (compiledRegex) {
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
    const activeRegex = compiledHighlightRegex || compiledRegex;
    if (!activeRegex) {
      return [{ text, matched: false }];
    }

    const segments: { text: string; matched: boolean }[] = [];
    activeRegex.lastIndex = 0;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    // Safety guard against infinite regex loops with zero-length matches
    let iterations = 0;
    const maxIterations = 500;

    while ((match = activeRegex.exec(text)) !== null && iterations++ < maxIterations) {
      if (match.index > lastIndex) {
        segments.push({
          text: text.slice(lastIndex, match.index),
          matched: false,
        });
      }
      if (match[0].length > 0) {
        segments.push({
          text: match[0],
          matched: true,
        });
        lastIndex = match.index + match[0].length;
      } else {
        activeRegex.lastIndex++;
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
    isAst,
    isValid,
    error,
    regex: compiledRegex,
    highlightRegex: compiledHighlightRegex,
    targetSymbol: astInfo.targetSymbol,
    test,
    matchCount,
    highlightSegments,
    grepPatch,
  };
}
