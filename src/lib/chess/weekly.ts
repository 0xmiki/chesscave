import type { ChessComGame, ChessComOutcome } from "./chesscom";
import {
  buildReviewPresentation,
  divideGame,
  phaseAtPly,
  REVIEW_PHASES,
  type ReviewPhase,
} from "./review";
import type {
  GameRecord,
  GameReview,
  MoveClassification,
  Side,
} from "./types";

const SERIOUS_ERRORS = new Set<MoveClassification>([
  "mistake",
  "miss",
  "blunder",
]);
const STRONG_MOVES = new Set<MoveClassification>([
  "brilliant",
  "great",
  "best",
  "excellent",
]);

export const WEEKLY_REPORT_STORAGE_KEY = "chesscave.weekly-report.v1";

export interface WeeklyGameMeta {
  id: string;
  url: string;
  opponent: string;
  endTime: number;
  outcome: ChessComOutcome;
}

export interface WeeklyMoment {
  ply: number;
  san: string;
  expectedPoints: number;
  expectedPointsLost: number;
  classification: MoveClassification;
}

export interface WeeklyGameInsight extends WeeklyGameMeta {
  side: Side;
  accuracy: number;
  qualityScore: number;
  seriousErrors: number;
  strongMoves: number;
  playerMoveCount: number;
  phaseAccuracy: Record<ReviewPhase, number | null>;
  phaseMoveCounts: Record<ReviewPhase, number>;
  conversionOpportunity: boolean;
  converted: boolean;
  bestMoment: WeeklyMoment | null;
  criticalMoment: WeeklyMoment | null;
}

export interface WeeklyStrengthSignal {
  key: "phase" | "move-quality" | "conversion";
  title: string;
  detail: string;
  value: number;
}

export interface WeeklyReport {
  games: WeeklyGameInsight[];
  bestGames: WeeklyGameInsight[];
  needsWork: WeeklyGameInsight[];
  strengths: WeeklyStrengthSignal[];
  strongestPhase: ReviewPhase | null;
  weakestPhase: ReviewPhase | null;
}

export function rapidGamesLastSevenDays(
  games: ChessComGame[],
  nowMs = Date.now(),
): ChessComGame[] {
  const cutoff = Math.floor(nowMs / 1000) - 7 * 24 * 60 * 60;
  return games
    .filter(
      (game) =>
        game.timeClass === "rapid" &&
        game.rules === "chess" &&
        game.endTime >= cutoff,
    )
    .sort((left, right) => right.endTime - left.endTime);
}

export function reconcileWeeklyInsights(
  gameIds: string[],
  cached: WeeklyGameInsight[],
): WeeklyGameInsight[] {
  const cachedById = new Map(cached.map((insight) => [insight.id, insight]));
  return gameIds
    .map((id) => cachedById.get(id))
    .filter((insight): insight is WeeklyGameInsight => Boolean(insight));
}

function moment(
  move: GameReview["moves"][number] | null | undefined,
): WeeklyMoment | null {
  return move
    ? {
        ply: move.ply,
        san: move.san,
        expectedPoints: move.expectedPointsBefore,
        expectedPointsLost: move.expectedPointsLost,
        classification: move.classification,
      }
    : null;
}

function bestMomentFor(moves: GameReview["moves"]): WeeklyMoment | null {
  const priority: Partial<Record<MoveClassification, number>> = {
    brilliant: 6,
    great: 5,
    best: 3,
    excellent: 2,
    good: 1,
  };
  const selected = [...moves].sort((left, right) => {
    const classificationGap =
      (priority[right.classification] ?? 0) -
      (priority[left.classification] ?? 0);
    if (classificationGap) return classificationGap;
    const tensionLeft = 1 - Math.abs(left.expectedPointsBefore - 0.5);
    const tensionRight = 1 - Math.abs(right.expectedPointsBefore - 0.5);
    return tensionRight - tensionLeft;
  })[0];
  return moment(selected);
}

function criticalMomentFor(moves: GameReview["moves"]): WeeklyMoment | null {
  return moment(
    [...moves].sort(
      (left, right) => right.expectedPointsLost - left.expectedPointsLost,
    )[0],
  );
}

export function buildWeeklyGameInsight(
  game: GameRecord,
  review: GameReview,
  side: Side,
  meta: WeeklyGameMeta,
): WeeklyGameInsight {
  const presentation = buildReviewPresentation(game, review, 0);
  const playerMoves = presentation.moves.filter((move) => move.color === side);
  const division = divideGame(game);
  const phaseMoveCounts = Object.fromEntries(
    REVIEW_PHASES.map((phase) => [
      phase,
      playerMoves.filter((move) => phaseAtPly(move.ply, division) === phase)
        .length,
    ]),
  ) as Record<ReviewPhase, number>;
  const seriousErrors = playerMoves.filter((move) =>
    SERIOUS_ERRORS.has(move.classification),
  ).length;
  const strongMoves = playerMoves.filter((move) =>
    STRONG_MOVES.has(move.classification),
  ).length;
  const accuracy = presentation.sides[side].accuracy ?? 0;
  const outcomeBonus = meta.outcome === "win" ? 4 : meta.outcome === "draw" ? 1 : 0;
  const qualityScore = Math.max(
    0,
    Math.min(100, accuracy + outcomeBonus - seriousErrors * 1.5),
  );
  const conversionOpportunity = playerMoves.some(
    (move) => move.expectedPointsBefore >= 0.75,
  );

  return {
    ...meta,
    side,
    accuracy,
    qualityScore,
    seriousErrors,
    strongMoves,
    playerMoveCount: playerMoves.length,
    phaseAccuracy: presentation.sides[side].phaseAccuracy,
    phaseMoveCounts,
    conversionOpportunity,
    converted: conversionOpportunity && meta.outcome === "win",
    bestMoment: bestMomentFor(playerMoves),
    criticalMoment: criticalMomentFor(playerMoves),
  };
}

function weightedPhaseAverages(
  games: WeeklyGameInsight[],
): Record<ReviewPhase, number | null> {
  return Object.fromEntries(
    REVIEW_PHASES.map((phase) => {
      const available = games.filter(
        (game) =>
          game.phaseAccuracy[phase] !== null && game.phaseMoveCounts[phase] > 0,
      );
      const weight = available.reduce(
        (sum, game) => sum + game.phaseMoveCounts[phase],
        0,
      );
      const average = weight
        ? available.reduce(
            (sum, game) =>
              sum + game.phaseAccuracy[phase]! * game.phaseMoveCounts[phase],
            0,
          ) / weight
        : null;
      return [phase, average];
    }),
  ) as Record<ReviewPhase, number | null>;
}

function phaseExtremes(averages: Record<ReviewPhase, number | null>): {
  strongest: ReviewPhase | null;
  weakest: ReviewPhase | null;
} {
  const available = REVIEW_PHASES.filter(
    (phase) => averages[phase] !== null,
  );
  if (!available.length) return { strongest: null, weakest: null };
  return {
    strongest: [...available].sort(
      (left, right) => averages[right]! - averages[left]!,
    )[0],
    weakest: [...available].sort(
      (left, right) => averages[left]! - averages[right]!,
    )[0],
  };
}

export function buildWeeklyReport(games: WeeklyGameInsight[]): WeeklyReport {
  const ranked = [...games].sort(
    (left, right) => right.qualityScore - left.qualityScore,
  );
  const bestCount = Math.min(3, Math.ceil(ranked.length / 2));
  const remaining = ranked.slice(bestCount);
  const needsCount = Math.min(3, remaining.length);
  const bestGames = ranked.slice(0, bestCount);
  const needsWork = remaining.slice(-needsCount).reverse();
  const phaseAverages = weightedPhaseAverages(ranked);
  const { strongest, weakest } = phaseExtremes(phaseAverages);
  const totalMoves = ranked.reduce((sum, game) => sum + game.playerMoveCount, 0);
  const strongMoves = ranked.reduce((sum, game) => sum + game.strongMoves, 0);
  const opportunities = ranked.filter((game) => game.conversionOpportunity);
  const conversions = opportunities.filter((game) => game.converted).length;
  const strengths: WeeklyStrengthSignal[] = [];

  if (strongest) {
    strengths.push({
      key: "phase",
      title: `${strongest[0].toUpperCase()}${strongest.slice(1)} play`,
      detail: `${phaseAverages[strongest]!.toFixed(1)} average accuracy across the week's ${strongest} moves.`,
      value: phaseAverages[strongest]!,
    });
  }
  if (totalMoves) {
    const rate = (strongMoves / totalMoves) * 100;
    strengths.push({
      key: "move-quality",
      title: "Reliable decisions",
      detail: `${Math.round(rate)}% of your moves were best, excellent, great, or brilliant.`,
      value: rate,
    });
  }
  if (opportunities.length) {
    const rate = (conversions / opportunities.length) * 100;
    strengths.push({
      key: "conversion",
      title: "Winning-position conversion",
      detail: `${conversions} of ${opportunities.length} games with a 75%+ edge became wins.`,
      value: rate,
    });
  }
  strengths.sort((left, right) => right.value - left.value);

  return {
    games: ranked,
    bestGames,
    needsWork,
    strengths,
    strongestPhase: strongest,
    weakestPhase: weakest,
  };
}
