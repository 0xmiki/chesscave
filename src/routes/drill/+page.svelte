<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { Chess, type Square } from "chess.js";
  import AppHeader from "$lib/components/AppHeader.svelte";
  import ChessBoard from "$lib/components/ChessBoard.svelte";
  import { uciToArrow } from "$lib/chess/arrows";
  import { STUDY_STORAGE_KEY } from "$lib/chess/chesscom";
  import {
    isAcceptedPatchMove,
    reviewPatchCard,
  } from "$lib/patches/patches";
  import type { PatchCard, PatchReviewResult } from "$lib/patches/types";
  import { listPatchCards, savePatchCard } from "$lib/services/patches";

  let cards = $state<PatchCard[]>([]);
  let loading = $state(true);
  let error = $state("");
  let selected = $state<string | null>(null);
  let attemptedFen = $state<string | null>(null);
  let attemptedMove = $state<{ uci: string; san: string; correct: boolean } | null>(null);
  let saving = $state(false);
  let previousCardId = "";
  let sessionTotal = $state(0);
  let sessionCompleted = $state(0);

  const dueCards = $derived(
    cards
      .filter((card) => card.schedule.dueAt <= Date.now())
      .sort((left, right) => left.schedule.dueAt - right.schedule.dueAt),
  );
  const card = $derived(dueCards[0] ?? null);
  const boardFen = $derived(attemptedFen ?? card?.source.fen ?? new Chess().fen());
  const sourcePosition = $derived(card ? new Chess(card.source.fen) : new Chess());
  const legalTargets = $derived.by(() => {
    if (!card || attemptedMove || !selected) return [];
    return sourcePosition
      .moves({ square: selected as Square, verbose: true })
      .map((move) => move.to);
  });
  const explanation = $derived(
    card?.revealBlocks.find((block) => block.type === "explanation") ?? null,
  );
  const principle = $derived(
    card?.revealBlocks.find((block) => block.type === "principle") ?? null,
  );
  const variation = $derived(
    card?.revealBlocks.find((block) => block.type === "variation") ?? null,
  );
  const acceptedMoveArrow = $derived(
    card && attemptedMove && !attemptedMove.correct
      ? uciToArrow(card.quiz.acceptedMoves[0]?.uci)
      : null,
  );
  const understoodInterval = $derived.by(() => {
    if (!card) return "Tomorrow";
    const repetition = card.schedule.repetitions + 1;
    if (repetition === 1) return "Tomorrow";
    if (repetition === 2) return "3 days";
    return `${Math.max(6, Math.round(card.schedule.intervalDays * 2))} days`;
  });

  $effect(() => {
    const id = card?.id ?? "";
    if (id === previousCardId) return;
    previousCardId = id;
    selected = null;
    attemptedFen = null;
    attemptedMove = null;
  });

  onMount(() => {
    void listPatchCards()
      .then((loaded) => {
        cards = loaded;
        sessionTotal = loaded.filter((card) => card.schedule.dueAt <= Date.now()).length;
      })
      .catch((reason) => {
        error = reason instanceof Error ? reason.message : String(reason);
      })
      .finally(() => {
        loading = false;
      });
  });

  function handleSquare(square: string) {
    if (!card || attemptedMove) return;
    const piece = sourcePosition.get(square as Square);
    if (!selected) {
      if (piece?.color === sourcePosition.turn()) selected = square;
      return;
    }
    if (selected === square) {
      selected = null;
      return;
    }
    if (!legalTargets.includes(square as Square)) {
      selected = piece?.color === sourcePosition.turn() ? square : null;
      return;
    }

    const chess = new Chess(card.source.fen);
    const move = chess.move({ from: selected, to: square, promotion: "q" });
    selected = null;
    if (!move) return;
    const uci = `${move.from}${move.to}${move.promotion ?? ""}`;
    attemptedMove = {
      uci,
      san: move.san,
      correct: isAcceptedPatchMove(card, uci),
    };
    attemptedFen = chess.fen();
  }

  async function record(result: PatchReviewResult) {
    if (!card || saving) return;
    saving = true;
    error = "";
    try {
      const updated = reviewPatchCard(card, result);
      await savePatchCard(updated);
      cards = cards.map((existing) => existing.id === updated.id ? updated : existing);
      sessionCompleted += 1;
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    } finally {
      saving = false;
    }
  }

  async function openSource() {
    if (!card) return;
    localStorage.setItem(
      STUDY_STORAGE_KEY,
      JSON.stringify({
        pgn: card.source.pgn,
        currentPly: Math.min(
          card.source.decisionPly + (card.source.playedMove ? 1 : 0),
          10_000,
        ),
        sourceUrl: card.source.sourceUrl,
      }),
    );
    await goto("/study");
  }

  function handleReviewShortcut(event: KeyboardEvent) {
    if (!attemptedMove || saving || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
    if (event.key === "1") void record("again");
    if (event.key === "2") void record("understood");
  }
</script>

<svelte:head>
  <title>Drill — ChessCave</title>
  <meta name="description" content="Practice the positions you chose to patch." />
</svelte:head>

<svelte:window onkeydown={handleReviewShortcut} />

<div class="app-shell">
  {#snippet headerActions()}
    {#if cards.length}
      <span class="due-count">
        {sessionTotal ? `${Math.min(sessionCompleted + 1, sessionTotal)} of ${sessionTotal}` : "Queue complete"}
        · {cards.length} saved
      </span>
    {/if}
  {/snippet}

  <AppHeader
    active="drill"
    title="Your patches"
    subtitle="Recall the move before revealing the lesson"
    actions={headerActions}
  />

  <main>
    {#if loading}
      <section class="state-card"><span class="spinner"></span><p>Loading your patches…</p></section>
    {:else if error && !card}
      <section class="state-card error-state"><span>DRILL UNAVAILABLE</span><h1>Your patches could not be opened.</h1><p>{error}</p></section>
    {:else if !card}
      <section class="state-card empty-state">
        <span>{cards.length ? "QUEUE COMPLETE" : "NO PATCHES YET"}</span>
        <h1>{cards.length ? "You are caught up." : "Turn a mistake into something trainable."}</h1>
        <p>
          {cards.length
            ? "The next patch will return when it is useful to recall again."
            : "Open a game in Study, stop on the move that mattered, and choose Patch."}
        </p>
        <a href="/study">Open Study</a>
      </section>
    {:else}
      <section class="drill-shell">
        <div class="board-column">
          <div class="card-context">
            <span>{card.source.gameTitle}</span>
            <strong>{card.quiz.prompt}</strong>
            <small>{card.source.orientation === "white" ? "White" : "Black"} at the bottom · play your answer</small>
          </div>
          <div class:answered={Boolean(attemptedMove)} class="board-wrap">
            <ChessBoard
              fen={boardFen}
              flipped={card.source.orientation === "black"}
              lastMove={attemptedMove
                ? { from: attemptedMove.uci.slice(0, 2), to: attemptedMove.uci.slice(2, 4) }
                : null}
              {selected}
              {legalTargets}
              annotation={attemptedMove ? attemptedMove.correct ? "best" : "mistake" : null}
              engineArrow={acceptedMoveArrow}
              onSquareClick={handleSquare}
            />
          </div>
        </div>

        <aside class:revealed={Boolean(attemptedMove)} class="lesson">
          {#if !attemptedMove}
            <div class="waiting-copy">
              <span>YOUR TURN</span>
              <h1>Commit to a move.</h1>
              <p>The explanation stays hidden until you make a decision on the board.</p>
            </div>
            <button class="source-link" type="button" onclick={openSource}>Open source game</button>
          {:else}
            <div class:correct={attemptedMove.correct} class="result" aria-live="polite">
              <span>{attemptedMove.correct ? "FOUND" : "NOT YET"}</span>
              <h1>{attemptedMove.san}</h1>
              <p>
                {attemptedMove.correct
                  ? "That is the move this patch was built to recall."
                  : `The patch move is ${card.quiz.acceptedMoves.map((move) => move.san).join(" or ")}. The arrow shows it on the board.`}
              </p>
            </div>

            <div class="diagnosis">
              <span>WHAT WENT WRONG</span>
              <p>{card.diagnosis.mistake}</p>
            </div>
            {#if explanation?.type === "explanation"}
              <div class="reveal-block">
                <span>WHY</span>
                <p>{explanation.text}</p>
              </div>
            {/if}
            {#if variation?.type === "variation"}
              <div class="line"><span>LINE</span><p>{variation.moves.join(" ")}</p></div>
            {/if}
            {#if principle?.type === "principle"}
              <div class="principle"><span>PATCH</span><p>{principle.text}</p></div>
            {/if}
            {#if error}<p class="save-error">{error}</p>{/if}
            <div class="review-actions">
              <button type="button" disabled={saving} onclick={() => record("again")}> 
                <span>{saving ? "Saving…" : "Again"}</span>
                <small><kbd>1</kbd> · 10 min</small>
              </button>
              <button class="understood" type="button" disabled={saving} onclick={() => record("understood")}> 
                <span>{saving ? "Saving…" : "Understood"}</span>
                <small><kbd>2</kbd> · {understoodInterval}</small>
              </button>
            </div>
            <button class="source-link after-answer" type="button" onclick={openSource}>Open source game</button>
          {/if}
        </aside>
      </section>
    {/if}
  </main>
</div>

<style>
  .app-shell {
    position: fixed;
    inset: 0;
    display: grid;
    grid-template-rows: 68px minmax(0, 1fr);
    color: var(--ink);
    background: var(--paper);
  }

  .due-count {
    color: var(--muted);
    font-size: 10px;
  }

  main {
    min-width: 0;
    min-height: 0;
    overflow: auto;
  }

  .drill-shell {
    display: grid;
    grid-template-columns: minmax(380px, 650px) minmax(320px, 430px);
    gap: clamp(46px, 7vw, 100px);
    align-items: center;
    justify-content: center;
    min-height: 100%;
    padding: 34px clamp(24px, 5vw, 76px);
  }

  .board-column {
    width: min(100%, calc(100vh - 190px));
  }

  .card-context {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 5px 16px;
    padding: 0 0 14px;
  }

  .card-context > span,
  .card-context small {
    color: var(--muted);
    font-size: 9px;
  }

  .card-context strong {
    grid-column: 1 / -1;
    font-family: var(--display);
    font-size: clamp(21px, 2.2vw, 30px);
    font-variation-settings: "opsz" 32, "wght" 570;
    line-height: 1.12;
  }

  .card-context small {
    grid-row: 1;
    grid-column: 2;
  }

  .board-wrap {
    border: 1px solid var(--line-strong);
    box-shadow: 0 22px 60px rgba(62, 48, 37, 0.1);
  }

  .lesson {
    display: grid;
    align-content: center;
    min-height: min(580px, calc(100vh - 150px));
    padding-block: 32px;
    border-block: 1px solid var(--line-strong);
  }

  .waiting-copy > span,
  .result > span,
  .diagnosis > span,
  .reveal-block > span,
  .line > span,
  .principle > span,
  .state-card > span {
    color: var(--coral-dark);
    font-size: 8px;
    font-weight: 780;
    letter-spacing: 0.13em;
  }

  .waiting-copy h1,
  .result h1,
  .state-card h1 {
    margin: 8px 0 0;
    font-family: var(--display);
    font-size: 34px;
    font-variation-settings: "opsz" 38, "wght" 560;
  }

  .waiting-copy p,
  .result p,
  .state-card p {
    margin: 13px 0 0;
    color: var(--muted);
    font-family: var(--display);
    font-size: 14px;
    line-height: 1.55;
  }

  .source-link {
    width: fit-content;
    margin-top: 28px;
    border: 0;
    border-bottom: 1px solid var(--line-strong);
    padding: 5px 0;
    color: var(--ink-soft);
    background: transparent;
    font-size: 10px;
    cursor: pointer;
  }

  .source-link.after-answer {
    margin-top: 14px;
  }

  .result {
    padding-bottom: 18px;
    border-bottom: 1px solid var(--line);
  }

  .result.correct > span,
  .result.correct h1 {
    color: var(--sage);
  }

  .diagnosis,
  .reveal-block,
  .line {
    padding: 15px 0;
    border-bottom: 1px solid var(--line);
  }

  .diagnosis p,
  .reveal-block p,
  .line p,
  .principle p {
    margin: 6px 0 0;
    color: var(--ink-soft);
    font-family: var(--display);
    font-size: 13px;
    line-height: 1.52;
  }

  .principle {
    margin-top: 16px;
    padding: 13px 14px;
    border-left: 3px solid var(--coral);
    background: var(--coral-soft);
  }

  .review-actions {
    display: grid;
    grid-template-columns: 1fr 1.3fr;
    gap: 8px;
    margin-top: 18px;
  }

  .review-actions button {
    display: grid;
    gap: 1px;
    place-items: center;
    min-height: 42px;
    border: 1px solid var(--line-strong);
    border-radius: 8px;
    color: var(--ink-soft);
    background: var(--pearl-raised);
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
  }

  .review-actions button span {
    font-size: 11px;
    font-weight: 700;
  }

  .review-actions button small {
    color: var(--muted);
    font-size: 8px;
    font-weight: 550;
  }

  .review-actions .understood small {
    color: rgba(255, 255, 255, 0.65);
  }

  kbd {
    font: inherit;
    font-weight: 750;
  }

  .review-actions .understood {
    border-color: var(--ink);
    color: var(--pearl-raised);
    background: var(--ink);
  }

  .review-actions button:disabled {
    opacity: 0.45;
  }

  .save-error {
    margin: 12px 0 0;
    color: var(--danger);
    font-size: 10px;
  }

  .state-card {
    display: grid;
    width: min(560px, calc(100% - 40px));
    min-height: 320px;
    align-content: center;
    justify-items: start;
    margin: 10vh auto 0;
    padding: 38px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--pearl);
  }

  .state-card a {
    margin-top: 24px;
    border-radius: 8px;
    padding: 10px 14px;
    color: var(--pearl-raised);
    background: var(--ink);
    font-size: 11px;
    font-weight: 700;
    text-decoration: none;
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid var(--line);
    border-top-color: var(--coral);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  @media (prefers-reduced-motion: reduce) {
    .spinner { animation: none; }
  }

  @media (max-width: 920px) {
    .drill-shell {
      grid-template-columns: minmax(320px, 620px);
      gap: 30px;
      align-content: start;
    }

    .board-column {
      width: 100%;
    }

    .lesson {
      min-height: 340px;
    }
  }

  @media (max-width: 680px) {
    .app-shell { grid-template-rows: 62px minmax(0, 1fr); }
    .drill-shell { padding: 20px 12px 34px; }
    .card-context { grid-template-columns: 1fr; }
    .card-context small { grid-row: auto; grid-column: 1; }
  }
</style>
