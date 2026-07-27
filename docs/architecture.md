# ChessCave architecture

## Foundation

```text
Svelte webview
  ├─ board and legal move interaction
  ├─ PGN timeline
  ├─ offline ECO opening recognition
  ├─ cached review presentation
  └─ streamed coach conversation
          │ Tauri commands/events
Rust host
  ├─ UCI engine adapter ── one-pass Stockfish review
  │                         └─ durable JSON snapshot per game/settings key
  └─ Codex gateway ── codex app-server
                         └─ stdio MCP ── ChessCave engine tools
```

Chess state crosses boundaries as FEN, moves as UCI/SAN, and complete games as
PGN. These formats keep future practice modes independent of the board
renderer, engine process, and coach UI.

## Current contracts

- `GameRecord` owns headers, moves, and immutable per-ply snapshots containing
  FEN, last-move geometry, and both players' remaining clock time. PGN
  `[%clk ...]` annotations advance the relevant clock while `TimeControl`,
  `WhiteClock`, and `BlackClock` initialize it.
- The bundled CC0 Lichess opening index maps normalized four-field FENs to ECO
  names. The UI walks backward to the deepest named position, so recognition
  survives transpositions and remains visible after leaving theory.
- `VariationLine` owns an exploratory branch rooted at a mainline ply. Creating
  or extending it never truncates or rewrites `GameRecord`.
- `review_game` sends every snapshot through one Stockfish process using the
  same node budget, persists the resulting `GameReview`, and returns that
  snapshot on later opens.
- `analyze_position` returns normalized White-perspective scores and MultiPV
  lines for MCP and exploratory coach requests. Each variation position is
  analyzed once per session and cached by FEN; mainline timeline navigation
  reads the persisted `GameReview` and never calls it.
- The automatic green review arrow reads `MoveReview.bestMove`, which belongs
  to the pre-move position. Personal arrows and square highlights remain
  transient webview state and clear when the selected position changes.
- `compare_moves` evaluates a played UCI move against the engine's best move.
- `get_game_review` gives the coach read-only access to the persisted
  `GameReview`. It can return aggregate accuracy, rank the largest
  expected-points losses for either side, or page through the full move list
  with best moves, MultiPV candidates, evaluations, and continuations without
  running Stockfish again.
- `CoachState` owns one app-server child and one ephemeral thread.
- App-server JSONL is forwarded to Svelte as `chesscave://coach-event`.

The app-server integration is intentionally contained in `src-tauri/src/codex.rs`
because the upstream protocol is experimental and version-specific.

The game-review path reuses one configured Stockfish child for the entire game.
MCP and variation analysis remain isolated short-lived requests because they
are exploratory and must not mutate the saved review. Selecting a mainline move
leaves any explored variation intact while restoring the original position and
stored evaluation. A supervised engine scheduler is still the next
infrastructure step before real-time play mode, where search cancellation and
resource arbitration become important.

## Safety boundary

The coach thread runs in a dedicated application-data directory with a
read-only sandbox, approval policy `never`, and the Codex shell tool disabled.
The ChessCave MCP tools are declared read-only, idempotent, and closed-world.

## Extension points

Opening drills, puzzles, endgames, and historical games should produce the same
position contract:

```text
position + objective + accepted moves + feedback + completion
```

They can therefore reuse the board, Stockfish adapter, coach context, and
event-stream UI without introducing mode-specific engine or Codex processes.
