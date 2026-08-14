<script lang="ts">
  import { onMount } from "svelte";
  import { Chess, type Square } from "chess.js";
  import IconArrowCounterClockwiseRegular from "phosphor-icons-svelte/IconArrowCounterClockwiseRegular.svelte";
  import IconArrowsDownUpRegular from "phosphor-icons-svelte/IconArrowsDownUpRegular.svelte";
  import IconFlagCheckeredRegular from "phosphor-icons-svelte/IconFlagCheckeredRegular.svelte";
  import IconPaperPlaneTiltRegular from "phosphor-icons-svelte/IconPaperPlaneTiltRegular.svelte";
  import IconCaretLeftRegular from "phosphor-icons-svelte/IconCaretLeftRegular.svelte";
  import IconCaretRightRegular from "phosphor-icons-svelte/IconCaretRightRegular.svelte";
  import IconSkipBackRegular from "phosphor-icons-svelte/IconSkipBackRegular.svelte";
  import IconSkipForwardRegular from "phosphor-icons-svelte/IconSkipForwardRegular.svelte";
  import ChessBoard from "$lib/components/ChessBoard.svelte";
  import AppHeader from "$lib/components/AppHeader.svelte";
  import EvaluationBar from "$lib/components/EvaluationBar.svelte";
  import MoveBadge from "$lib/components/MoveBadge.svelte";
  import { bestAlternativeArrow, uciToArrow } from "$lib/chess/arrows";
  import {
    CODEX_COMPARE_TIME_MS,
    CODEX_MOVE_TIME_MS,
    CODEX_OPENING_ROTATION_KEY,
    CODEX_PLAY_STORAGE_KEY,
    classifyLiveMove,
    codexPositionContext,
    isNotableComparison,
    lineToSan,
    moveRecord,
    playUci,
    scoreLabel,
    type CodexPlayMove,
  } from "$lib/chess/codex-play";
  import {
    chooseTeachingContinuation,
    exactOpening,
    loadOpeningBook,
    openingAt,
    openingContinuations,
    teachingRepertoire,
    type OpeningBook,
    type OpeningMatch,
  } from "$lib/chess/openings";
  import type {
    AnalysisResult,
    MoveClassification,
    MoveComparison,
    Side,
  } from "$lib/chess/types";
  import {
    analyzePosition,
    compareMove,
    getEngineStatus,
    hasNativeHost,
    interruptCoachTurn,
    onCoachEvent,
    sendCoachMessage,
    startCoach,
    stopCoach,
  } from "$lib/services/native";

  type Phase = "ready" | "opponent-thinking" | "complete" | "offline";
  type Insight = {
    before: string;
    move: CodexPlayMove;
    comparison: MoveComparison;
  };
  type PendingExplanation = {
    session: number;
    before: string;
    move: CodexPlayMove;
    analysis: AnalysisResult | null;
    opening: OpeningMatch | null;
    playerFeedback?: LiveFeedback | null;
  };
  type LiveFeedback = {
    move: CodexPlayMove;
    comparison: MoveComparison;
    classification: MoveClassification;
  };
  type ActiveCoachRequest = {
    purpose: "idea" | "move";
    session: number;
    movePly: number;
    ideaTurnId?: number;
  };
  type IdeaTurn = {
    id: number;
    question: string;
    reply: string;
    state: "queued" | "thinking" | "complete" | "error";
  };
  type PendingIdea = {
    session: number;
    movePly: number;
    turnId: number;
    question: string;
    context: string;
  };
  type CoachNote = {
    heading: string;
    label: string;
    text: string;
  };

  const initialFen = new Chess().fen();
  let liveFen = $state(initialFen);
  let reflectionFen = $state<string | null>(null);
  let lastMove = $state<{ from: string; to: string } | null>(null);
  let playerSide = $state<Side>("w");
  let gameStarted = $state(false);
  let historyPly = $state<number | null>(null);
  let flipped = $state(false);
  let selected = $state<string | null>(null);
  let moves = $state<CodexPlayMove[]>([]);
  let phase = $state<Phase>(hasNativeHost() ? "ready" : "offline");
  let engineName = $state("Stockfish");
  let statusText = $state(hasNativeHost() ? "Your move" : "Desktop app required for Stockfish");
  let latestAnalysis = $state<AnalysisResult | null>(null);
  let latestFeedback = $state<LiveFeedback | null>(null);
  let insight = $state<Insight | null>(null);
  let ideaDraft = $state("");
  let ideaThreads = $state<Record<number, IdeaTurn[]>>({});
  let ideaQueue = $state<PendingIdea[]>([]);
  let activeIdea = $state<PendingIdea | null>(null);
  let note = $state("");
  let noteLabel = $state("Session setup");
  let codexReady = $state(false);
  let coachUnavailable = $state(false);
  let coachBusy = $state(false);
  let codexReply = $state("");
  let activeMessageId = $state("");
  let activeTurnId = $state("");
  let activeCoachRequest = $state<ActiveCoachRequest | null>(null);
  let activeExplanation = $state<PendingExplanation | null>(null);
  let explanationQueue = $state<PendingExplanation[]>([]);
  let coachNotes = $state<Record<number, CoachNote>>({});
  let coachingAids = $state(true);
  let coachRestartTimer: number | null = null;
  let coachReadyTimer: number | null = null;
  let coachStartAttempts = 0;
  let gameSession = 1;
  let openingRotation = 0;
  let openingSeed = 0;
  let openingBook = $state<OpeningBook | null>(null);
  let turnToken = 0;
  let nextIdeaTurnId = 1;

  const historyMove = $derived(
    historyPly !== null && historyPly > 0 ? moves[historyPly - 1] ?? null : null,
  );
  const historyFen = $derived(
    historyPly === null
      ? null
      : historyPly === 0
        ? initialFen
        : historyMove?.after ?? liveFen,
  );
  const displayFen = $derived(reflectionFen ?? historyFen ?? liveFen);
  const displayLastMove = $derived(
    reflectionFen
      ? null
      : historyPly !== null
        ? historyMove
          ? { from: historyMove.uci.slice(0, 2), to: historyMove.uci.slice(2, 4) }
          : null
        : lastMove,
  );
  const displayPosition = $derived(new Chess(displayFen));
  const legalTargets = $derived.by(() => {
    if (!gameStarted || !selected || phase !== "ready" || reflectionFen || historyPly !== null) return [];
    return displayPosition
      .moves({ square: selected as Square, verbose: true })
      .map((move) => move.to);
  });
  const engineArrow = $derived.by(() => {
    if (reflectionFen) return uciToArrow(insight?.comparison.analysis.bestMove);
    if (historyPly !== null || !coachingAids || !latestFeedback) return null;
    return bestAlternativeArrow(
      latestFeedback.move.uci,
      latestFeedback.comparison.analysis.bestMove,
      latestFeedback.classification === "book",
    );
  });
  const snapshots = $derived([
    { fen: initialFen, ply: 0, lastMove: null, clocks: { w: null, b: null } },
    ...moves.map((move) => ({
      fen: move.after,
      ply: move.ply,
      lastMove: { from: move.uci.slice(0, 2), to: move.uci.slice(2, 4) },
      clocks: { w: null, b: null },
    })),
  ]);
  const currentOpening = $derived(openingAt(openingBook, snapshots, moves.length));
  const activeAnalysis = $derived(
    reflectionFen
      ? insight?.comparison.analysis ?? null
      : historyPly !== null
        ? null
        : latestAnalysis,
  );
  const evaluationLine = $derived(
    reflectionFen
      ? insight?.comparison.analysis.lines[0] ?? null
      : historyPly !== null
        ? null
      : latestFeedback?.comparison.playedLine ?? latestAnalysis?.lines[0] ?? null,
  );
  const principalLine = $derived(
    lineToSan(activeAnalysis?.fen ?? liveFen, activeAnalysis?.lines[0] ?? null),
  );
  const game = $derived(new Chess(liveFen));
  const latestCodexMove = $derived(
    moves.slice().reverse().find((move) => move.side !== playerSide) ?? null,
  );
  const latestCoachNote = $derived(
    latestCodexMove ? coachNotes[latestCodexMove.ply] ?? null : null,
  );
  const feedbackBestMove = $derived(
    latestFeedback
      ? lineToSan(
          latestFeedback.move.before,
          latestFeedback.comparison.analysis.lines[0] ?? null,
        )[0] ?? latestFeedback.comparison.analysis.bestMove
      : null,
  );
  const moveAnnotation = $derived(
    historyPly === null && coachingAids && latestFeedback && moves.at(-1)?.ply === latestFeedback.move.ply
      ? latestFeedback.classification
      : null,
  );
  const historyCoachNote = $derived(
    historyMove ? coachNotes[historyMove.ply] ?? null : null,
  );
  const historyOpening = $derived(
    historyPly !== null ? openingAt(openingBook, snapshots, historyPly) : null,
  );
  const reflectionOpening = $derived(
    insight ? openingAt(openingBook, snapshots, Math.max(0, insight.move.ply - 1)) : null,
  );
  const reflectionBestMove = $derived(
    principalLine[0] ?? insight?.comparison.analysis.bestMove ?? "—",
  );
  const reflectionMoveSan = $derived(insight?.move.san ?? "your move");
  const reflectionBestScore = $derived(
    scoreLabel(insight?.comparison.analysis.lines[0] ?? null),
  );
  const reflectionPlayedScore = $derived(
    scoreLabel(insight?.comparison.playedLine ?? null),
  );
  const reflectionLoss = $derived(
    insight?.comparison.expectedPointsLost === null || insight?.comparison.expectedPointsLost === undefined
      ? null
      : Math.round(insight.comparison.expectedPointsLost * 100),
  );
  const ideaThread = $derived(insight ? ideaThreads[insight.move.ply] ?? [] : []);
  const ideaInFlight = $derived(
    ideaThread.some((turn) => turn.state === "queued" || turn.state === "thinking"),
  );

  function clearCoachTimers() {
    if (coachRestartTimer !== null) window.clearTimeout(coachRestartTimer);
    if (coachReadyTimer !== null) window.clearTimeout(coachReadyTimer);
    coachRestartTimer = null;
    coachReadyTimer = null;
  }

  function scheduleCoachRestart() {
    if (!hasNativeHost() || coachRestartTimer !== null) return;
    if (coachStartAttempts >= 3) {
      coachUnavailable = true;
      for (const pending of ideaQueue) {
        updateIdeaTurn(pending.movePly, pending.turnId, {
          reply: "Codex commentary is unavailable. The board still shows Stockfish's preferred move and evaluation.",
          state: "error",
        });
      }
      ideaQueue = [];
      if (latestCodexMove) {
        coachNotes = {
          ...coachNotes,
          [latestCodexMove.ply]: {
            heading: latestCodexMove.san,
            label: "Stockfish coaching",
            text: "Codex commentary is unavailable. Stockfish's coaching aids remain active.",
          },
        };
      }
      return;
    }
    coachRestartTimer = window.setTimeout(() => {
      coachRestartTimer = null;
      void startCoachReliably(true);
    }, 1_500);
  }

  async function startCoachReliably(restart = false) {
    if (!hasNativeHost()) return;
    coachUnavailable = false;
    coachStartAttempts += 1;
    try {
      if (restart) await stopCoach();
      const snapshot = await startCoach();
      if (snapshot.status === "ready") {
        codexReady = true;
        coachUnavailable = false;
        coachStartAttempts = 0;
        clearCoachTimers();
        drainCoachQueue();
        return;
      }
      if (snapshot.status === "error" || snapshot.status === "offline") {
        throw new Error(snapshot.detail);
      }
      if (coachReadyTimer !== null) window.clearTimeout(coachReadyTimer);
      coachReadyTimer = window.setTimeout(() => {
        coachReadyTimer = null;
        if (!codexReady) scheduleCoachRestart();
      }, 12_000);
    } catch {
      codexReady = false;
      scheduleCoachRestart();
    }
  }

  onMount(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    try {
      openingRotation = Number.parseInt(
        localStorage.getItem(CODEX_OPENING_ROTATION_KEY) ?? "0",
        10,
      ) || 0;
      const saved = JSON.parse(localStorage.getItem(CODEX_PLAY_STORAGE_KEY) ?? "null") as {
        liveFen?: string;
        playerSide?: Side;
        moves?: CodexPlayMove[];
        note?: string;
        coachingAids?: boolean;
        openingSeed?: number;
      } | null;
      if (saved?.liveFen && saved.moves) {
        liveFen = saved.liveFen;
        moves = saved.moves;
        playerSide = saved.playerSide ?? "w";
        flipped = playerSide === "b";
        note = saved.note ?? "Game restored. Take a moment with the position.";
        noteLabel = "Welcome back";
        coachingAids = saved.coachingAids ?? true;
        gameStarted = saved.moves.length > 0;
        openingSeed = saved.openingSeed ?? openingRotation;
      }
    } catch {
      localStorage.removeItem(CODEX_PLAY_STORAGE_KEY);
    }

    void loadOpeningBook().then((book) => {
      if (!disposed) openingBook = book;
    });
    if (!hasNativeHost()) return;
    void (async () => {
      const engine = await getEngineStatus();
      if (disposed) return;
      if (!engine.available) {
        phase = "offline";
        statusText = engine.message;
        return;
      }
      engineName = engine.name ?? "Stockfish";
      unlisten = await onCoachEvent(handleCoachEvent);
      await startCoachReliably();
      if (!gameStarted) {
        phase = "ready";
        statusText = "Set up your session";
      } else if (game.turn() === playerSide) {
        phase = "ready";
        statusText = "Your move";
      } else void makeCodexMove(++turnToken);
    })();

    return () => {
      disposed = true;
      turnToken += 1;
      clearCoachTimers();
      unlisten?.();
    };
  });

  $effect(() => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      CODEX_PLAY_STORAGE_KEY,
      JSON.stringify({ liveFen, playerSide, moves, note, coachingAids, openingSeed }),
    );
  });

  function handleSquare(square: string) {
    if (!gameStarted || phase !== "ready" || reflectionFen || historyPly !== null || displayPosition.turn() !== playerSide) return;
    const piece = displayPosition.get(square as Square);
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
    const from = selected;
    selected = null;
    void playPlayerMove(from, square);
  }

  async function playPlayerMove(from: string, to: string) {
    const before = liveFen;
    const chess = new Chess(before);
    let played;
    try {
      played = chess.move({ from, to, promotion: "q" });
    } catch {
      return;
    }
    const record = moveRecord(played, moves.length + 1);
    const token = ++turnToken;
    liveFen = record.after;
    moves = [...moves, record];
    lastMove = { from, to };
    reflectionFen = null;
    ideaDraft = "";
    latestFeedback = null;
    insight = null;

    const bookMove = exactOpening(openingBook, record.after, record.ply);
    const session = gameSession;
    const comparisonPromise = compareMove(before, record.uci, CODEX_COMPARE_TIME_MS)
      .then((comparison) => {
        if (session !== gameSession) return null;
        const feedback: LiveFeedback = {
          move: record,
          comparison,
          classification: classifyLiveMove(
            comparison,
            record.uci,
            record.side,
            Boolean(bookMove),
          ),
        };
        if (!latestFeedback || feedback.move.ply >= latestFeedback.move.ply) {
          latestFeedback = feedback;
        }
        if (isNotableComparison(comparison) && !bookMove) {
          insight = { before, move: record, comparison };
        }
        return feedback;
      })
      .catch(() => {
        // Coaching is optional; an unavailable comparison never stops play.
        return null;
      });

    if (new Chess(liveFen).isGameOver()) {
      finishGame();
      const feedback = await comparisonPromise;
      if (feedback) queuePlayerOnlyNote(feedback, bookMove);
      return;
    }

    const explanation = await makeCodexMove(token, false);
    const feedback = await comparisonPromise;
    if (explanation?.session === gameSession) {
      const combined = { ...explanation, playerFeedback: feedback };
      prepareCoachNote(combined);
      queueMoveNote(combined);
    }
  }

  async function makeCodexMove(
    token: number,
    explain = true,
  ): Promise<PendingExplanation | null> {
    selected = null;
    phase = "opponent-thinking";
    statusText = "Codex is thinking";
    const before = liveFen;
    let analysis: AnalysisResult | null = null;
    let opening: OpeningMatch | null = null;
    let uci: string | null = null;

    try {
      const nextPly = moves.length + 1;
      const continuations = openingContinuations(openingBook, before, nextPly);
      if (continuations.length) {
        const choice = chooseTeachingContinuation(
          continuations,
          teachingRepertoire(nextPly, moves[0]?.uci),
          nextPly <= 2 ? openingSeed : openingSeed + nextPly,
        );
        if (!choice) throw new Error("The opening book had no playable continuation.");
        uci = choice.uci;
        opening = choice.match;
        await new Promise((resolve) => setTimeout(resolve, 260));
      } else {
        analysis = await analyzePosition(
          before,
          16,
          1,
          CODEX_MOVE_TIME_MS,
        );
        uci = analysis.bestMove;
      }
      if (token !== turnToken || !uci) return null;
      const played = playUci(before, uci);
      if (!played) throw new Error("Stockfish returned an unplayable move.");
      const record = moveRecord(played, moves.length + 1);
      liveFen = record.after;
      moves = [...moves, record];
      lastMove = { from: played.from, to: played.to };
      latestAnalysis = analysis;
      noteLabel = opening?.name ?? currentOpening?.name ?? "Codex's move";
      note = analysis
        ? `${record.san}. Stockfish considered for ${(analysis.elapsedMs / 1_000).toFixed(1)} seconds; Codex's explanation can arrive while you play.`
        : `${record.san} continues ${opening?.name ?? "the opening"} without an engine search.`;
      const explanation = { session: gameSession, before, move: record, analysis, opening };
      prepareCoachNote(explanation);
      if (explain) queueMoveNote(explanation);
      if (new Chess(liveFen).isGameOver()) {
        finishGame();
        return explanation;
      }
      phase = "ready";
      statusText = "Your move";
      return explanation;
    } catch (error) {
      if (token !== turnToken) return null;
      phase = "offline";
      statusText = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  function openInsight() {
    if (!insight) return;
    selected = null;
    historyPly = null;
    reflectionFen = insight.before;
    ideaDraft = "";
  }

  function closeInsight() {
    reflectionFen = null;
    ideaDraft = "";
  }

  function browsePly(ply: number) {
    if (!gameStarted || reflectionFen || !moves.length) return;
    historyPly = Math.max(0, Math.min(moves.length, ply));
    selected = null;
  }

  function stepHistoryBack() {
    const current = historyPly ?? moves.length;
    if (current > 0) browsePly(current - 1);
  }

  function stepHistoryForward() {
    if (historyPly === null) return;
    if (historyPly < moves.length) browsePly(historyPly + 1);
    else returnToLive();
  }

  function returnToLive() {
    historyPly = null;
    selected = null;
  }

  function handleHistoryKeyboard(event: KeyboardEvent) {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      !gameStarted ||
      reflectionFen
    ) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.matches("input, textarea, select, [contenteditable='true']")) return;

    if (event.key === "ArrowLeft" && (historyPly ?? moves.length) > 0) {
      event.preventDefault();
      stepHistoryBack();
    } else if (event.key === "ArrowRight" && historyPly !== null) {
      event.preventDefault();
      stepHistoryForward();
    }
  }

  function retryCodexMove() {
    if (new Chess(liveFen).turn() === playerSide) {
      phase = "ready";
      statusText = "Your move";
      return;
    }
    void makeCodexMove(++turnToken);
  }

  function updateIdeaTurn(movePly: number, turnId: number, update: Partial<IdeaTurn>) {
    const thread = ideaThreads[movePly] ?? [];
    ideaThreads = {
      ...ideaThreads,
      [movePly]: thread.map((turn) => turn.id === turnId ? { ...turn, ...update } : turn),
    };
  }

  function askAboutMove(question = ideaDraft) {
    const idea = question.trim();
    if (!idea || !insight || ideaInFlight) return;
    const movePly = insight.move.ply;
    const turnId = nextIdeaTurnId++;
    const existing = ideaThreads[movePly] ?? [];
    const discussion = existing
      .filter((turn) => turn.reply)
      .map((turn) => `Player: ${turn.question}\nCodex: ${turn.reply}`)
      .join("\n");
    const context = codexPositionContext({
      fen: insight.before,
      playerSide,
      opening: reflectionOpening?.name ?? currentOpening?.name ?? null,
      history: moves.slice(-8),
      analysis: insight.comparison.analysis,
      comparison: insight.comparison,
      classification: latestFeedback?.move.ply === movePly ? latestFeedback.classification : null,
      playerMove: insight.move,
      playerIdea: [discussion, `Latest player question: ${idea}`].filter(Boolean).join("\n"),
    });
    const pending: PendingIdea = {
      session: gameSession,
      movePly,
      turnId,
      question: idea,
      context,
    };
    ideaThreads = {
      ...ideaThreads,
      [movePly]: [
        ...existing,
        coachUnavailable
          ? {
              id: turnId,
              question: idea,
              reply: "Codex commentary is unavailable. The board still shows Stockfish's preferred move and evaluation.",
              state: "error",
            }
          : { id: turnId, question: idea, reply: "", state: "queued" },
      ],
    };
    if (coachUnavailable) {
      ideaDraft = "";
      return;
    }
    ideaQueue = [...ideaQueue, pending];
    ideaDraft = "";
    drainCoachQueue();
  }

  function handleIdeaKeydown(event: KeyboardEvent) {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    askAboutMove();
  }

  async function requestIdea(pending: PendingIdea) {
    if (pending.session !== gameSession) return;
    coachBusy = true;
    activeIdea = pending;
    activeCoachRequest = {
      purpose: "idea",
      session: pending.session,
      movePly: pending.movePly,
      ideaTurnId: pending.turnId,
    };
    updateIdeaTurn(pending.movePly, pending.turnId, { state: "thinking" });
    codexReply = "";
    try {
      await sendCoachMessage(
        "Answer the player's latest question directly in at most 90 words. Use the supplied Stockfish comparison as evidence. Explain the concrete position in accessible chess language: what their move accomplishes, what it changes or misses, and why the preferred move works better. Address follow-up challenges precisely instead of repeating prior advice. Use notation only when it clarifies the idea. Plain prose only.",
        pending.context,
        "live",
      );
    } catch {
      coachBusy = false;
      activeCoachRequest = null;
      activeIdea = null;
      updateIdeaTurn(pending.movePly, pending.turnId, {
        reply: `Codex is unavailable. Stockfish's line begins ${principalLine.slice(0, 4).join(" ") || reflectionBestMove}.`,
        state: "error",
      });
      codexReady = false;
      scheduleCoachRestart();
    }
  }

  function prepareCoachNote(explanation: PendingExplanation) {
    const feedback = explanation.playerFeedback;
    const heading = feedback
      ? explanation.move.side === playerSide
        ? feedback.move.san
        : `${feedback.move.san} · ${explanation.move.san}`
      : explanation.move.san;
    const label = feedback
      ? `${classificationLabel(feedback.classification)} after ${feedback.move.san}`
      : explanation.opening?.name ?? "Codex's move";
    const text = feedback
      ? `Sol is comparing ${feedback.move.san} with Stockfish's preferred plan. Keep playing.`
      : explanation.analysis
        ? "Sol is turning Stockfish's choice into a human idea. Keep playing."
        : `Sol is explaining why ${explanation.move.san} belongs in ${explanation.opening?.name ?? "this opening"}. Keep playing.`;
    coachNotes = {
      ...coachNotes,
      [explanation.move.ply]: { heading, label, text },
    };
  }

  function queuePlayerOnlyNote(feedback: LiveFeedback, opening: OpeningMatch | null) {
    const explanation: PendingExplanation = {
      session: gameSession,
      before: feedback.move.before,
      move: feedback.move,
      analysis: feedback.comparison.analysis,
      opening,
      playerFeedback: feedback,
    };
    prepareCoachNote(explanation);
    queueMoveNote(explanation);
  }

  function queueMoveNote(explanation: PendingExplanation) {
    if (explanation.session !== gameSession) return;
    if (!explanationQueue.some((queued) => queued.move.ply === explanation.move.ply)) {
      explanationQueue = [...explanationQueue, explanation];
    }
    drainCoachQueue();
  }

  function drainCoachQueue() {
    if (!codexReady || coachBusy) return;
    const [idea, ...remainingIdeas] = ideaQueue;
    if (idea) {
      ideaQueue = remainingIdeas;
      if (idea.session === gameSession) void requestIdea(idea);
      else drainCoachQueue();
      return;
    }
    const [explanation, ...remainingExplanations] = explanationQueue;
    if (explanation) {
      explanationQueue = remainingExplanations;
      if (explanation.session === gameSession) void requestMoveNote(explanation);
      else drainCoachQueue();
    }
  }

  async function requestMoveNote(explanation: PendingExplanation) {
    if (explanation.session !== gameSession) return;
    coachBusy = true;
    codexReply = "";
    activeCoachRequest = {
      purpose: "move",
      session: explanation.session,
      movePly: explanation.move.ply,
    };
    activeExplanation = explanation;
    const context = codexPositionContext({
      fen: explanation.playerFeedback?.move.before ?? explanation.before,
      playerSide,
      opening: explanation.opening?.name ?? currentOpening?.name ?? null,
      history: moves.slice(-8),
      analysis: explanation.playerFeedback?.comparison.analysis ?? explanation.analysis,
      comparison: explanation.playerFeedback?.comparison,
      classification: explanation.playerFeedback?.classification,
      playerMove: explanation.playerFeedback?.move,
      codexMove: explanation.move.side === playerSide ? null : explanation.move,
    });
    const feedback = explanation.playerFeedback;
    const preferredMove = feedback
      ? lineToSan(
          feedback.move.before,
          feedback.comparison.analysis.lines[0] ?? null,
        )[0] ?? feedback.comparison.analysis.bestMove ?? "another move"
      : "";
    const prompt = feedback
      ? explanation.move.side === playerSide
        ? `The player just played ${feedback.move.san}, classified ${feedback.classification}. In at most 70 words, explain what the move tries to do, its concrete merit or drawback, and why Stockfish preferred ${preferredMove}. Describe the preferred move as a plan, not merely notation. Plain prose only.`
        : `Coach this full turn in at most 80 words. The player chose ${feedback.move.san}, classified ${feedback.classification}; Stockfish preferred ${preferredMove}; then you replied ${explanation.move.san}. Lead with the player's idea, explain the concrete merit or drawback, explain why Stockfish's preferred move and line fit the position, then briefly connect your reply. Plain prose only.`
      : `You just played ${explanation.move.san}. In at most 45 words, explain the move's idea and what it changes. Mention ${explanation.opening?.name ?? "the opening"} only if useful. Plain prose only.`;
    try {
      await sendCoachMessage(
        prompt,
        context,
        "live",
      );
    } catch {
      coachBusy = false;
      activeCoachRequest = null;
      activeExplanation = null;
      codexReady = false;
      if (explanation.session === gameSession) {
        explanationQueue = [explanation, ...explanationQueue];
      }
      scheduleCoachRestart();
    }
  }

  function publishCoachReply(request: ActiveCoachRequest | null, text: string) {
    const reply = text.trim();
    if (!request || request.session !== gameSession || !reply) return;
    if (request.purpose === "move") {
      const existing = coachNotes[request.movePly];
      if (existing) {
        coachNotes = {
          ...coachNotes,
          [request.movePly]: { ...existing, text: reply },
        };
      }
    } else if (request.ideaTurnId !== undefined) {
      updateIdeaTurn(request.movePly, request.ideaTurnId, { reply });
    }
  }

  function handleCoachEvent(event: Record<string, unknown>) {
    const method = typeof event.method === "string" ? event.method : "";
    const params = (event.params ?? {}) as Record<string, unknown>;
    if ((event.id === 1 && event.result) || method === "chesscave/ready") {
      codexReady = true;
      coachUnavailable = false;
      coachStartAttempts = 0;
      clearCoachTimers();
      drainCoachQueue();
      return;
    }
    if (method === "turn/started") {
      const turn = params.turn as Record<string, unknown> | undefined;
      activeTurnId = typeof turn?.id === "string" ? turn.id : "";
      return;
    }
    if (method === "item/started") {
      const item = params.item as Record<string, unknown> | undefined;
      if (item?.type === "agentMessage") {
        activeMessageId = String(item.id ?? "active");
        codexReply = "";
      }
      return;
    }
    if (method === "item/agentMessage/delta") {
      const id = String(params.itemId ?? params.item_id ?? "active");
      if (!activeMessageId || activeMessageId === id) {
        codexReply += String(params.delta ?? "");
        publishCoachReply(activeCoachRequest, codexReply);
      }
      return;
    }
    if (method === "item/completed") {
      const item = params.item as Record<string, unknown> | undefined;
      if (item?.type === "agentMessage" && !codexReply && typeof item.text === "string") {
        codexReply = item.text;
      }
      return;
    }
    if (method === "turn/completed") {
      publishCoachReply(activeCoachRequest, codexReply);
      if (activeCoachRequest?.purpose === "idea" && activeCoachRequest.ideaTurnId !== undefined) {
        updateIdeaTurn(
          activeCoachRequest.movePly,
          activeCoachRequest.ideaTurnId,
          codexReply.trim()
            ? { state: "complete" }
            : { reply: "Codex finished without an answer. The engine comparison remains available above.", state: "error" },
        );
      }
      activeMessageId = "";
      activeTurnId = "";
      activeCoachRequest = null;
      activeExplanation = null;
      activeIdea = null;
      coachBusy = false;
      drainCoachQueue();
      return;
    }
    if (method === "chesscave/error") {
      const interrupted = activeExplanation;
      if (interrupted?.session === gameSession) {
        explanationQueue = [interrupted, ...explanationQueue];
      }
      if (activeIdea?.session === gameSession) {
        updateIdeaTurn(activeIdea.movePly, activeIdea.turnId, {
          reply: "Codex lost the connection before finishing this answer. The board still shows Stockfish's preferred move.",
          state: "error",
        });
      }
      codexReady = false;
      coachBusy = false;
      activeMessageId = "";
      activeTurnId = "";
      activeCoachRequest = null;
      activeExplanation = null;
      activeIdea = null;
      scheduleCoachRestart();
    }
  }

  function finishGame() {
    phase = "complete";
    const position = new Chess(liveFen);
    statusText = position.isCheckmate()
      ? `${position.turn() === "w" ? "Black" : "White"} wins by checkmate`
      : "Draw";
    noteLabel = "Game complete";
    note = position.isCheckmate()
      ? "The king has no legal escape. The full game is ready to revisit."
      : "The position has reached a drawn result.";
  }

  function newGame(side: Side = playerSide) {
    const retryCoach = coachUnavailable;
    const turnToInterrupt = activeTurnId;
    gameSession += 1;
    turnToken += 1;
    liveFen = initialFen;
    reflectionFen = null;
    historyPly = null;
    lastMove = null;
    playerSide = side;
    gameStarted = false;
    flipped = side === "b";
    selected = null;
    moves = [];
    latestAnalysis = null;
    latestFeedback = null;
    insight = null;
    ideaDraft = "";
    ideaThreads = {};
    ideaQueue = [];
    activeIdea = null;
    coachNotes = {};
    explanationQueue = [];
    codexReply = "";
    activeMessageId = "";
    activeTurnId = "";
    activeCoachRequest = null;
    activeExplanation = null;
    coachBusy = false;
    if (turnToInterrupt) void interruptCoachTurn(turnToInterrupt).catch(() => {});
    note = "Choose how much engine guidance you want, then begin.";
    noteLabel = "Session setup";
    phase = hasNativeHost() ? "ready" : "offline";
    statusText = hasNativeHost() ? "Set up your session" : "Desktop app required for Stockfish";
    if (retryCoach) {
      coachStartAttempts = 0;
      coachUnavailable = false;
      void startCoachReliably(true);
    }
  }

  function chooseSide(side: Side) {
    if (gameStarted) return;
    playerSide = side;
    flipped = side === "b";
  }

  function startGame() {
    if (gameStarted || !hasNativeHost()) return;
    gameStarted = true;
    openingSeed = openingRotation;
    openingRotation += 1;
    localStorage.setItem(CODEX_OPENING_ROTATION_KEY, String(openingRotation));
    note = playerSide === "w"
      ? "You have White. Make the first move."
      : "Codex has White and will make the first move.";
    noteLabel = "At the board";
    if (playerSide === "w") {
      phase = "ready";
      statusText = "Your move";
    } else {
      statusText = "Codex is thinking";
      void makeCodexMove(++turnToken);
    }
  }

  function resign() {
    if (phase === "complete") return;
    turnToken += 1;
    gameSession += 1;
    explanationQueue = [];
    ideaQueue = [];
    activeIdea = null;
    activeCoachRequest = null;
    activeExplanation = null;
    const turnToInterrupt = activeTurnId;
    activeTurnId = "";
    if (turnToInterrupt) void interruptCoachTurn(turnToInterrupt).catch(() => {});
    phase = "complete";
    statusText = "You resigned";
    noteLabel = "Game complete";
    note = "The position is saved. Start again whenever you are ready.";
  }

  function moveNumber(move: CodexPlayMove) {
    return Math.ceil(move.ply / 2);
  }

  function classificationLabel(value: MoveClassification): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
</script>

<svelte:window onkeydown={handleHistoryKeyboard} />

<svelte:head>
  <title>Play with Codex — ChessCave</title>
  <meta name="description" content="Play a thoughtful game against Codex and Stockfish." />
</svelte:head>

<div class="play-shell">
  {#snippet headerActions()}
    <div class="header-tools">
      <button type="button" onclick={() => (flipped = !flipped)} title="Flip board" aria-label="Flip board"><IconArrowsDownUpRegular /></button>
      <button type="button" onclick={() => newGame()} title="New game" aria-label="New game"><IconArrowCounterClockwiseRegular /></button>
      <button type="button" onclick={resign} disabled={!gameStarted || phase === "complete"} title="Resign" aria-label="Resign"><IconFlagCheckeredRegular /></button>
    </div>
  {/snippet}

  <AppHeader
    active="play"
    title="Play with Codex"
    subtitle={!gameStarted
      ? "Session setup"
      : historyPly !== null
        ? historyOpening?.name ?? "Move history"
        : currentOpening?.name ?? "A game in progress"}
    actions={headerActions}
  />

  <main>
    <section class:setup={!gameStarted} class="table" aria-label="Game against Codex">
      <div class="board-column">
        <div class="player-row top">
          <span class="avatar codex">C</span>
          <span><strong>Codex</strong><small>Varied repertoire · {engineName} 0.7s · Luna · {!hasNativeHost() ? "desktop app only" : codexReady ? coachBusy ? "forming a thought" : "ready to coach" : coachUnavailable ? "commentary unavailable" : "connecting"}</small></span>
          {#if displayPosition.inCheck() && displayPosition.turn() !== playerSide}<em>Check</em>{/if}
        </div>
        <div class:with-evaluation={coachingAids} class="board-stage">
          {#if coachingAids}
            <div class="evaluation-slot">
              <EvaluationBar
                scoreCp={evaluationLine?.scoreCp ?? null}
                scoreMate={evaluationLine?.scoreMate ?? null}
                {flipped}
              />
            </div>
          {/if}
          <div class:waiting={phase === "opponent-thinking" && historyPly === null} class="board-wrap">
            <ChessBoard
              fen={displayFen}
              {flipped}
              lastMove={displayLastMove}
              {selected}
              {legalTargets}
              annotation={moveAnnotation}
              {engineArrow}
              onSquareClick={handleSquare}
            />
            {#if phase === "opponent-thinking" && historyPly === null}
              <div class="thinking-mark" aria-hidden="true"><i></i><i></i><i></i></div>
            {/if}
          </div>
        </div>
        {#if coachingAids}
          <div class:empty={!latestFeedback || historyPly !== null} class="coach-feedback" aria-live="polite">
            {#if latestFeedback && historyPly === null}
              <MoveBadge kind={latestFeedback.classification} compact />
              <strong>{latestFeedback.move.san}</strong>
              <span>{classificationLabel(latestFeedback.classification)}</span>
              {#if feedbackBestMove && feedbackBestMove !== latestFeedback.move.san && latestFeedback.classification !== "book"}
                <em>Best: {feedbackBestMove}</em>
              {/if}
              <small>{scoreLabel(latestFeedback.comparison.playedLine)}</small>
            {/if}
          </div>
        {/if}
        {#if gameStarted && moves.length}
          <nav class="history-navigation" aria-label="Move history navigation">
            <button type="button" onclick={() => browsePly(0)} disabled={(historyPly ?? moves.length) === 0} title="Starting position" aria-label="Starting position"><IconSkipBackRegular /></button>
            <button type="button" onclick={stepHistoryBack} disabled={(historyPly ?? moves.length) === 0} title="Previous move · Left arrow" aria-label="Previous move"><IconCaretLeftRegular /></button>
            <span class:live={historyPly === null}>{historyPly === null ? "Live" : `${historyPly} / ${moves.length}`}</span>
            <button type="button" onclick={stepHistoryForward} disabled={historyPly === null} title="Next move · Right arrow" aria-label="Next move"><IconCaretRightRegular /></button>
            <button type="button" onclick={returnToLive} disabled={historyPly === null} title="Return to live position" aria-label="Return to live position"><IconSkipForwardRegular /></button>
          </nav>
        {/if}
        <div class="player-row bottom">
          <span class="avatar you">Y</span>
          <span><strong>You</strong><small>{playerSide === "w" ? "White" : "Black"}</small></span>
          {#if displayPosition.inCheck() && displayPosition.turn() === playerSide}<em>Check</em>{/if}
        </div>
      </div>

      <aside class:reflection={Boolean(reflectionFen)} class="table-note" aria-live="polite">
        <div class="position-state">
          <span class:active={gameStarted && phase === "ready" && !reflectionFen && historyPly === null}></span>
          <strong>{reflectionFen && insight ? `Discussing ${moveNumber(insight.move)}${insight.move.side === "w" ? "." : "…"}${insight.move.san}` : historyPly !== null ? `Reviewing ${historyPly} of ${moves.length}` : statusText}</strong>
          {#if reflectionFen && insight}
            <button class="position-return" type="button" onclick={closeInsight}>Back to live</button>
          {:else if historyPly !== null}
            <small>{phase === "complete" ? "Game complete" : "Live game continues"}</small>
          {/if}
        </div>

        {#if reflectionFen && insight}
          <div class:empty={!ideaThread.length} class="reflection-workspace">
            <section class="move-comparison" aria-label="Move comparison">
              <span class="eyebrow">{reflectionOpening?.name ?? "Position after your move"}</span>
              <h1>You chose <span>{insight.move.san}</span>. Stockfish preferred <i>{reflectionBestMove}</i>.</h1>
              <div class="evidence-strip">
                <div><span>Your move</span><strong>{insight.move.san}</strong><em>{reflectionPlayedScore}</em></div>
                <div><span>Stockfish</span><strong>{reflectionBestMove}</strong><em>{reflectionBestScore}</em></div>
                {#if reflectionLoss !== null}
                  <div><span>Opportunity</span><strong>{reflectionLoss}%</strong><em>expected points</em></div>
                {/if}
              </div>
            </section>

            <section class="coach-conversation" aria-label={`Discussion of ${insight.move.san}`}>
              {#if !ideaThread.length}
                <div class="conversation-start">
                  <h2>What do you want to understand?</h2>
                  <div class="question-prompts" aria-label="Suggested questions">
                    <button type="button" onclick={() => askAboutMove(`Why is ${reflectionBestMove} better than ${reflectionMoveSan}?`)}>Why is {reflectionBestMove} better?</button>
                    <button type="button" onclick={() => askAboutMove(`What is the concrete problem with ${reflectionMoveSan}?`)}>What does my move miss?</button>
                    <button type="button" onclick={() => askAboutMove("What plan should I remember from this position?")}>What should I remember?</button>
                  </div>
                </div>
              {:else}
                <div class="conversation-turns" role="log" aria-label="Coaching discussion">
                  {#each ideaThread as turn}
                    <article class:error={turn.state === "error"}>
                      <div class="player-question"><span>You</span><p>{turn.question}</p></div>
                      <div class="codex-answer">
                        <span>Codex</span>
                        {#if turn.reply}
                          <p>{turn.reply}</p>
                        {:else}
                          <p class="answer-state">{turn.state === "queued" ? codexReady ? "Waiting for the current note to finish…" : "Waiting for Codex to reconnect…" : "Reading the position…"}</p>
                        {/if}
                      </div>
                    </article>
                  {/each}
                </div>
              {/if}
            </section>

            <form class="idea-form" onsubmit={(event) => { event.preventDefault(); askAboutMove(); }}>
              <label for="idea">Ask about {insight.move.san}</label>
              <div class="idea-input">
                <textarea id="idea" bind:value={ideaDraft} onkeydown={handleIdeaKeydown} rows="2" placeholder="What doesn't add up?"></textarea>
                <button type="submit" disabled={!ideaDraft.trim() || ideaInFlight} aria-label="Ask Codex" title="Ask Codex"><IconPaperPlaneTiltRegular /></button>
              </div>
            </form>
          </div>
        {:else}
          <div class="note-copy">
            <span class="eyebrow">{historyPly !== null ? historyCoachNote?.label ?? historyOpening?.name ?? "Move history" : latestCoachNote?.label ?? noteLabel}</span>
            {#if !gameStarted}
            <h1>A serious game, with room to think aloud.</h1>
          {:else if historyPly !== null}
            <h1>{historyMove ? `${moveNumber(historyMove)}${historyMove.side === "w" ? "." : "…"} ${historyMove.san}` : "Starting position"}</h1>
            {#if historyCoachNote}
              <p>{historyCoachNote.text}</p>
            {:else if historyMove}
              <p>{historyMove.side === "w" ? "White" : "Black"} played {historyMove.san}. Use the arrows to move through the game or return to the live board.</p>
            {/if}
          {:else if latestCodexMove}
            <h1>{latestCoachNote?.heading ?? latestCodexMove.san}</h1>
            {#if latestCoachNote}<p>{latestCoachNote.text}</p>{/if}
          {:else}
            <h1>{moves.at(-1)?.san}</h1>
            {#if note}<p class:preserve={note.includes("\n")}>{note}</p>{/if}
          {/if}
          </div>

          {#if phase === "complete"}
            <button class="continue" type="button" onclick={() => newGame()}>Play again</button>
          {:else if phase === "offline" && game.turn() !== playerSide && hasNativeHost()}
            <button class="continue" type="button" onclick={retryCodexMove}>Try Codex's move again</button>
          {:else if !gameStarted}
            <div class="game-setup">
              <div class="coach-setting">
                <span><strong>Coach view</strong><small>Evaluation, move marks, and best-move arrows</small></span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={coachingAids}
                  aria-label="Coach view"
                  class:on={coachingAids}
                  onclick={() => (coachingAids = !coachingAids)}
                ><i></i></button>
              </div>
              <div class="side-choice" aria-label="Choose a side">
                <button class:chosen={playerSide === "w"} type="button" onclick={() => chooseSide("w")}>White</button>
                <button class:chosen={playerSide === "b"} type="button" onclick={() => chooseSide("b")}>Black</button>
              </div>
              <button class="start-session" type="button" disabled={!hasNativeHost()} onclick={startGame}>Begin session</button>
            </div>
          {/if}
        {/if}

        {#if !reflectionFen && historyPly === null && insight && phase !== "complete"}
          <button class="insight-invitation" type="button" onclick={openInsight}>
            <span>Earlier · {insight.move.san}</span>
            <strong>Stockfish found another useful idea</strong>
            <em>Look when ready</em>
          </button>
        {/if}

        {#if gameStarted && historyPly === null && !reflectionFen}
          <div class="line-glimpse">
            <span>Engine line</span>
            <p>{principalLine.length ? principalLine.slice(0, 5).join("  ") : currentOpening ? "Opening book — no engine wait" : "Appears after calculation"}</p>
          </div>
        {/if}
      </aside>
    </section>

    <section class="move-ribbon" aria-label="Moves played">
      <span class="opening-code">{currentOpening?.eco ?? "—"}</span>
      <div class="moves">
        {#if !moves.length}<span class="empty-moves">The moves will gather here.</span>{/if}
        {#each moves as move}
          <button type="button" class:active={historyPly === move.ply} class:player-move={move.side === playerSide} onclick={() => browsePly(move.ply)}>{move.ply % 2 === 1 ? `${moveNumber(move)}.` : ""} {move.san}</button>
        {/each}
      </div>
      <span class="turn-count">{Math.ceil(moves.length / 2)} moves</span>
    </section>
  </main>
</div>

<style>
  .play-shell { display: grid; grid-template-rows: 68px minmax(0, 1fr); height: 100%; overflow: hidden; color: var(--ink); background: #ece7dc; }
  .header-tools { display: flex; gap: 6px; justify-content: end; }
  .header-tools button { display: grid; width: 32px; height: 32px; place-items: center; border: 1px solid transparent; border-radius: 50%; color: var(--ink-soft); background: transparent; cursor: pointer; }
  .header-tools button:hover:not(:disabled) { border-color: var(--line); background: var(--pearl-raised); }
  .header-tools button:disabled { opacity: .35; }
  .header-tools :global(svg) { width: 17px; height: 17px; }
  main { min-height: 0; overflow: auto; }
  .table { display: grid; grid-template-columns: minmax(360px, 660px) minmax(300px, 430px); gap: clamp(42px, 7vw, 104px); align-items: center; justify-content: center; min-height: calc(100vh - 130px); padding: 28px clamp(24px, 5vw, 76px) 24px; }
  .board-column { width: min(100%, calc(100vh - 250px)); min-width: 0; }
  .board-stage { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; align-items: stretch; }
  .board-stage.with-evaluation { grid-template-columns: 28px minmax(0, 1fr); }
  .evaluation-slot { display: flex; min-height: 0; }
  .evaluation-slot :global(.evaluation) { min-height: 0; height: 100%; }
  .board-wrap { position: relative; transition: opacity var(--motion-fast) ease-out; }
  .board-wrap.waiting :global(.board) { filter: saturate(.88); }
  .thinking-mark { position: absolute; z-index: 8; top: 12px; right: 12px; display: flex; gap: 4px; align-items: center; height: 24px; padding: 0 9px; border: 1px solid rgba(255,255,255,.45); border-radius: 20px; background: rgba(41,36,31,.72); pointer-events: none; }
  .thinking-mark i { width: 4px; height: 4px; border-radius: 50%; background: #fffaf0; animation: pulse 1.2s ease-in-out infinite; }
  .thinking-mark i:nth-child(2) { animation-delay: 140ms; }.thinking-mark i:nth-child(3) { animation-delay: 280ms; }
  .player-row { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; gap: 10px; align-items: center; min-height: 48px; }
  .player-row.top { margin-bottom: 8px; }.player-row.bottom { margin-top: 8px; }
  .avatar { display: grid; width: 32px; height: 32px; place-items: center; border-radius: 50%; font-family: var(--display); font-size: 13px; font-weight: 650; }
  .avatar.codex { color: #fffaf2; background: var(--ink); }.avatar.you { border: 1px solid var(--line-strong); color: var(--coral-dark); background: var(--pearl-raised); }
  .player-row > span:nth-child(2) { display: grid; gap: 2px; }
  .player-row strong { font-size: 12px; }.player-row small { color: var(--muted); font-size: 9px; }
  .player-row em { color: var(--coral-dark); font-size: 10px; font-style: normal; font-weight: 700; text-transform: uppercase; }
  .coach-feedback { display: grid; grid-template-columns: 20px auto auto minmax(0, 1fr) auto; gap: 7px; align-items: center; min-height: 30px; margin-left: 36px; color: var(--ink-soft); }
  .coach-feedback.empty { visibility: hidden; }
  .coach-feedback strong { font-family: var(--display); font-size: 12px; font-weight: 650; }
  .coach-feedback span { font-size: 9px; font-weight: 700; text-transform: uppercase; }
  .coach-feedback em { overflow: hidden; color: var(--coral-dark); font-size: 10px; font-style: normal; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
  .coach-feedback small { color: var(--muted); font-size: 9px; font-variant-numeric: tabular-nums; }
  .history-navigation { display: grid; grid-template-columns: repeat(2, 28px) minmax(58px, auto) repeat(2, 28px); gap: 3px; align-items: center; justify-content: center; min-height: 34px; margin-left: 36px; }
  .history-navigation button { display: grid; width: 28px; height: 28px; place-items: center; border: 0; border-radius: 50%; color: var(--ink-soft); background: transparent; cursor: pointer; }
  .history-navigation button:hover:not(:disabled) { background: var(--pearl-raised); }
  .history-navigation button:disabled { opacity: .25; cursor: default; }
  .history-navigation :global(svg) { width: 15px; height: 15px; }
  .history-navigation span { color: var(--muted); font-size: 9px; font-variant-numeric: tabular-nums; text-align: center; }
  .history-navigation span.live { color: var(--sage); font-weight: 750; text-transform: uppercase; }
  .table-note { align-self: stretch; display: grid; grid-template-rows: auto minmax(150px, 1fr) auto auto; align-content: center; min-width: 0; padding: clamp(28px, 5vh, 60px) 0; border-block: 1px solid var(--line-strong); }
  .table-note.reflection { grid-template-rows: auto minmax(0, 1fr); align-content: stretch; padding-block: clamp(20px, 3vh, 34px); }
  .position-state { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; gap: 9px; align-items: center; padding-bottom: 20px; border-bottom: 1px solid var(--line); }
  .position-state > span { width: 7px; height: 7px; border-radius: 50%; background: var(--ochre); }.position-state > span.active { background: var(--sage); }
  .position-state strong { font-size: 11px; font-weight: 650; }.position-state small { color: var(--muted); font-size: 9px; }
  .position-return { border: 0; border-bottom: 1px solid var(--line-strong); padding: 5px 0; color: var(--ink-soft); background: transparent; font-size: 9px; font-weight: 650; cursor: pointer; }
  .position-return:hover { border-bottom-color: var(--coral-dark); color: var(--coral-dark); }
  .note-copy { align-self: center; padding: 28px 0; }
  .eyebrow { display: block; margin-bottom: 14px; color: var(--coral-dark); font-size: 9px; font-weight: 750; text-transform: uppercase; }
  h1 { max-width: 390px; margin: 0; font-family: var(--display); font-size: clamp(25px, 2.6vw, 38px); font-variation-settings: "opsz" 42, "wght" 540; line-height: 1.08; letter-spacing: 0; }
  h1 i { color: var(--coral-dark); font-style: normal; }
  .note-copy p { max-width: 390px; margin: 18px 0 0; color: var(--ink-soft); font-family: var(--display); font-size: 15px; line-height: 1.55; }.note-copy p.preserve { white-space: pre-line; }
  .reflection-workspace { display: grid; grid-template-rows: auto minmax(110px, 1fr) auto; min-height: 0; }
  .reflection-workspace.empty { grid-template-rows: auto auto auto; align-content: start; }
  .reflection-workspace.empty .idea-form { margin-top: 8px; }
  .move-comparison { padding: 24px 0 20px; border-bottom: 1px solid var(--line); }
  .move-comparison .eyebrow { margin-bottom: 9px; }
  .move-comparison h1 { max-width: 420px; font-size: clamp(22px, 2vw, 29px); line-height: 1.16; }
  .move-comparison h1 span { color: var(--ink-soft); }
  .evidence-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 18px; border-block: 1px solid var(--line); }
  .evidence-strip > div { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px 8px; min-width: 0; padding: 10px 12px 10px 0; }
  .evidence-strip > div + div { border-left: 1px solid var(--line); padding-left: 12px; }
  .evidence-strip span { grid-column: 1 / -1; color: var(--muted); font-size: 8px; font-weight: 700; text-transform: uppercase; }
  .evidence-strip strong { overflow: hidden; font-family: var(--display); font-size: 14px; font-weight: 620; text-overflow: ellipsis; white-space: nowrap; }
  .evidence-strip em { align-self: center; color: var(--muted); font-size: 9px; font-style: normal; font-variant-numeric: tabular-nums; text-align: right; }
  .coach-conversation { min-height: 0; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--line-strong) transparent; }
  .conversation-start { display: grid; gap: 14px; align-content: center; min-height: 132px; padding: 20px 0; }
  .conversation-start h2 { margin: 0; font-family: var(--display); font-size: 16px; font-weight: 560; letter-spacing: 0; }
  .question-prompts { display: flex; flex-wrap: wrap; gap: 7px 16px; }
  .question-prompts button { border: 0; border-bottom: 1px solid var(--line-strong); padding: 5px 0; color: var(--ink-soft); background: transparent; font-size: 10px; text-align: left; cursor: pointer; }
  .question-prompts button:hover { border-bottom-color: var(--coral-dark); color: var(--coral-dark); }
  .conversation-turns article { padding: 17px 0 19px; border-bottom: 1px solid var(--line); }
  .conversation-turns article.error .codex-answer { color: var(--muted); }
  .player-question, .codex-answer { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 10px; }
  .codex-answer { margin-top: 13px; color: var(--ink-soft); }
  .player-question > span, .codex-answer > span { padding-top: 3px; color: var(--muted); font-size: 8px; font-weight: 750; text-transform: uppercase; }
  .player-question p, .codex-answer p { margin: 0; overflow-wrap: anywhere; font-family: var(--display); font-size: 13px; line-height: 1.52; }
  .player-question p { color: var(--ink); font-weight: 560; }
  .codex-answer .answer-state { color: var(--muted); font-style: italic; }
  .idea-form { padding: 15px 0 12px; border-top: 1px solid var(--line-strong); }
  .idea-form label { display: block; margin-bottom: 7px; color: var(--ink-soft); font-size: 9px; font-weight: 700; }
  .idea-input { display: grid; grid-template-columns: minmax(0, 1fr) 38px; align-items: end; border-bottom: 1px solid var(--ink-soft); }
  textarea { width: 100%; min-height: 54px; max-height: 112px; resize: none; border: 0; padding: 7px 8px 9px 0; color: var(--ink); background: transparent; font-family: var(--display); font-size: 14px; line-height: 1.42; }
  textarea::placeholder { color: var(--faint); } textarea:focus { outline: 0; }
  .idea-input:focus-within { border-bottom-color: var(--coral-dark); }
  .idea-input button { display: grid; width: 34px; height: 34px; place-items: center; margin-bottom: 7px; border: 0; border-radius: 50%; color: var(--pearl); background: var(--ink); cursor: pointer; }.idea-input button:disabled { opacity: .3; }
  .idea-input :global(svg) { width: 16px; height: 16px; }
  .continue { width: fit-content; border: 1px solid var(--ink); border-radius: 3px; padding: 9px 14px; color: var(--pearl); background: var(--ink); font-size: 10px; font-weight: 650; cursor: pointer; }.continue:disabled { opacity: .4; }
  .insight-invitation { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 3px 12px; width: 100%; margin: 16px 0; border: 0; border-block: 1px solid var(--line); padding: 13px 0; color: var(--ink); background: transparent; text-align: left; cursor: pointer; }
  .insight-invitation span { grid-column: 1 / -1; color: var(--coral-dark); font-size: 8px; font-weight: 750; text-transform: uppercase; }
  .insight-invitation strong { font-family: var(--display); font-size: 13px; font-weight: 550; }
  .insight-invitation em { align-self: center; color: var(--muted); font-size: 9px; font-style: normal; }
  .insight-invitation:hover strong { color: var(--coral-dark); }
  .game-setup { display: grid; gap: 12px; padding-top: 18px; border-top: 1px solid var(--line); }
  .coach-setting { display: grid; grid-template-columns: minmax(0, 1fr) 36px; gap: 14px; align-items: center; }
  .coach-setting > span { display: grid; gap: 3px; }
  .coach-setting strong { font-size: 10px; font-weight: 700; }
  .coach-setting small { color: var(--muted); font-size: 9px; }
  .coach-setting button { position: relative; width: 34px; height: 18px; border: 1px solid var(--line-strong); border-radius: 10px; padding: 0; background: var(--pearl-raised); cursor: pointer; }
  .coach-setting button i { position: absolute; top: 3px; left: 3px; width: 10px; height: 10px; border-radius: 50%; background: var(--muted); transition: transform var(--motion-fast) ease-out, background var(--motion-fast) ease-out; }
  .coach-setting button.on { border-color: var(--sage); background: color-mix(in srgb, var(--sage) 18%, var(--pearl-raised)); }
  .coach-setting button.on i { background: var(--sage); transform: translateX(16px); }
  .side-choice { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid var(--line-strong); border-radius: 3px; overflow: hidden; }
  .side-choice button { border: 0; padding: 9px; color: var(--muted); background: transparent; font-size: 10px; cursor: pointer; }.side-choice button + button { border-left: 1px solid var(--line-strong); }.side-choice button.chosen { color: var(--pearl); background: var(--ink); }
  .start-session { border: 1px solid var(--ink); border-radius: 3px; padding: 10px 14px; color: var(--pearl); background: var(--ink); font-size: 10px; font-weight: 700; cursor: pointer; }
  .start-session:disabled { opacity: .42; cursor: default; }
  .line-glimpse { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 12px; padding-top: 18px; border-top: 1px solid var(--line); }
  .line-glimpse span { color: var(--muted); font-size: 9px; text-transform: uppercase; }.line-glimpse p { margin: 0; overflow: hidden; color: var(--ink-soft); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .move-ribbon { position: sticky; bottom: 0; display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 14px; align-items: center; min-height: 58px; padding: 9px 24px; border-top: 1px solid var(--line); background: rgba(251,248,242,.97); backdrop-filter: blur(12px); }
  .opening-code { color: var(--coral-dark); font-family: var(--display); font-size: 14px; font-weight: 650; }
  .moves { display: flex; gap: 13px; align-items: center; overflow-x: auto; scrollbar-width: none; }
  .moves button { flex: 0 0 auto; border: 0; border-bottom: 1px solid transparent; padding: 5px 1px; color: var(--muted); background: transparent; font-size: 10px; cursor: pointer; }
  .moves button:hover, .moves button.active { border-bottom-color: var(--coral-dark); color: var(--coral-dark); }
  .moves button.player-move { color: var(--ink); font-weight: 650; }
  .moves button.player-move.active { color: var(--coral-dark); }
  .moves .empty-moves { flex: 0 0 auto; color: var(--faint); font-family: var(--display); font-size: 12px; }
  .turn-count { color: var(--muted); font-size: 9px; }
  @keyframes pulse { 0%, 100% { opacity: .35; transform: translateY(1px); } 50% { opacity: 1; transform: translateY(-1px); } }
  @media (max-width: 900px) {
    .table { grid-template-columns: minmax(300px, 570px); gap: 28px; min-height: auto; padding-block: 22px 36px; }
    .table.setup .table-note { order: -1; }
    .board-column { width: 100%; }
    .table-note { min-height: 360px; padding: 28px 0; }
    .table-note.reflection { min-height: 540px; }
    .coach-conversation { max-height: none; overflow: visible; }
    h1 { font-size: 28px; }
  }
  @media (max-width: 560px) {
    .play-shell { grid-template-rows: 62px minmax(0, 1fr); }
    .table { padding: 12px 12px 28px; }.player-row { min-height: 42px; }.table-note { min-height: 330px; }.move-ribbon { padding-inline: 12px; }
    .table-note.reflection { min-height: 560px; }
    .move-comparison h1 { font-size: 23px; }
    .evidence-strip > div { padding-right: 8px; }
    .evidence-strip > div + div { padding-left: 8px; }
    .evidence-strip strong { font-size: 13px; }
    .question-prompts { display: grid; justify-items: start; }
    .player-question, .codex-answer { grid-template-columns: 38px minmax(0, 1fr); gap: 7px; }
    .board-stage.with-evaluation { grid-template-columns: 22px minmax(0, 1fr); gap: 6px; }
    .evaluation-slot :global(.evaluation) { width: 22px; }
    .coach-feedback { margin-left: 28px; }
    .history-navigation { margin-left: 28px; }
  }
</style>
