import os
import sys
import argparse
import json
from pathlib import Path
from typing import Optional

from cyclode import __version__
from cyclode.config import (
    get_cyclode_home,
    ensure_cyclode_home,
    load_user_config,
    save_user_config,
    resolve_database_url,
    resolve_workspace_root,
)
from cyclode.launcher import start_cyclode


def _print_banner():
    banner = f"""\033[1;36m
   ______           __          __    
  / ____/_  _______/ /___  ____/ /__  
 / /   / / / / ___/ / __ \\/ __  / _ \\ 
/ /___/ /_/ / /__/ / /_/ / /_/ /  __/ 
\\____/\\__, /\\___/_/\\____/\\__,_/\\___/  
     /____/  \033[0m\033[1;30mv{__version__} - Autonomous Agent Platform\033[0m
"""
    print(banner)


def cmd_start(args):
    _print_banner()
    home_dirs = ensure_cyclode_home()
    workspace = args.workspace or os.getcwd()
    port = args.port
    host = args.host
    model = args.model
    reload = args.dev
    open_browser = not args.no_browser

    print(f"\033[1;32m●\033[0m Starting Cyclode server...")
    print(f"  • \033[1mWorkspace\033[0m : {workspace}")
    print(f"  • \033[1mDatabase\033[0m  : {home_dirs['data'] / 'cyclode.db'}")
    print(f"  • \033[1mURL\033[0m       : \033[4;34mhttp://{host}:{port}\033[0m")
    if model:
        print(f"  • \033[1mModel\033[0m     : {model}")
    print("")

    start_cyclode(
        host=host,
        port=port,
        workspace=workspace,
        reload=reload,
        open_browser=open_browser,
        model=model,
    )


def cmd_init(args):
    _print_banner()
    print("\033[1mInteractive Cyclode Setup Wizard\033[0m\n")
    ensure_cyclode_home()
    current = load_user_config()

    # 1. Gemini API Key
    existing_gemini = current.get("gemini_api_key") or os.environ.get("GEMINI_API_KEY", "")
    masked_gemini = f"{existing_gemini[:4]}...{existing_gemini[-4:]}" if len(existing_gemini) > 8 else (existing_gemini or "Not Set")
    prompt_gemini = input(f"Enter Gemini API Key [{masked_gemini}]: ").strip()
    gemini_key = prompt_gemini if prompt_gemini else existing_gemini

    # 2. Default Model
    default_model = current.get("model", "gemini-3.7-flash")
    prompt_model = input(f"Default Gemini Model [{default_model}]: ").strip()
    model = prompt_model if prompt_model else default_model

    # 3. Default Port
    default_port = current.get("port", 8080)
    prompt_port = input(f"Default Web Port [{default_port}]: ").strip()
    try:
        port = int(prompt_port) if prompt_port else default_port
    except ValueError:
        port = 8080

    # 4. Linear API Key (optional)
    existing_linear = current.get("linear_api_key") or os.environ.get("LINEAR_API_KEY", "")
    prompt_linear = input(f"Linear API Key (optional) [{existing_linear or 'None'}]: ").strip()
    linear_key = prompt_linear if prompt_linear else existing_linear

    updates = {
        "gemini_api_key": gemini_key,
        "model": model,
        "port": port,
        "linear_api_key": linear_key,
    }
    save_user_config(updates)
    print(f"\n\033[1;32m✔ Configuration saved to {get_cyclode_home() / 'config.json'}\033[0m")
    print(f"Run \033[1mcyclode start\033[0m to launch the platform.")


def cmd_status(args):
    _print_banner()
    dirs = ensure_cyclode_home()
    cfg = load_user_config()
    db_url = resolve_database_url()

    gemini_key = cfg.get("gemini_api_key") or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    linear_key = cfg.get("linear_api_key") or os.environ.get("LINEAR_API_KEY")

    gemini_status = "\033[32mConfigured\033[0m" if gemini_key else "\033[31mNot Set (Run: cyclode init)\033[0m"
    linear_status = "\033[32mConfigured\033[0m" if linear_key else "\033[33mOptional (Not set)\033[0m"

    print("\033[1mCyclode Environment & Status\033[0m")
    print(f"  • Version      : {__version__}")
    print(f"  • Home Dir     : {dirs['home']}")
    print(f"  • Database     : {db_url}")
    print(f"  • Workspaces   : {dirs['workspaces']}")
    print(f"  • Skills       : {dirs['skills']}")
    print(f"  • Gemini Key   : {gemini_status}")
    print(f"  • Linear Key   : {linear_status}")
    print(f"  • Default Model: {cfg.get('model', 'gemini-3.7-flash')}")


def cmd_config(args):
    action = args.action
    key = args.key
    value = args.value
    cfg = load_user_config()

    if action == "list" or not action:
        print(json.dumps(cfg, indent=2))
    elif action == "get":
        if not key:
            print("Error: Key required for 'get'")
            sys.exit(1)
        print(cfg.get(key, ""))
    elif action == "set":
        if not key or value is None:
            print("Error: Key and value required for 'set'")
            sys.exit(1)
        if value.lower() == "true":
            val = True
        elif value.lower() == "false":
            val = False
        elif value.isdigit():
            val = int(value)
        else:
            val = value
        save_user_config({key: val})
        print(f"Updated {key} = {val}")


def main():
    parser = argparse.ArgumentParser(
        prog="cyclode",
        description="Cyclode: Autonomous Agent Platform & Live App Builder",
    )
    parser.add_argument("-v", "--version", action="version", version=f"cyclode {__version__}")

    subparsers = parser.add_subparsers(dest="command", help="Command to execute")

    # cyclode start
    p_start = subparsers.add_parser("start", help="Start Cyclode agent platform and web interface")
    p_start.add_argument("workspace", nargs="?", default=None, help="Directory to use as workspace (defaults to current directory)")
    p_start.add_argument("-p", "--port", type=int, default=8080, help="Port to bind server (default: 8080)")
    p_start.add_argument("-H", "--host", default="127.0.0.1", help="Host interface to bind (default: 127.0.0.1)")
    p_start.add_argument("-m", "--model", default=None, help="Gemini model override (e.g. gemini-3.7-flash)")
    p_start.add_argument("--no-browser", action="store_true", help="Do not automatically open web browser")
    p_start.add_argument("--dev", action="store_true", help="Run with hot-reloading enabled for development")
    p_start.set_defaults(func=cmd_start)

    # cyclode init
    p_init = subparsers.add_parser("init", help="Interactive setup wizard for API keys and configuration")
    p_init.set_defaults(func=cmd_init)

    # cyclode status
    p_status = subparsers.add_parser("status", help="Display environment configuration and health status")
    p_status.set_defaults(func=cmd_status)

    # cyclode config
    p_config = subparsers.add_parser("config", help="View or modify user configuration")
    p_config.add_argument("action", choices=["list", "get", "set"], nargs="?", default="list")
    p_config.add_argument("key", nargs="?", default=None)
    p_config.add_argument("value", nargs="?", default=None)
    p_config.set_defaults(func=cmd_config)

    args = parser.parse_args()
    if not args.command:
        # Default to starting cyclode if no subcommand passed
        cmd_start(argparse.Namespace(
            workspace=None,
            port=8080,
            host="127.0.0.1",
            model=None,
            no_browser=False,
            dev=False
        ))
    else:
        args.func(args)


if __name__ == "__main__":
    main()
