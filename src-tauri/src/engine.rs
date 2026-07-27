use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    env,
    path::PathBuf,
    process::Stdio,
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};
use tokio::{
    fs,
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    time::{timeout, Duration},
};

pub(crate) const REVIEW_SCHEMA_VERSION: u8 = 1;
const DEFAULT_REVIEW_NODES: u64 = 60_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub available: bool,
    pub name: Option<String>,
    pub path: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineLine {
    pub multipv: u8,
    pub depth: u16,
    pub score_cp: Option<i32>,
    pub score_mate: Option<i32>,
    /// Win/draw/loss permille normalized to White's perspective.
    pub wdl: Option<[u16; 3]>,
    pub moves: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisResult {
    pub engine: String,
    pub fen: String,
    pub best_move: Option<String>,
    pub elapsed_ms: u128,
    pub lines: Vec<EngineLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewPositionInput {
    pub ply: u16,
    pub fen: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewMoveInput {
    pub ply: u16,
    pub san: String,
    pub uci: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionReview {
    pub ply: u16,
    pub fen: String,
    pub best_move: Option<String>,
    pub elapsed_ms: u128,
    pub lines: Vec<EngineLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveReview {
    pub ply: u16,
    pub san: String,
    pub uci: String,
    pub color: String,
    pub classification: String,
    pub expected_points_before: f64,
    pub expected_points_after: f64,
    pub expected_points_lost: f64,
    pub estimated_accuracy: f64,
    pub best_move: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSummary {
    pub white_accuracy: f64,
    pub black_accuracy: f64,
    pub classifications: BTreeMap<String, u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameReview {
    pub schema_version: u8,
    pub game_key: String,
    pub engine: String,
    pub nodes_per_position: u64,
    pub multi_pv: u8,
    pub created_at_ms: u128,
    pub cached: bool,
    pub model: String,
    pub positions: Vec<PositionReview>,
    pub moves: Vec<MoveReview>,
    pub summary: ReviewSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewProgress {
    game_key: String,
    completed: usize,
    total: usize,
    ply: u16,
}

struct UciProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

fn engine_command() -> String {
    env::var("CHESSCAVE_STOCKFISH_PATH")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "stockfish".to_string())
}

async fn spawn_engine() -> Result<UciProcess, String> {
    let path = engine_command();
    let mut child = Command::new(&path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| {
            format!(
                "Could not start Stockfish at `{path}`: {error}. Set CHESSCAVE_STOCKFISH_PATH if Stockfish is installed elsewhere."
            )
        })?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Stockfish stdin was unavailable.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Stockfish stdout was unavailable.".to_string())?;

    Ok(UciProcess {
        child,
        stdin,
        stdout: BufReader::new(stdout),
    })
}

async fn send(process: &mut UciProcess, command: &str) -> Result<(), String> {
    process
        .stdin
        .write_all(format!("{command}\n").as_bytes())
        .await
        .map_err(|error| format!("Failed to write to Stockfish: {error}"))?;
    process
        .stdin
        .flush()
        .await
        .map_err(|error| format!("Failed to flush Stockfish input: {error}"))
}

async fn initialize(process: &mut UciProcess) -> Result<String, String> {
    send(process, "uci").await?;
    let mut name = "Stockfish".to_string();
    let mut line = String::new();

    loop {
        line.clear();
        let bytes = process
            .stdout
            .read_line(&mut line)
            .await
            .map_err(|error| format!("Failed to read Stockfish output: {error}"))?;
        if bytes == 0 {
            return Err("Stockfish exited before completing UCI initialization.".to_string());
        }
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix("id name ") {
            name = value.to_string();
        }
        if trimmed == "uciok" {
            break;
        }
    }

    send(process, "isready").await?;
    loop {
        line.clear();
        let bytes = process
            .stdout
            .read_line(&mut line)
            .await
            .map_err(|error| format!("Failed to read Stockfish readiness: {error}"))?;
        if bytes == 0 {
            return Err("Stockfish exited before becoming ready.".to_string());
        }
        if line.trim() == "readyok" {
            break;
        }
    }

    Ok(name)
}

fn parse_info(line: &str, white_to_move: bool) -> Option<EngineLine> {
    if !line.starts_with("info ") || !line.contains(" score ") || !line.contains(" pv ") {
        return None;
    }

    let tokens: Vec<&str> = line.split_whitespace().collect();
    let mut depth = 0_u16;
    let mut multipv = 1_u8;
    let mut score_cp = None;
    let mut score_mate = None;
    let mut wdl = None;
    let mut moves = Vec::new();
    let perspective = if white_to_move { 1 } else { -1 };
    let mut index = 0;

    while index < tokens.len() {
        match tokens[index] {
            "depth" if index + 1 < tokens.len() => {
                depth = tokens[index + 1].parse().unwrap_or(0);
                index += 2;
            }
            "multipv" if index + 1 < tokens.len() => {
                multipv = tokens[index + 1].parse().unwrap_or(1);
                index += 2;
            }
            "score" if index + 2 < tokens.len() => {
                match tokens[index + 1] {
                    "cp" => {
                        score_cp = tokens[index + 2]
                            .parse::<i32>()
                            .ok()
                            .map(|score| score * perspective)
                    }
                    "mate" => {
                        score_mate = tokens[index + 2]
                            .parse::<i32>()
                            .ok()
                            .map(|score| score * perspective)
                    }
                    _ => {}
                }
                index += 3;
            }
            "wdl" if index + 3 < tokens.len() => {
                let wins = tokens[index + 1].parse::<u16>().ok();
                let draws = tokens[index + 2].parse::<u16>().ok();
                let losses = tokens[index + 3].parse::<u16>().ok();
                if let (Some(wins), Some(draws), Some(losses)) = (wins, draws, losses) {
                    wdl = Some(if white_to_move {
                        [wins, draws, losses]
                    } else {
                        [losses, draws, wins]
                    });
                }
                index += 4;
            }
            "pv" => {
                moves = tokens[index + 1..]
                    .iter()
                    .map(|value| (*value).to_string())
                    .collect();
                break;
            }
            _ => index += 1,
        }
    }

    if moves.is_empty() {
        return None;
    }

    Some(EngineLine {
        multipv,
        depth,
        score_cp,
        score_mate,
        wdl,
        moves,
    })
}

async fn probe() -> Result<(String, String), String> {
    let mut process = spawn_engine().await?;
    let name = initialize(&mut process).await?;
    let _ = send(&mut process, "quit").await;
    let _ = process.child.wait().await;
    Ok((name, engine_command()))
}

#[tauri::command]
pub async fn engine_status() -> EngineStatus {
    match timeout(Duration::from_secs(4), probe()).await {
        Ok(Ok((name, path))) => EngineStatus {
            available: true,
            name: Some(name),
            path: Some(path),
            message: "Stockfish is ready.".to_string(),
        },
        Ok(Err(message)) => EngineStatus {
            available: false,
            name: None,
            path: Some(engine_command()),
            message,
        },
        Err(_) => EngineStatus {
            available: false,
            name: None,
            path: Some(engine_command()),
            message: "Stockfish did not respond within four seconds.".to_string(),
        },
    }
}

async fn configure(process: &mut UciProcess, multi_pv: u8) -> Result<(), String> {
    send(process, "setoption name Threads value 2").await?;
    send(process, "setoption name Hash value 128").await?;
    send(process, "setoption name UCI_ShowWDL value true").await?;
    send(process, &format!("setoption name MultiPV value {multi_pv}")).await?;
    send(process, "isready").await?;

    let mut line = String::new();
    loop {
        line.clear();
        let bytes = process
            .stdout
            .read_line(&mut line)
            .await
            .map_err(|error| format!("Failed while waiting for Stockfish options: {error}"))?;
        if bytes == 0 {
            return Err("Stockfish exited while applying analysis options.".to_string());
        }
        if line.trim() == "readyok" {
            break;
        }
    }

    Ok(())
}

async fn analyze_with_process(
    process: &mut UciProcess,
    ply: u16,
    fen: String,
    limit: &str,
) -> Result<PositionReview, String> {
    if fen.split_whitespace().count() < 4 {
        return Err(format!("The FEN at ply {ply} is incomplete."));
    }

    let started = Instant::now();
    send(process, &format!("position fen {fen}")).await?;
    send(process, &format!("go {limit}")).await?;

    let white_to_move = fen.split_whitespace().nth(1) != Some("b");
    let mut latest = BTreeMap::<u8, EngineLine>::new();
    let mut best_move = None;
    let mut line = String::new();

    loop {
        line.clear();
        let bytes = process
            .stdout
            .read_line(&mut line)
            .await
            .map_err(|error| format!("Failed to read Stockfish analysis: {error}"))?;
        if bytes == 0 {
            return Err("Stockfish exited before returning a best move.".to_string());
        }

        let trimmed = line.trim();
        if let Some(candidate) = parse_info(trimmed, white_to_move) {
            let should_replace = latest
                .get(&candidate.multipv)
                .map(|existing| candidate.depth >= existing.depth)
                .unwrap_or(true);
            if should_replace {
                latest.insert(candidate.multipv, candidate);
            }
        }

        if let Some(rest) = trimmed.strip_prefix("bestmove ") {
            let value = rest.split_whitespace().next().unwrap_or("(none)");
            if value != "(none)" {
                best_move = Some(value.to_string());
            }
            break;
        }
    }

    Ok(PositionReview {
        ply,
        fen,
        best_move,
        elapsed_ms: started.elapsed().as_millis(),
        lines: latest.into_values().collect(),
    })
}

async fn run_analysis(fen: String, depth: u16, multi_pv: u8) -> Result<AnalysisResult, String> {
    let mut process = spawn_engine().await?;
    let name = initialize(&mut process).await?;
    let depth = depth.clamp(8, 30);
    let multi_pv = multi_pv.clamp(1, 5);
    configure(&mut process, multi_pv).await?;
    let position = analyze_with_process(&mut process, 0, fen, &format!("depth {depth}")).await?;
    let _ = send(&mut process, "quit").await;
    let _ = process.child.wait().await;

    Ok(AnalysisResult {
        engine: name,
        fen: position.fen,
        best_move: position.best_move,
        elapsed_ms: position.elapsed_ms,
        lines: position.lines,
    })
}

#[tauri::command]
pub async fn analyze_position(
    fen: String,
    depth: Option<u16>,
    multi_pv: Option<u8>,
) -> Result<AnalysisResult, String> {
    timeout(
        Duration::from_secs(45),
        run_analysis(fen, depth.unwrap_or(16), multi_pv.unwrap_or(3)),
    )
    .await
    .map_err(|_| "Stockfish analysis timed out after 45 seconds.".to_string())?
}

fn game_review_key(
    positions: &[ReviewPositionInput],
    moves: &[ReviewMoveInput],
    nodes: u64,
    multi_pv: u8,
) -> Result<String, String> {
    let mut hasher = Sha256::new();
    hasher.update(format!(
        "chesscave-review-v{REVIEW_SCHEMA_VERSION}|{nodes}|{multi_pv}|{}|",
        engine_command()
    ));
    hasher.update(
        serde_json::to_vec(&(positions, moves))
            .map_err(|error| format!("Could not fingerprint the game: {error}"))?,
    );
    Ok(format!("{:x}", hasher.finalize()))
}

fn review_cache_path(app: &tauri::AppHandle, key: &str) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Could not locate ChessCave's data directory: {error}"))?;
    Ok(root
        .join("reviews")
        .join(format!("v{REVIEW_SCHEMA_VERSION}"))
        .join(format!("{key}.json")))
}

fn expected_points_white(position: &PositionReview) -> f64 {
    let Some(line) = position.lines.first() else {
        return 0.5;
    };

    if let Some([wins, draws, _losses]) = line.wdl {
        return ((f64::from(wins) + f64::from(draws) * 0.5) / 1000.0).clamp(0.0, 1.0);
    }

    if let Some(mate) = line.score_mate {
        return if mate > 0 { 1.0 } else { 0.0 };
    }

    let cp = f64::from(line.score_cp.unwrap_or(0));
    (1.0 / (1.0 + (-cp / 250.0).exp())).clamp(0.0, 1.0)
}

fn line_expected_points_white(line: &EngineLine) -> f64 {
    if let Some([wins, draws, _losses]) = line.wdl {
        return ((f64::from(wins) + f64::from(draws) * 0.5) / 1000.0).clamp(0.0, 1.0);
    }
    if let Some(mate) = line.score_mate {
        return if mate > 0 { 1.0 } else { 0.0 };
    }
    let cp = f64::from(line.score_cp.unwrap_or(0));
    (1.0 / (1.0 + (-cp / 250.0).exp())).clamp(0.0, 1.0)
}

fn mover_points(white_points: f64, color: &str) -> f64 {
    if color == "b" {
        1.0 - white_points
    } else {
        white_points
    }
}

fn round(value: f64, places: i32) -> f64 {
    let factor = 10_f64.powi(places);
    (value * factor).round() / factor
}

fn classify_move(
    input: &ReviewMoveInput,
    before: &PositionReview,
    expected_before: f64,
    lost: f64,
) -> String {
    if before.best_move.as_deref() == Some(input.uci.as_str()) {
        if let Some(second_line) = before.lines.get(1) {
            let second = mover_points(line_expected_points_white(second_line), &input.color);
            let only_move_gap = expected_before - second;
            if only_move_gap >= 0.10 && expected_before < 0.90 {
                return "great".to_string();
            }
        }
        return "best".to_string();
    }

    // These are Chess.com's published Classification V2 expected-points
    // boundaries. Brilliant, Book, Miss, and sacrifice detection require
    // additional chess-specific rules and are deliberately not guessed here.
    if lost <= 0.02 {
        "excellent"
    } else if lost <= 0.05 {
        "good"
    } else if lost <= 0.10 {
        "inaccuracy"
    } else if lost <= 0.20 {
        "mistake"
    } else {
        "blunder"
    }
    .to_string()
}

fn build_move_reviews(positions: &[PositionReview], inputs: &[ReviewMoveInput]) -> Vec<MoveReview> {
    inputs
        .iter()
        .filter_map(|input| {
            let before = positions.get(input.ply.saturating_sub(1) as usize)?;
            let after = positions.get(input.ply as usize)?;
            let expected_before = mover_points(expected_points_white(before), input.color.as_str());
            let expected_after = mover_points(expected_points_white(after), input.color.as_str());
            let lost = (expected_before - expected_after).max(0.0);
            let classification = classify_move(input, before, expected_before, lost);
            let estimated_accuracy = (100.0 * (-2.5 * lost).exp()).clamp(0.0, 100.0);

            Some(MoveReview {
                ply: input.ply,
                san: input.san.clone(),
                uci: input.uci.clone(),
                color: input.color.clone(),
                classification,
                expected_points_before: round(expected_before, 4),
                expected_points_after: round(expected_after, 4),
                expected_points_lost: round(lost, 4),
                estimated_accuracy: round(estimated_accuracy, 1),
                best_move: before.best_move.clone(),
            })
        })
        .collect()
}

fn build_summary(moves: &[MoveReview]) -> ReviewSummary {
    let mut white = Vec::new();
    let mut black = Vec::new();
    let mut classifications = BTreeMap::new();

    for item in moves {
        if item.color == "b" {
            black.push(item.estimated_accuracy);
        } else {
            white.push(item.estimated_accuracy);
        }
        *classifications
            .entry(item.classification.clone())
            .or_insert(0) += 1;
    }

    let average = |values: &[f64]| {
        if values.is_empty() {
            0.0
        } else {
            round(values.iter().sum::<f64>() / values.len() as f64, 1)
        }
    };

    ReviewSummary {
        white_accuracy: average(&white),
        black_accuracy: average(&black),
        classifications,
    }
}

async fn read_cached_review(path: &PathBuf) -> Option<GameReview> {
    let bytes = fs::read(path).await.ok()?;
    let mut review = serde_json::from_slice::<GameReview>(&bytes).ok()?;
    if review.schema_version != REVIEW_SCHEMA_VERSION {
        return None;
    }
    review.cached = true;
    Some(review)
}

async fn persist_review(path: &PathBuf, review: &GameReview) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "The review cache path had no parent directory.".to_string())?;
    fs::create_dir_all(parent)
        .await
        .map_err(|error| format!("Could not create the review cache: {error}"))?;
    let bytes = serde_json::to_vec(review)
        .map_err(|error| format!("Could not serialize the game review: {error}"))?;
    fs::write(path, bytes)
        .await
        .map_err(|error| format!("Could not save the game review: {error}"))
}

#[tauri::command]
pub async fn review_game(
    app: tauri::AppHandle,
    positions: Vec<ReviewPositionInput>,
    moves: Vec<ReviewMoveInput>,
    nodes: Option<u64>,
    multi_pv: Option<u8>,
    force: Option<bool>,
) -> Result<GameReview, String> {
    if positions.is_empty() {
        return Err("A game review needs at least one position.".to_string());
    }
    if positions.len() != moves.len() + 1 {
        return Err(format!(
            "Review data is inconsistent: {} positions for {} moves.",
            positions.len(),
            moves.len()
        ));
    }

    let nodes = nodes
        .unwrap_or(DEFAULT_REVIEW_NODES)
        .clamp(5_000, 2_000_000);
    let multi_pv = multi_pv.unwrap_or(3).clamp(2, 5);
    let game_key = game_review_key(&positions, &moves, nodes, multi_pv)?;
    let cache_path = review_cache_path(&app, &game_key)?;

    if !force.unwrap_or(false) {
        if let Some(review) = read_cached_review(&cache_path).await {
            let _ = app.emit(
                "chesscave://review-progress",
                ReviewProgress {
                    game_key,
                    completed: positions.len(),
                    total: positions.len(),
                    ply: positions.last().map(|item| item.ply).unwrap_or(0),
                },
            );
            return Ok(review);
        }
    }

    let mut process = spawn_engine().await?;
    let engine = initialize(&mut process).await?;
    configure(&mut process, multi_pv).await?;
    send(&mut process, "ucinewgame").await?;

    let total = positions.len();
    let mut analyzed = Vec::with_capacity(total);
    for (index, input) in positions.into_iter().enumerate() {
        let ply = input.ply;
        let result = timeout(
            Duration::from_secs(90),
            analyze_with_process(
                &mut process,
                input.ply,
                input.fen,
                &format!("nodes {nodes}"),
            ),
        )
        .await
        .map_err(|_| format!("Stockfish timed out while reviewing ply {ply}."))??;
        analyzed.push(result);
        let _ = app.emit(
            "chesscave://review-progress",
            ReviewProgress {
                game_key: game_key.clone(),
                completed: index + 1,
                total,
                ply,
            },
        );
    }

    let _ = send(&mut process, "quit").await;
    let _ = process.child.wait().await;

    let move_reviews = build_move_reviews(&analyzed, &moves);
    let summary = build_summary(&move_reviews);
    let created_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let review = GameReview {
        schema_version: REVIEW_SCHEMA_VERSION,
        game_key,
        engine,
        nodes_per_position: nodes,
        multi_pv,
        created_at_ms,
        cached: false,
        model: "stockfish-wdl + chess.com-expected-points-cutoffs-v2".to_string(),
        positions: analyzed,
        moves: move_reviews,
        summary,
    };

    persist_review(&cache_path, &review).await?;
    Ok(review)
}

#[cfg(test)]
mod tests {
    use super::{build_move_reviews, parse_info, PositionReview, ReviewMoveInput};

    #[test]
    fn parses_white_score_and_principal_variation() {
        let line = parse_info(
            "info depth 18 multipv 2 score cp 37 nodes 1000 pv e2e4 e7e5",
            true,
        )
        .expect("analysis line");

        assert_eq!(line.depth, 18);
        assert_eq!(line.multipv, 2);
        assert_eq!(line.score_cp, Some(37));
        assert_eq!(line.wdl, None);
        assert_eq!(line.moves, vec!["e2e4", "e7e5"]);
    }

    #[test]
    fn normalizes_black_to_move_scores_to_white() {
        let line = parse_info("info depth 14 score cp 81 nodes 1000 pv d7d5 e4d5", false)
            .expect("analysis line");

        assert_eq!(line.score_cp, Some(-81));
    }

    #[test]
    fn normalizes_wdl_to_white() {
        let line = parse_info(
            "info depth 14 score cp 81 wdl 640 300 60 nodes 1000 pv d7d5",
            false,
        )
        .expect("analysis line");

        assert_eq!(line.wdl, Some([60, 300, 640]));
    }

    #[test]
    fn classifies_with_expected_points_loss() {
        let position = |ply, wdl, best_move: &str| PositionReview {
            ply,
            fen: String::new(),
            best_move: Some(best_move.to_string()),
            elapsed_ms: 1,
            lines: vec![super::EngineLine {
                multipv: 1,
                depth: 12,
                score_cp: None,
                score_mate: None,
                wdl: Some(wdl),
                moves: vec![best_move.to_string()],
            }],
        };
        let positions = vec![
            position(0, [500, 400, 100], "e2e4"),
            position(1, [330, 400, 270], "e7e5"),
        ];
        let moves = vec![ReviewMoveInput {
            ply: 1,
            san: "d4".to_string(),
            uci: "d2d4".to_string(),
            color: "w".to_string(),
        }];

        let review = build_move_reviews(&positions, &moves);
        assert_eq!(review[0].classification, "mistake");
        assert_eq!(review[0].expected_points_lost, 0.17);
    }
}
