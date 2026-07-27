use serde_json::{json, Value};
use std::{
    env,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::Mutex,
};

#[derive(Clone, Default)]
pub struct CoachState {
    inner: Arc<Mutex<CoachInner>>,
}

#[derive(Default)]
struct CoachInner {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    thread_id: Option<String>,
    pending_thread_start_id: Option<u64>,
    next_id: u64,
}

const COACH_INSTRUCTIONS: &str = concat!(
    "You are Sol, the calm and insightful ChessCave chess coach. ",
    "Discuss chess only. The application supplies the exact position and game context on every turn. ",
    "For questions about an overall game, core mistakes, turning points, accuracy, or recurring patterns, ",
    "call the ChessCave MCP get_game_review tool with the supplied review key before answering. ",
    "Use its stored whole-game review instead of recalculating every position. ",
    "For concrete claims about an individual move or live variation, call analyze_position or compare_moves. ",
    "If the student says 'my game' but their side is not identified, ask whether they played White or Black. ",
    "Treat Stockfish output as evidence, not prose: ",
    "translate variations into clear plans, tactical motifs, and human-readable explanations. ",
    "Never run shell commands, inspect files, modify data, or use unrelated tools. ",
    "Be concise but educational, and mention uncertainty when search depth is limited."
);

fn project_root() -> PathBuf {
    if let Ok(root) = env::var("CHESSCAVE_PROJECT_ROOT") {
        return PathBuf::from(root);
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn locate_mcp_script(app: &AppHandle) -> Result<PathBuf, String> {
    let development = project_root().join("scripts/chesscave-mcp.mjs");
    if development.exists() {
        return Ok(development);
    }

    if let Ok(resources) = app.path().resource_dir() {
        let bundled = resources.join("scripts/chesscave-mcp.mjs");
        if bundled.exists() {
            return Ok(bundled);
        }
    }

    Err("Could not locate the bundled ChessCave MCP server.".to_string())
}

fn toml_string(value: &str) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| error.to_string())
}

fn coach_workspace(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|directory| directory.join("coach-workspace"))
        .map_err(|error| format!("Could not resolve app data directory: {error}"))
}

fn game_review_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|directory| {
            directory
                .join("reviews")
                .join(format!("v{}", crate::engine::REVIEW_SCHEMA_VERSION))
        })
        .map_err(|error| format!("Could not resolve app data directory: {error}"))
}

fn thread_start_request(id: u64, workspace: &Path) -> Value {
    json!({
        "method": "thread/start",
        "id": id,
        "params": {
            "cwd": workspace,
            "approvalPolicy": "never",
            "sandbox": "read-only",
            "personality": "friendly",
            "ephemeral": true,
            "serviceName": "chesscave",
            "developerInstructions": COACH_INSTRUCTIONS
        }
    })
}

async fn write_message(stdin: &mut ChildStdin, message: &Value) -> Result<(), String> {
    stdin
        .write_all(format!("{}\n", message).as_bytes())
        .await
        .map_err(|error| format!("Could not write to Codex app-server: {error}"))?;
    stdin
        .flush()
        .await
        .map_err(|error| format!("Could not flush Codex app-server input: {error}"))
}

async fn emit_reader_events(
    app: AppHandle,
    state: CoachState,
    stdout: tokio::process::ChildStdout,
) {
    let mut lines = BufReader::new(stdout).lines();

    loop {
        match lines.next_line().await {
            Ok(Some(line)) => match serde_json::from_str::<Value>(&line) {
                Ok(message) => {
                    if let Some(response_id) = message.get("id").and_then(Value::as_u64) {
                        let mut inner = state.inner.lock().await;
                        if inner.pending_thread_start_id == Some(response_id) {
                            inner.pending_thread_start_id = None;
                            if let Some(thread_id) = message
                                .pointer("/result/thread/id")
                                .and_then(Value::as_str)
                                .map(str::to_string)
                            {
                                inner.thread_id = Some(thread_id);
                                drop(inner);
                                let _ = app.emit(
                                    "chesscave://coach-event",
                                    json!({
                                        "method": "chesscave/ready",
                                        "params": {}
                                    }),
                                );
                            } else {
                                drop(inner);
                            }
                        }
                    }

                    let _ = app.emit("chesscave://coach-event", message);
                }
                Err(error) => {
                    let _ = app.emit(
                        "chesscave://coach-event",
                        json!({
                            "method": "chesscave/log",
                            "params": {
                                "message": format!("Ignored malformed app-server output: {error}"),
                                "line": line
                            }
                        }),
                    );
                }
            },
            Ok(None) => break,
            Err(error) => {
                let _ = app.emit(
                    "chesscave://coach-event",
                    json!({
                        "method": "chesscave/error",
                        "params": {
                            "message": format!("Lost the Codex app-server stream: {error}")
                        }
                    }),
                );
                break;
            }
        }
    }

    let mut inner = state.inner.lock().await;
    inner.child = None;
    inner.stdin = None;
    inner.thread_id = None;
    inner.pending_thread_start_id = None;
    let _ = app.emit(
        "chesscave://coach-event",
        json!({
            "method": "chesscave/error",
            "params": {
                "message": "Codex app-server stopped."
            }
        }),
    );
}

async fn emit_stderr_events(app: AppHandle, stderr: tokio::process::ChildStderr) {
    let mut lines = BufReader::new(stderr).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let _ = app.emit(
            "chesscave://coach-event",
            json!({
                "method": "chesscave/log",
                "params": { "message": line }
            }),
        );
    }
}

#[tauri::command]
pub async fn coach_start(app: AppHandle, state: State<'_, CoachState>) -> Result<(), String> {
    let mut inner = state.inner.lock().await;
    if inner.child.is_some() {
        return Ok(());
    }

    let mcp_script = locate_mcp_script(&app)?;
    let root = project_root();
    let workspace = coach_workspace(&app)?;
    let review_directory = game_review_directory(&app)?;
    std::fs::create_dir_all(&workspace)
        .map_err(|error| format!("Could not create the coach workspace: {error}"))?;

    let codex_path = env::var("CHESSCAVE_CODEX_PATH").unwrap_or_else(|_| "codex".to_string());
    let node_path = env::var("CHESSCAVE_NODE_PATH").unwrap_or_else(|_| "node".to_string());
    let args_value = serde_json::to_string(&vec![
        mcp_script.to_string_lossy().to_string(),
        "--review-dir".to_string(),
        review_directory.to_string_lossy().to_string(),
    ])
    .map_err(|error| error.to_string())?;

    let mut child = Command::new(&codex_path)
        .arg("app-server")
        .arg("--listen")
        .arg("stdio://")
        .arg("--disable")
        .arg("shell_tool")
        .arg("-c")
        .arg(format!(
            "mcp_servers.chesscave.command={}",
            toml_string(&node_path)?
        ))
        .arg("-c")
        .arg(format!("mcp_servers.chesscave.args={args_value}"))
        .arg("-c")
        .arg(format!(
            "mcp_servers.chesscave.cwd={}",
            toml_string(&root.to_string_lossy())?
        ))
        .arg("-c")
        .arg("mcp_servers.chesscave.required=true")
        .arg("-c")
        .arg("mcp_servers.chesscave.startup_timeout_sec=10")
        .arg("-c")
        .arg("mcp_servers.chesscave.tool_timeout_sec=45")
        .arg("-c")
        .arg("mcp_servers.chesscave.default_tools_approval_mode=\"approve\"")
        .current_dir(&workspace)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("Could not start Codex at `{codex_path}`: {error}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Codex app-server stdin was unavailable.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Codex app-server stdout was unavailable.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Codex app-server stderr was unavailable.".to_string())?;

    write_message(
        &mut stdin,
        &json!({
            "method": "initialize",
            "id": 0,
            "params": {
                "clientInfo": {
                    "name": "chesscave",
                    "title": "ChessCave",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }
        }),
    )
    .await?;
    write_message(
        &mut stdin,
        &json!({
            "method": "initialized",
            "params": {}
        }),
    )
    .await?;
    write_message(&mut stdin, &thread_start_request(1, &workspace)).await?;

    inner.child = Some(child);
    inner.stdin = Some(stdin);
    inner.thread_id = None;
    inner.pending_thread_start_id = Some(1);
    inner.next_id = 2;
    drop(inner);

    tauri::async_runtime::spawn(emit_reader_events(
        app.clone(),
        state.inner().clone(),
        stdout,
    ));
    tauri::async_runtime::spawn(emit_stderr_events(app, stderr));

    Ok(())
}

#[tauri::command]
pub async fn coach_new_thread(app: AppHandle, state: State<'_, CoachState>) -> Result<(), String> {
    let workspace = coach_workspace(&app)?;
    let mut inner = state.inner.lock().await;

    if inner.pending_thread_start_id.is_some() {
        return Err("Codex is still starting. Please try again in a moment.".to_string());
    }

    if inner.thread_id.is_none() {
        return Err("Codex is not ready to start a new conversation.".to_string());
    }

    let id = inner.next_id;
    inner.next_id += 1;
    inner.pending_thread_start_id = Some(id);

    let result = match inner.stdin.as_mut() {
        Some(stdin) => write_message(stdin, &thread_start_request(id, &workspace)).await,
        None => Err("Codex app-server is not running.".to_string()),
    };

    if let Err(error) = result {
        inner.pending_thread_start_id = None;
        return Err(error);
    }

    Ok(())
}

#[tauri::command]
pub async fn coach_send(
    state: State<'_, CoachState>,
    message: String,
    context: String,
) -> Result<(), String> {
    if message.trim().is_empty() {
        return Err("The coach message cannot be empty.".to_string());
    }

    let mut inner = state.inner.lock().await;
    if inner.pending_thread_start_id.is_some() {
        return Err("Codex is still starting. Please try again in a moment.".to_string());
    }
    let thread_id = inner
        .thread_id
        .clone()
        .ok_or_else(|| "Codex is still starting. Please try again in a moment.".to_string())?;
    let id = inner.next_id;
    inner.next_id += 1;
    let stdin = inner
        .stdin
        .as_mut()
        .ok_or_else(|| "Codex app-server is not running.".to_string())?;

    let prompt = format!(
        "{message}\n\n<chesscave_position_context>\n{context}\n</chesscave_position_context>\n\
         Use the ChessCave MCP tools when analysis is needed. Explain the chess idea, not just the engine number."
    );

    write_message(
        stdin,
        &json!({
            "method": "turn/start",
            "id": id,
            "params": {
                "threadId": thread_id,
                "input": [{ "type": "text", "text": prompt }]
            }
        }),
    )
    .await
}

#[tauri::command]
pub async fn coach_stop(state: State<'_, CoachState>) -> Result<(), String> {
    let (mut child, mut stdin) = {
        let mut inner = state.inner.lock().await;
        inner.thread_id = None;
        inner.pending_thread_start_id = None;
        (inner.child.take(), inner.stdin.take())
    };

    if let Some(ref mut input) = stdin {
        let _ = write_message(
            input,
            &json!({
                "method": "shutdown",
                "id": 9_999,
                "params": {}
            }),
        )
        .await;
    }
    drop(stdin);

    if let Some(ref mut process) = child {
        process
            .kill()
            .await
            .map_err(|error| format!("Could not stop Codex app-server: {error}"))?;
    }

    Ok(())
}
