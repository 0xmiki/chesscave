import { describe, expect, test } from "bun:test";
import {
  formatChessComTimeControl,
  normalizeChessComUsername,
  ratingHistory,
  recentRatingChange,
  summarizeChessComGame,
  type ChessComDashboard,
  type ChessComGame,
} from "./chesscom";

function game(overrides: Partial<ChessComGame> = {}): ChessComGame {
  return {
    url: "https://www.chess.com/game/live/1",
    pgn: "1. e4 e5",
    timeControl: "600",
    endTime: 100,
    rated: true,
    timeClass: "rapid",
    rules: "chess",
    uuid: null,
    eco: null,
    accuracies: null,
    white: { username: "Student", rating: 1400, result: "win" },
    black: { username: "Opponent", rating: 1430, result: "checkmated" },
    ...overrides,
  };
}

function dashboard(games: ChessComGame[]): ChessComDashboard {
  return {
    profile: {
      username: "Student",
      name: null,
      avatar: null,
      url: null,
      location: null,
      title: null,
      status: null,
      joined: null,
      lastOnline: null,
      followers: null,
    },
    stats: {
      chessRapid: {
        last: { rating: 1425, date: 200, rd: 40 },
        best: null,
        record: { win: 10, loss: 8, draw: 2 },
      },
      chessBlitz: null,
    },
    games,
    fetchedAtMs: 1,
  };
}

describe("Chess.com dashboard data", () => {
  test("normalizes usernames and profile URLs", () => {
    expect(normalizeChessComUsername(" @Example_Player ")).toBe("example_player");
    expect(
      normalizeChessComUsername("https://www.chess.com/member/Example_Player/"),
    ).toBe("example_player");
    expect(() => normalizeChessComUsername("not a username")).toThrow();
  });

  test("summarizes games from the selected player's perspective", () => {
    expect(summarizeChessComGame(game(), "student")).toMatchObject({
      side: "white",
      outcome: "win",
      opponent: { username: "Opponent" },
    });
    expect(
      summarizeChessComGame(
        game({
          white: { username: "Opponent", rating: 1430, result: "agreed" },
          black: { username: "Student", rating: 1405, result: "agreed" },
        }),
        "student",
      ).outcome,
    ).toBe("draw");
  });

  test("builds chronological rating history and recent change", () => {
    const data = dashboard([
      game({ endTime: 200, white: { username: "Student", rating: 1420, result: "win" } }),
      game({ endTime: 100, white: { username: "Student", rating: 1400, result: "win" } }),
    ]);
    const history = ratingHistory(data, "student", "rapid");

    expect(history.map((point) => point.rating)).toEqual([1400, 1420]);
    expect(recentRatingChange(data.stats.chessRapid, history)).toBe(25);
  });

  test("formats common live time controls", () => {
    expect(formatChessComTimeControl("600")).toBe("10");
    expect(formatChessComTimeControl("180+2")).toBe("3+2");
    expect(formatChessComTimeControl("45+1")).toBe("45s+1");
  });
});
