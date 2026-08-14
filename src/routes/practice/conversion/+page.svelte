<script lang="ts">
  import { onMount } from "svelte";
  import { Chess, type Square } from "chess.js";
  import AppHeader from "$lib/components/AppHeader.svelte";
  import ChessBoard from "$lib/components/ChessBoard.svelte";
  import PlayerStrip from "$lib/components/PlayerStrip.svelte";
  import {
    CHESSCOM_USERNAME_STORAGE_KEY,
    STUDY_STORAGE_KEY,
  } from "$lib/chess/chesscom";
  import {
    expectedPointsForSide,
    findConversionExercises,
    loadConversionAttempts,
    PRACTICE_LAUNCH_STORAGE_KEY,
    practiceDepth,
    practiceExerciseAtPly,
    saveConversionAttempt,
    selectPracticeMove,
    sideForUsername,
    type ConversionAttemptRecord,
    type ConversionExercise,
    type PracticeDifficulty,
    type PracticeLaunch,
  } from "$lib/chess/conversion";
  import { parsePgn } from "$lib/chess/game";
  import { formatClock } from "$lib/chess/time";
  import type { GameRecord, GameReview, Side } from "$lib/chess/types";
  import {
    analyzePosition,
    getEngineStatus,
    hasNativeHost,
    reviewGame,
  } from "$lib/services/native";

  type AttemptStatus =
    | "ready"
    | "player"
    | "engine"
    | "engine-error"
    | "complete";
  type AttemptResult = ConversionAttemptRecord["result"];
  type AttemptMove = { san: string; color: Side; player: boolean };
  type TrajectoryPoint = { san: string; expectedPoints: number | null };

  let game = $state<GameRecord | null>(null);
  let review = $state<GameReview | null>(null);
  let playerSide = $state<Side | null>(null);
  let exercises = $state<ConversionExercise[]>([]);
  let exerciseIndex = $state(0);
  let loading = $state(true);
  let loadingDetail = $state("Opening your active study…");
  let loadError = $state("");
  let status = $state<AttemptStatus>("ready");
  let difficulty = $state<PracticeDifficulty>("club");
  let useClock = $state(true);
  let boardFen = $state("");
  let selected = $state<string | null>(null);
  let lastMove = $state<{ from: string; to: string } | null>(null);
  let clocks = $state<Record<Side, number | null>>({ w: null, b: null });
  let attemptMoves = $state<AttemptMove[]>([]);
  let trajectory = $state<TrajectoryPoint[]>([]);
  let attemptResult = $state<AttemptResult | null>(null);
  let finishMessage = $state("");
  let engineError = $state("");
  let attemptGeneration = 0;
  let history = $state<ConversionAttemptRecord[]>([]);

  const exercise = $derived(exercises[exerciseIndex] ?? null);
  const flipped = $derived(playerSide === "b");
  const boardPosition = $derived(boardFen ? new Chess(boardFen) : null);
  const legalTargets = $derived.by(() => {
    if (!selected || !boardPosition || status !== "player") return [];
    return boardPosition
      .moves({ square: selected as Square, verbose: true })
      .map((move) => move.to);
  });
  const playerName = $derived(
    playerSide === "w"
      ? game?.headers.White || "White"
      : game?.headers.Black || "Black",
  );
  const opponentSide = $derived<Side>(playerSide === "b" ? "w" : "b");
  const opponentName = $derived(
    opponentSide === "w"
      ? game?.headers.White || "White"
      : game?.headers.Black || "Black",
  );
  const attemptsForExercise = $derived(
    exercise
      ? history.filter((attempt) => attempt.exerciseId === exercise.id)
      : [],
  );
  const winsForExercise = $derived(
    attemptsForExercise.filter((attempt) => attempt.result === "win").length,
  );
  const lowestExpectedPoints = $derived.by(() => {
    const values = trajectory
      .map((point) => point.expectedPoints)
      .filter((value): value is number => value !== null);
    return values.length ? Math.min(...values) : null;
  });
  const firstSlip = $derived.by(() => {
    let previous = exercise?.startingExpectedPoints ?? null;
    for (const point of trajectory) {
      if (point.expectedPoints === null) continue;
      if (
        previous !== null &&
        (previous - point.expectedPoints >= 0.12 || point.expectedPoints < 0.62)
      ) {
        return { ...point, before: previous };
      }
      previous = point.expectedPoints;
    }
    return null;
  });

  onMount(() => {
    let disposed = false;
    const timer = window.setInterval(() => {
      if (
        status !== "player" ||
        !useClock ||
        !playerSide ||
        clocks[playerSide] === null
      ) {
        return;
      }
      const remaining = Math.max(0, (clocks[playerSide] ?? 0) - 1);
      clocks = { ...clocks, [playerSide]: remaining };
      if (remaining === 0) finishAttempt("time", "Your original clock ran out.");
    }, 1000);

    void (async () => {
      try {
        if (!hasNativeHost()) {
          throw new Error("Conversion training needs the ChessCave desktop app and Stockfish.");
        }
        const launch = JSON.parse(
          localStorage.getItem(PRACTICE_LAUNCH_STORAGE_KEY) ?? "null",
        ) as PracticeLaunch | null;
        localStorage.removeItem(PRACTICE_LAUNCH_STORAGE_KEY);
        const saved = JSON.parse(
          localStorage.getItem(STUDY_STORAGE_KEY) ?? "null",
        ) as { pgn?: string } | null;
        const launchIsFresh =
          launch && Date.now() - launch.createdAtMs < 10 * 60 * 1000;
        const sourcePgn = launchIsFresh ? launch.pgn : saved?.pgn;
        if (!sourcePgn) {
          throw new Error("Open a game in Study first, then return to Conversion.");
        }
        const nextGame = parsePgn(sourcePgn);
        if (!nextGame.moves.length) throw new Error("The active study has no moves.");
        game = nextGame;
        history = loadConversionAttempts();

        loadingDetail = "Checking Stockfish…";
        const engine = await getEngineStatus();
        if (!engine.available) throw new Error(engine.message);

        loadingDetail = "Loading the game review…";
        const nextReview = await reviewGame(nextGame);
        if (disposed) return;
        review = nextReview;
        if (launchIsFresh) {
          playerSide = launch.side;
          const replay = practiceExerciseAtPly(
            nextGame,
            nextReview,
            launch.side,
            launch.startPly,
            launch.title,
          );
          if (replay) {
            exercises = [replay];
            selectExercise(0);
            return;
          }
        }
        const username = localStorage.getItem(CHESSCOM_USERNAME_STORAGE_KEY);
        const detectedSide = sideForUsername(nextGame, username);
        if (detectedSide) chooseSide(detectedSide);
      } catch (error) {
        if (!disposed) {
          loadError = error instanceof Error ? error.message : String(error);
        }
      } finally {
        if (!disposed) loading = false;
      }
    })();

    return () => {
      disposed = true;
      attemptGeneration += 1;
      window.clearInterval(timer);
    };
  });

  function chooseSide(side: Side) {
    if (!game || !review) return;
    playerSide = side;
    exercises = findConversionExercises(game, review, side);
    selectExercise(0);
  }

  function selectExercise(index: number) {
    exerciseIndex = Math.max(0, Math.min(exercises.length - 1, index));
    const next = exercises[exerciseIndex];
    attemptGeneration += 1;
    status = "ready";
    attemptResult = null;
    finishMessage = "";
    engineError = "";
    selected = null;
    attemptMoves = [];
    trajectory = [];
    if (next) {
      boardFen = next.startFen;
      lastMove = game?.snapshots[next.startPly].lastMove ?? null;
      clocks = { ...next.clocks };
      useClock = next.clocks[next.side] !== null;
    }
  }

  function incrementSeconds(): number {
    const value = game?.headers.TimeControl ?? "";
    const match = value.match(/(?:^|:)\d+\+(\d+)(?:$|:)/);
    return match ? Number(match[1]) : 0;
  }

  function startAttempt() {
    if (!exercise) return;
    attemptGeneration += 1;
    status = "player";
    attemptResult = null;
    finishMessage = "";
    engineError = "";
    boardFen = exercise.startFen;
    lastMove = game?.snapshots[exercise.startPly].lastMove ?? null;
    clocks = { ...exercise.clocks };
    selected = null;
    attemptMoves = [];
    trajectory = [];
  }

  function handleSquare(square: string) {
    if (status !== "player" || !boardPosition || !playerSide) return;
    const piece = boardPosition.get(square as Square);
    if (!selected) {
      if (piece?.color === playerSide) selected = square;
      return;
    }
    if (selected === square) {
      selected = null;
      return;
    }
    if (!legalTargets.includes(square as Square)) {
      selected = piece?.color === playerSide ? square : null;
      return;
    }

    const position = new Chess(boardFen);
    const from = selected;
    selected = null;
    try {
      const move = position.move({ from, to: square, promotion: "q" });
      boardFen = position.fen();
      lastMove = { from: move.from, to: move.to };
      attemptMoves = [
        ...attemptMoves,
        { san: move.san, color: move.color, player: true },
      ];
      if (useClock && clocks[playerSide] !== null) {
        clocks = {
          ...clocks,
          [playerSide]: (clocks[playerSide] ?? 0) + incrementSeconds(),
        };
      }
      const terminal = terminalResult(position);
      if (terminal) {
        finishAttempt(terminal.result, terminal.message);
        return;
      }
      status = "engine";
      void requestEngineMove(boardFen, ++attemptGeneration);
    } catch {
      selected = null;
    }
  }

  async function requestEngineMove(fen: string, generation: number) {
    if (!playerSide) return;
    engineError = "";
    try {
      const analysis = await analyzePosition(
        fen,
        practiceDepth(difficulty),
        5,
      );
      if (generation !== attemptGeneration || status !== "engine") return;
      const playerMove = [...attemptMoves].reverse().find((move) => move.player);
      trajectory = [
        ...trajectory,
        {
          san: playerMove?.san ?? "Move",
          expectedPoints: expectedPointsForSide(analysis.lines[0], playerSide),
        },
      ];
      const uci = selectPracticeMove(analysis.lines, difficulty);
      if (!uci) throw new Error("Stockfish did not return a playable reply.");
      const position = new Chess(fen);
      const move = position.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4] || "q",
      });
      boardFen = position.fen();
      lastMove = { from: move.from, to: move.to };
      attemptMoves = [
        ...attemptMoves,
        { san: move.san, color: move.color, player: false },
      ];
      const terminal = terminalResult(position);
      if (terminal) {
        finishAttempt(terminal.result, terminal.message);
      } else {
        status = "player";
      }
    } catch (error) {
      if (generation !== attemptGeneration) return;
      engineError = error instanceof Error ? error.message : String(error);
      status = "engine-error";
    }
  }

  function retryEngineMove() {
    if (status !== "engine-error") return;
    status = "engine";
    void requestEngineMove(boardFen, ++attemptGeneration);
  }

  function terminalResult(
    position: Chess,
  ): { result: AttemptResult; message: string } | null {
    if (!position.isGameOver() || !playerSide) return null;
    if (position.isCheckmate()) {
      return position.turn() === playerSide
        ? { result: "loss", message: "Stockfish delivered checkmate." }
        : { result: "win", message: "You converted the advantage into checkmate." };
    }
    if (position.isStalemate()) {
      return { result: "draw", message: "Stalemate: the winning chances disappeared." };
    }
    return { result: "draw", message: "The game ended in a draw." };
  }

  function finishAttempt(result: AttemptResult, message: string) {
    if (status === "complete" || !exercise || !playerSide) return;
    attemptGeneration += 1;
    status = "complete";
    selected = null;
    attemptResult = result;
    finishMessage = message;
    const record: ConversionAttemptRecord = {
      id: crypto.randomUUID(),
      exerciseId: exercise.id,
      gameKey: exercise.gameKey,
      side: playerSide,
      finishedAtMs: Date.now(),
      result,
      moveCount: attemptMoves.filter((move) => move.player).length,
      lowestExpectedPoints,
    };
    saveConversionAttempt(record);
    history = loadConversionAttempts();
  }

  function resultTitle(result: AttemptResult | null): string {
    if (result === "win") return "Position converted";
    if (result === "draw") return "The win became a draw";
    if (result === "time") return "Flagged under the original clock";
    if (result === "stopped") return "Attempt reviewed early";
    return "Stockfish escaped";
  }

  function exerciseTitle(item: ConversionExercise): string {
    if (item.title) return item.title;
    if (item.kind === "convert") return "Close it out";
    if (item.kind === "rescue") return "Save the win";
    return "Replay key moment";
  }

  function phaseLabel(value: string): string {
    return value[0].toUpperCase() + value.slice(1);
  }

  function leakLabel(item: ConversionExercise): string {
    if (item.leak === "tactical") return "A single tactical drop decided the original game.";
    if (item.leak === "time") return "The original turning point came with under 30 seconds.";
    if (item.leak === "endgame") return "The advantage leaked in an endgame position.";
    return "The original advantage faded over several decisions.";
  }
</script>

<svelte:head>
  <title>Conversion Trainer — ChessCave</title>
  <meta
    name="description"
    content="Replay winning positions from your own games and practice converting them."
  />
</svelte:head>

<div class="app-shell">
  {#snippet headerActions()}
    <a class="study-link" href="/study">Return to study</a>
  {/snippet}

  <AppHeader
    active="study"
    title="Conversion Trainer"
    subtitle="Turn advantages into points"
    actions={headerActions}
  />

  <main>
    {#if loading}
      <section class="state-card loading-card">
        <span class="spinner" aria-hidden="true"></span>
        <p>{loadingDetail}</p>
      </section>
    {:else if loadError}
      <section class="state-card">
        <span class="eyebrow">TRAINING UNAVAILABLE</span>
        <h2>There is no position to load yet.</h2>
        <p>{loadError}</p>
        <a class="primary-link" href="/study">Open Study</a>
      </section>
    {:else if !playerSide}
      <section class="state-card">
        <span class="eyebrow">CHOOSE YOUR SIDE</span>
        <h2>Which player were you?</h2>
        <p>This imported PGN is not tied to your saved Chess.com username.</p>
        <div class="side-options">
          <button type="button" onclick={() => chooseSide("w")}>
            White · {game?.headers.White || "White"}
          </button>
          <button type="button" onclick={() => chooseSide("b")}>
            Black · {game?.headers.Black || "Black"}
          </button>
        </div>
      </section>
    {:else if !exercises.length}
      <section class="state-card">
        <span class="eyebrow">NO FAILED CONVERSION</span>
        <h2>This game does not contain the target pattern.</h2>
        <p>
          ChessCave looks for a game you did not win after reaching at least 75%
          expected score. Open another reviewed loss or draw and try again.
        </p>
        <div class="side-options">
          <a class="primary-link" href="/">Choose another game</a>
          <button type="button" onclick={() => chooseSide(playerSide === "w" ? "b" : "w")}>
            Check the other side
          </button>
        </div>
      </section>
    {:else if exercise}
      <div class="trainer-grid">
        <aside class="brief-panel">
          <span class="eyebrow">{exercise.kind === "replay" ? "WEEKLY HIGHLIGHT" : "FAILED WIN · YOUR GAME"}</span>
          <h2>{exerciseTitle(exercise)}</h2>
          <p class="brief-copy">
            {exercise.kind === "replay"
              ? "Take over at this highlighted decision and play the position forward."
              : exercise.kind === "convert"
              ? "Play from the first stable advantage and finish the game."
              : "Replay the critical moment before the advantage disappeared."}
          </p>

          <div class="exercise-tabs" aria-label="Conversion exercises">
            {#each exercises as item, index}
              <button
                class:active={exerciseIndex === index}
                type="button"
                onclick={() => selectExercise(index)}
              >
                <span>{index + 1}</span>
                <div>
                  <strong>{exerciseTitle(item)}</strong>
                  <small>Move {Math.floor(item.startPly / 2) + 1}</small>
                </div>
              </button>
            {/each}
          </div>

          <dl class="position-facts">
            <div>
              <dt>Starting edge</dt>
              <dd>{Math.round(exercise.startingExpectedPoints * 100)}%</dd>
            </div>
            <div>
              <dt>Phase</dt>
              <dd>{phaseLabel(exercise.phase)}</dd>
            </div>
            <div>
              <dt>Original result</dt>
              <dd>{phaseLabel(exercise.sourceOutcome)}</dd>
            </div>
          </dl>

          {#if status === "ready"}
            <div class="setup">
              <label>
                Sparring strength
                <select bind:value={difficulty}>
                  <option value="supportive">Supportive</option>
                  <option value="club">Club</option>
                  <option value="strong">Strong</option>
                </select>
              </label>
              <label class:disabled={exercise.clocks[playerSide] === null} class="clock-toggle">
                <input
                  type="checkbox"
                  bind:checked={useClock}
                  disabled={exercise.clocks[playerSide] === null}
                />
                Use my original clock
              </label>
              <button class="start-button" type="button" onclick={startAttempt}>
                Start attempt
              </button>
            </div>
          {:else if status === "complete"}
            <div class={`result-card ${attemptResult}`}>
              <span>{attemptResult === "win" ? "SUCCESS" : "ATTEMPT COMPLETE"}</span>
              <strong>{resultTitle(attemptResult)}</strong>
              <p>{finishMessage}</p>
            </div>
            <button class="start-button" type="button" onclick={startAttempt}>
              Try the position again
            </button>
          {:else}
            <div class="live-note">
              <i></i>
              <span>
                {status === "player"
                  ? "Your move"
                  : status === "engine-error"
                    ? "Engine reply interrupted"
                    : "Stockfish is choosing a practical reply…"}
              </span>
            </div>
            <button
              class="stop-button"
              type="button"
              onclick={() => finishAttempt("stopped", "You ended the attempt before the game finished.")}
            >End and review</button>
          {/if}

          <div class="progress-note">
            <strong>{winsForExercise} conversion{winsForExercise === 1 ? "" : "s"}</strong>
            <span>{attemptsForExercise.length} recorded attempt{attemptsForExercise.length === 1 ? "" : "s"}</span>
          </div>
        </aside>

        <section class="board-panel" aria-label="Conversion board">
          <div class="player-row top">
            <PlayerStrip
              side={opponentSide}
              name={opponentName}
              rating={null}
              clock={clocks[opponentSide]}
              active={status === "engine" || status === "engine-error"}
            />
          </div>
          <div class="board-wrap">
            <ChessBoard
              fen={boardFen}
              {flipped}
              {lastMove}
              {selected}
              {legalTargets}
              onSquareClick={handleSquare}
            />
            {#if status === "ready"}
              <div class="board-shade">
                <span>POSITION READY</span>
                <strong>{playerName} to move</strong>
              </div>
            {:else if status === "engine"}
              <div class="thinking-chip"><i></i>Stockfish thinking</div>
            {:else if status === "engine-error"}
              <div class="board-error">
                <strong>Engine reply failed</strong>
                <span>{engineError}</span>
                <button type="button" onclick={retryEngineMove}>Try reply again</button>
              </div>
            {/if}
          </div>
          <div class="player-row bottom">
            <PlayerStrip
              side={playerSide}
              name={playerName}
              rating={null}
              clock={clocks[playerSide]}
              active={status === "player"}
            />
          </div>
          <div class="hidden-engine">
            <span>Engine help hidden</span>
            <p>Checks · captures · threats · remove counterplay</p>
          </div>
        </section>

        <aside class="review-panel">
          <header>
            <span class="eyebrow">ATTEMPT</span>
            <h2>{status === "complete" ? "What happened" : "Move record"}</h2>
          </header>

          {#if status === "complete"}
            <div class="attempt-metrics">
              <div>
                <span>Started</span>
                <strong>{Math.round(exercise.startingExpectedPoints * 100)}%</strong>
              </div>
              <div>
                <span>Lowest measured</span>
                <strong>{lowestExpectedPoints === null ? "—" : `${Math.round(lowestExpectedPoints * 100)}%`}</strong>
              </div>
            </div>

            <div class="feedback-block">
              <span>THIS ATTEMPT</span>
              {#if firstSlip}
                <strong>Control first slipped after {firstSlip.san}.</strong>
                <p>
                  Expected score moved from {Math.round(firstSlip.before * 100)}%
                  to {Math.round((firstSlip.expectedPoints ?? 0) * 100)}%.
                </p>
              {:else if attemptResult === "win"}
                <strong>You kept the position under control.</strong>
                <p>Repeat it once more to make the technique reliable.</p>
              {:else}
                <strong>No single large drop was measured.</strong>
                <p>The result came from accumulated decisions or the final game-ending move.</p>
              {/if}
            </div>

            <div class="feedback-block original">
              <span>ORIGINAL GAME</span>
              <strong>{leakLabel(exercise)}</strong>
              {#if exercise.criticalMove}
                <p>
                  The first critical move was
                  {Math.ceil(exercise.criticalMove.ply / 2)}{exercise.criticalMove.color === "b" ? "…" : "."}
                  {exercise.criticalMove.san}.
                </p>
              {/if}
            </div>
          {:else}
            <div class="move-record">
              {#if !attemptMoves.length}
                <p>Your moves will appear here. Evaluation stays hidden until the attempt ends.</p>
              {:else}
                {#each attemptMoves as move, index}
                  {@const absolutePly = exercise.startPly + index + 1}
                  {#if absolutePly % 2 === 1}
                    <span class="move-number">{Math.ceil(absolutePly / 2)}.</span>
                  {:else if index === 0}
                    <span class="move-number">{Math.ceil(absolutePly / 2)}…</span>
                  {/if}
                  <span class:player-move={move.player}>{move.san}</span>
                {/each}
              {/if}
            </div>
            <div class="checklist">
              <span>BEFORE EVERY MOVE</span>
              <ol>
                <li>What is the opponent threatening?</li>
                <li>Check forcing moves for both sides.</li>
                <li>Reduce counterplay before rushing.</li>
                <li>Trade pieces only when it helps.</li>
              </ol>
            </div>
          {/if}
        </aside>
      </div>
    {/if}
  </main>
</div>

<style>
  .app-shell {
    height: 100%;
    background:
      radial-gradient(circle at 22% 16%, rgba(204, 107, 80, 0.08), transparent 30%),
      var(--paper);
  }

  main {
    height: calc(100% - 69px);
    overflow: auto;
  }

  .study-link,
  .primary-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 8px 13px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    color: var(--ink-soft);
    background: var(--pearl-raised);
    font-size: 12px;
    font-weight: 650;
    text-decoration: none;
  }

  .trainer-grid {
    display: grid;
    grid-template-columns: minmax(250px, 0.78fr) minmax(440px, 1.45fr) minmax(270px, 0.85fr);
    gap: 22px;
    width: min(1500px, 100%);
    min-height: 100%;
    margin: 0 auto;
    padding: 24px 28px 32px;
  }

  .brief-panel,
  .review-panel {
    align-self: start;
    padding: 24px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: rgba(255, 253, 248, 0.86);
    box-shadow: 0 12px 32px rgba(66, 52, 42, 0.06);
  }

  .eyebrow,
  .feedback-block > span,
  .checklist > span,
  .result-card > span {
    color: var(--coral-dark);
    font-size: 10px;
    font-weight: 780;
    letter-spacing: 0.13em;
  }

  h2 {
    margin: 8px 0 0;
    font-family: var(--display);
    font-size: 27px;
    font-variation-settings: "opsz" 28, "wght" 620;
  }

  .brief-copy,
  .state-card p,
  .move-record p,
  .feedback-block p {
    color: var(--muted);
    font-size: 13px;
    line-height: 1.55;
  }

  .exercise-tabs {
    display: grid;
    gap: 7px;
    margin: 22px 0;
  }

  .exercise-tabs button {
    display: flex;
    gap: 11px;
    align-items: center;
    width: 100%;
    padding: 10px;
    border: 1px solid var(--line);
    border-radius: 10px;
    color: var(--ink-soft);
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .exercise-tabs button > span {
    display: grid;
    width: 27px;
    height: 27px;
    place-items: center;
    border-radius: 50%;
    color: var(--muted);
    background: var(--paper);
    font-size: 11px;
  }

  .exercise-tabs button div {
    display: grid;
    gap: 2px;
  }

  .exercise-tabs small {
    color: var(--muted);
  }

  .exercise-tabs button.active {
    border-color: #d7a28f;
    background: var(--coral-soft);
  }

  .exercise-tabs button.active > span {
    color: white;
    background: var(--coral-dark);
  }

  .position-facts {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    margin: 0 0 22px;
    border-block: 1px solid var(--line);
  }

  .position-facts div {
    display: grid;
    gap: 5px;
    padding: 13px 7px;
    text-align: center;
  }

  .position-facts div + div {
    border-left: 1px solid var(--line);
  }

  dt {
    color: var(--muted);
    font-size: 9px;
    text-transform: uppercase;
  }

  dd {
    margin: 0;
    font-size: 12px;
    font-weight: 720;
  }

  .setup {
    display: grid;
    gap: 13px;
  }

  .setup label:not(.clock-toggle) {
    display: grid;
    gap: 7px;
    color: var(--ink-soft);
    font-size: 11px;
    font-weight: 650;
  }

  select {
    width: 100%;
    padding: 9px 10px;
    border: 1px solid var(--line-strong);
    border-radius: 8px;
    color: var(--ink);
    background: var(--pearl-raised);
  }

  .clock-toggle {
    display: flex;
    gap: 8px;
    align-items: center;
    color: var(--ink-soft);
    font-size: 12px;
  }

  .clock-toggle.disabled {
    opacity: 0.5;
  }

  .start-button {
    width: 100%;
    padding: 11px 15px;
    border: 0;
    border-radius: 9px;
    color: white;
    background: var(--coral-dark);
    font-weight: 720;
    cursor: pointer;
  }

  .stop-button {
    margin-top: 12px;
    padding: 7px 0;
    border: 0;
    color: var(--muted);
    background: transparent;
    font-size: 11px;
    text-decoration: underline;
    cursor: pointer;
  }

  .live-note {
    display: flex;
    gap: 9px;
    align-items: center;
    padding: 12px;
    border-radius: 9px;
    color: var(--sage);
    background: var(--sage-soft);
    font-size: 12px;
    font-weight: 650;
  }

  .live-note i,
  .thinking-chip i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
    animation: pulse 1.25s ease-in-out infinite;
  }

  .progress-note {
    display: flex;
    justify-content: space-between;
    margin-top: 20px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 10px;
  }

  .progress-note strong {
    color: var(--ink-soft);
  }

  .result-card {
    display: grid;
    gap: 6px;
    margin-bottom: 12px;
    padding: 14px;
    border: 1px solid #ddc9ba;
    border-radius: 10px;
    background: #f8eee6;
  }

  .result-card.win {
    border-color: #b9c3aa;
    background: var(--sage-soft);
  }

  .result-card strong {
    font-family: var(--display);
    font-size: 18px;
  }

  .result-card p {
    margin: 0;
    color: var(--muted);
    font-size: 11px;
    line-height: 1.45;
  }

  .board-panel {
    width: min(100%, 700px);
    justify-self: center;
  }

  .player-row {
    margin-left: 34px;
  }

  .player-row.top {
    margin-bottom: 8px;
  }

  .player-row.bottom {
    margin-top: 8px;
  }

  .board-wrap {
    position: relative;
    width: 100%;
  }

  .board-shade {
    position: absolute;
    z-index: 4;
    inset: 0;
    display: grid;
    place-content: center;
    gap: 6px;
    border-radius: 5px;
    color: white;
    background: rgba(36, 31, 27, 0.56);
    text-align: center;
    backdrop-filter: blur(2px);
  }

  .board-shade span {
    font-size: 10px;
    font-weight: 750;
    letter-spacing: 0.15em;
  }

  .board-shade strong {
    font-family: var(--display);
    font-size: 24px;
  }

  .thinking-chip {
    position: absolute;
    z-index: 4;
    right: 12px;
    bottom: 12px;
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 8px 11px;
    border-radius: 999px;
    color: white;
    background: rgba(41, 36, 31, 0.86);
    font-size: 10px;
  }

  .board-error {
    position: absolute;
    z-index: 5;
    inset: 35% 12%;
    display: grid;
    place-content: center;
    gap: 8px;
    padding: 18px;
    border-radius: 12px;
    color: white;
    background: rgba(91, 48, 41, 0.94);
    text-align: center;
  }

  .board-error span {
    font-size: 11px;
  }

  .board-error button {
    justify-self: center;
    padding: 7px 11px;
    border: 0;
    border-radius: 7px;
    cursor: pointer;
  }

  .hidden-engine {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin: 14px 0 0 34px;
    padding: 10px 13px;
    border: 1px dashed var(--line-strong);
    border-radius: 9px;
    color: var(--muted);
    font-size: 10px;
  }

  .hidden-engine span {
    font-weight: 720;
    text-transform: uppercase;
  }

  .hidden-engine p {
    margin: 0;
  }

  .review-panel header {
    padding-bottom: 18px;
    border-bottom: 1px solid var(--line);
  }

  .review-panel h2 {
    font-size: 22px;
  }

  .move-record {
    display: grid;
    grid-template-columns: 26px 1fr 1fr;
    gap: 7px 8px;
    min-height: 105px;
    max-height: 240px;
    padding: 18px 0;
    overflow: auto;
    font-size: 12px;
  }

  .move-record p {
    grid-column: 1 / -1;
    margin: 0;
  }

  .move-number {
    color: var(--faint);
  }

  .player-move {
    color: var(--coral-dark);
    font-weight: 720;
  }

  .checklist {
    padding-top: 17px;
    border-top: 1px solid var(--line);
  }

  .checklist ol {
    display: grid;
    gap: 9px;
    margin: 13px 0 0;
    padding-left: 19px;
    color: var(--ink-soft);
    font-size: 12px;
    line-height: 1.4;
  }

  .attempt-metrics {
    display: grid;
    grid-template-columns: 1fr 1fr;
    margin: 18px 0;
  }

  .attempt-metrics div {
    display: grid;
    gap: 5px;
    text-align: center;
  }

  .attempt-metrics div + div {
    border-left: 1px solid var(--line);
  }

  .attempt-metrics span {
    color: var(--muted);
    font-size: 9px;
    text-transform: uppercase;
  }

  .attempt-metrics strong {
    font-family: var(--display);
    font-size: 24px;
  }

  .feedback-block {
    padding: 16px 0;
    border-top: 1px solid var(--line);
  }

  .feedback-block strong {
    display: block;
    margin-top: 8px;
    font-size: 13px;
    line-height: 1.45;
  }

  .feedback-block p {
    margin-bottom: 0;
    font-size: 11px;
  }

  .feedback-block.original > span {
    color: var(--sage);
  }

  .state-card {
    width: min(560px, calc(100% - 32px));
    margin: 12vh auto 0;
    padding: 34px;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: var(--pearl-raised);
    text-align: center;
    box-shadow: 0 18px 50px rgba(66, 52, 42, 0.08);
  }

  .state-card h2 {
    margin-bottom: 12px;
  }

  .loading-card {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: center;
  }

  .spinner {
    width: 17px;
    height: 17px;
    border: 2px solid var(--line);
    border-top-color: var(--coral);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .side-options {
    display: flex;
    gap: 10px;
    justify-content: center;
    margin-top: 22px;
  }

  .side-options button {
    padding: 9px 13px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    color: var(--ink-soft);
    background: var(--pearl-raised);
    cursor: pointer;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @keyframes pulse {
    50% { opacity: 0.35; transform: scale(0.75); }
  }

  @media (max-width: 1180px) {
    .trainer-grid {
      grid-template-columns: minmax(235px, 0.72fr) minmax(430px, 1.25fr);
    }

    .review-panel {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: 0.55fr 1.45fr;
      gap: 22px;
    }

    .review-panel header {
      border-right: 1px solid var(--line);
      border-bottom: 0;
    }
  }

  @media (max-width: 820px) {
    main {
      height: calc(100% - 63px);
    }

    .trainer-grid {
      grid-template-columns: 1fr;
      padding: 16px;
    }

    .brief-panel,
    .review-panel {
      width: 100%;
    }

    .board-panel {
      grid-row: 1;
    }

    .review-panel {
      grid-column: auto;
      display: block;
    }

    .review-panel header {
      border-right: 0;
      border-bottom: 1px solid var(--line);
    }
  }
</style>
