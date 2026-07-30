# ChessCave

ChessCave is a private Tauri desktop study for reviewing chess games with
Stockfish and discussing positions with a Codex-powered coach.

The first milestone includes:

- a custom Svelte chessboard with legal moves and non-destructive variation
  branching;
- Neo board-piece artwork with identity-preserving move animation;
- PGN import, move navigation, local study restoration, and orientation-aware
  player strips with ratings and timeline-synchronized clocks;
- offline ECO opening recognition from 3,807 pinned Lichess positions;
- one-pass, whole-game Stockfish reviews persisted to the desktop data folder;
- instant per-ply evaluation, WDL, expected-points classification, and MultiPV
  playback after the review completes;
- a local read-only MCP server for engine analysis, whole-game review, and
  clock-addressable PNG board images;
- a streamed Codex app-server sidebar with live thinking, MCP, waiting, and
  replying states, isolated behind the Tauri backend.

## System dependency

ChessCave resolves `stockfish` from the process `PATH`. On NixOS, install it
system-wide in `configuration.nix`:

```nix
environment.systemPackages = with pkgs; [
  stockfish
];
```

Apply the configuration with `sudo nixos-rebuild switch`, then open a new
terminal and confirm `command -v stockfish` returns a path. The optional
`CHESSCAVE_STOCKFISH_PATH` environment variable remains available for
non-standard installations; ChessCave no longer scans fixed directories or the
Nix store.

## Development

The checked-in Nix shell still provides Rust and Tauri's native Linux build
dependencies when your system configuration does not:

```sh
nix-shell
bun install
bun run tauri dev
```

If those build dependencies are already installed system-wide, run the last
two commands directly. `CHESSCAVE_CODEX_PATH` and `CHESSCAVE_NODE_PATH` can
override the other executable names when necessary.

In the analysis desk, Left/Right move backward and forward through the active
line. Keyboard navigation is disabled while typing in a form field.
Reviewed non-book moves show Stockfish's saved best alternative as a green
arrow unless the played move was already best.

Right-drag on the board to draw a yellow analysis arrow. Hold Shift for green,
Ctrl for red, or Alt for blue. Right-click a single square to highlight it;
left-clicking or changing position clears personal annotations.

## Opening data

The opening index is generated from the CC0
[`lichess-org/chess-openings`](https://github.com/lichess-org/chess-openings)
dataset pinned under `data/openings/`. It is bundled with the app and never
requires an opening API. See [data/openings/README.md](data/openings/README.md)
for the pinned revision and regeneration command.

## Verification

```sh
bun run check
bun test
bun run build
cargo test --manifest-path src-tauri/Cargo.toml
bun run smoke:coach
```

The final smoke command uses the local Codex login and performs a live
app-server → ChessCave MCP → Stockfish round trip.

## Architecture

The Svelte webview owns presentation and transient interaction. The Rust host
owns Stockfish, Codex, filesystem paths, and process lifecycle. Codex receives a
read-only chess coaching thread and uses ChessCave MCP tools for objective move
analysis. See [docs/architecture.md](docs/architecture.md) and
[docs/game-review.md](docs/game-review.md).

Stockfish is GPLv3. Any distributed build that bundles it must include the
licence and corresponding-source information required by Stockfish's terms.
