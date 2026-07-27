<script lang="ts">
  import { onMount } from "svelte";
  import { Chess, type Square } from "chess.js";
  import ChessBoard from "$lib/components/ChessBoard.svelte";
  import CoachSidebar from "$lib/components/CoachSidebar.svelte";
  import EvaluationBar from "$lib/components/EvaluationBar.svelte";
  import MoveList from "$lib/components/MoveList.svelte";
  import MoveBadge from "$lib/components/MoveBadge.svelte";
  import PlayerStrip from "$lib/components/PlayerStrip.svelte";
  import {
    createVariation,
    extendVariation,
    parsePgn,
    positionLabel,
    SAMPLE_PGN,
    sideToMove,
    uciLineToSan,
    variationPositionLabel,
  } from "$lib/chess/game";
  import { bestAlternativeArrow } from "$lib/chess/arrows";
  import {
    deepestOpeningPly,
    loadOpeningBook,
    openingAt,
    type OpeningBook,
  } from "$lib/chess/openings";
  import type {
    AnalysisResult,
    CoachMessage,
    EngineStatus,
    GameReview,
    MoveClassification,
    ReviewProgress,
    Side,
    VariationLine,
  } from "$lib/chess/types";
  import {
    analyzePosition,
    getEngineStatus,
    hasNativeHost,
    newCoachThread,
    onCoachEvent,
    onReviewProgress,
    reviewGame,
    sendCoachMessage,
    startCoach,
  } from "$lib/services/native";

  let game = $state(parsePgn(SAMPLE_PGN));
  let currentPly = $state(16);
  let variation = $state<VariationLine | null>(null);
  let variationPly = $state<number | null>(null);
  let variationAnalyses = $state<Record<string, AnalysisResult>>({});
  let variationPending = $state<Record<string, true>>({});
  let variationError = $state("");
  let flipped = $state(false);
  let selected = $state<string | null>(null);
  let review = $state<GameReview | null>(null);
  let reviewBusy = $state(false);
  let reviewQueued = $state(false);
  let forceQueuedReview = $state(false);
  let reviewError = $state("");
  let reviewProgress = $state<ReviewProgress | null>(null);
  let engine = $state<EngineStatus>({
    available: false,
    name: null,
    path: null,
    message: "Checking Stockfish…",
  });
  let coachStatus = $state<"offline" | "starting" | "ready" | "thinking" | "error">(
    hasNativeHost() ? "starting" : "offline",
  );
  let coachDetail = $state(
    hasNativeHost() ? "Starting Codex app-server…" : "Desktop preview required",
  );
  let coachMessages = $state<CoachMessage[]>([]);
  let importOpen = $state(false);
  let pgnDraft = $state("");
  let importError = $state("");
  let storageReady = $state(false);
  let openingBook = $state<OpeningBook | null>(null);
  let openingError = $state("");

  const exploring = $derived(variation !== null && variationPly !== null);
  const snapshot = $derived(
    exploring
      ? variation!.snapshots[variationPly!]
      : game.snapshots[currentPly],
  );
  const boardPosition = $derived(new Chess(snapshot.fen));
  const legalTargets = $derived.by(() => {
    if (!selected) return [];
    return boardPosition
      .moves({ square: selected as Square, verbose: true })
      .map((move) => move.to);
  });
  const positionReview = $derived(
    exploring
      ? variationAnalyses[snapshot.fen] ?? null
      : review?.positions[currentPly] ?? null,
  );
  const moveReview = $derived(
    !exploring && currentPly > 0
      ? review?.moves[currentPly - 1] ?? null
      : null,
  );
  const principal = $derived(positionReview?.lines[0] ?? null);
  const currentLabel = $derived(
    exploring
      ? variationPositionLabel(variation!, variationPly!)
      : positionLabel(game, currentPly),
  );
  const navigationLabel = $derived(
    exploring
      ? `Variation ${variationPly} / ${variation?.moves.length ?? 0}`
      : `${currentPly} / ${game.moves.length}`,
  );
  const canGoBack = $derived(exploring || currentPly > 0);
  const canGoForward = $derived(
    exploring
      ? variationPly! < (variation?.moves.length ?? 0)
      : currentPly < game.moves.length,
  );
  const variationPositionBusy = $derived(
    exploring && Boolean(variationPending[snapshot.fen]),
  );
  const variationSnapshots = $derived.by(() =>
    variation
      ? [
          ...game.snapshots.slice(0, variation.rootPly + 1),
          ...variation.snapshots.slice(1),
        ]
      : game.snapshots,
  );
  const mainlineBookThrough = $derived(
    deepestOpeningPly(openingBook, game.snapshots),
  );
  const variationBookThrough = $derived(
    variation
      ? Math.max(
          0,
          deepestOpeningPly(openingBook, variationSnapshots) -
            variation.rootPly,
        )
      : 0,
  );
  const currentOpening = $derived(
    openingAt(
      openingBook,
      exploring ? variationSnapshots : game.snapshots,
      exploring ? variation!.rootPly + variationPly! : currentPly,
    ),
  );
  const currentMoveClassification = $derived.by(
    (): MoveClassification | null => {
      if (exploring) {
        return variationPly! <= variationBookThrough ? "book" : null;
      }
      if (currentPly > 0 && currentPly <= mainlineBookThrough) return "book";
      return moveReview?.classification ?? null;
    },
  );
  const bestMoveArrow = $derived.by(() => {
    if (exploring || currentPly <= 0 || !moveReview) return null;
    return bestAlternativeArrow(
      moveReview.uci,
      moveReview.bestMove,
      currentPly <= mainlineBookThrough,
    );
  });
  const bestAlternativeSan = $derived.by(() => {
    if (!bestMoveArrow || currentPly <= 0) return null;
    return (
      uciLineToSan(game.snapshots[currentPly - 1].fen, [
        moveReview!.bestMove!,
      ])[0] ?? moveReview!.bestMove
    );
  });
  const eventTitle = $derived(game.headers.Event || "Untitled game");
  const whitePlayer = $derived({
    side: "w" as Side,
    name: game.headers.White || "White player",
    rating:
      game.headers.WhiteElo && game.headers.WhiteElo !== "?"
        ? game.headers.WhiteElo
        : null,
  });
  const blackPlayer = $derived({
    side: "b" as Side,
    name: game.headers.Black || "Black player",
    rating:
      game.headers.BlackElo && game.headers.BlackElo !== "?"
        ? game.headers.BlackElo
        : null,
  });
  const topPlayer = $derived(flipped ? whitePlayer : blackPlayer);
  const bottomPlayer = $derived(flipped ? blackPlayer : whitePlayer);
  const activeSide = $derived<Side>(
    snapshot.fen.split(/\s+/)[1] === "b" ? "b" : "w",
  );

  $effect(() => {
    if (!storageReady || typeof localStorage === "undefined") return;
    localStorage.setItem(
      "chesscave.study.v1",
      JSON.stringify({ pgn: game.pgn, currentPly }),
    );
  });

  $effect(() => {
    if (!storageReady || typeof localStorage === "undefined") return;
    localStorage.setItem(
      "chesscave.coach-messages.v1",
      JSON.stringify(coachMessages.slice(-40)),
    );
  });

  onMount(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let unlistenReview: (() => void) | undefined;

    void (async () => {
      try {
        const savedStudy = localStorage.getItem("chesscave.study.v1");
        if (savedStudy) {
          const saved = JSON.parse(savedStudy) as { pgn?: string; currentPly?: number };
          if (saved.pgn) {
            const restored = parsePgn(saved.pgn);
            game = restored;
            currentPly = Math.max(
              0,
              Math.min(restored.moves.length, saved.currentPly ?? restored.moves.length),
            );
          }
        }

        const savedMessages = localStorage.getItem("chesscave.coach-messages.v1");
        if (savedMessages) {
          const restored = JSON.parse(savedMessages) as CoachMessage[];
          coachMessages = restored.map((message) => ({ ...message, pending: false }));
        }
      } catch {
        localStorage.removeItem("chesscave.study.v1");
        localStorage.removeItem("chesscave.coach-messages.v1");
      }
      storageReady = true;

      void loadOpeningBook()
        .then((book) => {
          if (!disposed) openingBook = book;
        })
        .catch((error) => {
          if (!disposed) openingError = String(error);
        });

      if (hasNativeHost()) {
        unlistenReview = await onReviewProgress((progress) => {
          reviewProgress = progress;
        });
      }

      engine = await getEngineStatus();
      if (engine.available) void requestGameReview();

      if (!hasNativeHost()) return;
      unlisten = await onCoachEvent(handleCoachEvent);
      try {
        await startCoach();
      } catch (error) {
        if (!disposed) {
          coachStatus = "error";
          coachDetail = String(error);
        }
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
      unlistenReview?.();
    };
  });

  function selectPly(ply: number) {
    currentPly = Math.max(0, Math.min(game.moves.length, ply));
    variationPly = null;
    selected = null;
  }

  function selectVariationPly(ply: number) {
    if (!variation) return;
    variationPly = Math.max(1, Math.min(variation.moves.length, ply));
    selected = null;
    void requestVariationAnalysis(variation.snapshots[variationPly].fen);
  }

  function sameMove(
    move: { from: string; to: string; promotion?: string },
    from: string,
    to: string,
  ) {
    return move.from === from && move.to === to;
  }

  function handleSquare(square: string) {
    const piece = boardPosition.get(square as Square);

    if (!selected) {
      if (piece?.color === boardPosition.turn()) selected = square;
      return;
    }

    if (selected === square) {
      selected = null;
      return;
    }

    if (legalTargets.includes(square as Square)) {
      const from = selected;
      selected = null;

      if (!exploring) {
        const mainlineMove = game.moves[currentPly];
        if (mainlineMove && sameMove(mainlineMove, from, square)) {
          selectPly(currentPly + 1);
          return;
        }

        const nextVariation = createVariation(
          game,
          currentPly,
          from,
          square,
        );
        if (!nextVariation) return;
        variation = nextVariation;
        variationPly = 1;
        void requestVariationAnalysis(nextVariation.snapshots[1].fen);
        return;
      }

      const existingMove = variation!.moves[variationPly!];
      if (existingMove && sameMove(existingMove, from, square)) {
        variationPly = variationPly! + 1;
        void requestVariationAnalysis(variation!.snapshots[variationPly!].fen);
        return;
      }

      const nextVariation = extendVariation(
        variation!,
        variationPly!,
        from,
        square,
      );
      if (!nextVariation) return;
      variation = nextVariation;
      variationPly = variationPly! + 1;
      void requestVariationAnalysis(nextVariation.snapshots[variationPly!].fen);
      return;
    }

    selected = piece?.color === boardPosition.turn() ? square : null;
  }

  async function requestVariationAnalysis(fen: string) {
    if (!engine.available || variationAnalyses[fen] || variationPending[fen]) {
      return;
    }
    variationPending = { ...variationPending, [fen]: true };
    variationError = "";

    try {
      const result = await analyzePosition(fen, 16, 3);
      variationAnalyses = { ...variationAnalyses, [fen]: result };
    } catch (error) {
      if (snapshot.fen === fen) variationError = String(error);
    } finally {
      const { [fen]: _completed, ...remaining } = variationPending;
      variationPending = remaining;
    }
  }

  function stepBackward() {
    if (exploring) {
      if (variationPly! > 1) {
        selectVariationPly(variationPly! - 1);
      } else {
        selectPly(variation!.rootPly);
      }
      return;
    }
    selectPly(currentPly - 1);
  }

  function stepForward() {
    if (exploring) {
      if (variationPly! < variation!.moves.length) {
        selectVariationPly(variationPly! + 1);
      }
      return;
    }
    selectPly(currentPly + 1);
  }

  function goToStart() {
    selectPly(0);
  }

  function goToEnd() {
    selectPly(game.moves.length);
  }

  function handleKeyboardNavigation(event: KeyboardEvent) {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (
      target?.matches("input, textarea, select, [contenteditable='true']")
    ) {
      return;
    }

    if (event.key === "ArrowLeft" && canGoBack) {
      event.preventDefault();
      stepBackward();
    } else if (event.key === "ArrowRight" && canGoForward) {
      event.preventDefault();
      stepForward();
    }
  }

  async function requestGameReview(force = false) {
    if (!engine.available) return;
    if (reviewBusy) {
      reviewQueued = true;
      forceQueuedReview ||= force;
      return;
    }

    const requestedGame = game;
    const requestedPgn = game.pgn;
    reviewBusy = true;
    reviewError = "";
    reviewProgress = {
      gameKey: "",
      completed: 0,
      total: requestedGame.snapshots.length,
      ply: 0,
    };

    try {
      const result = await reviewGame(requestedGame, force);
      if (game.pgn === requestedPgn) review = result;
    } catch (error) {
      if (game.pgn === requestedPgn) reviewError = String(error);
    } finally {
      reviewBusy = false;
      if (reviewQueued) {
        const queuedForce = forceQueuedReview;
        reviewQueued = false;
        forceQueuedReview = false;
        void requestGameReview(queuedForce);
      }
    }
  }

  function importPgn() {
    importError = "";
    try {
      const next = parsePgn(pgnDraft);
      if (!next.moves.length) throw new Error("The PGN does not contain any moves.");
      game = next;
      currentPly = next.moves.length;
      variation = null;
      variationPly = null;
      selected = null;
      review = null;
      importOpen = false;
      pgnDraft = "";
      if (engine.available) void requestGameReview();
    } catch (error) {
      importError = error instanceof Error ? error.message : String(error);
    }
  }

  function coachContext(): string {
    const activeMoves = exploring
      ? [
          ...game.moves.slice(0, variation!.rootPly),
          ...variation!.moves.slice(0, variationPly!),
        ]
      : game.moves.slice(0, currentPly);
    const moves = activeMoves
      .map((move) => move.san)
      .join(" ");
    const lastMove = activeMoves.at(-1) ?? null;
    const previousFen = exploring
      ? variation!.snapshots[variationPly! - 1]?.fen
      : currentPly > 0
        ? game.snapshots[currentPly - 1].fen
        : null;
    const selectedPly = exploring
      ? variation!.rootPly + variationPly!
      : currentPly;
    const recentConversation = coachMessages
      .slice(-6)
      .map((item) => `${item.role === "user" ? "Student" : "Sol"}: ${item.text}`)
      .join("\n");
    return [
      `Game: ${game.headers.White || "White"} vs ${game.headers.Black || "Black"}`,
      ...(review
        ? [
            `Completed whole-game review key: ${review.gameKey}`,
            `Whole-game review: ${review.moves.length} moves analyzed once by ${review.engine}; use the ChessCave MCP get_game_review tool for game-level coaching questions`,
            `Review accuracy: White ${review.summary.whiteAccuracy.toFixed(1)}, Black ${review.summary.blackAccuracy.toFixed(1)}`,
          ]
        : [
            `Whole-game review: ${reviewBusy ? "still running" : "not available"}`,
          ]),
      `Selected position: ${currentLabel} (ply ${selectedPly})`,
      `Line: ${exploring ? "exploratory variation" : "imported game mainline"}`,
      `FEN: ${snapshot.fen}`,
      ...(lastMove
        ? [
            `Previous FEN: ${previousFen}`,
            `Last move: ${lastMove.san} (${lastMove.lan} in UCI notation)`,
          ]
        : []),
      `Moves played: ${moves || "(starting position)"}`,
      `Side to move: ${sideToMove(snapshot.fen)}`,
      ...(currentOpening
        ? [`Opening: ${currentOpening.eco} · ${currentOpening.name}`]
        : []),
      ...(positionReview
        ? [
            `Saved Stockfish review: ${principal?.scoreMate !== null && principal?.scoreMate !== undefined ? `mate ${principal.scoreMate}` : `${((principal?.scoreCp ?? 0) / 100).toFixed(2)} pawns`} from White's perspective`,
            `Stockfish best move: ${positionReview.bestMove ?? "none"}`,
          ]
        : []),
      ...(moveReview
        ? [
            `Last move classification: ${moveReview.classification}`,
            `Expected points lost: ${moveReview.expectedPointsLost.toFixed(3)}`,
          ]
        : []),
      ...(recentConversation ? [`Recent conversation:\n${recentConversation}`] : []),
    ].join("\n");
  }

  async function askCoach(text: string) {
    if (coachStatus !== "ready") return;
    const id = crypto.randomUUID();
    coachMessages = [...coachMessages, { id, role: "user", text }];
    coachStatus = "thinking";
    coachDetail = "Sol is studying the position…";
    try {
      await sendCoachMessage(text, coachContext());
    } catch (error) {
      coachStatus = "error";
      coachDetail = String(error);
    }
  }

  async function startNewCoachConversation() {
    if (!hasNativeHost() || coachStatus === "starting" || coachStatus === "thinking") return;

    coachStatus = "starting";
    coachDetail = "Starting a new conversation…";
    try {
      await newCoachThread();
      coachMessages = [];
    } catch (error) {
      coachStatus = "error";
      coachDetail = String(error);
    }
  }

  function handleCoachEvent(event: Record<string, unknown>) {
    const method = typeof event.method === "string" ? event.method : "";
    const params = (event.params ?? {}) as Record<string, unknown>;

    if (event.id === 1 && event.result) {
      coachStatus = "ready";
      coachDetail = "Current position synced";
      return;
    }

    if (event.error) {
      const error = event.error as Record<string, unknown>;
      coachStatus = "error";
      coachDetail = String(error.message ?? "Codex app-server error");
      return;
    }

    if (method === "chesscave/ready") {
      coachStatus = "ready";
      coachDetail = "Current position synced";
      return;
    }

    if (method === "chesscave/error") {
      coachStatus = "error";
      coachDetail = String(params.message ?? "Codex app-server stopped");
      return;
    }

    if (method === "mcpServer/startupStatus/updated") {
      const status = String(params.status ?? "");
      coachDetail =
        status === "ready"
          ? "Stockfish tools connected"
          : status === "failed"
            ? "Chess tools failed to start"
            : "Connecting chess tools…";
      return;
    }

    if (method === "item/mcpToolCall/progress") {
      coachDetail = "Stockfish is calculating…";
      return;
    }

    if (method === "item/started") {
      const item = params.item as Record<string, unknown> | undefined;
      if (item?.type === "mcpToolCall") coachDetail = "Consulting Stockfish…";
      if (item?.type === "agentMessage") {
        const messageId = String(item.id ?? crypto.randomUUID());
        if (!coachMessages.some((message) => message.id === messageId)) {
          coachMessages = [
            ...coachMessages,
            { id: messageId, role: "assistant", text: "", pending: true },
          ];
        }
      }
      return;
    }

    if (method === "item/agentMessage/delta") {
      const itemId = String(params.itemId ?? params.item_id ?? "active-assistant");
      const delta = String(params.delta ?? "");
      const existing = coachMessages.find((message) => message.id === itemId);
      if (existing) {
        existing.text += delta;
      } else {
        coachMessages = [
          ...coachMessages,
          { id: itemId, role: "assistant", text: delta, pending: true },
        ];
      }
      return;
    }

    if (method === "item/completed") {
      const item = params.item as Record<string, unknown> | undefined;
      if (item?.type === "agentMessage") {
        const itemId = String(item.id ?? "");
        const existing = coachMessages.find((message) => message.id === itemId);
        if (existing) {
          existing.pending = false;
          if (!existing.text && typeof item.text === "string") existing.text = item.text;
        } else if (typeof item.text === "string") {
          coachMessages = [
            ...coachMessages,
            { id: itemId || crypto.randomUUID(), role: "assistant", text: item.text },
          ];
        }
      }
      return;
    }

    if (method === "turn/completed") {
      for (const message of coachMessages) message.pending = false;
      coachStatus = "ready";
      coachDetail = "Current position synced";
    }
  }
</script>

<svelte:head>
  <title>ChessCave — Your private chess study</title>
  <meta
    name="description"
    content="A private chess study powered by Stockfish and your Codex coach."
  />
</svelte:head>

<svelte:window onkeydown={handleKeyboardNavigation} />

<div class="app-shell">
  <nav class="rail" aria-label="Primary navigation">
    <div class="brand-mark">♞</div>
    <div class="rail-items">
      <button class="active" type="button" aria-label="Analysis"><span>⌁</span><small>Study</small></button>
      <button type="button" aria-label="Practice"><span>◈</span><small>Train</small></button>
      <button type="button" aria-label="Games"><span>▤</span><small>Games</small></button>
      <button type="button" aria-label="Openings"><span>⌘</span><small>Lines</small></button>
    </div>
    <button class="settings" type="button" aria-label="Settings">⚙</button>
  </nav>

  <main>
    <header class="topbar">
      <div>
        <div class="breadcrumb"><span>ANALYSIS DESK</span><i></i>{currentOpening?.name || game.headers.Opening || "Game study"}</div>
        <h1>{eventTitle}</h1>
      </div>
      <div class="top-actions">
        <span class:online={engine.available} class="engine-chip">
          <i></i>{engine.available
            ? variationPositionBusy
              ? "Analyzing variation"
              : reviewBusy
                ? `Reviewing ${reviewProgress?.completed ?? 0}/${reviewProgress?.total ?? game.snapshots.length}`
                : review?.cached
                  ? "Review saved"
                  : engine.name || "Stockfish"
            : "Engine offline"}
        </span>
        <button type="button" onclick={() => { pgnDraft = ""; importOpen = true; }}>Import PGN</button>
      </div>
    </header>

    <section class="workspace">
      <div class="study-column">
        <div class="board-stage">
          <div class="player-slot top-player">
            <PlayerStrip
              side={topPlayer.side}
              name={topPlayer.name}
              rating={topPlayer.rating}
              clock={snapshot.clocks[topPlayer.side]}
              active={activeSide === topPlayer.side}
            />
          </div>

          <div class="evaluation-slot">
            <EvaluationBar
              scoreCp={principal?.scoreCp ?? null}
              scoreMate={principal?.scoreMate ?? null}
              {flipped}
            />
          </div>

          <div class="board-wrap">
            <ChessBoard
              fen={snapshot.fen}
              {flipped}
              lastMove={snapshot.lastMove}
              {selected}
              {legalTargets}
              annotation={currentMoveClassification}
              engineArrow={bestMoveArrow}
              onSquareClick={handleSquare}
            />
          </div>
          <div class="board-tools">
            <button type="button" title="Flip board" onclick={() => (flipped = !flipped)}>↻</button>
            <button
              class:working={reviewBusy}
              type="button"
              title="Re-run the complete game review"
              disabled={!engine.available || reviewBusy}
              onclick={() => requestGameReview(true)}
            >✦</button>
          </div>

          <div class="player-slot bottom-player">
            <PlayerStrip
              side={bottomPlayer.side}
              name={bottomPlayer.name}
              rating={bottomPlayer.rating}
              clock={snapshot.clocks[bottomPlayer.side]}
              active={activeSide === bottomPlayer.side}
            />
          </div>
        </div>

        <div class:exploring class="analysis-dock">
          <div class="dock-head">
            <div>
              <span class="meta-label">POSITION</span>
              <div class="position-title">
                <strong>{currentLabel}</strong>
                {#if currentMoveClassification}
                  <span class={`classification-pill ${currentMoveClassification}`}>
                    {currentMoveClassification}
                  </span>
                {:else if exploring}
                  <span class="variation-pill">analysis line</span>
                {/if}
              </div>
            </div>
            <div class="navigation">
              <button type="button" title="First move" onclick={goToStart} disabled={!exploring && currentPly === 0}>‹‹</button>
              <button type="button" title="Previous move · Left arrow" onclick={stepBackward} disabled={!canGoBack}>‹</button>
              <span>{navigationLabel}</span>
              <button type="button" title="Next move · Right arrow" onclick={stepForward} disabled={!canGoForward}>›</button>
              <button type="button" title="Last game move" onclick={goToEnd} disabled={!exploring && currentPly === game.moves.length}>››</button>
            </div>
          </div>

          {#if currentOpening}
            <div class="opening-band">
              <MoveBadge kind="book" compact />
              <div>
                <span>OPENING · {currentOpening.eco}</span>
                <strong>{currentOpening.name}</strong>
              </div>
              <small>
                {currentOpening.matchedPly === (exploring ? variation!.rootPly + variationPly! : currentPly)
                  ? "book position"
                  : "last known position"}
              </small>
            </div>
          {:else if openingError}
            <div class="opening-band error">
              <span>Opening book unavailable</span>
              <small>{openingError}</small>
            </div>
          {/if}

          {#if bestMoveArrow && bestAlternativeSan}
            <div class="best-alternative">
              <span class="suggestion-arrow">➜</span>
              <div>
                <span>STOCKFISH ALTERNATIVE</span>
                <strong>Best was {bestAlternativeSan}</strong>
              </div>
              <small>{moveReview?.bestMove}</small>
            </div>
          {/if}

          {#if variationError && exploring}
            <div class="engine-notice error">{variationError}</div>
          {:else if reviewError && !exploring}
            <div class="engine-notice error">{reviewError}</div>
          {:else if !engine.available}
            <div class="engine-notice">
              <span>Stockfish is not available yet.</span>
              <small>{engine.message}</small>
            </div>
          {:else if variationPositionBusy && !positionReview}
            <div class="engine-notice calculating">
              <span></span>
              Stockfish is evaluating this variation…
            </div>
          {:else if reviewBusy && !positionReview && !exploring}
            <div class="engine-notice calculating">
              <span></span>
              Reviewing the whole game once… {reviewProgress?.completed ?? 0} / {reviewProgress?.total ?? game.snapshots.length}
            </div>
          {:else if positionReview?.lines.length}
            {#if reviewBusy}
              <div class="review-refresh">
                Updating full review… {reviewProgress?.completed ?? 0}/{reviewProgress?.total ?? game.snapshots.length}
              </div>
            {/if}
            <div class="lines">
              {#each positionReview.lines as line}
                <div class="line">
                  <span class:mate={line.scoreMate !== null} class="score">
                    {line.scoreMate !== null
                      ? `M${Math.abs(line.scoreMate)}`
                      : `${(line.scoreCp ?? 0) >= 0 ? "+" : ""}${((line.scoreCp ?? 0) / 100).toFixed(2)}`}
                  </span>
                  <p>{uciLineToSan(snapshot.fen, line.moves).slice(0, 8).join(" ")}</p>
                  <small>d{line.depth}</small>
                </div>
              {/each}
            </div>
          {:else}
            <div class="engine-notice">This game has not been reviewed yet.</div>
          {/if}

          <MoveList
            moves={game.moves}
            reviews={review?.moves ?? []}
            {variation}
            {variationPly}
            bookThroughPly={mainlineBookThrough}
            {variationBookThrough}
            {currentPly}
            onSelect={selectPly}
            onSelectVariation={selectVariationPly}
          />
        </div>
      </div>

      <CoachSidebar
        messages={coachMessages}
        status={coachStatus}
        detail={coachDetail}
        busy={coachStatus === "thinking"}
        onSend={askCoach}
        onNewConversation={startNewCoachConversation}
      />
    </section>
  </main>
</div>

{#if importOpen}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) importOpen = false;
    }}
  >
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div class="modal-head">
        <div>
          <span class="meta-label">NEW STUDY</span>
          <h2 id="import-title">Import a PGN</h2>
        </div>
        <button type="button" onclick={() => (importOpen = false)}>×</button>
      </div>
      <p>Paste a complete game. ChessCave will build its timeline and make every position available to Stockfish and Sol.</p>
      <textarea bind:value={pgnDraft} rows="13" placeholder={'[Event "My game"]\n\n1. e4 e5 2. Nf3 …'}></textarea>
      {#if importError}<div class="import-error">{importError}</div>{/if}
      <div class="modal-actions">
        <button class="secondary" type="button" onclick={() => { pgnDraft = SAMPLE_PGN; }}>Use sample</button>
        <button class="primary" type="button" disabled={!pgnDraft.trim()} onclick={importPgn}>Import game</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .app-shell {
    position: fixed;
    inset: 0;
    display: flex;
    width: 100%;
    height: 100%;
    overflow: hidden;
    color: #e7eae3;
    background: #191b19;
  }

  .rail {
    flex: 0 0 72px;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 72px;
    min-width: 72px;
    height: 100%;
    padding: 15px 8px 12px;
    border-right: 1px solid #30342e;
    background: #20231f;
  }

  .brand-mark {
    display: grid;
    place-items: center;
    width: 42px;
    aspect-ratio: 1;
    border-radius: 12px;
    color: #1c2916;
    background: linear-gradient(145deg, #a6cf89, #719d55);
    font-size: 25px;
    box-shadow: 0 8px 22px rgba(86, 126, 58, 0.21);
  }

  .rail-items {
    display: grid;
    gap: 9px;
    width: 100%;
    margin-top: 26px;
  }

  .rail button {
    display: grid;
    place-items: center;
    gap: 2px;
    min-height: 52px;
    border: 0;
    border-radius: 10px;
    color: #747a71;
    background: transparent;
    cursor: pointer;
  }

  .rail button span {
    font-size: 19px;
  }

  .rail button small {
    font-size: 8px;
    font-weight: 750;
  }

  .rail button:hover,
  .rail button.active {
    color: #acd190;
    background: #2c3229;
  }

  .rail .settings {
    margin-top: auto;
    font-size: 17px;
  }

  main {
    flex: 1 1 auto;
    display: grid;
    grid-template-rows: 74px 1fr;
    width: calc(100% - 72px);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 22px 9px 25px;
    border-bottom: 1px solid #31352f;
    background: #222521;
  }

  .breadcrumb {
    display: flex;
    gap: 8px;
    align-items: center;
    color: #777e74;
    font-size: 9px;
    font-weight: 750;
    letter-spacing: 0.08em;
  }

  .breadcrumb span {
    color: #91ad80;
  }

  .breadcrumb i {
    width: 3px;
    height: 3px;
    border-radius: 99px;
    background: #555b52;
  }

  h1 {
    margin: 3px 0 0;
    color: #eef0eb;
    font-family: Georgia, serif;
    font-size: 21px;
    font-weight: 650;
  }

  .top-actions {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  .top-actions > button {
    padding: 9px 13px;
    border: 1px solid #42473f;
    border-radius: 8px;
    color: #d9ddd5;
    background: #2c302b;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
  }

  .top-actions > button:hover {
    border-color: #65795a;
  }

  .engine-chip {
    display: flex;
    gap: 6px;
    align-items: center;
    color: #888f85;
    font-size: 9px;
    font-weight: 700;
  }

  .engine-chip i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #6d716b;
  }

  .engine-chip.online {
    color: #9fb794;
  }

  .engine-chip.online i {
    background: #8ab86d;
    box-shadow: 0 0 0 4px rgba(138, 184, 109, 0.08);
  }

  .workspace {
    display: grid;
    grid-template-columns: minmax(570px, 1fr) 350px;
    min-height: 0;
    overflow: hidden;
  }

  .study-column {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: 15px clamp(18px, 3vw, 42px) 20px;
    scrollbar-color: #454a43 transparent;
    background:
      radial-gradient(circle at 43% 31%, rgba(75, 94, 65, 0.14), transparent 42%),
      #1c1f1c;
  }

  .meta-label {
    display: block;
    margin-bottom: 3px;
    color: #7d9870;
    font-size: 8px;
    font-weight: 850;
    letter-spacing: 0.14em;
  }

  .dock-head strong {
    color: #cfd3ca;
    font-size: 11px;
  }

  .position-title {
    display: flex;
    gap: 7px;
    align-items: center;
  }

  .classification-pill {
    padding: 2px 6px;
    border-radius: 999px;
    color: #d7ddd2;
    background: #3c4339;
    font-size: 7px;
    font-weight: 850;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .variation-pill {
    padding: 2px 6px;
    border: 1px solid #617654;
    border-radius: 999px;
    color: #b7d2a7;
    background: #303a2d;
    font-size: 7px;
    font-weight: 850;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .classification-pill.great,
  .classification-pill.best {
    color: #eff8e9;
    background: #56863e;
  }

  .classification-pill.excellent {
    color: #eff7ec;
    background: #6c9660;
  }

  .classification-pill.good {
    color: #e8efdf;
    background: #60765a;
  }

  .classification-pill.book {
    color: #fff9ee;
    background: #8f7558;
  }

  .classification-pill.inaccuracy {
    color: #282218;
    background: #d8ba65;
  }

  .classification-pill.mistake {
    color: #291b16;
    background: #dc965f;
  }

  .classification-pill.blunder {
    color: #fff0ed;
    background: #b9554b;
  }

  .board-stage {
    display: grid;
    grid-template-columns: 28px auto 30px;
    grid-template-rows: auto auto auto;
    column-gap: 8px;
    row-gap: 4px;
    justify-content: center;
    width: 100%;
  }

  .player-slot {
    grid-column: 2;
    min-width: 0;
  }

  .top-player {
    grid-row: 1;
  }

  .bottom-player {
    grid-row: 3;
  }

  .evaluation-slot {
    display: flex;
    grid-column: 1;
    grid-row: 2;
    align-items: stretch;
  }

  .board-wrap {
    grid-column: 2;
    grid-row: 2;
    width: min(640px, calc(100vh - 360px), calc(100vw - 520px));
    min-width: 320px;
    max-width: 100%;
    aspect-ratio: 1;
  }

  .board-tools {
    display: grid;
    grid-column: 3;
    grid-row: 2;
    align-content: start;
    gap: 7px;
  }

  .board-tools button {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: 1px solid #3a3f38;
    border-radius: 7px;
    color: #939a90;
    background: #292d28;
    cursor: pointer;
  }

  .board-tools button:hover:not(:disabled) {
    color: #b6d49f;
    border-color: #617a52;
  }

  .board-tools button:disabled {
    opacity: 0.36;
  }

  .board-tools button.working {
    animation: pulse 900ms infinite alternate;
  }

  .analysis-dock {
    width: min(calc(100% - 74px), 640px, calc(100vh - 360px));
    min-width: 320px;
    margin: 12px auto 0;
    overflow: hidden;
    border: 1px solid #353a33;
    border-radius: 10px;
    background: #242723;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.13);
  }

  .analysis-dock.exploring {
    border-color: #596c4f;
  }

  .dock-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 9px 12px;
    border-bottom: 1px solid #353a33;
  }

  .opening-band {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
    min-height: 42px;
    padding: 6px 11px;
    border-bottom: 1px solid #3a3931;
    background: linear-gradient(90deg, #302b24, #292a25);
  }

  .opening-band > div {
    display: grid;
    min-width: 0;
  }

  .opening-band div span {
    color: #a9957c;
    font-size: 7px;
    font-weight: 850;
    letter-spacing: 0.1em;
  }

  .opening-band strong {
    overflow: hidden;
    color: #ded8cd;
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .opening-band small {
    color: #81786b;
    font-size: 8px;
    white-space: nowrap;
  }

  .opening-band.error {
    grid-template-columns: minmax(0, 1fr) auto;
    color: #dc8b7b;
    background: #302522;
    font-size: 9px;
  }

  .best-alternative {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
    min-height: 39px;
    padding: 6px 11px;
    border-bottom: 1px solid #384333;
    background: linear-gradient(90deg, #293326, #292d27);
  }

  .best-alternative > div {
    display: grid;
    min-width: 0;
  }

  .best-alternative div span {
    color: #89aa70;
    font-size: 7px;
    font-weight: 850;
    letter-spacing: 0.1em;
  }

  .best-alternative strong {
    color: #dce9d4;
    font-size: 10px;
  }

  .best-alternative small {
    color: #74806f;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 8px;
  }

  .suggestion-arrow {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    color: #eff9e9;
    background: #719e4f;
    font-size: 13px;
    font-weight: 900;
  }

  .navigation {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .navigation button {
    display: grid;
    place-items: center;
    width: 25px;
    height: 24px;
    border: 0;
    border-radius: 5px;
    color: #a7aca4;
    background: #30342f;
    cursor: pointer;
  }

  .navigation button:hover:not(:disabled) {
    color: #d9e4d2;
    background: #3a4336;
  }

  .navigation button:disabled {
    opacity: 0.33;
  }

  .navigation span {
    min-width: 54px;
    color: #7f857c;
    font-size: 9px;
    text-align: center;
  }

  .lines {
    display: grid;
    gap: 1px;
    padding: 6px;
    border-bottom: 1px solid #343932;
  }

  .review-refresh {
    padding: 5px 10px;
    border-bottom: 1px solid #343932;
    color: #91ad80;
    background: #293027;
    font-size: 8px;
    font-weight: 750;
    text-align: center;
  }

  .line {
    display: grid;
    grid-template-columns: 47px 1fr 30px;
    gap: 7px;
    align-items: center;
    min-height: 27px;
    padding: 0 6px;
    border-radius: 5px;
    color: #b8bdb4;
    background: #292d28;
    font-size: 10px;
  }

  .line .score {
    color: #d7dfd1;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }

  .line .score.mate {
    color: #e5b96a;
  }

  .line p {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .line small {
    color: #6f756c;
    text-align: right;
  }

  .engine-notice {
    display: grid;
    min-height: 52px;
    place-content: center;
    gap: 3px;
    padding: 8px;
    border-bottom: 1px solid #343932;
    color: #a0a69c;
    font-size: 10px;
    text-align: center;
  }

  .engine-notice small {
    color: #6f756c;
  }

  .engine-notice.error {
    color: #dc8b7b;
  }

  .engine-notice.calculating {
    display: flex;
    align-items: center;
  }

  .engine-notice.calculating span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #8ab86d;
    animation: pulse 700ms infinite alternate;
  }

  .modal-backdrop {
    position: fixed;
    z-index: 20;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 20px;
    background: rgba(7, 9, 7, 0.72);
    backdrop-filter: blur(8px);
  }

  .modal {
    width: min(580px, 100%);
    padding: 20px;
    border: 1px solid #42483f;
    border-radius: 15px;
    background: #252925;
    box-shadow: 0 30px 90px rgba(0, 0, 0, 0.42);
  }

  .modal-head {
    display: flex;
    justify-content: space-between;
  }

  .modal h2 {
    margin: 0;
    color: #eef0eb;
    font-family: Georgia, serif;
    font-size: 23px;
  }

  .modal-head button {
    width: 31px;
    height: 31px;
    border: 0;
    border-radius: 8px;
    color: #a6aca2;
    background: #333832;
    font-size: 21px;
    cursor: pointer;
  }

  .modal > p {
    margin: 12px 0;
    color: #92988f;
    font-size: 11px;
    line-height: 1.55;
  }

  .modal textarea {
    width: 100%;
    resize: vertical;
    border: 1px solid #3e443c;
    border-radius: 10px;
    outline: 0;
    padding: 12px;
    color: #dfe3db;
    background: #1d201d;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    line-height: 1.55;
  }

  .modal textarea:focus {
    border-color: #698356;
  }

  .modal-actions {
    display: flex;
    justify-content: space-between;
    margin-top: 12px;
  }

  .modal-actions button {
    padding: 9px 13px;
    border: 1px solid #42483f;
    border-radius: 8px;
    font-size: 10px;
    font-weight: 750;
    cursor: pointer;
  }

  .modal-actions .secondary {
    color: #bdc2b9;
    background: #30342f;
  }

  .modal-actions .primary {
    color: #162010;
    border-color: #8cb56f;
    background: #92bc74;
  }

  .modal-actions button:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }

  .import-error {
    margin-top: 8px;
    color: #dc8b7b;
    font-size: 10px;
  }

  @keyframes pulse {
    to {
      opacity: 0.35;
    }
  }

  @media (max-width: 1080px) {
    .workspace {
      grid-template-columns: minmax(500px, 1fr) 320px;
    }

    .study-column {
      padding-inline: 16px;
    }
  }

  @media (max-width: 820px) {
    .rail {
      display: none;
    }

    main {
      width: 100%;
    }

    .workspace {
      grid-template-columns: 1fr;
      overflow: auto;
    }

    .study-column {
      overflow: visible;
    }

    .board-wrap {
      width: min(640px, calc(100vw - 110px));
    }

    .analysis-dock {
      width: min(640px, calc(100vw - 110px));
    }

    :global(.coach) {
      min-height: 620px;
    }
  }
</style>
