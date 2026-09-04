# Changelog

## 0.1.3

- Discover available Codex models before starting the coach.
- Use Terra for live coaching when Luna is unavailable, or the catalog default
  when neither preferred model is listed.
- Retry a rejected model once with an available alternative and remember rejected
  models until the account changes or the coach restarts.
- Match reasoning effort to the selected model. Quota and network errors do not
  trigger model switching.

## 0.1.2

- Fixed piece dragging so the piece follows the pointer and drops without a
  second travel animation.
- Restored the current-position best-move arrow in Play.
- Made Codex insight manual instead of generating commentary after every move.
- Added a switch for the best-move arrow and engine line.
- Kept Left and Right history controls working while the board has focus.
- Improved Play and Drill typography, labels, and buttons.
- Rebuilt the README around screenshots of each main screen.

## 0.1.0

Initial desktop release.

- Play against Stockfish or move both sides in self-play.
- Ask Codex for commentary on the current position during a game.
- Review Chess.com games and imported PGNs with Stockfish.
- Compare moves, inspect engine lines, and explore legal variations.
- Turn mistakes into scheduled drills.
- Practice winning positions in the Conversion Trainer.
- Keep local chess notes.
- Use light or dark mode.
- Move pieces by clicking or dragging.
- Navigate boards, tabs, dialogs, and game history with the keyboard.
