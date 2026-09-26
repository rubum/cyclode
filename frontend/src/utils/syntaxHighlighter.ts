import Prism from 'prismjs';

// Load base and dependent languages in proper order
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
import 'prismjs/components/prism-elixir';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-dart';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-groovy';
import 'prismjs/components/prism-graphql';
import 'prismjs/components/prism-scss';

const EXTENSION_MAP: Record<string, string> = {
  py: 'python',
  pyw: 'python',
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ex: 'elixir',
  exs: 'elixir',
  rs: 'rust',
  go: 'go',
  sql: 'sql',
  md: 'markdown',
  markdown: 'markdown',
  css: 'css',
  scss: 'scss',
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  svg: 'markup',
  dockerfile: 'docker',
  toml: 'toml',
  rb: 'ruby',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  dart: 'dart',
  swift: 'swift',
  groovy: 'groovy',
  gradle: 'groovy',
  graphql: 'graphql',
  gql: 'graphql',
  diff: 'diff',
};

export function resolveLanguage(langOrExt?: string, fileName?: string): string {
  if (fileName) {
    const lowerName = fileName.toLowerCase();
    if (lowerName === 'dockerfile' || lowerName.startsWith('dockerfile.')) return 'docker';
    if (lowerName === 'gemfile' || lowerName === 'rakefile') return 'ruby';
    if (lowerName === 'mix.lock') return 'elixir';
    if (lowerName === 'cargo.lock') return 'toml';
    if (lowerName === 'pubspec.yaml' || lowerName === 'pubspec.lock') return 'yaml';
    if (lowerName === 'package.swift') return 'swift';
    if (lowerName === 'build.gradle.kts' || lowerName === 'settings.gradle.kts') return 'kotlin';
    if (lowerName === 'build.gradle' || lowerName === 'settings.gradle') return 'groovy';
    
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

export default Prism;
