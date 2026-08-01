import { Chess, type Color, type Square } from "chess.js";
import type {
  GameRecord,
  GameReview,
  MoveClassification,
  MoveReview,
  PositionReview,
  Side,
} from "./types";

export const REVIEW_PHASES = ["opening", "middlegame", "endgame"] as const;
export type ReviewPhase = (typeof REVIEW_PHASES)[number];

export const CLASSIFICATION_ORDER: MoveClassification[] = [
  "brilliant",
  "great",
  "book",
  "best",
  "excellent",
  "good",
  "inaccuracy",
  "mistake",
  "miss",
  "blunder",
];

export interface GameDivision {
  middlegamePly: number | null;
  endgamePly: number | null;
}

export interface ReviewGraphPoint {
  ply: number;
  whiteWinPercent: number;
}

export interface SideReviewSummary {
  accuracy: number | null;
  classifications: Record<MoveClassification, number>;
  phaseAccuracy: Record<ReviewPhase, number | null>;
}

export interface ReviewPresentation {
  moves: MoveReview[];
  graph: ReviewGraphPoint[];
  division: GameDivision;
  sides: Record<Side, SideReviewSummary>;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function winPercentFromCentipawns(centipawns: number): number {
  const cp = clamp(centipawns, -1000, 1000);
  const winningChances = 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
  return clamp(50 + 50 * winningChances, 0, 100);
}

export function moveAccuracyFromWinPercentLoss(loss: number): number {
  if (loss <= 0) return 100;
  const raw =
    103.1668100711649 * Math.exp(-0.04354415386753951 * loss) -
    3.166924740191411;
  return clamp(raw + 1, 0, 100);
}

function lineWinPercent(position: PositionReview): number {
  const line = position.lines[0];
  if (!line) return 50;
  if (line.scoreMate === 0) {
    return position.fen.split(/\s+/)[1] === "b" ? 100 : 0;
  }
  if (line.scoreMate !== null) {
    return winPercentFromCentipawns(line.scoreMate > 0 ? 1000 : -1000);
  }
  if (line.scoreCp !== null) return winPercentFromCentipawns(line.scoreCp);
  if (line.wdl) {
    return clamp((line.wdl[0] + line.wdl[1] * 0.5) / 10, 0, 100);
  }
  return 50;
}

function standardDeviation(values: number[]): number {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    values.length;
  return Math.sqrt(variance);
}

function volatilityWeights(winPercents: number[]): number[] {
  if (winPercents.length < 2) return [];
  const moveCount = winPercents.length - 1;
  const windowSize = Math.min(clamp(Math.floor(moveCount / 10), 2, 8), winPercents.length);
  const windows: number[][] = [];

  for (let index = 0; index < Math.max(0, windowSize - 2); index += 1) {
    windows.push(winPercents.slice(0, windowSize));
  }
  for (let start = 0; start <= winPercents.length - windowSize; start += 1) {
    windows.push(winPercents.slice(start, start + windowSize));
  }

  return windows.map((window) => clamp(standardDeviation(window), 0.5, 12));
}

function aggregateAccuracy(
  moves: MoveReview[],
  positions: PositionReview[],
  side: Side,
): number | null {
  const selected = moves.filter((move) => move.color === side);
  if (!selected.length || positions.length < 2) return null;
  const firstPly = moves[0]?.ply ?? 1;
  const weights = volatilityWeights(positions.map(lineWinPercent));
  const weighted = selected.map((move) => ({
    accuracy: move.estimatedAccuracy,
    weight: weights[move.ply - firstPly] ?? 1,
  }));
  const weightTotal = weighted.reduce((sum, item) => sum + item.weight, 0);
  const weightedMean =
    weighted.reduce((sum, item) => sum + item.accuracy * item.weight, 0) /
    Math.max(Number.EPSILON, weightTotal);
  const harmonicMean = weighted.some((item) => item.accuracy <= 0)
    ? 0
    : weighted.length /
      weighted.reduce((sum, item) => sum + 1 / item.accuracy, 0);
  return Math.round(((weightedMean + harmonicMean) / 2) * 10) / 10;
}

function square(file: number, rank: number): Square {
  return `${String.fromCharCode(97 + file)}${rank}` as Square;
}

function piecesOnRank(board: Chess, rank: number, color: Color): number {
  let count = 0;
  for (let file = 0; file < 8; file += 1) {
    if (board.get(square(file, rank))?.color === color) count += 1;
  }
  return count;
}

function majorAndMinorCount(board: Chess): number {
  let count = 0;
  for (let rank = 1; rank <= 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const piece = board.get(square(file, rank));
      if (piece && piece.type !== "p" && piece.type !== "k") count += 1;
    }
  }
  return count;
}

function mixednessRegionScore(y: number, white: number, black: number): number {
  if (white === 0) {
    if (black === 1) return 1 + y;
    if (black === 2) return y < 6 ? 2 + (6 - y) : 0;
    if (black === 3 || black === 4) return y < 7 ? 3 + (7 - y) : 0;
    return 0;
  }
  if (white === 1) {
    if (black === 0) return 1 + (8 - y);
    if (black === 1) return 5 + Math.abs(4 - y);
    if (black === 2) return 4 + (7 - y);
    if (black === 3) return 5 + (7 - y);
    return 0;
  }
  if (white === 2) {
    if (black === 0) return y > 2 ? 2 + (y - 2) : 0;
    if (black === 1) return 4 + (y - 1);
    if (black === 2) return 7;
    return 0;
  }
  if (white === 3) {
    if (black === 0) return y > 1 ? 3 + (y - 1) : 0;
    if (black === 1) return 5 + (y - 1);
    return 0;
  }
  if (white === 4 && black === 0) return y > 1 ? 3 + (y - 1) : 0;
  return 0;
}

function boardMixedness(board: Chess): number {
  let score = 0;
  for (let rank = 1; rank <= 7; rank += 1) {
    for (let file = 0; file <= 6; file += 1) {
      let white = 0;
      let black = 0;
      for (let rankOffset = 0; rankOffset <= 1; rankOffset += 1) {
        for (let fileOffset = 0; fileOffset <= 1; fileOffset += 1) {
          const piece = board.get(square(file + fileOffset, rank + rankOffset));
          if (piece?.color === "w") white += 1;
          if (piece?.color === "b") black += 1;
        }
      }
      score += mixednessRegionScore(rank, white, black);
    }
  }
  return score;
}

export function divideGame(game: GameRecord): GameDivision {
  const positions = game.snapshots.map((snapshot) => new Chess(snapshot.fen));
  let middlegamePly: number | null = null;
  let endgamePly: number | null = null;

  for (const [ply, board] of positions.entries()) {
    const pieces = majorAndMinorCount(board);
    if (
      middlegamePly === null &&
      (pieces <= 10 ||
        piecesOnRank(board, 1, "w") < 4 ||
        piecesOnRank(board, 8, "b") < 4 ||
        boardMixedness(board) > 150)
    ) {
      middlegamePly = ply;
    }
    if (middlegamePly !== null && endgamePly === null && pieces <= 6) {
      endgamePly = ply;
    }
  }

  if (
    middlegamePly !== null &&
    endgamePly !== null &&
    middlegamePly >= endgamePly
  ) {
    middlegamePly = null;
  }
  return { middlegamePly, endgamePly };
}

export function phaseAtPly(ply: number, division: GameDivision): ReviewPhase {
  if (division.middlegamePly === null || ply < division.middlegamePly) {
    return "opening";
  }
  if (division.endgamePly !== null && ply >= division.endgamePly) {
    return "endgame";
  }
  return "middlegame";
}

function emptyClassifications(): Record<MoveClassification, number> {
  return Object.fromEntries(
    CLASSIFICATION_ORDER.map((classification) => [classification, 0]),
  ) as Record<MoveClassification, number>;
}

function phaseAccuracy(
  phase: ReviewPhase,
  side: Side,
  moves: MoveReview[],
  positions: PositionReview[],
  division: GameDivision,
): number | null {
  const phaseMoves = moves.filter((move) => phaseAtPly(move.ply, division) === phase);
  if (!phaseMoves.some((move) => move.color === side)) return null;
  const firstPly = phaseMoves[0].ply;
  const lastPly = phaseMoves.at(-1)!.ply;
  return aggregateAccuracy(
    phaseMoves,
    positions.slice(Math.max(0, firstPly - 1), lastPly + 1),
    side,
  );
}

export function buildReviewPresentation(
  game: GameRecord,
  review: GameReview,
  bookThroughPly: number,
): ReviewPresentation {
  const moves = review.moves.map((move) =>
    move.ply <= bookThroughPly
      ? { ...move, classification: "book" as const }
      : move,
  );
  const division = divideGame(game);
  const graph = review.positions.map((position) => ({
    ply: position.ply,
    whiteWinPercent: lineWinPercent(position),
  }));

  const sideSummary = (side: Side): SideReviewSummary => {
    const classifications = emptyClassifications();
    for (const move of moves) {
      if (move.color === side) classifications[move.classification] += 1;
    }
    return {
      accuracy:
        aggregateAccuracy(moves, review.positions, side) ??
        (side === "w" ? review.summary.whiteAccuracy : review.summary.blackAccuracy),
      classifications,
      phaseAccuracy: {
        opening: phaseAccuracy("opening", side, moves, review.positions, division),
        middlegame: phaseAccuracy("middlegame", side, moves, review.positions, division),
        endgame: phaseAccuracy("endgame", side, moves, review.positions, division),
      },
    };
  };

  return {
    moves,
    graph,
    division,
    sides: { w: sideSummary("w"), b: sideSummary("b") },
  };
}
