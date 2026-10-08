import { resolveLanguage } from './syntaxHighlighter';

export interface SniffedPastedDoc {
  id: string;
  title: string;
  content: string;
  language: string;
  extension: string;
  lineCount: number;
  wordCount: number;
  charCount: number;
  sizeBytes: number;
  createdAt: number;
}

export const localPastedDocs = new Map<string, SniffedPastedDoc>();

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Checks if a pasted string qualifies as "long text" that should be
 * encapsulated into an interactive document element.
 *
 * Rules:
 * - Length > 600 characters, OR
 * - >= 10 lines with total characters > 150
 */
export function isLongPastedText(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length > 600) return true;
  
  const lines = trimmed.split(/\r?\n/);
  if (lines.length >= 10 && trimmed.length > 150) {
    return true;
  }
  
  return false;
}

/**
 * Sniffs the semantic purpose, language grammar, and appropriate filename for a text block.
 */
export function sniffContentLanguageAndTitle(
  text: string,
  existingIndex: number = 1
): { language: string; extension: string; title: string } {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // 1. Python Traceback / Panic / Exception logs
  if (
    trimmed.includes('Traceback (most recent call last):') ||
    /File ".*?", line \d+, in /i.test(trimmed) ||
    /panic:\s*runtime error/i.test(trimmed) ||
    /Exception in thread ".*?"/i.test(trimmed)
  ) {
    return {
      language: 'python',
      extension: 'log',
      title: `traceback_${existingIndex}.log`,
    };
  }

  // 2. Structured JSON
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      JSON.parse(trimmed);
      return {
        language: 'json',
        extension: 'json',
        title: `payload_${existingIndex}.json`,
      };
    } catch {
      // Could be relaxed JSON or JS object
      if (trimmed.includes('":') || trimmed.includes("':")) {
        return {
          language: 'json',
          extension: 'json',
          title: `data_${existingIndex}.json`,
        };
      }
    }
  }

  // 3. SQL Queries / DDL
  if (
    /\b(SELECT\s+.*?\s+FROM|INSERT\s+INTO|CREATE\s+TABLE|ALTER\s+TABLE|UPDATE\s+.*?\s+SET|DELETE\s+FROM)\b/i.test(
      trimmed
    )
  ) {
    return {
      language: 'sql',
      extension: 'sql',
      title: `query_${existingIndex}.sql`,
    };
  }

  // 4. Shell / Bash scripts
  if (
    trimmed.startsWith('#!/bin/') ||
    trimmed.startsWith('#!/usr/bin/env') ||
    /^(curl\s+-|export\s+[A-Z_]+=|npm\s+(?:run|install)|docker\s+run)/m.test(trimmed)
  ) {
    return {
      language: 'bash',
      extension: 'sh',
      title: `script_${existingIndex}.sh`,
    };
  }

  // 5. TypeScript / JavaScript
  if (
    /\b(import\s+.*?\s+from\s+['"]|export\s+(?:default\s+)?(?:const|function|class|interface|type)|const\s+\w+\s*:\s*[A-Z]|console\.log\(|useEffect\(|useState\()/m.test(
      trimmed
    )
  ) {
    const isTs = /\b(interface\s+[A-Z]|type\s+[A-Z]\w*\s*=|:\s*(?:string|number|boolean|any|Record<))/m.test(
      trimmed
    );
    return {
      language: isTs ? 'typescript' : 'javascript',
      extension: isTs ? 'ts' : 'js',
      title: `snippet_${existingIndex}.${isTs ? 'ts' : 'js'}`,
    };
  }

  // 6. Python source code
  if (
    /\b(def\s+\w+\s*\(.*?\)\s*:|class\s+\w+(?:\(.*?\))?\s*:|import\s+\w+|from\s+\w+\s+import|if\s+__name__\s*==\s*['"]__main__['"])/m.test(
      trimmed
    )
  ) {
    return {
      language: 'python',
      extension: 'py',
      title: `snippet_${existingIndex}.py`,
    };
  }

  // 7. Rust source code
  if (
    /\b(fn\s+\w+\s*\(.*?\)\s*(?:->|\{)|pub\s+(?:struct|enum|fn|mod)|impl(?:<.*?>)?\s+\w+|let\s+mut\s+\w+)/m.test(
      trimmed
    )
  ) {
    return {
      language: 'rust',
      extension: 'rs',
      title: `snippet_${existingIndex}.rs`,
    };
  }

  // 8. Go source code
  if (
    /\b(package\s+\w+|func\s+(?:\(.*?\)\s*)?\w+\s*\(.*?\)|type\s+\w+\s+struct\s*\{|fmt\.Print)/m.test(
      trimmed
    )
  ) {
    return {
      language: 'go',
      extension: 'go',
      title: `snippet_${existingIndex}.go`,
    };
  }

  // 9. YAML / Docker Compose / Kubernetes manifests
  if (
    /^(apiVersion:|version:\s*['"]?\d|services:|dependencies:)/m.test(trimmed) ||
    /^[a-zA-Z0-9_-]+:\s*\n\s+[a-zA-Z0-9_-]+:/m.test(trimmed)
  ) {
    return {
      language: 'yaml',
      extension: 'yaml',
      title: `config_${existingIndex}.yaml`,
    };
  }

  // 10. Markdown documents
  if (
    trimmed.startsWith('# ') ||
    trimmed.startsWith('## ') ||
    /^(?:[-*]\s+.*?\n){3,}/m.test(trimmed) ||
    /\[.*?\]\(https?:\/\/.*?\)/m.test(trimmed)
  ) {
    return {
      language: 'markdown',
      extension: 'md',
      title: `document_${existingIndex}.md`,
    };
  }

  // Fallback: general plain text document
  return {
    language: 'text',
    extension: 'txt',
    title: `pasted_doc_${existingIndex}.txt`,
  };
}

/**
 * Creates a complete SniffedPastedDoc object from raw text.
 */
export function createSniffedPastedDoc(
  text: string,
  existingIndex: number = 1
): SniffedPastedDoc {
  const { language, extension, title } = sniffContentLanguageAndTitle(text, existingIndex);
  const lines = text.split(/\r?\n/);
  const lineCount = lines.length;
  const charCount = text.length;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  // UTF-8 byte estimate
  const sizeBytes = new Blob([text]).size;

  return {
    id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    content: text,
    language,
    extension,
    lineCount,
    wordCount,
    charCount,
    sizeBytes,
    createdAt: Date.now(),
  };
}
