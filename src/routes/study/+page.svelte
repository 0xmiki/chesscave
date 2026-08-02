<script lang="ts">
  import { onMount } from "svelte";
  import { Chess, type Square } from "chess.js";
  import AppHeader from "$lib/components/AppHeader.svelte";
  import ChessBoard from "$lib/components/ChessBoard.svelte";
  import CoachSidebar from "$lib/components/CoachSidebar.svelte";
  import EvaluationBar from "$lib/components/EvaluationBar.svelte";
  import GameSummary from "$lib/components/GameSummary.svelte";
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
  import { markGameReviewed, STUDY_STORAGE_KEY } from "$lib/chess/chesscom";
  import { buildReviewPresentation } from "$lib/chess/review";
  import {
    deepestOpeningPly,
    loadOpeningBook,
    openingAt,
    type OpeningBook,
  } from "$lib/chess/openings";
  import type {
    AnalysisResult,
    CoachActivity,
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
  let sourceUrl = $state<string | null>(null);
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
  let coachActivity = $state<CoachActivity | null>(null);
  let activeCoachTools = $state<Record<string, string>>({});
  let importOpen = $state(false);
  let pgnDraft = $state("");
  let importError = $state("");
  let studyTab = $state<"review" | "coach">("review");
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
  const reviewPresentation = $derived(
    review ? buildReviewPresentation(game, review, mainlineBookThrough) : null,
  );
  const reviewMoves = $derived(reviewPresentation?.moves ?? review?.moves ?? []);
  const moveReview = $derived(
    !exploring && currentPly > 0
      ? reviewMoves[currentPly - 1] ?? null
      : null,
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
  const matchupTitle = $derived(
    `${game.headers.White || "White"} vs ${game.headers.Black || "Black"}`,
  );
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
      STUDY_STORAGE_KEY,
      JSON.stringify({ pgn: game.pgn, currentPly, sourceUrl }),
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
        const savedStudy = localStorage.getItem(STUDY_STORAGE_KEY);
        if (savedStudy) {
          const saved = JSON.parse(savedStudy) as {
            pgn?: string;
            currentPly?: number;
            sourceUrl?: string | null;
          };
          if (saved.pgn) {
            const restored = parsePgn(saved.pgn);
            game = restored;
            sourceUrl = saved.sourceUrl ?? null;
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
        localStorage.removeItem(STUDY_STORAGE_KEY);
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
      if (game.pgn === requestedPgn) {
        review = result;
        if (sourceUrl) markGameReviewed(sourceUrl);
      }
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
      sourceUrl = null;
      currentPly = next.moves.length;
      variation = null;
      variationPly = null;
      selected = null;
      review = null;
      studyTab = "review";
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
      `Displayed clocks: White ${snapshot.clocks.w ?? "unknown"} seconds, Black ${snapshot.clocks.b ?? "unknown"} seconds`,
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
    coachActivity = {
      kind: "thinking",
      label: "Considering your question",
      detail: "Sol is deciding what evidence to inspect.",
    };
    try {
      await sendCoachMessage(text, coachContext());
    } catch (error) {
      coachStatus = "error";
      coachDetail = String(error);
      coachActivity = null;
    }
  }

  async function startNewCoachConversation() {
    if (!hasNativeHost() || coachStatus === "starting" || coachStatus === "thinking") return;

    coachStatus = "starting";
    coachDetail = "Starting a new conversation…";
    coachActivity = null;
    activeCoachTools = {};
    try {
      await newCoachThread();
      coachMessages = [];
    } catch (error) {
      coachStatus = "error";
      coachDetail = String(error);
    }
  }

  function coachToolName(item: Record<string, unknown> | undefined): string {
    const raw = String(item?.tool ?? item?.toolName ?? item?.name ?? "chess tool");
    return raw.split(/[./]/).at(-1) || raw;
  }

  function coachToolLabel(tool: string, waiting = false): CoachActivity {
    const verb = waiting ? "Waiting for" : "Calling";
    const labels: Record<string, [string, string]> = {
      get_position_image: [
        `${verb} board image`,
        waiting
          ? "ChessCave is rendering the requested position."
          : "Opening the position through ChessCave MCP.",
      ],
      get_game_review: [
        `${verb} full-game review`,
        waiting
          ? "ChessCave is loading the saved Stockfish review."
          : "Reading the game evidence through ChessCave MCP.",
      ],
      analyze_position: [
        `${verb} Stockfish analysis`,
        waiting
          ? "Stockfish is calculating candidate moves."
          : "Sending this position to the ChessCave engine.",
      ],
      compare_moves: [
        `${verb} move comparison`,
        waiting
          ? "Stockfish is comparing the played move and best line."
          : "Sending both lines to the ChessCave engine.",
      ],
    };
    const [label, detail] = labels[tool] ?? [
      `${verb} ChessCave tool`,
      waiting ? "Waiting for the MCP result." : `Using ${tool} through MCP.`,
    ];
    return { kind: waiting ? "waiting" : "calling", label, detail };
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
      coachActivity = null;
      activeCoachTools = {};
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
      coachActivity = null;
      activeCoachTools = {};
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
      const itemId = String(params.itemId ?? params.item_id ?? "");
      const tool =
        activeCoachTools[itemId] ??
        Object.values(activeCoachTools).at(-1) ??
        "chess tool";
      coachActivity = coachToolLabel(tool, true);
      coachDetail = coachActivity.label;
      return;
    }

    if (method === "item/started") {
      const item = params.item as Record<string, unknown> | undefined;
      if (item?.type === "mcpToolCall") {
        const itemId = String(item.id ?? crypto.randomUUID());
        const tool = coachToolName(item);
        activeCoachTools = { ...activeCoachTools, [itemId]: tool };
        coachActivity = coachToolLabel(tool);
        coachDetail = coachActivity.label;
      }
      if (item?.type === "agentMessage") {
        coachActivity = {
          kind: "replying",
          label: "Writing a response",
          detail: "Sol is turning the evidence into a clear explanation.",
        };
        coachDetail = coachActivity.label;
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
      coachActivity = {
        kind: "replying",
        label: "Writing a response",
        detail: "The answer is arriving now.",
      };
      coachDetail = coachActivity.label;
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
      if (item?.type === "mcpToolCall") {
        const itemId = String(item.id ?? "");
        const { [itemId]: _completed, ...remaining } = activeCoachTools;
        activeCoachTools = remaining;
        const nextTool = Object.values(remaining).at(-1);
        coachActivity = nextTool
          ? coachToolLabel(nextTool, true)
          : {
              kind: "thinking",
              label: "Reviewing the tool result",
              detail: "Sol is connecting the evidence to your question.",
            };
        coachDetail = coachActivity.label;
      }
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
      coachActivity = null;
      activeCoachTools = {};
    }
  }
</script>

<svelte:head>
  <title>Study — ChessCave</title>
  <meta
    name="description"
    content="A private chess study powered by Stockfish and your Codex coach."
  />
</svelte:head>

<svelte:window onkeydown={handleKeyboardNavigation} />

<div class="app-shell">
  {#snippet headerActions()}
    <div class="top-actions">
      {#if reviewBusy || variationPositionBusy}
        <span class="engine-chip working">
          <i></i>
          {variationPositionBusy
            ? "Analyzing variation"
            : `Reviewing ${reviewProgress?.completed ?? 0}/${reviewProgress?.total ?? game.snapshots.length}`}
        </span>
      {:else if review}
        <span class="engine-chip"><i></i>Review ready</span>
      {/if}
      <button type="button" onclick={() => { pgnDraft = ""; importOpen = true; }}>Import game</button>
    </div>
  {/snippet}

  <AppHeader
    active="study"
    title={matchupTitle}
    subtitle={`${eventTitle}${currentOpening?.name || game.headers.Opening ? ` · ${currentOpening?.name || game.headers.Opening}` : ""}`}
    actions={headerActions}
  />

  <main>
    <section class="workspace">
      <div class="summary-column">
        <GameSummary
          presentation={reviewPresentation}
          whiteName={whitePlayer.name}
          blackName={blackPlayer.name}
          whiteRating={whitePlayer.rating}
          blackRating={blackPlayer.rating}
          {currentPly}
          busy={reviewBusy}
          progress={reviewBusy
            ? `${reviewProgress?.completed ?? 0}/${reviewProgress?.total ?? game.snapshots.length}`
            : ""}
          error={reviewError || (!engine.available ? engine.message : "")}
          onSelect={selectPly}
        />
      </div>

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
            <button type="button" title="Flip board" aria-label="Flip board" onclick={() => (flipped = !flipped)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5.4 8.5A7.5 7.5 0 0 1 18 6.2l1.8 1.9M18.6 15.5A7.5 7.5 0 0 1 6 17.8l-1.8-1.9"></path>
                <path d="M19.8 3.9v4.2h-4.2M4.2 20.1v-4.2h4.2"></path>
              </svg>
            </button>
            <button
              class:working={reviewBusy}
              type="button"
              title="Refresh full-game review"
              aria-label="Refresh full-game review"
              disabled={!engine.available || reviewBusy}
              onclick={() => requestGameReview(true)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7z"></path>
              </svg>
            </button>
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

        <div class="board-footer">
          <div class="position-summary">
            <span>{exploring ? "Variation" : "Current position"}</span>
            <strong>{currentLabel}</strong>
            {#if currentMoveClassification}
              <span class={`classification-pill ${currentMoveClassification}`}>
                {currentMoveClassification}
              </span>
            {:else if exploring}
              <span class="variation-pill">analysis line</span>
            {/if}
          </div>

          <div class="navigation" aria-label="Move navigation">
            <button type="button" title="First move" aria-label="First move" onclick={goToStart} disabled={!exploring && currentPly === 0}>‹‹</button>
            <button type="button" title="Previous move · Left arrow" aria-label="Previous move" onclick={stepBackward} disabled={!canGoBack}>‹</button>
            <span>{navigationLabel}</span>
            <button type="button" title="Next move · Right arrow" aria-label="Next move" onclick={stepForward} disabled={!canGoForward}>›</button>
            <button type="button" title="Last game move" aria-label="Last game move" onclick={goToEnd} disabled={!exploring && currentPly === game.moves.length}>››</button>
          </div>
        </div>

        <div class="move-timeline">
          <span class="timeline-label">Game</span>
          <MoveList
            moves={game.moves}
            reviews={reviewMoves}
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

      <section class="study-panel" aria-label="Game study">
        <header class="panel-header">
          <div>
            <span class="panel-kicker">Study</span>
            <strong>
              {exploring
                ? "Exploratory line"
                : review
                  ? "Full-game review loaded"
                  : "Position context"}
            </strong>
          </div>
          <div class="panel-tabs" role="tablist" aria-label="Study mode">
            <button
              class:active={studyTab === "review"}
              type="button"
              role="tab"
              aria-selected={studyTab === "review"}
              onclick={() => (studyTab = "review")}
            >Review</button>
            <button
              class:active={studyTab === "coach"}
              type="button"
              role="tab"
              aria-selected={studyTab === "coach"}
              onclick={() => (studyTab = "coach")}
            >Coach</button>
          </div>
        </header>

        {#if studyTab === "review"}
          <div class="review-panel" role="tabpanel">
            <div class="review-lead">
              <span>{exploring ? "Exploratory position" : "Position review"}</span>
              <div>
                <h2>{currentLabel}</h2>
                {#if currentMoveClassification}
                  <span class={`classification-text ${currentMoveClassification}`}>
                    {currentMoveClassification}
                  </span>
                {/if}
              </div>
              {#if principal}
                <p>
                  Stockfish evaluates this position as
                  <strong>
                    {principal.scoreMate !== null
                      ? `mate in ${Math.abs(principal.scoreMate)}`
                      : `${(principal.scoreCp ?? 0) >= 0 ? "+" : ""}${((principal.scoreCp ?? 0) / 100).toFixed(2)}`}
                  </strong>
                  from White’s perspective.
                </p>
              {/if}
            </div>

            {#if currentOpening}
            <div class="opening-band">
              <MoveBadge kind="book" compact />
              <div>
                <span>Opening · {currentOpening.eco}</span>
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
              <span class="suggestion-arrow" aria-hidden="true">→</span>
              <div>
                <span>Stockfish alternative</span>
                <strong>Best was {bestAlternativeSan}</strong>
              </div>
            </div>
            {/if}

            {#if variationError && exploring}
            <div class="engine-notice error">{variationError}</div>
            {:else if reviewError && !exploring}
            <div class="engine-notice error">{reviewError}</div>
            {:else if !engine.available}
            <div class="engine-notice">
              <span>Stockfish is unavailable.</span>
              <small>{engine.message}</small>
            </div>
            {:else if variationPositionBusy && !positionReview}
            <div class="engine-notice calculating">
              <span></span>
              Evaluating this variation…
            </div>
            {:else if reviewBusy && !positionReview && !exploring}
            <div class="engine-notice calculating">
              <span></span>
              Reviewing the full game · {reviewProgress?.completed ?? 0}/{reviewProgress?.total ?? game.snapshots.length}
            </div>
            {:else if positionReview?.lines.length}
              {#if reviewBusy}
              <div class="review-refresh">
                Updating review · {reviewProgress?.completed ?? 0}/{reviewProgress?.total ?? game.snapshots.length}
              </div>
              {/if}
              <details class="engine-lines">
                <summary>Engine lines <span>{positionReview.lines.length}</span></summary>
                <div class="lines">
                  {#each positionReview.lines as line}
                    <div class="line">
                      <span class:mate={line.scoreMate !== null} class="score">
                        {line.scoreMate !== null
                          ? `M${Math.abs(line.scoreMate)}`
                          : `${(line.scoreCp ?? 0) >= 0 ? "+" : ""}${((line.scoreCp ?? 0) / 100).toFixed(2)}`}
                      </span>
                      <p>{uciLineToSan(snapshot.fen, line.moves).slice(0, 8).join(" ")}</p>
                      <small>depth {line.depth}</small>
                    </div>
                  {/each}
                </div>
              </details>
            {:else}
            <div class="engine-notice">This game has not been reviewed yet.</div>
            {/if}
          </div>
        {:else}
          <CoachSidebar
            messages={coachMessages}
            status={coachStatus}
            detail={coachDetail}
            activity={coachActivity}
            contextLabel={`${currentLabel}${review ? " · Full-game review loaded" : ""}`}
            busy={coachStatus === "thinking"}
            onSend={askCoach}
            onNewConversation={startNewCoachConversation}
          />
        {/if}
      </section>
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
  /* ChessCave ethos: one quiet study surface, with the game as the subject. */
  .app-shell {
    position: fixed;
    inset: 0;
    display: grid;
    grid-template-rows: 68px minmax(0, 1fr);
    width: 100%;
    height: 100%;
    overflow: hidden;
    color: var(--ink);
    background: var(--paper);
  }

  .top-actions {
    display: flex;
    gap: 16px;
    align-items: center;
  }

  .top-actions > button {
    min-height: 36px;
    padding: 0 15px;
    border: 1px solid var(--ink);
    border-radius: 999px;
    color: var(--pearl-raised);
    background: var(--ink);
    font-size: 12px;
    font-weight: 650;
    cursor: pointer;
  }

  .top-actions > button:hover {
    border-color: var(--coral-dark);
    background: var(--coral-dark);
  }

  .engine-chip {
    display: inline-flex;
    gap: 7px;
    align-items: center;
    color: var(--muted);
    font-size: 11px;
    font-weight: 550;
  }

  .engine-chip i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--sage);
  }

  .engine-chip.working i {
    background: var(--coral);
    animation: pulse 900ms ease-in-out infinite alternate;
  }

  main {
    display: block;
    width: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .workspace {
    display: grid;
    grid-template-columns:
      clamp(230px, 18vw, 270px)
      minmax(520px, 1fr)
      minmax(370px, 420px);
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .study-column {
    --board-size: min(660px, calc(100vh - 270px), calc(100vw - 810px));
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: 16px 24px 18px;
    scrollbar-color: var(--line-strong) transparent;
    background: var(--paper);
  }

  .summary-column {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .board-stage {
    display: grid;
    grid-template-columns: 28px var(--board-size) 32px;
    grid-template-rows: auto var(--board-size) auto;
    column-gap: 9px;
    row-gap: 5px;
    justify-content: center;
    width: auto;
  }

  .player-slot {
    grid-column: 2;
  }

  .top-player {
    grid-row: 1;
  }

  .bottom-player {
    grid-row: 3;
  }

  .evaluation-slot {
    grid-column: 1;
    grid-row: 2;
  }

  .board-wrap {
    grid-column: 2;
    grid-row: 2;
    width: var(--board-size);
    min-width: 0;
    max-width: none;
  }

  .board-tools {
    display: grid;
    grid-column: 3;
    grid-row: 2;
    align-content: start;
    gap: 8px;
  }

  .board-tools button {
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 50%;
    color: var(--ink-soft);
    background: var(--pearl);
    cursor: pointer;
  }

  .board-tools button:hover:not(:disabled) {
    color: var(--coral-dark);
    border-color: var(--coral);
    background: var(--coral-soft);
  }

  .board-tools button:disabled {
    opacity: 0.38;
  }

  .board-tools svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.7;
  }

  .board-tools button:last-child svg {
    fill: currentColor;
    stroke: none;
  }

  .board-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: var(--board-size);
    min-height: 47px;
    margin: 8px 0 0;
    border-bottom: 1px solid var(--line);
  }

  .position-summary {
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
  }

  .position-summary > span:first-child {
    color: var(--muted);
    font-size: 11px;
  }

  .position-summary strong {
    color: var(--ink);
    font-size: 13px;
    font-weight: 700;
  }

  .classification-pill,
  .variation-pill {
    padding: 3px 7px;
    border: 0;
    border-radius: 999px;
    color: var(--ink-soft);
    background: var(--sage-soft);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0;
    text-transform: capitalize;
  }

  .classification-pill.book {
    color: #755c3e;
    background: #eee3d4;
  }

  .classification-pill.inaccuracy {
    color: #79581f;
    background: #f3e5bf;
  }

  .classification-pill.mistake,
  .classification-pill.miss,
  .classification-pill.blunder {
    color: var(--coral-dark);
    background: var(--coral-soft);
  }

  .navigation {
    display: flex;
    gap: 3px;
    align-items: center;
  }

  .navigation button {
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    border: 0;
    border-radius: 50%;
    color: var(--ink-soft);
    background: transparent;
    font-size: 16px;
    cursor: pointer;
  }

  .navigation button:hover:not(:disabled) {
    color: var(--coral-dark);
    background: var(--coral-soft);
  }

  .navigation button:disabled {
    opacity: 0.26;
  }

  .navigation span {
    min-width: 54px;
    color: var(--muted);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .move-timeline {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr);
    gap: 8px;
    align-items: center;
    width: var(--board-size);
    min-height: 54px;
  }

  .timeline-label {
    color: var(--muted);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .study-panel {
    display: grid;
    grid-template-rows: 74px minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border-left: 1px solid var(--line);
    background: var(--pearl);
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid var(--line);
  }

  .panel-header > div:first-child {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  .panel-kicker {
    color: var(--coral-dark);
    font-size: 9px;
    font-weight: 750;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .panel-header strong {
    overflow: hidden;
    color: var(--ink-soft);
    font-size: 12px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .panel-tabs {
    display: flex;
    gap: 3px;
    padding: 3px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--paper);
  }

  .panel-tabs button {
    min-height: 29px;
    padding: 0 12px;
    border: 0;
    border-radius: 999px;
    color: var(--muted);
    background: transparent;
    font-size: 11px;
    font-weight: 650;
    cursor: pointer;
  }

  .panel-tabs button.active {
    color: var(--pearl-raised);
    background: var(--ink);
  }

  .review-panel {
    min-height: 0;
    overflow: auto;
    padding: 28px 24px 40px;
    scrollbar-color: var(--line-strong) transparent;
  }

  .review-lead {
    padding-bottom: 25px;
    border-bottom: 1px solid var(--line);
  }

  .review-lead > span {
    color: var(--coral-dark);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .review-lead > div {
    display: flex;
    gap: 10px;
    align-items: baseline;
    margin-top: 6px;
  }

  .review-lead h2 {
    margin: 0;
    color: var(--ink);
    font-family: var(--display);
    font-size: clamp(24px, 2vw, 31px);
    font-variation-settings: "opsz" 32, "wght" 580;
    line-height: 1.1;
  }

  .review-lead p {
    max-width: 34ch;
    margin: 13px 0 0;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.55;
  }

  .review-lead p strong {
    color: var(--ink);
  }

  .classification-text {
    color: var(--sage);
    font-size: 11px;
    font-weight: 700;
    text-transform: capitalize;
  }

  .classification-text.inaccuracy {
    color: var(--ochre);
  }

  .classification-text.mistake,
  .classification-text.miss,
  .classification-text.blunder {
    color: var(--coral-dark);
  }

  .opening-band,
  .best-alternative {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 11px;
    align-items: center;
    min-height: 66px;
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
    background: transparent;
  }

  .opening-band > div,
  .best-alternative > div {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  .opening-band div span,
  .best-alternative div span {
    color: var(--muted);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0;
    text-transform: none;
  }

  .opening-band strong,
  .best-alternative strong {
    overflow: hidden;
    color: var(--ink);
    font-size: 13px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .opening-band small {
    color: var(--faint);
    font-size: 9px;
    white-space: nowrap;
  }

  .opening-band.error {
    grid-template-columns: minmax(0, 1fr);
    color: var(--danger);
    background: transparent;
  }

  .best-alternative {
    grid-template-columns: auto minmax(0, 1fr);
    margin-top: 18px;
    padding: 14px;
    border: 0;
    border-radius: 10px;
    background: var(--coral-soft);
  }

  .best-alternative div span {
    color: var(--coral-dark);
  }

  .suggestion-arrow {
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    border: 1px solid rgba(159, 78, 59, 0.25);
    border-radius: 50%;
    color: var(--coral-dark);
    background: transparent;
    font-size: 16px;
  }

  .engine-notice {
    display: grid;
    min-height: 92px;
    place-content: center;
    gap: 4px;
    padding: 18px 0;
    border-bottom: 1px solid var(--line);
    color: var(--muted);
    font-size: 12px;
    text-align: center;
  }

  .engine-notice small {
    color: var(--faint);
  }

  .engine-notice.error {
    color: var(--danger);
  }

  .engine-notice.calculating {
    display: flex;
    align-items: center;
  }

  .engine-notice.calculating span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--coral);
    animation: pulse 700ms infinite alternate;
  }

  .review-refresh {
    margin-top: 18px;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: 7px;
    color: var(--muted);
    background: var(--paper);
    font-size: 10px;
    text-align: center;
  }

  .engine-lines {
    margin-top: 22px;
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }

  .engine-lines summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 48px;
    color: var(--ink-soft);
    font-size: 12px;
    font-weight: 650;
    cursor: pointer;
    list-style: none;
  }

  .engine-lines summary::-webkit-details-marker {
    display: none;
  }

  .engine-lines summary::after {
    content: "+";
    color: var(--coral-dark);
    font-size: 18px;
    font-weight: 400;
  }

  .engine-lines[open] summary::after {
    content: "−";
  }

  .engine-lines summary span {
    margin-left: auto;
    margin-right: 10px;
    color: var(--faint);
    font-size: 10px;
    font-weight: 500;
  }

  .lines {
    display: grid;
    gap: 0;
    padding: 0 0 8px;
    border: 0;
  }

  .line {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr);
    gap: 9px;
    align-items: start;
    min-height: 0;
    padding: 10px 0;
    border-top: 1px solid var(--line);
    border-radius: 0;
    color: var(--ink-soft);
    background: transparent;
    font-size: 11px;
  }

  .line .score {
    color: var(--ink);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .line .score.mate {
    color: var(--coral-dark);
  }

  .line p {
    margin: 0;
    overflow: hidden;
    line-height: 1.45;
    text-overflow: ellipsis;
    white-space: normal;
  }

  .line small {
    grid-column: 2;
    color: var(--faint);
    font-size: 9px;
    text-align: left;
  }

  .modal-backdrop {
    position: fixed;
    z-index: 20;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 20px;
    background: rgba(55, 47, 40, 0.42);
    backdrop-filter: blur(5px);
  }

  .modal {
    width: min(580px, 100%);
    padding: 24px;
    border: 1px solid var(--line-strong);
    border-radius: 14px;
    color: var(--ink);
    background: var(--pearl-raised);
    box-shadow: 0 30px 90px rgba(69, 54, 43, 0.18);
  }

  .meta-label {
    display: block;
    margin-bottom: 3px;
    color: var(--coral-dark);
    font-size: 9px;
    letter-spacing: 0.1em;
  }

  .modal h2 {
    margin: 0;
    color: var(--ink);
    font-family: var(--display);
    font-size: 27px;
    font-variation-settings: "opsz" 30, "wght" 580;
  }

  .modal-head button {
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    color: var(--ink-soft);
    background: var(--paper);
    font-size: 20px;
    cursor: pointer;
  }

  .modal-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
  }

  .modal > p {
    margin: 12px 0;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.55;
  }

  .modal textarea {
    width: 100%;
    resize: vertical;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    outline: 0;
    border-color: var(--line);
    color: var(--ink);
    background: var(--pearl);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    line-height: 1.55;
  }

  .modal textarea:focus {
    border-color: var(--coral);
  }

  .modal-actions button {
    padding: 9px 13px;
    border: 1px solid var(--line-strong);
    border-radius: 8px;
    border-color: var(--line-strong);
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
  }

  .modal-actions {
    display: flex;
    justify-content: space-between;
    margin-top: 12px;
  }

  .modal-actions .secondary {
    color: var(--ink-soft);
    background: transparent;
  }

  .modal-actions .primary {
    color: var(--pearl-raised);
    border-color: var(--ink);
    background: var(--ink);
  }

  .import-error {
    margin-top: 8px;
    color: var(--danger);
    font-size: 11px;
  }

  .modal-actions button:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }

  @keyframes pulse {
    to {
      opacity: 0.35;
    }
  }

  @media (max-width: 1180px) {
    .workspace {
      grid-template-columns: 220px minmax(440px, 1fr) 340px;
    }

    .study-column {
      --board-size: min(620px, calc(100vh - 270px), calc(100vw - 680px));
      padding-inline: 14px;
    }

  }

  @media (max-width: 1100px) {
    .app-shell {
      grid-template-rows: 68px minmax(0, 1fr);
    }

    main {
      overflow: auto;
    }

    .workspace {
      grid-template-columns: minmax(0, 1fr);
      height: auto;
      overflow: visible;
    }

    .study-column {
      --board-size: min(640px, calc(100vw - 90px), calc(100vh - 235px));
      order: 1;
      min-height: calc(100vh - 68px);
      overflow: visible;
    }

    .summary-column {
      order: 2;
      overflow: visible;
    }

    .study-panel {
      order: 3;
      min-height: 680px;
      border-top: 1px solid var(--line);
      border-left: 0;
    }

    .review-panel {
      padding-inline: max(24px, calc((100vw - 640px) / 2));
    }
  }

  @media (max-width: 640px) {
    .app-shell {
      grid-template-rows: 62px minmax(0, 1fr);
    }

    .engine-chip {
      display: none;
    }

    .top-actions > button {
      min-height: 32px;
      padding-inline: 11px;
      font-size: 11px;
    }

    .study-column {
      --board-size: min(calc(100vw - 62px), calc(100vh - 245px));
      min-height: calc(100vh - 62px);
      padding: 12px 6px 16px;
    }

    .board-stage {
      grid-template-columns: 24px var(--board-size) 28px;
      column-gap: 5px;
    }

    .board-tools button {
      width: 28px;
      height: 28px;
    }

    .board-footer {
      min-height: 52px;
    }

    .position-summary > span:first-child {
      display: none;
    }

    .navigation button:first-child,
    .navigation button:last-child {
      display: none;
    }

    .move-timeline {
      grid-template-columns: 1fr;
      gap: 0;
      padding-top: 5px;
    }

    .timeline-label {
      display: none;
    }

    .panel-header {
      padding-inline: 14px;
    }

    .review-panel {
      padding: 24px 18px 36px;
    }
  }
</style>
