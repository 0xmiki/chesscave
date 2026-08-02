export type ChessComTimeClass = "rapid" | "blitz";
export type ChessComOutcome = "win" | "draw" | "loss";

export const CHESSCOM_USERNAME_STORAGE_KEY = "chesscave.chesscom.username.v1";
export const CHESSCOM_DASHBOARD_STORAGE_KEY = "chesscave.chesscom.dashboard.v1";
export const REVIEWED_GAMES_STORAGE_KEY = "chesscave.reviewed-games.v1";
export const STUDY_STORAGE_KEY = "chesscave.study.v1";

export interface ChessComProfile {
  username: string;
  name: string | null;
  avatar: string | null;
  url: string | null;
  location: string | null;
  title: string | null;
  status: string | null;
  joined: number | null;
  lastOnline: number | null;
  followers: number | null;
}

export interface ChessComRatingSnapshot {
  rating: number;
  date: number;
  rd: number | null;
}

export interface ChessComBestRating {
  rating: number;
  date: number;
  game: string | null;
}

export interface ChessComRecord {
  win: number;
  loss: number;
  draw: number;
}

export interface ChessComRatingStats {
  last: ChessComRatingSnapshot | null;
  best: ChessComBestRating | null;
  record: ChessComRecord;
}

export interface ChessComStats {
  chessRapid: ChessComRatingStats | null;
  chessBlitz: ChessComRatingStats | null;
}

export interface ChessComGamePlayer {
  username: string;
  rating: number;
  result: string;
}

export interface ChessComAccuracies {
  white: number | null;
  black: number | null;
}

export interface ChessComGame {
  url: string;
  pgn: string;
  timeControl: string;
  endTime: number;
  rated: boolean;
  timeClass: string;
  rules: string;
  uuid: string | null;
  eco: string | null;
  accuracies: ChessComAccuracies | null;
  white: ChessComGamePlayer;
  black: ChessComGamePlayer;
}

export interface ChessComDashboard {
  profile: ChessComProfile;
  stats: ChessComStats;
  games: ChessComGame[];
  fetchedAtMs: number;
}

export interface ChessComGameSummary {
  side: "white" | "black";
  opponent: ChessComGamePlayer;
  player: ChessComGamePlayer;
  outcome: ChessComOutcome;
}

export interface RatingPoint {
  rating: number;
  timestamp: number;
}

const drawResults = new Set([
  "agreed",
  "repetition",
  "stalemate",
  "insufficient",
  "50move",
  "timevsinsufficient",
]);

export function normalizeChessComUsername(value: string): string {
  let candidate = value.trim();
  const profileMatch = candidate.match(
    /^(?:https?:\/\/)?(?:www\.)?chess\.com\/member\/([^/?#]+)/i,
  );
  if (profileMatch) candidate = profileMatch[1];
  candidate = candidate.replace(/^@+/, "").trim().toLowerCase();

  if (!candidate) throw new Error("Enter your Chess.com username.");
  if (
    candidate.length > 32 ||
    !/^[a-z0-9_-]+$/.test(candidate)
  ) {
    throw new Error("Enter a valid Chess.com username or profile URL.");
  }
  return candidate;
}

export function gamesForTimeClass(
  dashboard: ChessComDashboard | null,
  timeClass: ChessComTimeClass,
): ChessComGame[] {
  return (dashboard?.games ?? [])
    .filter((game) => game.timeClass === timeClass)
    .sort((left, right) => right.endTime - left.endTime);
}

export function summarizeChessComGame(
  game: ChessComGame,
  username: string,
): ChessComGameSummary {
  const playsWhite = game.white.username.toLowerCase() === username.toLowerCase();
  const player = playsWhite ? game.white : game.black;
  const opponent = playsWhite ? game.black : game.white;
  const outcome: ChessComOutcome =
    player.result === "win"
      ? "win"
      : drawResults.has(player.result)
        ? "draw"
        : "loss";

  return {
    side: playsWhite ? "white" : "black",
    opponent,
    player,
    outcome,
  };
}

export function ratingStatsFor(
  dashboard: ChessComDashboard | null,
  timeClass: ChessComTimeClass,
): ChessComRatingStats | null {
  return timeClass === "rapid"
    ? dashboard?.stats.chessRapid ?? null
    : dashboard?.stats.chessBlitz ?? null;
}

export function ratingHistory(
  dashboard: ChessComDashboard | null,
  username: string,
  timeClass: ChessComTimeClass,
): RatingPoint[] {
  return gamesForTimeClass(dashboard, timeClass)
    .map((game) => ({
      rating: summarizeChessComGame(game, username).player.rating,
      timestamp: game.endTime,
    }))
    .filter((point) => point.rating > 0)
    .sort((left, right) => left.timestamp - right.timestamp);
}

export function recentRatingChange(
  stats: ChessComRatingStats | null,
  history: RatingPoint[],
): number | null {
  if (!stats?.last || history.length < 2) return null;
  return stats.last.rating - history[0].rating;
}

export function formatChessComTimeControl(value: string): string {
  const [baseValue, incrementValue] = value.split("+");
  const baseSeconds = Number.parseInt(baseValue, 10);
  const increment = Number.parseInt(incrementValue ?? "0", 10);
  if (!Number.isFinite(baseSeconds)) return value;

  const base =
    baseSeconds >= 60 && baseSeconds % 60 === 0
      ? String(baseSeconds / 60)
      : `${baseSeconds}s`;
  return increment > 0 ? `${base}+${increment}` : base;
}

export function reviewedGameUrls(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const value = JSON.parse(
      localStorage.getItem(REVIEWED_GAMES_STORAGE_KEY) ?? "[]",
    ) as unknown;
    return new Set(
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

export function markGameReviewed(url: string): void {
  if (!url || typeof localStorage === "undefined") return;
  const reviewed = reviewedGameUrls();
  reviewed.add(url);
  localStorage.setItem(
    REVIEWED_GAMES_STORAGE_KEY,
    JSON.stringify([...reviewed].slice(-500)),
  );
}
