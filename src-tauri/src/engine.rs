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

pub(crate) const REVIEW_SCHEMA_VERSION: u8 = 5;
const DEFAULT_REVIEW_NODES: u64 = 60_000;
const SHALLOW_REVIEW_DEPTH: u16 = 10;
const SACRIFICE_PV_PLIES: usize = 4;

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
pub struct ReviewClocks {
    pub w: Option<f64>,
    pub b: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewLastMove {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewPositionInput {
    pub ply: u16,
    pub fen: String,
    pub clocks: ReviewClocks,
    pub last_move: Option<ReviewLastMove>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewMoveInput {
    pub ply: u16,
    pub san: String,
    pub uci: String,
    pub color: String,
    pub rating: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionReview {
    pub ply: u16,
    pub fen: String,
    pub clocks: ReviewClocks,
    pub last_move: Option<ReviewLastMove>,
    pub best_move: Option<String>,
    pub elapsed_ms: u128,
    pub lines: Vec<EngineLine>,
    #[serde(skip)]
    pub shallow_lines: Vec<EngineLine>,
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
    pub white_classifications: BTreeMap<String, u16>,
    pub black_classifications: BTreeMap<String, u16>,
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
    if !line.starts_with("info ") || !line.contains(" score ") {
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

    if score_cp.is_none() && score_mate.is_none() {
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
    let mut shallow = BTreeMap::<u8, EngineLine>::new();
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
            if candidate.depth <= SHALLOW_REVIEW_DEPTH && !candidate.moves.is_empty() {
                let should_replace_shallow = shallow
                    .get(&candidate.multipv)
                    .map(|existing| candidate.depth >= existing.depth)
                    .unwrap_or(true);
                if should_replace_shallow {
                    shallow.insert(candidate.multipv, candidate.clone());
                }
            }
            let should_replace = latest
                .get(&candidate.multipv)
                .map(|existing| {
                    candidate.depth >= existing.depth
                        && (!candidate.moves.is_empty() || existing.moves.is_empty())
                })
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
        clocks: ReviewClocks { w: None, b: None },
        last_move: None,
        best_move,
        elapsed_ms: started.elapsed().as_millis(),
        lines: latest.into_values().collect(),
        shallow_lines: shallow.into_values().collect(),
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

    if let Some(0) = line.score_mate {
        return if position.fen.split_whitespace().nth(1) == Some("b") {
            1.0
        } else {
            0.0
        };
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

fn line_win_percent_white(line: &EngineLine) -> f64 {
    let centipawns = if let Some(mate) = line.score_mate {
        if mate > 0 {
            1000.0
        } else {
            -1000.0
        }
    } else if let Some(score) = line.score_cp {
        f64::from(score.clamp(-1000, 1000))
    } else if let Some([wins, draws, _losses]) = line.wdl {
        return ((f64::from(wins) + f64::from(draws) * 0.5) / 10.0).clamp(0.0, 100.0);
    } else {
        0.0
    };

    let winning_chances = 2.0 / (1.0 + (-0.00368208 * centipawns).exp()) - 1.0;
    (50.0 + 50.0 * winning_chances).clamp(0.0, 100.0)
}

fn win_percent_white(position: &PositionReview) -> f64 {
    if position.lines.first().and_then(|line| line.score_mate) == Some(0) {
        return if position.fen.split_whitespace().nth(1) == Some("b") {
            100.0
        } else {
            0.0
        };
    }
    position
        .lines
        .first()
        .map(line_win_percent_white)
        .unwrap_or(50.0)
}

fn mover_win_percent(white_percent: f64, color: &str) -> f64 {
    if color == "b" {
        100.0 - white_percent
    } else {
        white_percent
    }
}

fn accuracy_from_win_percent_loss(loss: f64) -> f64 {
    if loss <= 0.0 {
        return 100.0;
    }
    let raw = 103.1668100711649 * (-0.04354415386753951 * loss).exp() - 3.166924740191411;
    (raw + 1.0).clamp(0.0, 100.0)
}

fn piece_value(piece: char) -> i8 {
    match piece.to_ascii_lowercase() {
        'p' => 1,
        'n' | 'b' => 3,
        'r' => 5,
        'q' => 9,
        _ => 0,
    }
}

fn piece_side(piece: char) -> char {
    if piece.is_ascii_uppercase() {
        'w'
    } else {
        'b'
    }
}

fn piece_belongs_to(piece: char, color: &str) -> bool {
    (color == "w" && piece.is_ascii_uppercase()) || (color == "b" && piece.is_ascii_lowercase())
}

fn opposite_side(side: char) -> char {
    if side == 'w' {
        'b'
    } else {
        'w'
    }
}

fn square_index(square: &str) -> Option<usize> {
    let bytes = square.as_bytes();
    if bytes.len() != 2 || !(b'a'..=b'h').contains(&bytes[0]) || !(b'1'..=b'8').contains(&bytes[1])
    {
        return None;
    }
    Some(usize::from(bytes[0] - b'a') + usize::from(bytes[1] - b'1') * 8)
}

#[derive(Clone)]
struct BoardState {
    squares: [Option<char>; 64],
}

impl BoardState {
    fn from_fen(fen: &str) -> Option<Self> {
        let mut squares = [None; 64];
        let board = fen.split_whitespace().next()?;
        let ranks = board.split('/').collect::<Vec<_>>();
        if ranks.len() != 8 {
            return None;
        }

        for (row, rank) in ranks.iter().enumerate() {
            let board_rank = 7_usize.saturating_sub(row);
            let mut file = 0_usize;
            for item in rank.chars() {
                if let Some(empty) = item.to_digit(10) {
                    file += empty as usize;
                } else {
                    if file >= 8 {
                        return None;
                    }
                    squares[board_rank * 8 + file] = Some(item);
                    file += 1;
                }
            }
            if file != 8 {
                return None;
            }
        }

        Some(Self { squares })
    }

    fn material_balance(&self, color: &str) -> i16 {
        let white = self
            .squares
            .iter()
            .flatten()
            .map(|piece| {
                let value = i16::from(piece_value(*piece));
                if piece.is_ascii_uppercase() {
                    value
                } else {
                    -value
                }
            })
            .sum::<i16>();
        if color == "b" {
            -white
        } else {
            white
        }
    }

    fn apply_uci(&mut self, uci: &str) -> Option<Option<char>> {
        if uci.len() < 4 {
            return None;
        }
        let from = square_index(&uci[0..2])?;
        let to = square_index(&uci[2..4])?;
        let piece = self.squares[from]?;
        let from_file = from % 8;
        let from_rank = from / 8;
        let to_file = to % 8;
        let mut captured = self.squares[to];

        // En passant is the only UCI capture whose target square is empty.
        if piece.eq_ignore_ascii_case(&'p') && from_file != to_file && captured.is_none() {
            let capture_index = from_rank * 8 + to_file;
            captured = self.squares[capture_index];
            self.squares[capture_index] = None;
        }

        // Move the rook as well when replaying a castling PV move.
        if piece.eq_ignore_ascii_case(&'k') && from_file.abs_diff(to_file) == 2 {
            let (rook_from_file, rook_to_file) = if to_file > from_file { (7, 5) } else { (0, 3) };
            let rook_from = from_rank * 8 + rook_from_file;
            let rook_to = from_rank * 8 + rook_to_file;
            self.squares[rook_to] = self.squares[rook_from];
            self.squares[rook_from] = None;
        }

        self.squares[from] = None;
        let promoted = uci
            .as_bytes()
            .get(4)
            .copied()
            .map(char::from)
            .map(|role| {
                if piece.is_ascii_uppercase() {
                    role.to_ascii_uppercase()
                } else {
                    role.to_ascii_lowercase()
                }
            })
            .unwrap_or(piece);
        self.squares[to] = Some(promoted);
        Some(captured)
    }

    fn path_is_clear(&self, from: usize, to: usize, file_step: i8, rank_step: i8) -> bool {
        let mut file = (from % 8) as i8 + file_step;
        let mut rank = (from / 8) as i8 + rank_step;
        let to_file = (to % 8) as i8;
        let to_rank = (to / 8) as i8;
        while file != to_file || rank != to_rank {
            if !(0..8).contains(&file) || !(0..8).contains(&rank) {
                return false;
            }
            if self.squares[rank as usize * 8 + file as usize].is_some() {
                return false;
            }
            file += file_step;
            rank += rank_step;
        }
        true
    }

    fn piece_attacks(&self, from: usize, target: usize) -> bool {
        let Some(piece) = self.squares[from] else {
            return false;
        };
        if from == target {
            return false;
        }
        let file_delta = (target % 8) as i8 - (from % 8) as i8;
        let rank_delta = (target / 8) as i8 - (from / 8) as i8;
        let abs_file = file_delta.abs();
        let abs_rank = rank_delta.abs();

        match piece.to_ascii_lowercase() {
            'p' => abs_file == 1 && rank_delta == if piece.is_ascii_uppercase() { 1 } else { -1 },
            'n' => (abs_file == 1 && abs_rank == 2) || (abs_file == 2 && abs_rank == 1),
            'b' if abs_file == abs_rank => {
                self.path_is_clear(from, target, file_delta.signum(), rank_delta.signum())
            }
            'r' if file_delta == 0 || rank_delta == 0 => {
                self.path_is_clear(from, target, file_delta.signum(), rank_delta.signum())
            }
            'q' if file_delta == 0 || rank_delta == 0 || abs_file == abs_rank => {
                self.path_is_clear(from, target, file_delta.signum(), rank_delta.signum())
            }
            'k' => abs_file <= 1 && abs_rank <= 1,
            _ => false,
        }
    }

    fn attackers_to(&self, target: usize, side: char) -> Vec<usize> {
        self.squares
            .iter()
            .enumerate()
            .filter_map(|(index, piece)| {
                piece
                    .filter(|piece| piece_side(*piece) == side && self.piece_attacks(index, target))
                    .map(|_| index)
            })
            .collect()
    }

    fn is_in_check(&self, side: char) -> bool {
        let king = if side == 'w' { 'K' } else { 'k' };
        let Some(king_square) = self.squares.iter().position(|piece| *piece == Some(king)) else {
            return false;
        };
        !self
            .attackers_to(king_square, opposite_side(side))
            .is_empty()
    }

    fn capture_on(&mut self, from: usize, target: usize, side: char) -> bool {
        let Some(attacker) = self.squares[from] else {
            return false;
        };
        let Some(victim) = self.squares[target] else {
            return false;
        };
        if piece_side(attacker) != side
            || piece_side(victim) == side
            || victim.eq_ignore_ascii_case(&'k')
        {
            return false;
        }

        self.squares[from] = None;
        let target_rank = target / 8;
        let promoted = if attacker.eq_ignore_ascii_case(&'p') && matches!(target_rank, 0 | 7) {
            if side == 'w' {
                'Q'
            } else {
                'q'
            }
        } else {
            attacker
        };
        self.squares[target] = Some(promoted);
        !self.is_in_check(side)
    }

    fn static_exchange_gain(&self, target: usize, side: char, depth: usize) -> i16 {
        if depth >= 16 {
            return 0;
        }
        let Some(victim) = self.squares[target] else {
            return 0;
        };
        if piece_side(victim) == side || victim.eq_ignore_ascii_case(&'k') {
            return 0;
        }

        self.attackers_to(target, side)
            .into_iter()
            .filter_map(|attacker| {
                let mut next = self.clone();
                if !next.capture_on(attacker, target, side) {
                    return None;
                }
                let reply = next.static_exchange_gain(target, opposite_side(side), depth + 1);
                Some(i16::from(piece_value(victim)) - reply)
            })
            .max()
            .unwrap_or(0)
            .max(0)
    }
}

fn mover_has_forced_mate(position: &PositionReview, color: &str) -> bool {
    position
        .lines
        .first()
        .and_then(|line| line.score_mate)
        .map(|mate| (color == "w" && mate > 0) || (color == "b" && mate < 0))
        .unwrap_or(false)
}

fn newly_offered_material(
    input: &ReviewMoveInput,
    before: &PositionReview,
    after: &PositionReview,
) -> i16 {
    let Some(before_board) = BoardState::from_fen(&before.fen) else {
        return 0;
    };
    let Some(after_board) = BoardState::from_fen(&after.fen) else {
        return 0;
    };
    let side = if input.color == "b" { 'b' } else { 'w' };
    let captured_value = input
        .uci
        .get(2..4)
        .and_then(square_index)
        .and_then(|square| before_board.squares[square])
        .map(piece_value)
        .map(i16::from)
        .unwrap_or(0);

    let newly_hanging = after_board
        .squares
        .iter()
        .enumerate()
        .filter_map(|(square, piece)| {
            let piece = (*piece)?;
            if piece_side(piece) != side || matches!(piece.to_ascii_lowercase(), 'p' | 'k') {
                return None;
            }
            let after_gain = after_board.static_exchange_gain(square, opposite_side(side), 0);
            let before_gain = before_board.squares[square]
                .filter(|earlier| piece_side(*earlier) == side)
                .map(|_| before_board.static_exchange_gain(square, opposite_side(side), 0))
                .unwrap_or(0);
            Some((after_gain - before_gain).max(0))
        })
        .max()
        .unwrap_or(0);

    (newly_hanging - captured_value).max(0)
}

fn principal_variation_material(
    input: &ReviewMoveInput,
    before: &PositionReview,
    after: &PositionReview,
) -> (i16, bool) {
    let Some(before_board) = BoardState::from_fen(&before.fen) else {
        return (0, false);
    };
    let Some(mut board) = BoardState::from_fen(&after.fen) else {
        return (0, false);
    };
    let baseline = before_board.material_balance(&input.color);
    let mut lowest_delta = board.material_balance(&input.color) - baseline;
    let mut non_pawn_was_given = false;

    if let Some(line) = after.lines.first() {
        for uci in line.moves.iter().take(SACRIFICE_PV_PLIES) {
            let Some(captured) = board.apply_uci(uci) else {
                break;
            };
            if captured
                .filter(|piece| {
                    piece_belongs_to(*piece, &input.color)
                        && !matches!(piece.to_ascii_lowercase(), 'p' | 'k')
                })
                .is_some()
            {
                non_pawn_was_given = true;
            }
            lowest_delta = lowest_delta.min(board.material_balance(&input.color) - baseline);
        }
    }

    ((-lowest_delta).max(0), non_pawn_was_given)
}

fn shallow_search_surprise(input: &ReviewMoveInput, before: &PositionReview) -> bool {
    if before.shallow_lines.is_empty() {
        return false;
    }
    let deep_rank = before
        .lines
        .iter()
        .position(|line| line.moves.first().map(String::as_str) == Some(input.uci.as_str()))
        .or_else(|| (before.best_move.as_deref() == Some(input.uci.as_str())).then_some(0));
    let shallow_rank = before
        .shallow_lines
        .iter()
        .position(|line| line.moves.first().map(String::as_str) == Some(input.uci.as_str()));

    let Some(deep_rank) = deep_rank else {
        return false;
    };
    let Some(shallow_rank) = shallow_rank else {
        return true;
    };
    if shallow_rank > deep_rank {
        return true;
    }

    let deep = before.lines.get(deep_rank).map(line_win_percent_white);
    let shallow = before
        .shallow_lines
        .get(shallow_rank)
        .map(line_win_percent_white);
    matches!((deep, shallow), (Some(deep), Some(shallow)) if mover_win_percent(deep, &input.color) - mover_win_percent(shallow, &input.color) >= 5.0)
}

fn brilliant_loss_limit(rating: Option<u16>, surprising: bool) -> f64 {
    let rating_limit = match rating {
        Some(rating) if rating < 1000 => 2.0,
        Some(rating) if rating < 1600 => 1.5,
        Some(rating) if rating >= 2200 => 0.75,
        _ => 1.0,
    };
    rating_limit + if surprising { 0.5 } else { 0.0 }
}

fn sacrifice_material_threshold(rating: Option<u16>) -> i16 {
    if rating.is_some_and(|rating| rating < 1000) {
        1
    } else {
        2
    }
}

fn is_sound_sacrifice(
    input: &ReviewMoveInput,
    before: &PositionReview,
    after: &PositionReview,
    win_percent_lost: f64,
) -> bool {
    if input.uci.len() < 4 {
        return false;
    }
    let surprising = shallow_search_surprise(input, before);
    if win_percent_lost > brilliant_loss_limit(input.rating, surprising) {
        return false;
    }

    let offered = newly_offered_material(input, before, after);
    let (pv_concession, non_pawn_was_given) = principal_variation_material(input, before, after);
    let threshold = sacrifice_material_threshold(input.rating);
    let has_piece_sacrifice =
        offered >= threshold || (non_pawn_was_given && pv_concession >= threshold);
    let before_percent = mover_win_percent(win_percent_white(before), &input.color);
    let after_percent = mover_win_percent(win_percent_white(after), &input.color);

    has_piece_sacrifice && before_percent < 90.0 && after_percent >= 40.0
}

fn round(value: f64, places: i32) -> f64 {
    let factor = 10_f64.powi(places);
    (value * factor).round() / factor
}

fn classify_move(
    input: &ReviewMoveInput,
    before: &PositionReview,
    after: &PositionReview,
    previous: Option<&PositionReview>,
    win_percent_lost: f64,
) -> String {
    let before_percent = mover_win_percent(win_percent_white(before), &input.color);
    let after_percent = mover_win_percent(win_percent_white(after), &input.color);
    let missed_forced_mate =
        mover_has_forced_mate(before, &input.color) && !mover_has_forced_mate(after, &input.color);
    let missed_created_opportunity = previous
        .map(|position| {
            let earlier = mover_win_percent(win_percent_white(position), &input.color);
            before_percent >= 65.0
                && before_percent - earlier >= 10.0
                && win_percent_lost >= 10.0
                && after_percent < before_percent
        })
        .unwrap_or(false);

    if before.best_move.as_deref() != Some(input.uci.as_str())
        && (missed_forced_mate || missed_created_opportunity)
    {
        return "miss".to_string();
    }

    if is_sound_sacrifice(input, before, after, win_percent_lost) {
        return "brilliant".to_string();
    }

    if before.best_move.as_deref() == Some(input.uci.as_str()) {
        if let Some(second_line) = before.lines.get(1) {
            let best = before
                .lines
                .first()
                .map(line_win_percent_white)
                .map(|percent| mover_win_percent(percent, &input.color))
                .unwrap_or(before_percent);
            let second = mover_win_percent(line_win_percent_white(second_line), &input.color);
            if best - second >= 10.0 && best < 90.0 {
                return "great".to_string();
            }
        }
        return "best".to_string();
    }

    // Chesskit applies Chess.com-like labels to the public Lichess Win% curve.
    // Boundary values stay in the better category (for example, exactly 10 is
    // an inaccuracy); this deliberately mirrors Chesskit's strict comparisons.
    basic_classification(win_percent_lost).to_string()
}

fn basic_classification(win_percent_lost: f64) -> &'static str {
    if win_percent_lost > 20.0 {
        "blunder"
    } else if win_percent_lost > 10.0 {
        "mistake"
    } else if win_percent_lost > 5.0 {
        "inaccuracy"
    } else if win_percent_lost <= 2.0 {
        "excellent"
    } else {
        "good"
    }
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
            let win_percent_before = mover_win_percent(win_percent_white(before), &input.color);
            let win_percent_after = mover_win_percent(win_percent_white(after), &input.color);
            let win_percent_lost = (win_percent_before - win_percent_after).max(0.0);
            let previous = input
                .ply
                .checked_sub(2)
                .and_then(|ply| positions.get(ply as usize));
            let classification = classify_move(input, before, after, previous, win_percent_lost);
            let estimated_accuracy = accuracy_from_win_percent_loss(win_percent_lost);

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

fn standard_deviation(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mean = values.iter().sum::<f64>() / values.len() as f64;
    let variance = values
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f64>()
        / values.len() as f64;
    variance.sqrt()
}

fn game_accuracy(moves: &[&MoveReview], weights: &[f64]) -> f64 {
    if moves.is_empty() {
        return 0.0;
    }
    let weighted_denominator = moves
        .iter()
        .map(|item| {
            weights
                .get(item.ply.saturating_sub(1) as usize)
                .copied()
                .unwrap_or(1.0)
        })
        .sum::<f64>();
    let weighted = moves
        .iter()
        .map(|item| {
            item.estimated_accuracy
                * weights
                    .get(item.ply.saturating_sub(1) as usize)
                    .copied()
                    .unwrap_or(1.0)
        })
        .sum::<f64>()
        / weighted_denominator.max(f64::EPSILON);
    // Chesskit floors only the harmonic-mean inputs at 10. A single zero-
    // accuracy move should lower a game score substantially, not collapse the
    // harmonic half of the score all the way to zero.
    let harmonic = moves.len() as f64
        / moves
            .iter()
            .map(|item| 1.0 / item.estimated_accuracy.max(10.0))
            .sum::<f64>();
    (weighted + harmonic) / 2.0
}

fn volatility_weights(positions: &[PositionReview]) -> Vec<f64> {
    if positions.len() < 2 {
        return Vec::new();
    }
    let percents = positions.iter().map(win_percent_white).collect::<Vec<_>>();
    let window_size = positions
        .len()
        .div_ceil(10)
        .clamp(2, 8)
        .min(positions.len());
    let half_window_size = window_size.div_ceil(2);
    let mut windows = Vec::with_capacity(positions.len() - 1);
    for index in 1..positions.len() {
        if index < half_window_size {
            windows.push(&percents[..window_size]);
            continue;
        }
        let end = index + half_window_size;
        if end > positions.len() {
            windows.push(&percents[positions.len() - window_size..]);
            continue;
        }
        windows.push(&percents[index - half_window_size..end]);
    }
    windows
        .into_iter()
        .map(|window| standard_deviation(window).clamp(0.5, 12.0))
        .collect()
}

fn build_summary(moves: &[MoveReview], positions: &[PositionReview]) -> ReviewSummary {
    let mut classifications = BTreeMap::new();
    let mut white_classifications = BTreeMap::new();
    let mut black_classifications = BTreeMap::new();

    for item in moves {
        *classifications
            .entry(item.classification.clone())
            .or_insert(0) += 1;
        let side = if item.color == "b" {
            &mut black_classifications
        } else {
            &mut white_classifications
        };
        *side.entry(item.classification.clone()).or_insert(0) += 1;
    }

    let weights = volatility_weights(positions);
    let white = moves
        .iter()
        .filter(|item| item.color == "w")
        .collect::<Vec<_>>();
    let black = moves
        .iter()
        .filter(|item| item.color == "b")
        .collect::<Vec<_>>();

    ReviewSummary {
        white_accuracy: round(game_accuracy(&white, &weights), 1),
        black_accuracy: round(game_accuracy(&black, &weights), 1),
        classifications,
        white_classifications,
        black_classifications,
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
        let mut result = timeout(
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
        result.clocks = input.clocks;
        result.last_move = input.last_move;
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
    let summary = build_summary(&move_reviews, &analyzed);
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
        model: "stockfish + chesskit-lichess-accuracy + chesscave-special-moves-v2".to_string(),
        positions: analyzed,
        moves: move_reviews,
        summary,
    };

    persist_review(&cache_path, &review).await?;
    Ok(review)
}

#[cfg(test)]
mod tests {
    use super::{
        basic_classification, brilliant_loss_limit, build_move_reviews, game_accuracy, parse_info,
        shallow_search_surprise, square_index, BoardState, EngineLine, MoveReview, PositionReview,
        ReviewClocks, ReviewMoveInput,
    };

    fn engine_line(multipv: u8, score_cp: i32, moves: &[&str]) -> EngineLine {
        EngineLine {
            multipv,
            depth: 18,
            score_cp: Some(score_cp),
            score_mate: None,
            wdl: None,
            moves: moves.iter().map(|item| (*item).to_string()).collect(),
        }
    }

    fn reviewed_position(
        ply: u16,
        fen: &str,
        best_move: &str,
        lines: Vec<EngineLine>,
    ) -> PositionReview {
        PositionReview {
            ply,
            fen: fen.to_string(),
            clocks: ReviewClocks { w: None, b: None },
            last_move: None,
            best_move: Some(best_move.to_string()),
            elapsed_ms: 1,
            lines,
            shallow_lines: Vec::new(),
        }
    }

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
    fn uses_chesskit_strict_classification_boundaries() {
        assert_eq!(basic_classification(2.0), "excellent");
        assert_eq!(basic_classification(2.01), "good");
        assert_eq!(basic_classification(5.0), "good");
        assert_eq!(basic_classification(5.01), "inaccuracy");
        assert_eq!(basic_classification(10.0), "inaccuracy");
        assert_eq!(basic_classification(10.01), "mistake");
        assert_eq!(basic_classification(20.0), "mistake");
        assert_eq!(basic_classification(20.01), "blunder");
    }

    #[test]
    fn floors_chesskit_harmonic_accuracy_inputs_at_ten() {
        let move_with_accuracy = |ply, accuracy| MoveReview {
            ply,
            san: String::new(),
            uci: String::new(),
            color: "w".to_string(),
            classification: String::new(),
            expected_points_before: 0.0,
            expected_points_after: 0.0,
            expected_points_lost: 0.0,
            estimated_accuracy: accuracy,
            best_move: None,
        };
        let moves = vec![move_with_accuracy(1, 0.0), move_with_accuracy(2, 100.0)];
        let selected = moves.iter().collect::<Vec<_>>();

        assert!((game_accuracy(&selected, &[1.0, 1.0]) - 34.090_909).abs() < 0.000_001);
    }

    #[test]
    fn keeps_terminal_mate_scores_without_a_principal_variation() {
        let line =
            parse_info("info depth 0 score mate 0", false).expect("terminal score without PV");

        assert_eq!(line.score_mate, Some(0));
        assert!(line.moves.is_empty());
    }

    #[test]
    fn static_exchange_rejects_a_pinned_attacker() {
        let board = BoardState::from_fen("4k3/N3r3/8/8/8/8/8/4R2K b - - 0 1").expect("valid board");
        let target = square_index("a7").expect("valid square");

        assert_eq!(board.static_exchange_gain(target, 'b', 0), 0);
    }

    #[test]
    fn recognizes_a_delayed_principal_variation_sacrifice() {
        let positions = vec![
            reviewed_position(
                0,
                "1k6/8/8/8/8/8/8/R6K w - - 0 1",
                "a1a6",
                vec![engine_line(1, 0, &["a1a6"])],
            ),
            reviewed_position(
                1,
                "1k6/8/R7/8/8/8/8/7K b - - 1 1",
                "b8b7",
                vec![engine_line(1, 0, &["b8b7", "h1h2", "b7a6"])],
            ),
        ];
        let moves = vec![ReviewMoveInput {
            ply: 1,
            san: "Ra6".to_string(),
            uci: "a1a6".to_string(),
            color: "w".to_string(),
            rating: None,
        }];

        assert_eq!(
            build_move_reviews(&positions, &moves)[0].classification,
            "brilliant"
        );
    }

    #[test]
    fn recognizes_an_offered_piece_when_best_defense_declines_it() {
        let positions = vec![
            reviewed_position(
                0,
                "1k6/8/8/8/8/8/8/R6K w - - 0 1",
                "a1a8",
                vec![engine_line(1, 0, &["a1a8"])],
            ),
            reviewed_position(
                1,
                "Rk6/8/8/8/8/8/8/7K b - - 1 1",
                "b8b7",
                vec![engine_line(1, 0, &["b8b7"])],
            ),
        ];
        let moves = vec![ReviewMoveInput {
            ply: 1,
            san: "Ra8+".to_string(),
            uci: "a1a8".to_string(),
            color: "w".to_string(),
            rating: None,
        }];

        assert_eq!(
            build_move_reviews(&positions, &moves)[0].classification,
            "brilliant"
        );
    }

    #[test]
    fn does_not_call_a_balanced_exchange_a_sacrifice() {
        let positions = vec![
            reviewed_position(
                0,
                "4k3/8/p7/1b6/8/2N5/8/4K3 w - - 0 1",
                "c3b5",
                vec![engine_line(1, 0, &["c3b5"])],
            ),
            reviewed_position(
                1,
                "4k3/8/p7/1N6/8/8/8/4K3 b - - 0 1",
                "a6b5",
                vec![engine_line(1, 0, &["a6b5"])],
            ),
        ];
        let moves = vec![ReviewMoveInput {
            ply: 1,
            san: "Nxb5".to_string(),
            uci: "c3b5".to_string(),
            color: "w".to_string(),
            rating: None,
        }];

        assert_eq!(
            build_move_reviews(&positions, &moves)[0].classification,
            "best"
        );
    }

    #[test]
    fn detects_when_shallow_search_underestimates_the_final_best_move() {
        let input = ReviewMoveInput {
            ply: 1,
            san: "e4".to_string(),
            uci: "e2e4".to_string(),
            color: "w".to_string(),
            rating: None,
        };
        let mut position = reviewed_position(
            0,
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            "e2e4",
            vec![
                engine_line(1, 180, &["e2e4"]),
                engine_line(2, 160, &["d2d4"]),
            ],
        );
        position.shallow_lines = vec![
            engine_line(1, 10, &["d2d4"]),
            engine_line(2, -120, &["e2e4"]),
        ];

        assert!(shallow_search_surprise(&input, &position));
        assert!(brilliant_loss_limit(Some(800), true) > brilliant_loss_limit(Some(2300), false));
    }

    #[test]
    fn classifies_with_lichess_win_percent_loss() {
        let position = |ply, wdl, score_cp, best_move: &str| PositionReview {
            ply,
            fen: String::new(),
            clocks: super::ReviewClocks { w: None, b: None },
            last_move: None,
            best_move: Some(best_move.to_string()),
            elapsed_ms: 1,
            lines: vec![super::EngineLine {
                multipv: 1,
                depth: 12,
                score_cp: Some(score_cp),
                score_mate: None,
                wdl: Some(wdl),
                moves: vec![best_move.to_string()],
            }],
            shallow_lines: Vec::new(),
        };
        let positions = vec![
            position(0, [500, 400, 100], 0, "e2e4"),
            position(1, [330, 400, 270], -120, "e7e5"),
        ];
        let moves = vec![ReviewMoveInput {
            ply: 1,
            san: "d4".to_string(),
            uci: "d2d4".to_string(),
            color: "w".to_string(),
            rating: None,
        }];

        let review = build_move_reviews(&positions, &moves);
        assert_eq!(review[0].classification, "mistake");
        assert_eq!(review[0].expected_points_lost, 0.17);
    }

    #[test]
    fn recognizes_a_sound_direct_piece_sacrifice_as_brilliant() {
        let position = |ply, fen: &str, best_move: &str, response: &str| PositionReview {
            ply,
            fen: fen.to_string(),
            clocks: super::ReviewClocks { w: None, b: None },
            last_move: None,
            best_move: Some(best_move.to_string()),
            elapsed_ms: 1,
            lines: vec![super::EngineLine {
                multipv: 1,
                depth: 18,
                score_cp: Some(0),
                score_mate: None,
                wdl: Some([300, 400, 300]),
                moves: vec![response.to_string()],
            }],
            shallow_lines: Vec::new(),
        };
        let positions = vec![
            position(0, "bk6/8/8/8/8/8/8/R6K w - - 0 1", "a1a8", "a1a8"),
            position(1, "Rk6/8/8/8/8/8/8/7K b - - 0 1", "b8a8", "b8a8"),
        ];
        let moves = vec![ReviewMoveInput {
            ply: 1,
            san: "Rxa8+".to_string(),
            uci: "a1a8".to_string(),
            color: "w".to_string(),
            rating: None,
        }];

        let review = build_move_reviews(&positions, &moves);
        assert_eq!(review[0].classification, "brilliant");
    }

    #[test]
    fn recognizes_a_squandered_opponent_error_as_a_miss() {
        let position = |ply, score_cp, best_move: &str| PositionReview {
            ply,
            fen: "8/8/8/8/8/8/4k3/6K1 w - - 0 1".to_string(),
            clocks: super::ReviewClocks { w: None, b: None },
            last_move: None,
            best_move: Some(best_move.to_string()),
            elapsed_ms: 1,
            lines: vec![super::EngineLine {
                multipv: 1,
                depth: 18,
                score_cp: Some(score_cp),
                score_mate: None,
                wdl: None,
                moves: vec![best_move.to_string()],
            }],
            shallow_lines: Vec::new(),
        };
        let positions = vec![
            position(0, 0, "g1f1"),
            position(1, 0, "e2f2"),
            position(2, 300, "g1f1"),
            position(3, 40, "e2f2"),
        ];
        let moves = vec![
            ReviewMoveInput {
                ply: 1,
                san: "Kf1".to_string(),
                uci: "g1f1".to_string(),
                color: "w".to_string(),
                rating: None,
            },
            ReviewMoveInput {
                ply: 2,
                san: "Kf2".to_string(),
                uci: "e2f2".to_string(),
                color: "b".to_string(),
                rating: None,
            },
            ReviewMoveInput {
                ply: 3,
                san: "Kg2".to_string(),
                uci: "g1g2".to_string(),
                color: "w".to_string(),
                rating: None,
            },
        ];

        let review = build_move_reviews(&positions, &moves);
        assert_eq!(review[2].classification, "miss");
    }
}
