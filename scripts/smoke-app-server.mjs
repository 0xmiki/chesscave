#!/usr/bin/env node

import { spawn } from "node:child_process";
import readline from "node:readline";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const mcpScript = path.join(root, "scripts/chesscave-mcp.mjs");
const codexPath = process.env.CHESSCAVE_CODEX_PATH || "codex";
const timeoutMs = 120_000;
let threadId = null;
let sawMcpReady = false;
let sawMcpCall = false;
let assistantText = "";
let finished = false;

const child = spawn(
  codexPath,
  [
    "app-server",
    "--listen",
    "stdio://",
    "--disable",
    "shell_tool",
    "-c",
    'mcp_servers.chesscave.command="node"',
    "-c",
    `mcp_servers.chesscave.args=${JSON.stringify([mcpScript])}`,
    "-c",
    `mcp_servers.chesscave.cwd=${JSON.stringify(root)}`,
    "-c",
    "mcp_servers.chesscave.required=true",
    "-c",
    'mcp_servers.chesscave.default_tools_approval_mode="approve"',
  ],
  {
    cwd: "/tmp",
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  },
);

const timer = setTimeout(() => {
  fail("Timed out waiting for the app-server smoke test.");
}, timeoutMs);

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function close(code) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  child.kill();
  process.exitCode = code;
}

function fail(message) {
  process.stderr.write(`SMOKE FAILURE: ${message}\n`);
  close(1);
}

child.once("error", (error) => fail(`Could not launch Codex: ${error.message}`));
child.stderr.on("data", (chunk) => process.stderr.write(chunk));

readline.createInterface({ input: child.stdout }).on("line", (line) => {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    fail(`Non-JSON app-server output: ${line}`);
    return;
  }

  if (event.error) {
    fail(event.error.message || JSON.stringify(event.error));
    return;
  }

  if (event.id === 1 && event.result?.thread?.id) {
    threadId = event.result.thread.id;
    send({
      method: "turn/start",
      id: 2,
      params: {
        threadId,
        input: [
          {
            type: "text",
            text:
              "Which first move would you recommend and why?\n\n" +
              "<chesscave_position_context>\n" +
              "FEN: rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1\n" +
              "Side to move: White\n" +
              "</chesscave_position_context>\n" +
              "Use ChessCave Stockfish analysis before answering.",
          },
        ],
      },
    });
    return;
  }

  if (event.method === "mcpServer/startupStatus/updated") {
    if (event.params?.name === "chesscave" && event.params?.status === "ready") {
      sawMcpReady = true;
    }
    if (event.params?.name === "chesscave" && event.params?.status === "failed") {
      fail(`ChessCave MCP failed: ${event.params?.error || "unknown error"}`);
    }
    return;
  }

  if (event.method === "item/started" && event.params?.item?.type === "mcpToolCall") {
    sawMcpCall = true;
    return;
  }

  if (event.method === "item/agentMessage/delta") {
    assistantText += event.params?.delta || "";
    return;
  }

  if (event.method === "item/completed" && event.params?.item?.type === "agentMessage") {
    assistantText ||= event.params.item.text || "";
    return;
  }

  if (event.method === "turn/completed") {
    const status = event.params?.turn?.status;
    if (status !== "completed") {
      fail(`Turn finished with status ${status || "unknown"}.`);
      return;
    }
    if (!sawMcpReady) {
      fail("The ChessCave MCP server never reported ready.");
      return;
    }
    if (!sawMcpCall) {
      fail("Codex answered without calling the ChessCave MCP tool.");
      return;
    }
    if (!assistantText.trim()) {
      fail("Codex completed without an assistant message.");
      return;
    }

    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          threadId,
          mcpReady: sawMcpReady,
          mcpCalled: sawMcpCall,
          response: assistantText.trim(),
        },
        null,
        2,
      ) + "\n",
    );
    close(0);
  }
});

send({
  method: "initialize",
  id: 0,
  params: {
    clientInfo: {
      name: "chesscave_smoke",
      title: "ChessCave smoke test",
      version: "0.1.0",
    },
  },
});
send({ method: "initialized", params: {} });
send({
  method: "thread/start",
  id: 1,
  params: {
    cwd: "/tmp",
    approvalPolicy: "never",
    sandbox: "read-only",
    personality: "friendly",
    ephemeral: true,
    serviceName: "chesscave",
    developerInstructions:
      "You are a chess coach. Always call the ChessCave MCP server before making concrete move recommendations. Do not use shell commands or unrelated tools.",
  },
});
