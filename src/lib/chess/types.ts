export type Side = "w" | "b";

export interface GameMove {
  san: string;
  lan: string;
  from: string;
  to: string;
  color: Side;
  piece: string;
  captured?: string;
  promotion?: string;
  before: string;
  after: string;
}

export interface GameSnapshot {
  fen: string;
  ply: number;
  lastMove: { from: string; to: string } | null;
  clocks: Record<Side, number | null>;
}

export interface GameRecord {
  headers: Record<string, string>;
  pgn: string;
  moves: GameMove[];
  snapshots: GameSnapshot[];
}

export interface VariationLine {
  rootPly: number;
  moves: GameMove[];
  snapshots: GameSnapshot[];
}

export interface EngineLine {
  multipv: number;
  depth: number;
  scoreCp: number | null;
  scoreMate: number | null;
  wdl: [number, number, number] | null;
  moves: string[];
}

export interface AnalysisResult {
  engine: string;
  fen: string;
  bestMove: string | null;
  elapsedMs: number;
  lines: EngineLine[];
}

export interface EngineStatus {
  available: boolean;
  name: string | null;
  path: string | null;
  message: string;
}

export type MoveClassification =
  | "brilliant"
  | "great"
  | "best"
  | "excellent"
  | "good"
  | "book"
  | "inaccuracy"
  | "mistake"
  | "miss"
  | "blunder";

export interface PositionReview {
  ply: number;
  fen: string;
  bestMove: string | null;
  elapsedMs: number;
  lines: EngineLine[];
}

export interface MoveReview {
  ply: number;
  san: string;
  uci: string;
  color: Side;
  classification: MoveClassification;
  expectedPointsBefore: number;
  expectedPointsAfter: number;
  expectedPointsLost: number;
  estimatedAccuracy: number;
  bestMove: string | null;
}

export interface ReviewSummary {
  whiteAccuracy: number;
  blackAccuracy: number;
  classifications: Partial<Record<MoveClassification, number>>;
}

export interface GameReview {
  schemaVersion: number;
  gameKey: string;
  engine: string;
  nodesPerPosition: number;
  multiPv: number;
  createdAtMs: number;
  cached: boolean;
  model: string;
  positions: PositionReview[];
  moves: MoveReview[];
  summary: ReviewSummary;
}

export interface ReviewProgress {
  gameKey: string;
  completed: number;
  total: number;
  ply: number;
}

export interface CoachMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
}
