pub mod indexer;
pub mod treesitter;

pub use indexer::{TrigramIndex, SearchMatch, SearchResult};
pub use treesitter::{TreeSitterEngine, AstSymbol, AstSearchResult, AstSymbolMatch};

use std::path::PathBuf;

/// High-level unified search function for full-text regex.
pub fn search_text(
    workspace_root: &str,
    query: &str,
    is_regex: bool,
    case_sensitive: bool,
    max_results: usize,
    current_file: Option<&str>,
) -> anyhow::Result<SearchResult> {
    let mut index = TrigramIndex::new(PathBuf::from(workspace_root));
    index.build()?;
    index.search(query, is_regex, case_sensitive, max_results, current_file)
}

/// High-level unified AST symbol search function.
pub fn search_ast(
    workspace_root: &str,
    pattern: &str,
    max_results: usize,
    current_file: Option<&str>,
) -> anyhow::Result<AstSearchResult> {
    let engine = TreeSitterEngine::new(PathBuf::from(workspace_root));
    engine.search_symbols(pattern, max_results, current_file)
}

#[cfg(feature = "python")]
use pyo3::prelude::*;

#[cfg(feature = "python")]
#[pyfunction]
fn py_search_text(
    workspace_root: String,
    query: String,
    is_regex: bool,
    case_sensitive: bool,
    max_results: usize,
    current_file: Option<String>,
) -> PyResult<String> {
    let res = search_text(
        &workspace_root,
        &query,
        is_regex,
        case_sensitive,
        max_results,
        current_file.as_deref(),
    ).map_err(|e| PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(e.to_string()))?;

    serde_json::to_string(&res)
        .map_err(|e| PyErr::new::<pyo3::exceptions::PyValueError, _>(e.to_string()))
}

#[cfg(feature = "python")]
#[pyfunction]
fn py_search_ast(
    workspace_root: String,
    pattern: String,
    max_results: usize,
    current_file: Option<String>,
) -> PyResult<String> {
    let res = search_ast(
        &workspace_root,
        &pattern,
        max_results,
        current_file.as_deref(),
    ).map_err(|e| PyErr::new::<pyo3::exceptions::PyRuntimeError, _>(e.to_string()))?;

    serde_json::to_string(&res)
        .map_err(|e| PyErr::new::<pyo3::exceptions::PyValueError, _>(e.to_string()))
}

#[cfg(feature = "python")]
#[pymodule]
fn cyclode_search(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(py_search_text, m)?)?;
    m.add_function(wrap_pyfunction!(py_search_ast, m)?)?;
    Ok(())
}
