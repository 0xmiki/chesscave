use serde::Serialize;
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
    time::{sleep, Duration},
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
    generation: u64,
    last_error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoachConnectionSnapshot {
    status: String,
    detail: String,
}

const COACH_STARTUP_TIMEOUT_SECONDS: u64 = 16;

fn coach_snapshot(inner: &CoachInner) -> CoachConnectionSnapshot {
    if inner.thread_id.is_some() {
        return CoachConnectionSnapshot {
            status: "ready".to_string(),
            detail: "Coach ready".to_string(),
        };
    }
    if let Some(error) = &inner.last_error {
        return CoachConnectionSnapshot {
            status: "error".to_string(),
            detail: error.clone(),
        };
    }
    if inner.child.is_some() {
        return CoachConnectionSnapshot {
            status: "starting".to_string(),
            detail: "Starting Codex app-server…".to_string(),
        };
    }
    CoachConnectionSnapshot {
        status: "offline".to_string(),
        detail: "Codex app-server is not running.".to_string(),
    }
}

const COACH_INSTRUCTIONS: &str = concat!(
    "You are Sol, the calm and insightful ChessCave chess coach. ",
    "Discuss chess only. The application supplies the exact position and game context on every turn. ",
    "For questions about an overall game, core mistakes, turning points, accuracy, or recurring patterns, ",
    "call the ChessCave MCP get_game_review tool with the supplied review key before answering. ",
    "Use its stored whole-game review instead of recalculating every position. ",
    "When seeing the board would improve spatial reasoning, call get_position_image with the review key ",
    "and either an exact ply or a player's displayed clock. It returns the requested board as a PNG image. ",
    "For concrete claims about an individual move or live variation, call analyze_position or compare_moves. ",
    "Exception: when the supplied context says 'Mode: live game against Codex', answer directly from the supplied ",
    "Stockfish evidence or opening-book context without calling a tool. The live interaction is latency-sensitive. ",
    "If the student says 'my game' but their side is not identified, ask whether they played White or Black. ",
    "For patch-card generation, the supplied student side is authoritative. Never create a drill for the opponent's move or perspective. ",
    "Treat Stockfish output as evidence, not prose: ",
    "translate variations into clear plans, tactical motifs, and human-readable explanations. ",
    "Never run shell commands, inspect files, modify data, or use unrelated tools. ",
    "Be concise but educational, and mention uncertainty when search depth is limited."
);

fn study_coach_model() -> String {
    env::var("CHESSCAVE_STUDY_COACH_MODEL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "gpt-5.6-sol".to_string())
}

fn live_coach_model() -> String {
    env::var("CHESSCAVE_LIVE_COACH_MODEL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "gpt-5.6-luna".to_string())
}

fn deliberate_coach_model() -> String {
    env::var("CHESSCAVE_DELIBERATE_COACH_MODEL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "gpt-5.6-sol".to_string())
}

fn live_coach_service_tier() -> Option<String> {
    env::var("CHESSCAVE_LIVE_COACH_SERVICE_TIER")
        .ok()
        .filter(|value| !value.trim().is_empty())
}

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

fn locate_piece_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let development = project_root().join("static/pieces/neo");
    if development.is_dir() {
        return Ok(development);
    }

    if let Ok(resources) = app.path().resource_dir() {
        let bundled = resources.join("pieces/neo");
        if bundled.is_dir() {
            return Ok(bundled);
        }
    }

    Err("Could not locate the bundled ChessCave piece artwork.".to_string())
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
            "model": study_coach_model(),
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
    generation: u64,
    stdout: tokio::process::ChildStdout,
) {
    let mut lines = BufReader::new(stdout).lines();

    loop {
        match lines.next_line().await {
            Ok(Some(line)) => match serde_json::from_str::<Value>(&line) {
                Ok(message) => {
                    let current = {
                        let inner = state.inner.lock().await;
                        inner.generation == generation
                    };
                    if !current {
                        continue;
                    }

                    if let Some(response_id) = message.get("id").and_then(Value::as_u64) {
                        let mut inner = state.inner.lock().await;
                        if inner.generation == generation
                            && inner.pending_thread_start_id == Some(response_id)
                        {
                            inner.pending_thread_start_id = None;
                            if let Some(thread_id) = message
                                .pointer("/result/thread/id")
                                .and_then(Value::as_str)
                                .map(str::to_string)
                            {
                                inner.thread_id = Some(thread_id);
                                inner.last_error = None;
                                drop(inner);
                                let _ = app.emit(
                                    "chesscave://coach-event",
                                    json!({
                                        "method": "chesscave/ready",
                                        "params": {}
                                    }),
                                );
                            } else {
                                let detail = message
                                    .get("error")
                                    .and_then(|error| error.get("message"))
                                    .and_then(Value::as_str)
                                    .unwrap_or("Codex could not create a coaching thread.")
                                    .to_string();
                                inner.last_error = Some(detail.clone());
                                drop(inner);
                                let _ = app.emit(
                                    "chesscave://coach-event",
                                    json!({
                                        "method": "chesscave/error",
                                        "params": { "message": detail, "retryable": true }
                                    }),
                                );
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
                let current = {
                    let inner = state.inner.lock().await;
                    inner.generation == generation
                };
                if current {
                    let _ = app.emit(
                        "chesscave://coach-event",
                        json!({
                            "method": "chesscave/error",
                            "params": {
                                "message": format!("Lost the Codex app-server stream: {error}"),
                                "retryable": true
                            }
                        }),
                    );
                }
                break;
            }
        }
    }

    let mut inner = state.inner.lock().await;
    if inner.generation != generation {
        return;
    }
    inner.child = None;
    inner.stdin = None;
    inner.thread_id = None;
    inner.pending_thread_start_id = None;
    inner.last_error = Some("Codex app-server stopped.".to_string());
    drop(inner);
    let _ = app.emit(
        "chesscave://coach-event",
        json!({
            "method": "chesscave/error",
            "params": {
                "message": "Codex app-server stopped.",
                "retryable": true
            }
        }),
    );
}

async fn enforce_thread_start_timeout(
    app: AppHandle,
    state: CoachState,
    generation: u64,
    request_id: u64,
) {
    sleep(Duration::from_secs(COACH_STARTUP_TIMEOUT_SECONDS)).await;
    let (mut child, stdin) = {
        let mut inner = state.inner.lock().await;
        if inner.generation != generation
            || inner.pending_thread_start_id != Some(request_id)
            || inner.thread_id.is_some()
        {
            return;
        }

        let detail =
            format!("Codex did not become ready within {COACH_STARTUP_TIMEOUT_SECONDS} seconds.");
        inner.last_error = Some(detail);
        inner.pending_thread_start_id = None;
        inner.thread_id = None;
        inner.generation += 1;
        (inner.child.take(), inner.stdin.take())
    };

    drop(stdin);
    if let Some(ref mut process) = child {
        let _ = process.kill().await;
    }
    let _ = app.emit(
        "chesscave://coach-event",
        json!({
            "method": "chesscave/error",
            "params": {
                "code": "startup_timeout",
                "message": format!("Codex did not become ready within {COACH_STARTUP_TIMEOUT_SECONDS} seconds."),
                "retryable": true
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
pub async fn coach_status(state: State<'_, CoachState>) -> Result<CoachConnectionSnapshot, String> {
    let inner = state.inner.lock().await;
    Ok(coach_snapshot(&inner))
}

#[tauri::command]
pub async fn coach_start(
    app: AppHandle,
    state: State<'_, CoachState>,
) -> Result<CoachConnectionSnapshot, String> {
    let mut inner = state.inner.lock().await;
    if inner.child.is_some() {
        return Ok(coach_snapshot(&inner));
    }

    inner.last_error = None;
    inner.generation += 1;
    let generation = inner.generation;

    let mcp_script = locate_mcp_script(&app)?;
    let piece_directory = locate_piece_directory(&app)?;
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
        "--piece-dir".to_string(),
        piece_directory.to_string_lossy().to_string(),
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
    let snapshot = coach_snapshot(&inner);
    drop(inner);

    tauri::async_runtime::spawn(emit_reader_events(
        app.clone(),
        state.inner().clone(),
        generation,
        stdout,
    ));
    tauri::async_runtime::spawn(emit_stderr_events(app.clone(), stderr));
    tauri::async_runtime::spawn(enforce_thread_start_timeout(
        app,
        state.inner().clone(),
        generation,
        1,
    ));

    Ok(snapshot)
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
    inner.last_error = None;
    let generation = inner.generation;

    let result = match inner.stdin.as_mut() {
        Some(stdin) => write_message(stdin, &thread_start_request(id, &workspace)).await,
        None => Err("Codex app-server is not running.".to_string()),
    };

    if let Err(error) = result {
        inner.pending_thread_start_id = None;
        inner.last_error = Some(error.clone());
        return Err(error);
    }

    drop(inner);
    tauri::async_runtime::spawn(enforce_thread_start_timeout(
        app,
        state.inner().clone(),
        generation,
        id,
    ));

    Ok(())
}

#[tauri::command]
pub async fn coach_send(
    state: State<'_, CoachState>,
    message: String,
    context: String,
    profile: Option<String>,
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

    let live = profile.as_deref() == Some("live");
    let deliberate = profile.as_deref() == Some("deliberate");
    let model = if live {
        live_coach_model()
    } else if deliberate {
        deliberate_coach_model()
    } else {
        study_coach_model()
    };
    let effort = if live {
        "low"
    } else if deliberate {
        "high"
    } else {
        "medium"
    };

    write_message(
        stdin,
        &json!({
            "method": "turn/start",
            "id": id,
            "params": {
                "threadId": thread_id,
                "model": model,
                "effort": effort,
                "serviceTier": if live { live_coach_service_tier() } else { None },
                "input": [{ "type": "text", "text": prompt }]
            }
        }),
    )
    .await
}

#[tauri::command]
pub async fn coach_interrupt(state: State<'_, CoachState>, turn_id: String) -> Result<(), String> {
    if turn_id.trim().is_empty() {
        return Ok(());
    }

    let mut inner = state.inner.lock().await;
    let thread_id = inner
        .thread_id
        .clone()
        .ok_or_else(|| "Codex is not ready to interrupt a turn.".to_string())?;
    let id = inner.next_id;
    inner.next_id += 1;
    let stdin = inner
        .stdin
        .as_mut()
        .ok_or_else(|| "Codex app-server is not running.".to_string())?;

    write_message(
        stdin,
        &json!({
            "method": "turn/interrupt",
            "id": id,
            "params": {
                "threadId": thread_id,
                "turnId": turn_id
            }
        }),
    )
    .await
}

#[tauri::command]
pub async fn coach_stop(state: State<'_, CoachState>) -> Result<(), String> {
    let (mut child, mut stdin) = {
        let mut inner = state.inner.lock().await;
        inner.generation += 1;
        inner.thread_id = None;
        inner.pending_thread_start_id = None;
        inner.last_error = None;
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
