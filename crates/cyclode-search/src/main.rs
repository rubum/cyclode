use clap::{Parser, Subcommand};
use cyclode_search::{search_ast, search_text};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "cyclode-searchd")]
#[command(about = "High-performance trigram indexed search and Tree-sitter code intelligence engine for Cyclode")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Search full-text or regex across the workspace
    Search {
        /// Workspace directory root
        #[arg(short, long, default_value = ".")]
        workspace: PathBuf,

        /// Search query or regex pattern
        #[arg(short, long)]
        query: String,

        /// Match as regular expression
        #[arg(long, default_value_t = false)]
        is_regex: bool,

        /// Case-sensitive matching
        #[arg(long, default_value_t = false)]
        case_sensitive: bool,

        /// Maximum results limit
        #[arg(short, long, default_value_t = 100)]
        max_results: usize,

        /// Relative path of active file to prioritize
        #[arg(long)]
        current_file: Option<String>,
    },

    /// Search AST symbols across the workspace
    Ast {
        /// Workspace directory root
        #[arg(short, long, default_value = ".")]
        workspace: PathBuf,

        /// Symbol pattern or query
        #[arg(short, long)]
        pattern: String,

        /// Maximum results limit
        #[arg(short, long, default_value_t = 100)]
        max_results: usize,

        /// Relative path of active file to prioritize
        #[arg(long)]
        current_file: Option<String>,
    },
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Search {
            workspace,
            query,
            is_regex,
            case_sensitive,
            max_results,
            current_file,
        } => {
            let ws_str = workspace.to_string_lossy().to_string();
            let res = search_text(
                &ws_str,
                &query,
                is_regex,
                case_sensitive,
                max_results,
                current_file.as_deref(),
            )?;
            println!("{}", serde_json::to_string(&res)?);
        }
        Commands::Ast {
            workspace,
            pattern,
            max_results,
            current_file,
        } => {
            let ws_str = workspace.to_string_lossy().to_string();
            let res = search_ast(
                &ws_str,
                &pattern,
                max_results,
                current_file.as_deref(),
            )?;
            println!("{}", serde_json::to_string(&res)?);
        }
    }

    Ok(())
}
