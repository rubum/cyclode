use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use rayon::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tree_sitter::{Parser, Query, QueryCursor};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AstSymbol {
    pub name: String,
    #[serde(rename = "type")]
    pub symbol_type: String,
    pub file_path: String,
    pub line_number: usize,
    pub signature: String,
    #[serde(default)]
    pub docstring: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub decorators: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bases: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AstSearchResult {
    pub pattern: String,
    pub total_matches: usize,
    pub matches: Vec<AstSymbolMatch>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AstSymbolMatch {
    pub file_path: String,
    pub line_number: usize,
    pub symbol: String,
    #[serde(rename = "type")]
    pub symbol_type: String,
    pub signature: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub decorators: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bases: Vec<String>,
}

pub struct TreeSitterEngine {
    pub workspace_root: PathBuf,
}

impl TreeSitterEngine {
    pub fn new(workspace_root: PathBuf) -> Self {
        Self { workspace_root }
    }

    /// Extracts AST symbols for a specific file based on its extension.
    pub fn extract_file_symbols(&self, file_path: &str, content: &str) -> Vec<AstSymbol> {
        let ext = Path::new(file_path)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();

        match ext.as_str() {
            "py" => self.extract_python_symbols(file_path, content),
            "rs" => self.extract_rust_symbols(file_path, content),
            "go" => self.extract_go_symbols(file_path, content),
            "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" => {
                self.extract_js_ts_symbols(file_path, content)
            }
            "ex" | "exs" => self.extract_elixir_symbols(file_path, content),
            "rb" => self.extract_ruby_symbols(file_path, content),
            "java" | "kt" => self.extract_jvm_symbols(file_path, content),
            _ => Vec::new(),
        }
    }

    fn extract_python_symbols(&self, file_path: &str, content: &str) -> Vec<AstSymbol> {
        let lines: Vec<&str> = content.lines().collect();
        let mut symbols = Vec::new();
        let mut parser = Parser::new();
        if parser.set_language(&tree_sitter_python::language().into()).is_err() {
            return self.extract_python_fallback(file_path, content);
        }

        if let Some(tree) = parser.parse(content, None) {
            let query_str = "
                (function_definition name: (identifier) @fn_name) @fn
                (class_definition name: (identifier) @cls_name) @cls
            ";
            if let Ok(query) = Query::new(&tree_sitter_python::language().into(), query_str) {
                let mut cursor = QueryCursor::new();
                let matches = cursor.matches(&query, tree.root_node(), content.as_bytes());

                for m in matches {
                    for cap in m.captures {
                        let node = cap.node;
                        let line_idx = node.start_position().row;
                        let line_number = line_idx + 1;
                        let text = &content[node.byte_range()];
                        let first_line = text.lines().next().unwrap_or("").trim().to_string();

                        // Extract preceding decorators
                        let mut decorators = Vec::new();
                        let mut cur_line = line_idx;
                        while cur_line > 0 {
                            cur_line -= 1;
                            let prev_trimmed = lines.get(cur_line).map(|l| l.trim()).unwrap_or("");
                            if prev_trimmed.starts_with('@') {
                                decorators.push(prev_trimmed.to_string());
                            } else if !prev_trimmed.is_empty() && !prev_trimmed.starts_with('#') {
                                break;
                            }
                        }
                        decorators.reverse();

                        if cap.index == 0 { // fn_name
                            symbols.push(AstSymbol {
                                name: text.to_string(),
                                symbol_type: if !decorators.is_empty() { "endpoint".to_string() } else { "function".to_string() },
                                file_path: file_path.to_string(),
                                line_number,
                                signature: first_line,
                                docstring: String::new(),
                                decorators,
                                bases: Vec::new(),
                            });
                        } else if cap.index == 2 { // cls_name
                            symbols.push(AstSymbol {
                                name: text.to_string(),
                                symbol_type: "class".to_string(),
                                file_path: file_path.to_string(),
                                line_number,
                                signature: first_line,
                                docstring: String::new(),
                                decorators,
                                bases: Vec::new(),
                            });
                        }
                    }
                }
            }
        }

        if symbols.is_empty() {
            self.extract_python_fallback(file_path, content)
        } else {
            symbols
        }
    }

    fn extract_python_fallback(&self, file_path: &str, content: &str) -> Vec<AstSymbol> {
        let lines: Vec<&str> = content.lines().collect();
        let mut symbols = Vec::new();
        let re_fn = Regex::new(r"^\s*(?:async\s+)?def\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)").unwrap();
        let re_cls = Regex::new(r"^\s*class\s+([A-Za-z0-9_]+)(?:\(([^)]*)\))?").unwrap();

        for (idx, line) in lines.iter().enumerate() {
            // Extract preceding decorators
            let mut decorators = Vec::new();
            let mut cur_line = idx;
            while cur_line > 0 {
                cur_line -= 1;
                let prev_trimmed = lines.get(cur_line).map(|l| l.trim()).unwrap_or("");
                if prev_trimmed.starts_with('@') {
                    decorators.push(prev_trimmed.to_string());
                } else if !prev_trimmed.is_empty() && !prev_trimmed.starts_with('#') {
                    break;
                }
            }
            decorators.reverse();

            if let Some(caps) = re_fn.captures(line) {
                symbols.push(AstSymbol {
                    name: caps[1].to_string(),
                    symbol_type: if !decorators.is_empty() { "endpoint".to_string() } else { "function".to_string() },
                    file_path: file_path.to_string(),
                    line_number: idx + 1,
                    signature: line.trim().to_string(),
                    docstring: String::new(),
                    decorators,
                    bases: Vec::new(),
                });
            } else if let Some(caps) = re_cls.captures(line) {
                let bases = caps.get(2)
                    .map(|m| m.as_str().split(',').map(|s| s.trim().to_string()).collect())
                    .unwrap_or_default();
                symbols.push(AstSymbol {
                    name: caps[1].to_string(),
                    symbol_type: "class".to_string(),
                    file_path: file_path.to_string(),
                    line_number: idx + 1,
                    signature: line.trim().to_string(),
                    docstring: String::new(),
                    decorators,
                    bases,
                });
            }
        }
        symbols
    }

    fn extract_rust_symbols(&self, file_path: &str, content: &str) -> Vec<AstSymbol> {
        let mut symbols = Vec::new();
        let re_fn = Regex::new(r"^\s*(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)").unwrap();
        let re_type = Regex::new(r"^\s*(?:pub(?:\([^)]+\))?\s+)?(struct|enum|trait|impl)\s+([A-Za-z0-9_]+)").unwrap();

        for (idx, line) in content.lines().enumerate() {
            if let Some(caps) = re_fn.captures(line) {
                symbols.push(AstSymbol {
                    name: caps[1].to_string(),
                    symbol_type: "function".to_string(),
                    file_path: file_path.to_string(),
                    line_number: idx + 1,
                    signature: line.trim().to_string(),
                    docstring: String::new(),
                    decorators: Vec::new(),
                    bases: Vec::new(),
                });
            } else if let Some(caps) = re_type.captures(line) {
                symbols.push(AstSymbol {
                    name: caps[2].to_string(),
                    symbol_type: caps[1].to_string(),
                    file_path: file_path.to_string(),
                    line_number: idx + 1,
                    signature: line.trim().to_string(),
                    docstring: String::new(),
                    decorators: Vec::new(),
                    bases: Vec::new(),
                });
            }
        }
        symbols
    }

    fn extract_go_symbols(&self, file_path: &str, content: &str) -> Vec<AstSymbol> {
        let mut symbols = Vec::new();
        let re_fn = Regex::new(r"^\s*func\s+(?:\([^)]+\)\s+)?([A-Za-z0-9_]+)\s*\(").unwrap();
        let re_type = Regex::new(r"^\s*type\s+([A-Za-z0-9_]+)\s+(struct|interface)").unwrap();

        for (idx, line) in content.lines().enumerate() {
            if let Some(caps) = re_fn.captures(line) {
                symbols.push(AstSymbol {
                    name: caps[1].to_string(),
                    symbol_type: "function".to_string(),
                    file_path: file_path.to_string(),
                    line_number: idx + 1,
                    signature: line.trim().to_string(),
                    docstring: String::new(),
                    decorators: Vec::new(),
                    bases: Vec::new(),
                });
            } else if let Some(caps) = re_type.captures(line) {
                symbols.push(AstSymbol {
                    name: caps[1].to_string(),
                    symbol_type: caps[2].to_string(),
                    file_path: file_path.to_string(),
                    line_number: idx + 1,
                    signature: line.trim().to_string(),
                    docstring: String::new(),
                    decorators: Vec::new(),
                    bases: Vec::new(),
                });
            }
        }
        symbols
    }

    fn extract_elixir_symbols(&self, file_path: &str, content: &str) -> Vec<AstSymbol> {
        let mut symbols = Vec::new();
        let re_mod = Regex::new(r"^\s*defmodule\s+([A-Za-z0-9_.]+)").unwrap();
        let re_fn = Regex::new(r"^\s*(def|defp|defmacro|defguard)\s+([A-Za-z0-9_?!]+)(?:\(([^)]*)\))?").unwrap();

        for (idx, line) in content.lines().enumerate() {
            if let Some(caps) = re_mod.captures(line) {
                symbols.push(AstSymbol {
                    name: caps[1].to_string(),
                    symbol_type: "module".to_string(),
                    file_path: file_path.to_string(),
                    line_number: idx + 1,
                    signature: line.trim().to_string(),
                    docstring: String::new(),
                    decorators: Vec::new(),
                    bases: Vec::new(),
                });
            } else if let Some(caps) = re_fn.captures(line) {
                let kind = &caps[1];
                let name = &caps[2];
                let sym_type = if kind == "def" || kind == "defp" { "function" } else { "macro" };
                symbols.push(AstSymbol {
                    name: name.to_string(),
                    symbol_type: sym_type.to_string(),
                    file_path: file_path.to_string(),
                    line_number: idx + 1,
                    signature: line.trim().to_string(),
                    docstring: String::new(),
                    decorators: Vec::new(),
                    bases: Vec::new(),
                });
            }
        }
        symbols
    }

    fn extract_js_ts_symbols(&self, file_path: &str, content: &str) -> Vec<AstSymbol> {
        let mut symbols = Vec::new();
        let re_fn = Regex::new(r"^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(").unwrap();
        let re_arrow = Regex::new(r"^\s*(?:export\s+)?const\s+([A-Za-z0-9_$]+)(?:\s*:\s*([^=]+))?\s*=\s*(?:async\s*)?\(").unwrap();
        let re_type = Regex::new(r"^\s*(?:export\s+)?(class|interface|type)\s+([A-Za-z0-9_$]+)").unwrap();

        for (idx, line) in content.lines().enumerate() {
            if let Some(caps) = re_fn.captures(line) {
                symbols.push(AstSymbol {
                    name: caps[1].to_string(),
                    symbol_type: "function".to_string(),
                    file_path: file_path.to_string(),
                    line_number: idx + 1,
                    signature: line.trim().to_string(),
                    docstring: String::new(),
                    decorators: Vec::new(),
                    bases: Vec::new(),
                });
            } else if let Some(caps) = re_arrow.captures(line) {
                let name = &caps[1];
                let is_comp = name.chars().next().map(|c| c.is_uppercase()).unwrap_or(false);
                symbols.push(AstSymbol {
                    name: name.to_string(),
                    symbol_type: if is_comp { "component".to_string() } else { "function".to_string() },
                    file_path: file_path.to_string(),
                    line_number: idx + 1,
                    signature: line.trim().to_string(),
                    docstring: String::new(),
                    decorators: Vec::new(),
                    bases: Vec::new(),
                });
            } else if let Some(caps) = re_type.captures(line) {
                symbols.push(AstSymbol {
                    name: caps[2].to_string(),
                    symbol_type: caps[1].to_string(),
                    file_path: file_path.to_string(),
                    line_number: idx + 1,
                    signature: line.trim().to_string(),
                    docstring: String::new(),
                    decorators: Vec::new(),
                    bases: Vec::new(),
                });
            }
        }
        symbols
    }

    fn extract_ruby_symbols(&self, file_path: &str, content: &str) -> Vec<AstSymbol> {
        let mut symbols = Vec::new();
        let re_class = Regex::new(r"^\s*(class|module)\s+([A-Za-z0-9_:]+)").unwrap();
        let re_def = Regex::new(r"^\s*def\s+([A-Za-z0-9_?!.]+)").unwrap();

        for (idx, line) in content.lines().enumerate() {
            if let Some(caps) = re_class.captures(line) {
                symbols.push(AstSymbol {
                    name: caps[2].to_string(),
                    symbol_type: caps[1].to_string(),
                    file_path: file_path.to_string(),
                    line_number: idx + 1,
                    signature: line.trim().to_string(),
                    docstring: String::new(),
                    decorators: Vec::new(),
                    bases: Vec::new(),
                });
            } else if let Some(caps) = re_def.captures(line) {
                symbols.push(AstSymbol {
                    name: caps[1].to_string(),
                    symbol_type: "function".to_string(),
                    file_path: file_path.to_string(),
                    line_number: idx + 1,
                    signature: line.trim().to_string(),
                    docstring: String::new(),
                    decorators: Vec::new(),
                    bases: Vec::new(),
                });
            }
        }
        symbols
    }

    fn extract_jvm_symbols(&self, file_path: &str, content: &str) -> Vec<AstSymbol> {
        let mut symbols = Vec::new();
        let re_class = Regex::new(r"^\s*(?:public\s+|private\s+|protected\s+)?(?:abstract\s+|data\s+)?(class|interface|enum)\s+([A-Za-z0-9_]+)").unwrap();
        let re_fun = Regex::new(r"^\s*(?:public\s+|private\s+|protected\s+)?(?:suspend\s+)?fun\s+([A-Za-z0-9_]+)").unwrap();

        for (idx, line) in content.lines().enumerate() {
            if let Some(caps) = re_class.captures(line) {
                symbols.push(AstSymbol {
                    name: caps[2].to_string(),
                    symbol_type: caps[1].to_string(),
                    file_path: file_path.to_string(),
                    line_number: idx + 1,
                    signature: line.trim().to_string(),
                    docstring: String::new(),
                    decorators: Vec::new(),
                    bases: Vec::new(),
                });
            } else if let Some(caps) = re_fun.captures(line) {
                symbols.push(AstSymbol {
                    name: caps[1].to_string(),
                    symbol_type: "function".to_string(),
                    file_path: file_path.to_string(),
                    line_number: idx + 1,
                    signature: line.trim().to_string(),
                    docstring: String::new(),
                    decorators: Vec::new(),
                    bases: Vec::new(),
                });
            }
        }
        symbols
    }

    /// Indexes and scans all workspace symbols matching pattern.
    pub fn search_symbols(
        &self,
        pattern: &str,
        max_results: usize,
        current_file: Option<&str>,
    ) -> anyhow::Result<AstSearchResult> {
        let mut all_symbols: Vec<AstSymbol> = Vec::new();
        let pattern_clean = pattern.trim().to_lowercase();
        let normalized_current = current_file.map(|s| s.trim_start_matches('/').to_string());

        let ignored_dirs: HashSet<&str> = [
            ".git", "node_modules", "venv", ".venv", "__pycache__",
            "dist", "build", "target", ".next", ".cache", ".pytest_cache", ".gemini", "assets", "_build", "deps"
        ].into_iter().collect();

        let supported_exts: HashSet<&str> = [
            "py", "rs", "go", "ts", "tsx", "js", "jsx", "mjs", "cjs", "ex", "exs", "rb", "java", "kt", "c", "cpp", "h", "hpp"
        ].into_iter().collect();

        let mut files_to_scan = Vec::new();

        for entry in walkdir::WalkDir::new(&self.workspace_root)
            .into_iter()
            .filter_entry(|e| {
                if e.depth() == 0 {
                    return true;
                }
                let name = e.file_name().to_string_lossy();
                if e.file_type().is_dir() && (ignored_dirs.contains(name.as_ref()) || name.starts_with('.')) {
                    return false;
                }
                true
            })
            .filter_map(|e| e.ok())
        {
            if entry.file_type().is_file() {
                let path = entry.path();
                if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                    if supported_exts.contains(ext.to_lowercase().as_str()) {
                        if let Ok(rel) = path.strip_prefix(&self.workspace_root) {
                            files_to_scan.push(rel.to_path_buf());
                        }
                    }
                }
            }
        }

        let extracted: Vec<Vec<AstSymbol>> = files_to_scan
            .par_iter()
            .filter_map(|rel_path| {
                let full = self.workspace_root.join(rel_path);
                if let Ok(content) = fs::read_to_string(&full) {
                    let rel_str = rel_path.to_string_lossy().to_string();
                    Some(self.extract_file_symbols(&rel_str, &content))
                } else {
                    None
                }
            })
            .collect();

        for list in extracted {
            all_symbols.extend(list);
        }

        let mut matches = Vec::new();

        if pattern_clean.starts_with('@') {
            let dec_query = pattern_clean.trim_start_matches('@').trim();
            for sym in &all_symbols {
                let has_decorator = sym.decorators.iter().any(|d| {
                    let d_clean = d.trim_start_matches('@').to_lowercase();
                    d_clean.contains(dec_query)
                });
                if has_decorator || sym.signature.to_lowercase().contains(&pattern_clean) {
                    matches.push(AstSymbolMatch {
                        file_path: sym.file_path.clone(),
                        line_number: sym.line_number,
                        symbol: sym.name.clone(),
                        symbol_type: sym.symbol_type.clone(),
                        signature: sym.signature.clone(),
                        decorators: sym.decorators.clone(),
                        bases: sym.bases.clone(),
                    });
                }
            }
        } else if pattern_clean.starts_with("class:") || pattern_clean.starts_with("extends:") {
            let base_query = pattern_clean.split(':').nth(1).unwrap_or("").trim();
            for sym in &all_symbols {
                let has_base = sym.bases.iter().any(|b| b.to_lowercase().contains(base_query));
                if has_base || sym.name.to_lowercase().contains(base_query) {
                    matches.push(AstSymbolMatch {
                        file_path: sym.file_path.clone(),
                        line_number: sym.line_number,
                        symbol: sym.name.clone(),
                        symbol_type: sym.symbol_type.clone(),
                        signature: sym.signature.clone(),
                        decorators: sym.decorators.clone(),
                        bases: sym.bases.clone(),
                    });
                }
            }
        } else {
            for sym in &all_symbols {
                if pattern_clean.is_empty()
                    || sym.name.to_lowercase().contains(&pattern_clean)
                    || sym.signature.to_lowercase().contains(&pattern_clean)
                    || sym.decorators.iter().any(|d| d.to_lowercase().contains(&pattern_clean))
                    || sym.bases.iter().any(|b| b.to_lowercase().contains(&pattern_clean))
                {
                    matches.push(AstSymbolMatch {
                        file_path: sym.file_path.clone(),
                        line_number: sym.line_number,
                        symbol: sym.name.clone(),
                        symbol_type: sym.symbol_type.clone(),
                        signature: sym.signature.clone(),
                        decorators: sym.decorators.clone(),
                        bases: sym.bases.clone(),
                    });
                }
            }
        }

        // If no AST matches found, fallback to searching text references
        if matches.is_empty() && !pattern_clean.is_empty() {
            let mut trigram_idx = crate::indexer::TrigramIndex::new(self.workspace_root.clone());
            if trigram_idx.build().is_ok() {
                if let Ok(text_res) = trigram_idx.search(pattern, false, false, max_results, current_file) {
                    for tm in text_res.matches {
                        matches.push(AstSymbolMatch {
                            file_path: tm.file_path,
                            line_number: tm.line_number,
                            symbol: pattern.to_string(),
                            symbol_type: "reference".to_string(),
                            signature: tm.line_content,
                            decorators: Vec::new(),
                            bases: Vec::new(),
                        });
                    }
                }
            }
        }

        // Prioritize current_file matches
        let final_matches = if let Some(curr) = normalized_current {
            let mut curr_matches = Vec::new();
            let mut other_matches = Vec::new();

            for m in matches {
                if m.file_path == curr || m.file_path.ends_with(&curr) {
                    curr_matches.push(m);
                } else {
                    other_matches.push(m);
                }
            }

            let mut res = curr_matches;
            let needed = max_results.saturating_sub(res.len());
            res.extend(other_matches.into_iter().take(needed));
            res
        } else {
            matches.into_iter().take(max_results).collect()
        };

        Ok(AstSearchResult {
            pattern: pattern.to_string(),
            total_matches: final_matches.len(),
            matches: final_matches,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_python_symbols() {
        let engine = TreeSitterEngine::new(PathBuf::from("."));
        let code = r#"
class DataProcessor:
    def __init__(self, name: str):
        self.name = name

    async def process_batch(self, items: list) -> bool:
        return True
"#;
        let symbols = engine.extract_file_symbols("processor.py", code);
        assert!(symbols.len() >= 2);
        let names: Vec<&str> = symbols.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"DataProcessor"));
        assert!(names.contains(&"process_batch"));
    }

    #[test]
    fn test_extract_rust_symbols() {
        let engine = TreeSitterEngine::new(PathBuf::from("."));
        let code = r#"
pub struct EngineConfig {
    pub threads: usize,
}

pub async fn run_daemon() -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}
"#;
        let symbols = engine.extract_file_symbols("engine.rs", code);
        assert_eq!(symbols.len(), 2);
        assert_eq!(symbols[0].name, "EngineConfig");
        assert_eq!(symbols[0].symbol_type, "struct");
        assert_eq!(symbols[1].name, "run_daemon");
        assert_eq!(symbols[1].symbol_type, "function");
    }

    #[test]
    fn test_extract_go_symbols() {
        let engine = TreeSitterEngine::new(PathBuf::from("."));
        let code = r#"
type Server struct {
    port int
}

func (s *Server) Start() error {
    return nil
}
"#;
        let symbols = engine.extract_file_symbols("server.go", code);
        assert!(symbols.len() >= 1);
        let names: Vec<&str> = symbols.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"Start"));
    }

    #[test]
    fn test_extract_js_ts_symbols() {
        let engine = TreeSitterEngine::new(PathBuf::from("."));
        let code = r#"
export class AppService {
    constructor() {}
}

export const fetchUsers = async () => {
    return [];
};
"#;
        let symbols = engine.extract_file_symbols("service.ts", code);
        assert!(symbols.len() >= 2);
        let names: Vec<&str> = symbols.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"AppService"));
        assert!(names.contains(&"fetchUsers"));
    }
}
