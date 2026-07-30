#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import {
  createGameReviewDigest,
  readStoredGameReview,
} from "./chesscave-review.mjs";
import { createPositionImage } from "./chesscave-board-image.mjs";

const ENGINE_PATH = process.env.CHESSCAVE_STOCKFISH_PATH || "stockfish";
const SERVER_INFO = { name: "chesscave", version: "0.2.0" };
const reviewDirectoryArgument = process.argv.indexOf("--review-dir");
const pieceDirectoryArgument = process.argv.indexOf("--piece-dir");
const REVIEW_DIRECTORY =
  process.env.CHESSCAVE_REVIEW_DIR ||
  (reviewDirectoryArgument >= 0 ? process.argv[reviewDirectoryArgument + 1] : null);
const PIECE_DIRECTORY =
  process.env.CHESSCAVE_PIECE_DIR ||
  (pieceDirectoryArgument >= 0 ? process.argv[pieceDirectoryArgument + 1] : null);

export const tools = [
  {
    name: "analyze_position",
    title: "Analyze a chess position",
    description:
      "Ask Stockfish to evaluate a FEN and return its best candidate moves with principal variations. Scores are normalized to White's perspective.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        fen: {
          type: "string",
          description: "A complete FEN for the position to analyze.",
        },
        depth: {
          type: "integer",
          minimum: 8,
          maximum: 24,
          default: 16,
          description: "Stockfish search depth.",
        },
        multipv: {
          type: "integer",
          minimum: 1,
          maximum: 5,
          default: 3,
          description: "Number of candidate lines to return.",
        },
      },
      required: ["fen"],
      additionalProperties: false,
    },
  },
  {
    name: "compare_moves",
    title: "Compare a played move with Stockfish",
    description:
      "Compare one legal UCI move with Stockfish's best choice in the same position. Use this before explaining why a move is inaccurate or strong.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        fen: {
          type: "string",
          description: "The FEN before the move was played.",
        },
        played_move: {
          type: "string",
          pattern: "^[a-h][1-8][a-h][1-8][qrbn]?$",
          description: "The played move in UCI notation, such as e2e4 or e7e8q.",
        },
        depth: {
          type: "integer",
          minimum: 8,
          maximum: 24,
          default: 16,
        },
      },
      required: ["fen", "played_move"],
      additionalProperties: false,
    },
  },
  {
    name: "get_position_image",
    title: "Get an image of any reviewed board position",
    description:
      "Return a PNG image of a position in ChessCave's completed game review. Select the exact position by ply, or find the nearest recorded position using a displayed White or Black clock such as 8:34. Use this whenever seeing piece placement would improve spatial, tactical, or positional reasoning. Supply exactly one of ply or clock.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        game_key: {
          type: "string",
          pattern: "^[a-fA-F0-9]{64}$",
          description:
            "The completed review key supplied in ChessCave's position context.",
        },
        ply: {
          type: "integer",
          minimum: 0,
          description:
            "Exact half-move index, where 0 is the starting position, 1 is after White's first move, and 2 is after Black's first move.",
        },
        clock: {
          type: "string",
          description:
            "Displayed clock timestamp written as M:SS or H:MM:SS, for example 8:34. ChessCave returns the nearest recorded match.",
        },
        clock_side: {
          type: "string",
          enum: ["white", "black", "either"],
          default: "either",
          description:
            "Whose displayed clock to match. Specify the side when it is known to avoid ambiguity.",
        },
        orientation: {
          type: "string",
          enum: ["white", "black"],
          default: "white",
          description: "Which player's side appears at the bottom of the image.",
        },
      },
      required: ["game_key"],
      additionalProperties: false,
    },
  },
  {
    name: "get_game_review",
    title: "Read the completed whole-game review",
    description:
      "Retrieve ChessCave's stored one-time Stockfish review for an entire game. Use this for questions about a player's core mistakes, turning points, accuracy, recurring weaknesses, or what should have been played. Critical mode ranks the largest expected-points losses and includes the best move, candidate lines, evaluations, and continuations. This reads the existing review and does not recompute positions.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        game_key: {
          type: "string",
          pattern: "^[a-fA-F0-9]{64}$",
          description:
            "The completed review key supplied in ChessCave's position context.",
        },
        focus: {
          type: "string",
          enum: ["critical", "summary", "all"],
          default: "critical",
          description:
            "critical ranks the biggest mistakes; summary returns aggregate accuracy and classifications; all returns reviewed moves in game order.",
        },
        side: {
          type: "string",
          enum: ["white", "black", "both"],
          default: "both",
          description:
            "Limit move selection to one player. Use both when the student's side is unknown.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          description:
            "Maximum moves to return. Critical mode defaults to 12; all mode defaults to the complete game, capped at 200.",
        },
      },
      required: ["game_key"],
      additionalProperties: false,
    },
  },
];

function write(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

function errorMessage(id, code, message) {
  write({ id, error: { code, message } });
}

function clamp(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(minimum, Math.min(maximum, Math.round(numeric)))
    : fallback;
}

function parseInfo(line, whiteToMove) {
  if (!line.startsWith("info ") || !line.includes(" score ") || !line.includes(" pv ")) {
    return null;
  }

  const tokens = line.trim().split(/\s+/);
  const result = {
    multipv: 1,
    depth: 0,
    scoreCp: null,
    scoreMate: null,
    moves: [],
  };
  const perspective = whiteToMove ? 1 : -1;

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === "depth") result.depth = Number(tokens[index + 1]) || 0;
    if (tokens[index] === "multipv") result.multipv = Number(tokens[index + 1]) || 1;
    if (tokens[index] === "score" && tokens[index + 1] === "cp") {
      result.scoreCp = (Number(tokens[index + 2]) || 0) * perspective;
    }
    if (tokens[index] === "score" && tokens[index + 1] === "mate") {
      result.scoreMate = (Number(tokens[index + 2]) || 0) * perspective;
    }
    if (tokens[index] === "pv") {
      result.moves = tokens.slice(index + 1);
      break;
    }
  }

  return result.moves.length ? result : null;
}

async function analyze(fen, depth, multipv, searchMove = null) {
  if (typeof fen !== "string" || fen.trim().split(/\s+/).length < 4) {
    throw new Error("A complete FEN is required.");
  }

  return new Promise((resolve, reject) => {
    const engine = spawn(ENGINE_PATH, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    const output = readline.createInterface({ input: engine.stdout });
    const latest = new Map();
    let engineName = "Stockfish";
    let ready = false;
    let completed = false;
    let bestMove = null;
    const whiteToMove = fen.trim().split(/\s+/)[1] !== "b";
    const timer = setTimeout(() => {
      engine.kill();
      reject(new Error("Stockfish analysis timed out."));
    }, 45_000);

    const finish = (callback) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      output.close();
      engine.stdin.end("quit\n");
      callback();
    };

    engine.once("error", (error) => {
      finish(() =>
        reject(
          new Error(
            `Could not start Stockfish at \`${ENGINE_PATH}\`: ${error.message}`,
          ),
        ),
      );
    });

    engine.stderr.on("data", (chunk) => {
      process.stderr.write(`[chesscave-mcp:stockfish] ${chunk}`);
    });

    output.on("line", (line) => {
      if (line.startsWith("id name ")) engineName = line.slice(8).trim();

      if (line === "uciok") {
        engine.stdin.write("setoption name Threads value 2\n");
        engine.stdin.write("setoption name Hash value 128\n");
        engine.stdin.write(`setoption name MultiPV value ${multipv}\n`);
        engine.stdin.write("isready\n");
        return;
      }

      if (line === "readyok" && !ready) {
        ready = true;
        engine.stdin.write(`position fen ${fen.trim()}\n`);
        engine.stdin.write(
          `go depth ${depth}${searchMove ? ` searchmoves ${searchMove}` : ""}\n`,
        );
        return;
      }

      const parsed = parseInfo(line, whiteToMove);
      if (parsed) {
        const existing = latest.get(parsed.multipv);
        if (!existing || parsed.depth >= existing.depth) {
          latest.set(parsed.multipv, parsed);
        }
      }

      if (line.startsWith("bestmove ")) {
        const value = line.split(/\s+/)[1];
        if (value && value !== "(none)") bestMove = value;
        finish(() =>
          resolve({
            engine: engineName,
            fen: fen.trim(),
            bestMove,
            lines: [...latest.values()].sort((a, b) => a.multipv - b.multipv),
          }),
        );
      }
    });

    engine.stdin.write("uci\n");
  });
}

function scoreForSideToMove(line, whiteToMove) {
  if (!line) return null;
  if (line.scoreMate !== null) {
    const mate = line.scoreMate * (whiteToMove ? 1 : -1);
    return Math.sign(mate) * (100_000 - Math.min(Math.abs(mate), 999));
  }
  if (line.scoreCp === null) return null;
  return line.scoreCp * (whiteToMove ? 1 : -1);
}

export async function callTool(name, args, configuration = {}) {
  const reviewDirectory =
    configuration.reviewDirectory ?? REVIEW_DIRECTORY;
  const pieceDirectory =
    configuration.pieceDirectory ?? PIECE_DIRECTORY;
  if (name === "get_position_image") {
    const review = await readStoredGameReview(reviewDirectory, args.game_key);
    return createPositionImage(review, args, pieceDirectory);
  }

  if (name === "get_game_review") {
    const review = await readStoredGameReview(reviewDirectory, args.game_key);
    return createGameReviewDigest(review, {
      focus: args.focus,
      side: args.side,
      limit: args.limit,
    });
  }

  if (name === "analyze_position") {
    return analyze(
      args.fen,
      clamp(args.depth, 8, 24, 16),
      clamp(args.multipv, 1, 5, 3),
    );
  }

  if (name === "compare_moves") {
    const depth = clamp(args.depth, 8, 24, 16);
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(args.played_move || "")) {
      throw new Error("played_move must use UCI notation, for example e2e4.");
    }
    const [best, played] = await Promise.all([
      analyze(args.fen, depth, 3),
      analyze(args.fen, depth, 1, args.played_move),
    ]);
    const whiteToMove = args.fen.trim().split(/\s+/)[1] !== "b";
    const bestScore = scoreForSideToMove(best.lines[0], whiteToMove);
    const playedScore = scoreForSideToMove(played.lines[0], whiteToMove);
    return {
      fen: args.fen,
      playedMove: args.played_move,
      bestMove: best.bestMove,
      bestLine: best.lines[0] || null,
      playedLine: played.lines[0] || null,
      centipawnLoss:
        bestScore === null || playedScore === null
          ? null
          : Math.max(0, bestScore - playedScore),
      engine: best.engine,
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}

export function createMcpToolResult(result) {
  if (Buffer.isBuffer(result?.png)) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result.metadata, null, 2),
        },
        {
          type: "image",
          data: result.png.toString("base64"),
          mimeType: "image/png",
        },
      ],
      structuredContent: result.metadata,
      isError: false,
    };
  }
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
    isError: false,
  };
}

async function handle(request) {
  const { id, method, params = {} } = request;

  if (method === "initialize") {
    write({
      id,
      result: {
        protocolVersion: params.protocolVersion || "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      },
    });
    return;
  }

  if (method === "ping") {
    write({ id, result: {} });
    return;
  }

  if (method === "tools/list") {
    write({ id, result: { tools } });
    return;
  }

  if (method === "tools/call") {
    try {
      const result = await callTool(params.name, params.arguments || {});
      write({ id, result: createMcpToolResult(result) });
    } catch (error) {
      write({
        id,
        result: {
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            },
          ],
          isError: true,
        },
      });
    }
    return;
  }

  if (id !== undefined) errorMessage(id, -32601, `Method not found: ${method}`);
}

export function startMcpServer() {
  const input = readline.createInterface({ input: process.stdin });
  input.on("line", (line) => {
    if (!line.trim()) return;
    try {
      void handle(JSON.parse(line));
    } catch (error) {
      process.stderr.write(`[chesscave-mcp] Invalid JSON: ${String(error)}\n`);
    }
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  startMcpServer();
}
