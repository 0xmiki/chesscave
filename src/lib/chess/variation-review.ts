import type {
  AnalysisResult,
  GameMove,
  MoveClassification,
  MoveReview,
  PositionReview,
} from "./types";
import { moveAccuracyFromWinPercentLoss, winPercentFromCentipawns } from "./review";

type EvaluatedPosition = Pick<AnalysisResult, "fen" | "bestMove" | "lines"> | PositionReview;

function whiteWinPercent(position: EvaluatedPosition): number | null {
  const line = position.lines[0];
  if (!line) return null;
  if (line.scoreMate === 0) {
    return position.fen.split(/\s+/)[1] === "b" ? 100 : 0;
  }
  if (line.scoreMate !== null) return line.scoreMate > 0 ? 100 : 0;
  if (line.scoreCp !== null) return winPercentFromCentipawns(line.scoreCp);
  if (line.wdl) return Math.max(0, Math.min(100, (line.wdl[0] + line.wdl[1] * 0.5) / 10));
  return null;
}

function classificationForLoss(loss: number): MoveClassification {
  if (loss > 20) return "blunder";
  if (loss > 10) return "mistake";
  if (loss > 5) return "inaccuracy";
  if (loss <= 2) return "excellent";
  return "good";
}

export function evaluateVariationMove(
  move: GameMove,
  absolutePly: number,
  before: EvaluatedPosition | null | undefined,
  after: EvaluatedPosition | null | undefined,
  bookMove = false,
): MoveReview | null {
  if (!before || !after) return null;
  const beforeWhite = whiteWinPercent(before);
  const afterWhite = whiteWinPercent(after);
  if (beforeWhite === null || afterWhite === null) return null;

  const beforeForMover = move.color === "b" ? 100 - beforeWhite : beforeWhite;
  const afterForMover = move.color === "b" ? 100 - afterWhite : afterWhite;
  const winPercentLost = Math.max(0, beforeForMover - afterForMover);
  const uci = `${move.from}${move.to}${move.promotion ?? ""}`;
  const classification: MoveClassification = bookMove
    ? "book"
    : before.bestMove === uci
      ? "best"
      : classificationForLoss(winPercentLost);

  return {
    ply: absolutePly,
    san: move.san,
    uci,
    color: move.color,
    classification,
    expectedPointsBefore: beforeForMover / 100,
    expectedPointsAfter: afterForMover / 100,
    expectedPointsLost: winPercentLost / 100,
    estimatedAccuracy: moveAccuracyFromWinPercentLoss(winPercentLost),
    bestMove: before.bestMove,
  };
}
