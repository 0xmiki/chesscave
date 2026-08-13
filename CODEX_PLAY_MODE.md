# Play with Codex: interaction plan

## What this mode should feel like

This is a coaching session expressed as a live chess game. Codex is the
opponent and the person across the table. Stockfish supplies immediate,
measured feedback underneath it. Coaching stays present without repeatedly
turning the board into a blocking lesson screen.

The board always shows the live game unless the player deliberately reviews an
earlier position or opens an earlier idea. The player never has to press
“Continue” after making a move.

## The three participants

### The player

The player chooses moves, decides whether an earlier choice is worth revisiting,
and may explain what they were trying to achieve. They never wait for Codex's
prose before they are allowed to play.

### Stockfish

Stockfish has two narrow responsibilities:

1. Choose Codex's move when the game is outside the opening book.
2. Quietly compare every player move so coach view always has a current
   evaluation and move classification. Known book moves retain the book label.

Stockfish does not write coaching copy. It does not analyze known opening moves.
It does not stop the game because its first choice differs from the player's.

### Codex

Codex explains its own move in human terms and responds when the player shares
an idea. It receives the opening, position, moves, and Stockfish evidence.
Codex does not choose the engine move or invent an evaluation.

Live turns use `gpt-5.6-luna` with low reasoning effort. The task is short and well-defined, while Stockfish supplies the
chess judgment, so additional model reasoning would add latency without owning
an important decision. Study mode continues to use `gpt-5.6-terra` at medium
effort. Both model choices can be overridden with `CHESSCAVE_LIVE_COACH_MODEL`
and `CHESSCAVE_STUDY_COACH_MODEL`. The optional
`CHESSCAVE_LIVE_COACH_SERVICE_TIER=priority` enables the account's faster tier.

The installed app-server exposed Sol, Terra, Luna, GPT-5.4, GPT-5.4 Mini, and
Codex Spark. Its catalog calls Spark “ultra-fast” for coding and Luna “fast and
affordable.” GPT-5.4 Mini is marked for replacement by Luna. OpenAI does not
publish guaranteed tokens-per-second figures for these Codex choices, so a
representative local turn was measured as well:

| Model at low effort | First text | Complete |
| --- | ---: | ---: |
| GPT-5.3 Codex Spark | 6,855 ms | 7,158 ms |
| GPT-5.6 Luna | 4,762 ms | 5,508 ms |
| GPT-5.6 Terra | 7,106 ms | 7,708 ms |

These are single observed samples, not platform guarantees. Luna won the actual
workload and also supports the account's priority tier, described by app-server
as 1.5x speed with increased usage. A separate priority sample was slower due to
normal request variance, so ChessCave does not spend that increased usage by
default. Luna at low effort is the best observed default tradeoff.

ChessCave renders streamed text as soon as app-server emits the first delta; it
does not wait for `turn/completed`. Live prompts include only the latest eight
plies plus the current engine evidence, preventing game-length context growth
from quietly increasing response time.

## The complete interaction in plain English

### Starting a game

The empty board is a real setup state. The player chooses White or Black and
decides whether coach view is on. Coach view adds the evaluation bar, move
classification icons, and best-move arrows. Codex's spoken coaching remains
part of either setting. Pressing “Begin session” fixes that contract for the
game. If Codex has White, it then begins immediately.

Codex uses a rotating teaching repertoire rather than choosing the opening with
the deepest named database branch. With White it cycles through `1.e4`,
`1.d4`, `1.c4`, and `1.Nf3`. Against `1.e4` it rotates through Open Games,
Sicilian, French, Caro-Kann, Scandinavian, Alekhine, Pirc, and Modern
structures. Against `1.d4` it rotates through Queen's Pawn, Indian, Dutch,
Benoni, Horwitz, and Modern structures. English and Réti starts have their own
similarly broad response sets. The rotation is saved locally so starting a new
session advances the repertoire instead of immediately repeating the previous
defense.

### When the player makes an opening move

1. The piece moves immediately.
2. ChessCave checks the local opening book, which is effectively instant.
3. A disposable 650 ms Stockfish comparison starts in the background to update
   coach view. The move is still classified as book.
4. Codex chooses a known continuation from the book after a short 260 ms visual
   beat, so the reply feels causal rather than abrupt.
5. The live board becomes playable again.
6. Codex writes a short explanation in the background. It uses opening-book
   context directly instead of launching a duplicate engine tool call, and may
   update while the player is already thinking.

Expected wait before Codex moves: about 0.26 seconds. There is no engine wait.

### When the player makes a move outside the opening book

1. The piece moves immediately.
2. Two independent Stockfish jobs start together.
3. The important job gives Codex 700 ms to choose its reply with one principal
   variation. This is the only job that temporarily owns the turn.
4. The background job gets a total 650 ms to compare the player's move with
   Stockfish's candidates. It analyzes both the best choice and the played
   choice from the same warmed engine process.
5. As soon as the 700 ms move search returns, Codex's piece moves and the player
   gets the turn. The background comparison does not have to finish first.
6. Codex starts a short explanation in the background. The player can move
   before it arrives.

The live prompt already includes Stockfish's result. Luna is explicitly told
to use that evidence directly rather than calling the chess MCP and waiting for
a duplicate engine search.

Expected wait before Codex moves: roughly 1.2 to 1.4 seconds including local
engine startup. The hard UI timeout is six seconds for a comparison and the
existing native command still guards an opponent search. A failed comparison is
silently discarded. A failed opponent search keeps the position and offers a
retry.

### What coach view shows

Every completed player comparison updates three coordinated signals without
pausing play: the evaluation bar, the familiar move-quality badge, and the
score from White's perspective. If Stockfish preferred a different move, its
arrow appears on the board and its SAN appears beside the badge. These signals
remain explicitly labelled with the player's move until the next player move,
so they cannot be mistaken for a judgment of Codex's reply.

### When Stockfish finds another useful idea

The comparison is measured by expected-points loss, not by exact move equality.
An alternative is shown only when the loss is at least eight percentage points.
Sound equivalent moves remain quiet.

The game does not rewind and the turn does not stop. A small invitation appears:
“Stockfish found another useful idea — look when ready.” The player can ignore
it forever and continue the game normally.

### When the player reviews earlier moves

The history controls beneath the board move to the first, previous, next, or
live position. The move ribbon is also directly clickable, and Left/Right arrow
keys step through history when focus is not inside an input. Entering history
never rewinds the actual game: Codex may finish its current work and the live
position remains intact underneath the review.

The board becomes read-only while reviewing. The side panel names the exact
move and opening at that ply and shows the coaching note stored for that turn
when one exists. Live-only evaluation, best-move arrows, classifications, and
thinking indicators are hidden so later analysis cannot be mistaken for an
earlier position. Returning to live is one action and restores the current
board with its coaching signals.

### When the player opens that idea

The player has chosen to leave the live board temporarily. ChessCave shows the
position before their move and draws Stockfish's alternative as an arrow. The
live position is preserved exactly as it was.

The coaching desk puts the comparison before the conversation: the player's
move and resulting score, Stockfish's preferred move and score, and the measured
expected-points opportunity. These facts remain visually separate from Codex's
interpretation. A player can start with their own question or use one of three
position-specific prompts about the alternative, the concrete drawback, or the
lesson to remember.

Each question and streamed answer becomes a quiet, ruled transcript tied to the
move rather than a stack of chat bubbles. Follow-up requests include the prior
exchange, so Codex can answer a challenge directly instead of restarting its
explanation. The composer remains writable while an answer is arriving. A new
question can be prepared, but only one is sent at a time.

Deliberate questions take priority over queued background move commentary. If a
background note is already streaming, the question appears immediately with an
honest waiting state and runs next. “Back to live” stays at the top of the desk;
it does not continue or advance the game because the game already continued.

The player may return to the live board while Codex is still writing. The answer
is attached to the move when ready, and the transcript is still there if the
player reopens it. This reflection is optional, reversible, and owned by the
player.

### When Codex explains its own move

The move is already on the board and it is already the player's turn. An
immediate factual note says whether the move came from the opening book or a
time-limited Stockfish search. Once the player's background comparison is also
ready, ChessCave sends one full-turn coaching request rather than separate
requests for each move.

That request gives Codex the player's classification, up to three Stockfish
candidate lines, the played-move line, both scores, expected-points loss, and
Codex's reply. The answer leads with what the player tried, explains the merit
or concrete drawback, translates Stockfish's preferred move into a plan, and
only then connects Codex's reply. Strong and book moves receive positive
explanations; inaccuracies, mistakes, and blunders receive corrective ones. If
the player's move ends the game, a player-only explanation is requested.

The streamed explanation is stored against that exact full turn. Only the
newest Codex move owns the primary note; a late answer for an older move cannot
replace it.

If the player moves quickly and Codex is still writing, full-turn explanations
form an ordered queue rather than replacing one another or creating overlapping
conversations. Requests made while the app-server is starting wait for
readiness instead of being discarded. Chess play stays available throughout.

### When something fails

- Opening-book failure falls through to the time-budgeted engine.
- Background comparison failure creates no warning because it does not affect
  the game.
- Codex prose failure leaves the factual engine or book note in place.
- App-server readiness has a 12-second watchdog and three total startup
  attempts. A lost stream requeues the current move explanation; exhausting
  retries explicitly leaves Stockfish coaching active and marks commentary unavailable.
- Opponent-search failure preserves the position and offers a retry.
- Restarting or resigning invalidates the coaching session and interrupts the
  active app-server turn. Late deltas cannot alter a newer game.

## UX scoring and iteration

Each version is scored out of ten using five two-point tests: continuity,
latency, relevance, player agency, and failure honesty.

### Version 1: 3/10

- Continuity: 0/2. Every non-best move rewound and stopped the game.
- Latency: 0/2. Depth 30 could take 45 seconds and was used in the opening.
- Relevance: 1/2. The arrow was accurate, but exact-best matching treated good
  alternatives as errors.
- Agency: 1/2. The player could explain an idea, but had to press Continue.
- Failure honesty: 1/2. Timeouts were visible, but they stranded the turn.

This is the flow shown in the supplied screenshots. It is not acceptable.

### Version 2: 8/10

Moving the correction into an optional invitation fixed continuity and agency.
Using a 700 ms opponent search fixed the worst latency. It was still only an
8 because opening moves unnecessarily invoked Stockfish, exact-move comparison
could still nag the player, and asynchronous Codex messages could overlap.

### Version 3: 7/10

The non-blocking game flow was right, but coach view was effectively hidden in
the optional reflection state. Explanations requested before app-server
readiness were silently dropped, streamed text was not bound to a move, and a
new game could still receive the old game's prose. A player could complete a
whole game without understanding Codex's role. That is not acceptable for a
coaching mode.

### Current version: 10/10 design score

- Continuity: 2/2. Only the opponent's bounded thinking owns the turn. Coaching
  and prose never do.
- Latency: 2/2. Book is instant; non-book search has a 700 ms budget; comparison
  runs concurrently and is disposable.
- Relevance: 2/2. Coach view identifies every move while the deeper reflection
  invitation still uses an eight-point expected-points threshold to suppress
  equivalent choices.
- Player agency: 2/2. The amount of engine guidance is chosen before play.
  Reflection remains optional and the live game never requires Continue.
- Failure honesty: 2/2. Explanations are move- and session-scoped, startup is
  recoverable, engine facts remain visible during prose failure, and resets
  interrupt obsolete work.

This is a 10/10 against the stated interaction rubric, not a claim that user
research is finished. Real-game timing data may change the 700 ms and eight-point
thresholds. The design can absorb those changes without changing the flow.

## Move-discussion UX rubric

The reflection experience is scored separately because uninterrupted play can
still conceal a weak coaching interaction. Five tests receive two points each:
position grounding, conversational continuity, response priority, visual
clarity, and player agency.

### Previous reflection: 4/10

- Position grounding: 1/2. The board arrow was correct, but the relevant scores
  were split between the board footer, status row, and engine line.
- Conversational continuity: 0/2. A reply replaced a placeholder, follow-ups had
  no visible history, and closing the reflection erased the exchange.
- Response priority: 0/2. Ambient move commentary could disable the deliberate
  question the player came here to ask.
- Visual clarity: 1/2. The editorial type was coherent, but an oversized generic
  headline pushed the actual question and answer into a cramped lower region.
- Player agency: 2/2. Reflection was optional and the player could return to the
  live board without stopping the game.

### Revised reflection: 10/10 design score

- Position grounding: 2/2. The board, arrow, played move, preferred move, both
  scores, and expected-points difference describe one exact decision.
- Conversational continuity: 2/2. A move-scoped multi-turn transcript preserves
  the player's words, streamed answers, and follow-up context when reopened.
- Response priority: 2/2. Player questions enter a priority queue ahead of
  unsent ambient explanations, with visible queued, thinking, and failure states.
- Visual clarity: 2/2. A compact comparison leads into a ruled dialogue and one
  anchored composer; there are no chat bubbles or competing article headline.
- Player agency: 2/2. Suggested questions accelerate common needs without
  replacing free expression, the composer stays writable during streaming, and
  “Back to live” remains immediately available.

This is a 10/10 against the explicit rubric, not a substitute for observing real
players. A future regression is any change that hides engine evidence, loses the
thread, delays a question behind queued prose, or makes leaving reflection hard.

## Engineering rules

- `chess.js` owns legality and terminal game state.
- The local position-keyed opening book owns known opening continuations.
- A persisted teaching rotation chooses mainstream opening families; later
  legal book choices vary within the family established on the board.
- Stockfish uses one variation for opponent play and three for comparison.
- Move comparison reuses one Stockfish process for the best and played searches.
- Codex receives engine facts but never supplies best-move truth.
- Each completed player/Codex turn uses one combined Codex request, preventing
  richer player coaching from doubling model latency and usage.
- A turn token rejects stale engine work. A separate game-session token and
  app-server interrupt reject stale Codex work after reset or resignation.
- Codex explanations are stored by ply; only the latest Codex ply can own the
  primary live note.
- The current live game is persisted locally. Reflection never mutates it.
- History is a read-only projection of persisted move FENs; navigation never
  changes the live game or cancels background coaching.
- Move discussions are keyed by player-move ply. Player questions have priority
  over queued move notes, and each streamed reply updates only its own turn.
- Keyboard focus rings on the shared board stay below the piece layer. A
  focused square may draw an inset outline but must never cover its piece.

## Measured local timing

The 700 ms move search was sampled three times from a representative Queen's
Gambit position using the same Stockfish process startup and configuration as
the app. End-to-end results were 1,195 ms, 1,307 ms, and 1,311 ms. The measured
median is 1,307 ms. Opening-book replies remain at the deliberate 260 ms beat.

The target is a median under 1.5 seconds and no normal opponent move above two
seconds. More quiet and tactical positions should be sampled in the packaged
desktop build. If slower hardware misses that target, reduce the 700 ms budget
rather than bringing back a blocking depth target.
