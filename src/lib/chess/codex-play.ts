import { Chess, type Move } from "chess.js";
import type {
  AnalysisResult,
  EngineLine,
  MoveClassification,
  MoveComparison,
  Side,
} from "./types";

export const CODEX_PLAY_STORAGE_KEY = "chesscave.codex-play.v1";
export const CODEX_OPENING_ROTATION_KEY = "chesscave.codex-opening-rotation.v1";
export const CODEX_MOVE_TIME_MS = 700;
export const CODEX_COMPARE_TIME_MS = 650;
export const NOTABLE_EXPECTED_POINTS_LOSS = 0.08;

export interface CodexPlayMove {
  ply: number;
  san: string;
  uci: string;
  side: Side;
  before: string;
  after: string;
}

export function playUci(fen: string, uci: string): Move | null {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  try {
    return new Chess(fen).move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4] ?? "q",
    });
  } catch {
    return null;
  }
}

export function lineToSan(fen: string, line: EngineLine | null): string[] {
  if (!line) return [];
  const chess = new Chess(fen);
  const result: string[] = [];
  for (const uci of line.moves) {
    const move = playUci(chess.fen(), uci);
    if (!move) break;
    chess.move({ from: move.from, to: move.to, promotion: move.promotion });
    result.push(move.san);
  }
  return result;
}

export function scoreLabel(line: EngineLine | null): string {
  if (!line) return "Position unclear";
  if (line.scoreMate !== null) {
    if (line.scoreMate === 0) return "Mate";
    return `${line.scoreMate > 0 ? "+" : "-"}M${Math.abs(line.scoreMate)}`;
  }
  if (line.scoreCp === null) return "Position unclear";
  const pawns = line.scoreCp / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(1)}`;
}

export function moveRecord(move: Move, ply: number): CodexPlayMove {
  return {
    ply,
    san: move.san,
    uci: `${move.from}${move.to}${move.promotion ?? ""}`,
    side: move.color,
    before: move.before,
    after: move.after,
  };
}

export function isNotableComparison(comparison: MoveComparison): boolean {
  if (!comparison.analysis.bestMove || !comparison.playedLine) return false;
  if (comparison.analysis.bestMove === comparison.playedLine.moves[0]) return false;
  return (
    comparison.expectedPointsLost !== null &&
    comparison.expectedPointsLost >= NOTABLE_EXPECTED_POINTS_LOSS
  );
}

function winPercentWhite(line: EngineLine | null): number {
  if (!line) return 50;
  if (line.wdl) return Math.max(0, Math.min(100, (line.wdl[0] + line.wdl[1] * 0.5) / 10));
  const centipawns = line.scoreMate !== null
    ? line.scoreMate > 0 ? 1_000 : -1_000
    : Math.max(-1_000, Math.min(1_000, line.scoreCp ?? 0));
  const winningChances = 2 / (1 + Math.exp(-0.00368208 * centipawns)) - 1;
  return Math.max(0, Math.min(100, 50 + 50 * winningChances));
}

export function classifyLiveMove(
  comparison: MoveComparison,
  playedMove: string,
  side: Side,
  isBookMove = false,
): MoveClassification {
  if (isBookMove) return "book";
  if (comparison.analysis.bestMove === playedMove) return "best";

  const best = winPercentWhite(comparison.analysis.lines[0] ?? null);
  const played = winPercentWhite(comparison.playedLine);
  const loss = Math.max(0, side === "w" ? best - played : played - best);
  if (loss > 20) return "blunder";
  if (loss > 10) return "mistake";
  if (loss > 5) return "inaccuracy";
  if (loss <= 2) return "excellent";
  return "good";
}

export function codexPositionContext(input: {
  fen: string;
  playerSide: Side;
  opening: string | null;
  history: CodexPlayMove[];
  analysis: AnalysisResult | null;
  comparison?: MoveComparison | null;
  classification?: MoveClassification | null;
  playerMove?: CodexPlayMove | null;
  codexMove?: CodexPlayMove | null;
  playerIdea?: string;
}): string {
  const principal = input.analysis?.lines[0] ?? null;
  const sanLine = lineToSan(input.fen, principal);
  const candidateLines = input.analysis?.lines.slice(0, 3).map((line, index) => {
    const moves = lineToSan(input.fen, line).slice(0, 5).join(" ") || "none";
    return `Candidate ${index + 1}: ${moves}; score ${scoreLabel(line)}`;
  }) ?? [];
  const playedLine = input.comparison?.playedLine ?? null;
  const playerColor = input.playerSide === "w" ? "White" : "Black";
  return [
    `Mode: live game against Codex`,
    `Player: ${playerColor}`,
    `FEN: ${input.fen}`,
    `Opening: ${input.opening ?? "Not identified"}`,
    `Moves: ${input.history.map((move) => move.san).join(" ") || "None"}`,
    input.playerMove
      ? `Player just chose: ${input.playerMove.san} (${input.playerMove.uci})`
      : "Codex is choosing the move.",
    input.classification ? `Player move classification: ${input.classification}` : "",
    input.codexMove ? `Codex replied: ${input.codexMove.san} (${input.codexMove.uci})` : "",
    input.playerIdea ? `Player's stated idea: ${input.playerIdea}` : "",
    input.analysis
      ? `Stockfish: ${input.analysis.engine}, depth ${principal?.depth ?? "time-limited"}, best ${input.analysis.bestMove ?? "none"}, score ${scoreLabel(principal)}, principal line ${sanLine.join(" ") || "none"}`
      : "Stockfish analysis unavailable.",
    ...candidateLines,
    playedLine
      ? `Played-move line: ${lineToSan(input.fen, playedLine).slice(0, 5).join(" ") || "none"}; score ${scoreLabel(playedLine)}`
      : "",
    input.comparison?.expectedPointsLost !== null && input.comparison?.expectedPointsLost !== undefined
      ? `Expected-points loss: ${(input.comparison.expectedPointsLost * 100).toFixed(1)} percentage points`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
