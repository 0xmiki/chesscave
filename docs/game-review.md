# Game Review data model

ChessCave treats a review as a durable result, not a live view concern.
Importing or branching a game creates one immutable sequence of positions. The
desktop host analyzes that sequence once and saves the complete result under:

```text
app-local-data/reviews/v5/<sha256>.json
```

The key covers the ordered FEN/played-move sequence, schema version, Stockfish
path, node budget, and MultiPV setting. Opening an identical game with identical
settings is therefore a disk read. The sparkle button is the explicit
force-re-review action.

## Snapshot

```text
GameReview
├─ schemaVersion
├─ gameKey
├─ engine
├─ nodesPerPosition
├─ multiPv
├─ createdAtMs
├─ cached
├─ model
├─ positions[]
│  ├─ ply + fen
│  ├─ clocks {w, b} + lastMove
│  ├─ bestMove
│  ├─ elapsedMs
│  └─ lines[]
│     ├─ multipv + depth
│     ├─ scoreCp | scoreMate
│     ├─ wdl [white win, draw, white loss]
│     └─ moves[]
├─ moves[]
│  ├─ ply + san + uci + color
│  ├─ classification
│  ├─ expectedPointsBefore
│  ├─ expectedPointsAfter
│  ├─ expectedPointsLost
│  ├─ estimatedAccuracy
│  └─ bestMove
└─ summary
   ├─ whiteAccuracy
   ├─ blackAccuracy
   ├─ classifications
   ├─ whiteClassifications
   └─ blackClassifications
```

All engine evaluations and WDL triples are normalized to White's perspective.
For a Black move, move quality converts both positions back to Black's expected
points before calculating the loss.

`MoveReview.bestMove` is copied from the analyzed position immediately before
the played move. The board uses it for the green best-alternative arrow when it
differs from the played UCI move. It deliberately does not use the next
`PositionReview.bestMove`, which belongs to the opponent's reply position.

The clocks and last-move geometry are persisted with every reviewed position.
The read-only MCP `get_position_image` tool can therefore render an exact ply,
or select the nearest recorded White/Black clock timestamp, and return a PNG
with the last move highlighted alongside structured FEN and clock metadata.

## Review pass

The engine is initialized once with two threads, a 128 MB hash, MultiPV, and
`UCI_ShowWDL`. Each FEN receives the same `go nodes` budget. Progress is emitted
as `chesscave://review-progress`; the review is exposed to the webview only as a
complete snapshot and is then persisted.

Fixed nodes mirror Chess.com's published reason for its faster whole-game
review architecture: comparable work for every ply instead of an unstable
depth or time budget.

## Accuracy and classifications

ChessCave v5 follows Chesskit's evaluation pipeline. Stockfish centipawn
evaluations are mapped onto Lichess's published winning-chance curve, then the
winning-chance loss of each move is mapped onto Lichess move accuracy.
Whole-game accuracy is the mean of a volatility-weighted mean and a harmonic
mean. The harmonic input is floored at 10, and the volatility weights use
Chesskit's bounded centered windows. This makes the displayed score
reproducible and keeps errors in already-decided positions from dominating the
review.

Chesskit's ordinary move labels use strict loss boundaries on the public
0–100 Win% scale:

| Classification | Win% lost |
| --- | ---: |
| Excellent | 0–2 |
| Good | >2–5 |
| Inaccuracy | >5–10 |
| Mistake | >10–20 |
| Blunder | >20 |

ChessCave supplies the positive vocabulary needed by its study interface. An
exact Stockfish choice is `best`; a non-best move losing at most two Win% points
is `excellent`, and one losing at most five is `good`. A best move becomes
`great` when the second candidate loses at least ten Win% points and the player
was not already overwhelmingly winning.

`brilliant` requires a sound non-pawn sacrifice, practical equality or better
after the move, and a position that was not already overwhelmingly won. The
sacrifice detector has two complementary signals. A legal static-exchange
search recognizes newly offered pieces even when the best defense declines the
offer; a four-ply walk through Stockfish's best continuation records temporary
material concessions and therefore catches delayed combinations. Measuring the
material change from the pre-move position prevents ordinary equal exchanges
from being called sacrifices.

ChessCave retains Stockfish's MultiPV snapshot at depth 10 while the normal
fixed-node review continues. When shallow search omits, demotes, or materially
undervalues the eventual deep choice, the move receives a small near-best
tolerance increase. This approximates the paper's human-surprise result without
running another engine. When a valid PGN rating is available, sub-1600 players
receive modestly wider near-best tolerances and sub-1000 players may receive
credit for a one-pawn net piece concession; 2200+ players receive a tighter
tolerance. No Elo-like single-game estimate is generated or displayed.

`miss` requires either losing a forced mate or surrendering a winning
opportunity just created by the opponent. Book moves are overlaid from the
bundled opening-position index in the webview so engine analysis remains
independent from opening taxonomy.

The phase divider is based on Lichess's public `scalachess` implementation. It
detects the middlegame from remaining major/minor pieces, sparse home ranks, or
color mixing on the board, and detects the endgame once six or fewer
major/minor pieces remain. Phase accuracy reuses the same move and game
accuracy machinery.

Published model and source attribution:

- <https://github.com/GuillaumeSD/Chesskit/blob/main/src/lib/engine/helpers/winPercentage.ts>
- <https://github.com/GuillaumeSD/Chesskit/blob/main/src/lib/engine/helpers/accuracy.ts>
- <https://github.com/GuillaumeSD/Chesskit/blob/main/src/lib/engine/helpers/moveClassification.ts>
- <https://lichess.org/page/accuracy>
- <https://github.com/lichess-org/lila/blob/master/modules/analyse/src/main/AccuracyPercent.scala>
- <https://github.com/lichess-org/lila/blob/master/modules/tree/src/main/Advice.scala>
- <https://github.com/lichess-org/scalachess/blob/master/core/src/main/scala/Divider.scala>
- <https://github.com/lichess-org/lila/pull/11148>
- <https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-etc>
- <https://arxiv.org/abs/2406.11895>
- <https://github.com/kamronzaidi/brilliant-moves-clf>
- <https://github.com/dev-arcturus/positional_chess>
