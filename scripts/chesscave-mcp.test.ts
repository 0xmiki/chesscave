import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  callTool,
  createMcpToolResult,
} from "./chesscave-mcp.mjs";

let temporaryDirectory = "";

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = "";
  }
});

describe("ChessCave MCP server", () => {
  test("returns a clock-selected board as MCP image content", async () => {
    const gameKey = "b".repeat(64);
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "chesscave-mcp-"));
    await writeFile(
      path.join(temporaryDirectory, `${gameKey}.json`),
      JSON.stringify({
        gameKey,
        engine: "Stockfish",
        positions: [
          {
            ply: 0,
            fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            clocks: { w: 600, b: 600 },
            lastMove: null,
          },
          {
            ply: 1,
            fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
            clocks: { w: 574, b: 600 },
            lastMove: { from: "e2", to: "e4" },
          },
        ],
        moves: [{ ply: 1, san: "e4" }],
      }),
    );

    const toolResult = await callTool(
      "get_position_image",
      {
        game_key: gameKey,
        clock: "9:34",
        clock_side: "white",
      },
      {
        reviewDirectory: temporaryDirectory,
        pieceDirectory: path.join(import.meta.dir, "../static/pieces/neo"),
      },
    );
    const result = createMcpToolResult(toolResult);
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      ply: 1,
      positionLabel: "1. e4",
      matchedClock: {
        side: "white",
        displayed: "9:34",
      },
    });
    expect(result.content[1].type).toBe("image");
    expect(result.content[1].mimeType).toBe("image/png");
    expect(
      Buffer.from(result.content[1].data, "base64").subarray(0, 8),
    ).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });
});
