use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use rayon::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchMatch {
    pub file_path: String,
    pub line_number: usize,
    pub line_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub query: String,
    pub mode: String,
    pub total_matches: usize,
    pub capped: bool,
    pub matches: Vec<SearchMatch>,
}

/// Computes all 3-byte trigrams from a string or byte slice.
pub fn extract_trigrams(text: &str) -> HashSet<[u8; 3]> {
    let mut trigrams = HashSet::new();
    let bytes = text.as_bytes();
    if bytes.len() < 3 {
        return trigrams;
    }
    for window in bytes.windows(3) {
        trigrams.insert([window[0], window[1], window[2]]);
    }
    trigrams
}

/// Inverted trigram index mapping trigrams to sorted file indices.
pub struct TrigramIndex {
    pub workspace_root: PathBuf,
    pub files: Vec<PathBuf>,
    pub posting_lists: HashMap<[u8; 3], Vec<u32>>,
}

impl TrigramIndex {
    pub fn new(workspace_root: PathBuf) -> Self {
        Self {
            workspace_root,
            files: Vec::new(),
            posting_lists: HashMap::new(),
        }
    }

    /// Indexes all non-ignored text files in the workspace.
    pub fn build(&mut self) -> anyhow::Result<usize> {
        let ignored_dirs: HashSet<&str> = [
            ".git", "node_modules", "venv", ".venv", "__pycache__",
            "dist", "build", "target", ".next", ".cache", ".pytest_cache", ".gemini", "assets", "_build", "deps"
        ].into_iter().collect();

        let ignored_exts: HashSet<&str> = [
            "png", "jpg", "jpeg", "ico", "svg", "gif", "webp",
            "pdf", "zip", "tar", "gz", "pyc", "db", "sqlite", "sqlite3", "woff", "woff2"
        ].into_iter().collect();

        let mut collected_files = Vec::new();

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
                    if ignored_exts.contains(ext.to_lowercase().as_str()) {
                        continue;
                    }
                }
                if let Ok(rel) = path.strip_prefix(&self.workspace_root) {
                    collected_files.push(rel.to_path_buf());
                }
            }
        }

        self.files = collected_files;

        // Build trigram postings in parallel
        let file_trigrams: Vec<(u32, HashSet<[u8; 3]>)> = self.files
            .par_iter()
            .enumerate()
            .filter_map(|(idx, rel_path)| {
                let full_path = self.workspace_root.join(rel_path);
                if let Ok(mut f) = File::open(&full_path) {
                    let mut buffer = Vec::new();
                    // Read up to 2MB per file for indexing
                    if f.read_to_end(&mut buffer).is_ok() {
                        if !buffer.contains(&0) { // Binary check
                            if let Ok(text) = std::str::from_utf8(&buffer) {
                                let trigrams = extract_trigrams(&text.to_lowercase());
                                return Some((idx as u32, trigrams));
                            }
                        }
                    }
                }
                None
            })
            .collect();

        for (file_id, trigrams) in file_trigrams {
            for tg in trigrams {
                self.posting_lists.entry(tg).or_default().push(file_id);
            }
        }

        Ok(self.files.len())
    }

    /// Extracts literal substrings of 3 or more alphanumeric/word chars from a regex pattern
    pub fn extract_regex_literals(pattern: &str) -> Vec<String> {
        let mut literals = Vec::new();
        let mut cur = String::new();
        for ch in pattern.chars() {
            if ch.is_alphanumeric() || ch == '_' {
                cur.push(ch);
            } else {
                if cur.len() >= 3 {
                    literals.push(cur.clone());
                }
                cur.clear();
            }
        }
        if cur.len() >= 3 {
            literals.push(cur);
        }
        literals
    }

    /// Finds candidate file IDs by intersecting trigrams found in query.
    pub fn find_candidates(&self, query: &str) -> Vec<u32> {
        let q_lower = query.to_lowercase();
        let query_trigrams = extract_trigrams(&q_lower);
        if query_trigrams.is_empty() {
            // If query is shorter than 3 chars, return all file IDs
            return (0..self.files.len() as u32).collect();
        }

        let mut candidate_set: Option<HashSet<u32>> = None;

        for tg in query_trigrams {
            if let Some(postings) = self.posting_lists.get(&tg) {
                let current_set: HashSet<u32> = postings.iter().copied().collect();
                candidate_set = match candidate_set {
                    None => Some(current_set),
                    Some(prev) => Some(prev.intersection(&current_set).copied().collect()),
                };
            } else {
                // If any trigram is completely absent, no file can match
                return Vec::new();
            }
        }

        candidate_set.map(|s| s.into_iter().collect()).unwrap_or_default()
    }

    /// Finds candidate file IDs for regex by checking literal chunks
    pub fn find_regex_candidates(&self, pattern: &str) -> Vec<u32> {
        let literals = Self::extract_regex_literals(pattern);
        if literals.is_empty() {
            return (0..self.files.len() as u32).collect();
        }

        if pattern.contains('|') {
            let mut union_set = HashSet::new();
            for lit in &literals {
                let cands = self.find_candidates(lit);
                union_set.extend(cands);
            }
            if union_set.is_empty() {
                (0..self.files.len() as u32).collect()
            } else {
                union_set.into_iter().collect()
            }
        } else {
            let mut candidate_set: Option<HashSet<u32>> = None;
            for lit in &literals {
                let cands: HashSet<u32> = self.find_candidates(lit).into_iter().collect();
                candidate_set = match candidate_set {
                    None => Some(cands),
                    Some(prev) => Some(prev.intersection(&cands).copied().collect()),
                };
            }
            candidate_set.map(|s| s.into_iter().collect()).unwrap_or_else(|| (0..self.files.len() as u32).collect())
        }
    }

    /// Searches text or regex across candidate files, prioritizing current_file.
    pub fn search(
        &self,
        query: &str,
        is_regex: bool,
        case_sensitive: bool,
        max_results: usize,
        current_file: Option<&str>,
    ) -> anyhow::Result<SearchResult> {
        if query.trim().is_empty() {
            return Ok(SearchResult {
                query: query.to_string(),
                mode: "text".to_string(),
                total_matches: 0,
                capped: false,
                matches: Vec::new(),
            });
        }

        let pattern_str = if is_regex {
            query.to_string()
        } else {
            regex::escape(query)
        };

        let regex_builder = if case_sensitive {
            Regex::new(&pattern_str)
        } else {
            regex::RegexBuilder::new(&pattern_str)
                .case_insensitive(true)
                .build()
        };

        let regex = match regex_builder {
            Ok(r) => r,
            Err(e) => anyhow::bail!("Invalid regex: {}", e),
        };

        let normalized_current = current_file.map(|s| s.trim_start_matches('/').to_string());

        let mut current_file_matches = Vec::new();

        // 1. Scan current_file first if provided
        if let Some(ref curr) = normalized_current {
            let full_curr = self.workspace_root.join(curr);
            if full_curr.exists() && full_curr.is_file() {
                if let Ok(f) = File::open(&full_curr) {
                    let reader = BufReader::new(f);
                    for (line_idx, line_res) in reader.lines().enumerate() {
                        if let Ok(line) = line_res {
                            if regex.is_match(&line) {
                                current_file_matches.push(SearchMatch {
                                    file_path: curr.clone(),
                                    line_number: line_idx + 1,
                                    line_content: line,
                                });
                            }
                        }
                    }
                }
            }
        }

        // 2. Candidate files via Trigram Index
        let candidates = if is_regex {
            self.find_regex_candidates(query)
        } else {
            self.find_candidates(query)
        };

        let workspace_matches: Vec<SearchMatch> = candidates
            .par_iter()
            .filter_map(|&file_id| {
                if let Some(rel_path) = self.files.get(file_id as usize) {
                    let rel_str = rel_path.to_string_lossy().to_string();
                    if let Some(ref curr) = normalized_current {
                        if &rel_str == curr || rel_str.ends_with(curr) {
                            return None; // Already scanned as current_file
                        }
                    }

                    let full_path = self.workspace_root.join(rel_path);
                    let mut file_matches = Vec::new();

                    if let Ok(f) = File::open(&full_path) {
                        let reader = BufReader::new(f);
                        for (line_idx, line_res) in reader.lines().enumerate() {
                            if let Ok(line) = line_res {
                                if regex.is_match(&line) {
                                    file_matches.push(SearchMatch {
                                        file_path: rel_str.clone(),
                                        line_number: line_idx + 1,
                                        line_content: line,
                                    });
                                }
                            }
                        }
                    }
                    Some(file_matches)
                } else {
                    None
                }
            })
            .flatten()
            .collect();

        let mut combined = current_file_matches;
        let ws_needed = max_results.saturating_sub(combined.len());
        combined.extend(workspace_matches.into_iter().take(ws_needed));

        let capped = combined.len() >= max_results;

        Ok(SearchResult {
            query: query.to_string(),
            mode: "text".to_string(),
            total_matches: combined.len(),
            capped,
            matches: combined,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_extract_trigrams_basic() {
        let tri = extract_trigrams("hello");
        assert_eq!(tri.len(), 3); // "hel", "ell", "llo"
        assert!(tri.contains(b"hel"));
        assert!(tri.contains(b"ell"));
        assert!(tri.contains(b"llo"));
    }

    #[test]
    fn test_extract_trigrams_short() {
        let tri = extract_trigrams("hi");
        assert!(tri.is_empty());
    }

    #[test]
    fn test_in_memory_indexing_and_search() {
        let tmp_dir = std::env::temp_dir().join(format!("cyclode_test_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&tmp_dir).unwrap();

        let file1 = tmp_dir.join("main.py");
        fs::write(&file1, "def hello_world():\n    print('hello world')\n").unwrap();

        let file2 = tmp_dir.join("helper.py");
        fs::write(&file2, "def helper_fn():\n    return 'no match here'\n").unwrap();

        let mut index = TrigramIndex::new(tmp_dir.clone());
        let count = index.build().unwrap();
        assert_eq!(count, 2);

        let res = index.search("hello_world", false, false, 10, None).unwrap();
        assert_eq!(res.matches.len(), 1);
        assert_eq!(res.matches[0].file_path, "main.py");
        assert_eq!(res.matches[0].line_number, 1);

        // Regex search
        let res_regex = index.search("print.*hello", true, false, 10, None).unwrap();
        assert_eq!(res_regex.matches.len(), 1);
        assert_eq!(res_regex.matches[0].line_number, 2);

        // Clean up
        let _ = fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn test_current_file_prioritization() {
        let tmp_dir = std::env::temp_dir().join(format!("cyclode_test_prio_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&tmp_dir).unwrap();

        let file1 = tmp_dir.join("alpha.py");
        fs::write(&file1, "def target():\n    pass\n").unwrap();

        let file2 = tmp_dir.join("current.py");
        fs::write(&file2, "def target():\n    pass\n").unwrap();

        let mut index = TrigramIndex::new(tmp_dir.clone());
        index.build().unwrap();

        let res = index.search("target", false, false, 10, Some("current.py")).unwrap();
        assert_eq!(res.matches.len(), 2);
        // Current file must be first
        assert_eq!(res.matches[0].file_path, "current.py");

        let _ = fs::remove_dir_all(&tmp_dir);
    }
}
