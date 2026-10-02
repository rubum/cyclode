import Prism from 'prismjs';

// Base and core foundation grammars
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-diff';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-markup-templating';

// Systems and C-family languages
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-zig';
import 'prismjs/components/prism-solidity';
import 'prismjs/components/prism-wasm';

// JVM & Mobile languages
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-scala';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-groovy';
import 'prismjs/components/prism-dart';
import 'prismjs/components/prism-swift';

// Functional languages
import 'prismjs/components/prism-haskell';
import 'prismjs/components/prism-elixir';
import 'prismjs/components/prism-erlang';
import 'prismjs/components/prism-clojure';
import 'prismjs/components/prism-ocaml';
import 'prismjs/components/prism-fsharp';

// Scripting & Dynamic languages
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-lua';
import 'prismjs/components/prism-perl';
import 'prismjs/components/prism-r';
import 'prismjs/components/prism-julia';
import 'prismjs/components/prism-powershell';

// Infrastructure, Config & Formats
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-hcl';
import 'prismjs/components/prism-nix';
import 'prismjs/components/prism-protobuf';
import 'prismjs/components/prism-graphql';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-makefile';
import 'prismjs/components/prism-latex';

// Custom Phoenix HEEx & EEx Template Grammar
if (Prism.languages.markup && Prism.languages.elixir) {
  const heexElixirExpression = {
    pattern: /=\{[\s\S]*?\}/,
    inside: {
      punctuation: /^=\{|^\s*\{|\}$/,
      elixir: {
        pattern: /[\s\S]+/,
        inside: Prism.languages.elixir,
      },
    },
  };

  const heexInlineExpression = {
    pattern: /\{[^{}\r\n]+\}/,
    inside: {
      punctuation: /^\{|\}$/,
      elixir: {
        pattern: /[\s\S]+/,
        inside: Prism.languages.elixir,
      },
    },
  };

  const heexComments = [
    {
      pattern: /<%!--[\s\S]*?--%>/,
      greedy: true,
      alias: 'comment',
    },
    {
      pattern: /<%#[\s\S]*?%>/,
      greedy: true,
      alias: 'comment',
    },
    {
      pattern: /<!--[\s\S]*?-->/,
      greedy: true,
      alias: 'comment',
    },
  ];

  const heexEexTag = {
    pattern: /<%={0,2}[\s\S]*?%>/,
    greedy: true,
    inside: {
      delimiter: {
        pattern: /^<%={0,2}|%>$/,
        alias: 'punctuation',
      },
      elixir: {
        pattern: /[\s\S]+/,
        inside: Prism.languages.elixir,
      },
    },
  };

  // Clone markup as the base for heex
  Prism.languages.heex = Prism.languages.extend('markup', {
    comment: heexComments,
  });

  // Insert HEEx Component and Slot parsers before general HTML tags
  Prism.languages.insertBefore('heex', 'tag', {
    'eex-tag': heexEexTag,
    'heex-component': {
      pattern: /<\/?\.[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*(?:\s+[^\s>]+|\s+{[^}]+})*\/?>/,
      greedy: true,
      inside: {
        tag: {
          pattern: /^<\/?\.[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*|\/?>$/,
          inside: {
            punctuation: /^<\/?|\/?>$/,
            namespace: /^\./,
            'class-name': /[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*/,
          },
        },
        'special-attr': {
          pattern: /:(?:let|for|if)=/i,
          alias: 'keyword',
        },
        'phx-directive': {
          pattern: /\bphx-[a-zA-Z0-9_-]+=/i,
          alias: 'property',
        },
        'heex-attr-expr': heexElixirExpression,
        'attr-value': {
          pattern: /=\s*(?:"[^"]*"|'[^']*')/i,
          inside: {
            punctuation: [
              /^=/,
              {
                pattern: /^(\s*)["']|["']$/,
                lookbehind: true,
              },
            ],
          },
        },
        punctuation: /=/,
        'attr-name': /[^\s>\/]+/,
      },
    },
    'heex-slot': {
      pattern: /<\/?\:[a-zA-Z0-9_]+(?:\s+[^\s>]+|\s+{[^}]+})*\/?>/,
      greedy: true,
      inside: {
        tag: {
          pattern: /^<\/?\:[a-zA-Z0-9_]+|\/?>$/,
          inside: {
            punctuation: /^<\/?|\/?>$/,
            symbol: /^\:[a-zA-Z0-9_]+/,
          },
        },
        'special-attr': {
          pattern: /:(?:let|for|if)=/i,
          alias: 'keyword',
        },
        'heex-attr-expr': heexElixirExpression,
        'attr-value': {
          pattern: /=\s*(?:"[^"]*"|'[^']*')/i,
          inside: {
            punctuation: [
              /^=/,
              {
                pattern: /^(\s*)["']|["']$/,
                lookbehind: true,
              },
            ],
          },
        },
        punctuation: /=/,
        'attr-name': /[^\s>\/]+/,
      },
    },
  });

  // Enhance standard tag attributes to recognize phx-* directives and ={...} expressions
  const heexGrammar = Prism.languages.heex as Record<string, any>;
  if (heexGrammar && heexGrammar.tag && heexGrammar.tag.inside) {
    Prism.languages.insertBefore(
      'heex',
      'attr-value',
      {
        'special-attr': {
          pattern: /:(?:let|for|if)=/i,
          alias: 'keyword',
        },
        'phx-directive': {
          pattern: /\bphx-[a-zA-Z0-9_-]+=/i,
          alias: 'property',
        },
        'heex-attr-expr': heexElixirExpression,
      },
      heexGrammar.tag.inside
    );
  }

  // Support inline {expression} interpolation in template text
  Prism.languages.insertBefore('heex', 'entity', {
    'heex-interpolation': heexInlineExpression,
  });

  // Register template aliases
  Prism.languages.eex = Prism.languages.heex;
  Prism.languages.leex = Prism.languages.heex;
  Prism.languages['html.heex'] = Prism.languages.heex;
  Prism.languages['html.eex'] = Prism.languages.heex;
  Prism.languages['html.leex'] = Prism.languages.heex;
}

// Enhance Elixir docstring grammar to prevent keyword leakage in prose and ensure comment styling
if (Prism.languages.elixir) {
  (Prism.languages.elixir as any).doc = {
    pattern: /@(?:doc|moduledoc|typedoc|shortdoc)\s+(?:~[sS](?:("""|''')[\s\S]*?\1|([\/|"'])(?:\\.|(?!\2)[^\\\r\n])*\2|\((?:\\.|[^\\)\r\n])*\)|\[(?:\\.|[^\\\]\r\n])*\]|\{(?:\\.|[^\\}\r\n])*\}|<(?:\\.|[^\\>\r\n])*>)|("""|''')[\s\S]*?\3|("|')(?:\\(?:\r\n|[\s\S])|(?!\4)[^\\\r\n])*\4|false)/,
    greedy: true,
    inside: {
      attribute: {
        pattern: /^@\w+/,
        alias: 'keyword',
      },
      boolean: {
        pattern: /\bfalse\b/,
        alias: 'boolean',
      },
      docstring: {
        pattern: /[\s\S]+/,
        alias: ['comment', 'doc-comment', 'docstring'],
      },
    },
  };
}

// Enhance Python triple-quoted docstrings with comment styling
if (Prism.languages.python && (Prism.languages.python as any)['triple-quoted-string']) {
  (Prism.languages.python as any)['triple-quoted-string'].alias = ['comment', 'docstring', 'doc-comment', 'string'];
}

const EXTENSION_MAP: Record<string, string> = {
  // Python
  py: 'python',
  pyw: 'python',
  // JS / TS
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  // Data / Config
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  // Shell
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  psm1: 'powershell',
  // Functional & Phoenix
  hs: 'haskell',
  lhs: 'haskell',
  cabal: 'haskell',
  ex: 'elixir',
  exs: 'elixir',
  heex: 'heex',
  eex: 'heex',
  leex: 'heex',
  sface: 'heex',
  erl: 'erlang',
  hrl: 'erlang',
  clj: 'clojure',
  cljs: 'clojure',
  cljc: 'clojure',
  edn: 'clojure',
  ml: 'ocaml',
  mli: 'ocaml',
  re: 'ocaml',
  fs: 'fsharp',
  fsi: 'fsharp',
  fsx: 'fsharp',
  scala: 'scala',
  sc: 'scala',
  // Systems & Compiled
  rs: 'rust',
  go: 'go',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  cs: 'csharp',
  zig: 'zig',
  sol: 'solidity',
  wat: 'wasm',
  wasm: 'wasm',
  // JVM & Mobile
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  dart: 'dart',
  swift: 'swift',
  groovy: 'groovy',
  gradle: 'groovy',
  // Scripting
  php: 'php',
  phtml: 'php',
  rb: 'ruby',
  lua: 'lua',
  pl: 'perl',
  pm: 'perl',
  r: 'r',
  rmd: 'r',
  jl: 'julia',
  // DevOps & Formats
  tf: 'hcl',
  tfvars: 'hcl',
  hcl: 'hcl',
  nix: 'nix',
  proto: 'protobuf',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  dockerfile: 'docker',
  makefile: 'makefile',
  mk: 'makefile',
  tex: 'latex',
  latex: 'latex',
  // Web & Markup
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  svg: 'markup',
  css: 'css',
  scss: 'scss',
  md: 'markdown',
  markdown: 'markdown',
  diff: 'diff',
};

export function resolveLanguage(langOrExt?: string, fileName?: string): string {
  if (fileName) {
    const lowerName = fileName.toLowerCase();
    if (lowerName === 'dockerfile' || lowerName.startsWith('dockerfile.')) return 'docker';
    if (lowerName === 'makefile' || lowerName === 'gnumakefile') return 'makefile';
    if (lowerName === 'gemfile' || lowerName === 'rakefile') return 'ruby';
    if (lowerName === 'mix.lock') return 'elixir';
    if (lowerName === 'cargo.lock') return 'toml';
    if (lowerName === 'pubspec.yaml' || lowerName === 'pubspec.lock') return 'yaml';
    if (lowerName === 'package.swift') return 'swift';
    if (lowerName === 'build.gradle.kts' || lowerName === 'settings.gradle.kts') return 'kotlin';
    if (lowerName === 'build.gradle' || lowerName === 'settings.gradle') return 'groovy';
    if (lowerName === 'cabal.project' || lowerName.endsWith('.cabal')) return 'haskell';
    if (lowerName === 'flake.nix' || lowerName === 'default.nix' || lowerName === 'shell.nix') return 'nix';
    if (lowerName.endsWith('.tf') || lowerName.endsWith('.tfvars')) return 'hcl';
    if (lowerName.endsWith('.html.heex') || lowerName.endsWith('.heex')) return 'heex';
    if (lowerName.endsWith('.html.eex') || lowerName.endsWith('.eex')) return 'heex';
    if (lowerName.endsWith('.html.leex') || lowerName.endsWith('.leex')) return 'heex';
    if (lowerName.endsWith('.sface')) return 'heex';
    
    const parts = lowerName.split('.');
    if (parts.length > 1) {
      const ext = parts.pop()!;
      if (EXTENSION_MAP[ext]) return EXTENSION_MAP[ext];
    }
  }

  if (langOrExt) {
    const norm = langOrExt.toLowerCase().trim().replace(/^\./, '');
    if (EXTENSION_MAP[norm]) return EXTENSION_MAP[norm];
    if (Prism.languages[norm]) return norm;
  }

  return 'text';
}

export function highlightCode(code: string, langOrExt?: string, fileName?: string): string {
  const language = resolveLanguage(langOrExt, fileName);
  const grammar = Prism.languages[language];

  if (grammar) {
    try {
      return Prism.highlight(code, grammar, language);
    } catch (e) {
      console.warn('Prism highlight error for lang:', language, e);
    }
  }

  return escapeHtml(code);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Accurately splits multiline syntax-highlighted HTML into individual line HTML strings
 * while cleanly carrying and closing open <span class="..."> tags across line breaks.
 */
export function splitHtmlLines(html: string): string[] {
  if (!html) return [];
  const lines = html.split('\n');
  const result: string[] = [];
  const openTags: { fullTag: string; tagName: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Start with currently open tags
    let lineOutput = openTags.map((t) => t.fullTag).join('') + line;

    // Parse tags in the current line to maintain the openTags stack
    const tagRegex = /<\/?([a-zA-Z0-9_-]+)(?:\s+[^>]*)?>/g;
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(line)) !== null) {
      const fullTag = match[0];
      const tagName = match[1].toLowerCase();
      if (fullTag.startsWith('</')) {
        // Find matching opening tag from end of openTags stack
        for (let k = openTags.length - 1; k >= 0; k--) {
          if (openTags[k].tagName === tagName) {
            openTags.splice(k, 1);
            break;
          }
        }
      } else if (!fullTag.endsWith('/>')) {
        // Opening tag
        openTags.push({ fullTag, tagName });
      }
    }

    // Close any tags still open at the end of this line
    for (let j = openTags.length - 1; j >= 0; j--) {
      lineOutput += '</' + openTags[j].tagName + '>';
    }
    result.push(lineOutput);
  }

  return result;
}

export interface HighlightDiffLineOptions {
  language?: string;
  fileName?: string;
  grepMatcher?: {
    test: (text: string | null | undefined) => boolean;
    highlightSegments: (text: string) => { text: string; matched: boolean }[];
  } | null;
}

const DIFF_LINE_CACHE = new Map<string, string>();
const MAX_DIFF_CACHE_SIZE = 5000;

function renderTokenStreamToHtml(
  token: string | Prism.Token | (string | Prism.Token)[],
  grepMatcher?: {
    test: (text: string | null | undefined) => boolean;
    highlightSegments: (text: string) => { text: string; matched: boolean }[];
  } | null
): string {
  if (typeof token === 'string') {
    if (grepMatcher && grepMatcher.test(token)) {
      const segments = grepMatcher.highlightSegments(token);
      return segments
        .map(seg =>
          seg.matched
            ? `<mark class="bg-onedark-yellow/30 text-onedark-yellow font-bold px-0.5 rounded-xs border border-onedark-yellow/40">${escapeHtml(seg.text)}</mark>`
            : escapeHtml(seg.text)
        )
        .join('');
    }
    return escapeHtml(token);
  }

  if (Array.isArray(token)) {
    return token.map(t => renderTokenStreamToHtml(t, grepMatcher)).join('');
  }

  // Prism.Token instance
  const typeClass = `token ${token.type} ${
    Array.isArray(token.alias)
      ? token.alias.join(' ')
      : token.alias || ''
  }`.trim();

  let innerHtml = '';
  if (typeof token.content === 'string') {
    if (grepMatcher && grepMatcher.test(token.content)) {
      const segments = grepMatcher.highlightSegments(token.content);
      innerHtml = segments
        .map(seg =>
          seg.matched
            ? `<mark class="bg-onedark-yellow/30 text-onedark-yellow font-bold px-0.5 rounded-xs border border-onedark-yellow/40">${escapeHtml(seg.text)}</mark>`
            : escapeHtml(seg.text)
        )
        .join('');
    } else {
      innerHtml = escapeHtml(token.content);
    }
  } else if (Array.isArray(token.content) || (typeof token.content === 'object' && token.content !== null)) {
    innerHtml = renderTokenStreamToHtml(token.content as any, grepMatcher);
  } else {
    innerHtml = escapeHtml(String(token.content ?? ''));
  }

  return `<span class="${typeClass}">${innerHtml}</span>`;
}

/**
 * Highlights a single line of source code from a unified or split diff.
 * Strips diff prefix markers before grammar tokenization to prevent syntax parse degradation,
 * preserves One Dark syntax token styling, and layers live grep search marks.
 */
export function highlightDiffLine(
  lineText: string,
  options?: HighlightDiffLineOptions
): string {
  if (!lineText) return ' ';

  const fileName = options?.fileName;
  const langOrExt = options?.language;
  const grepMatcher = options?.grepMatcher;

  const language = resolveLanguage(langOrExt, fileName);
  const grammar = Prism.languages[language];

  // If no grepMatcher is active, use fast LRU cache
  if (!grepMatcher) {
    const cacheKey = `${language}:::${lineText}`;
    const cached = DIFF_LINE_CACHE.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
  }

  let resultHtml = '';
  if (grammar) {
    try {
      const tokens = Prism.tokenize(lineText, grammar);
      resultHtml = renderTokenStreamToHtml(tokens, grepMatcher);
    } catch (e) {
      resultHtml = grepMatcher && grepMatcher.test(lineText)
        ? grepMatcher.highlightSegments(lineText).map(s => s.matched ? `<mark class="bg-onedark-yellow/30 text-onedark-yellow font-bold px-0.5 rounded-xs border border-onedark-yellow/40">${escapeHtml(s.text)}</mark>` : escapeHtml(s.text)).join('')
        : escapeHtml(lineText);
    }
  } else {
    resultHtml = grepMatcher && grepMatcher.test(lineText)
      ? grepMatcher.highlightSegments(lineText).map(s => s.matched ? `<mark class="bg-onedark-yellow/30 text-onedark-yellow font-bold px-0.5 rounded-xs border border-onedark-yellow/40">${escapeHtml(s.text)}</mark>` : escapeHtml(s.text)).join('')
      : escapeHtml(lineText);
  }

  if (!grepMatcher) {
    if (DIFF_LINE_CACHE.size > MAX_DIFF_CACHE_SIZE) {
      DIFF_LINE_CACHE.clear();
    }
    const cacheKey = `${language}:::${lineText}`;
    DIFF_LINE_CACHE.set(cacheKey, resultHtml);
  }

  return resultHtml;
}

export default Prism;
