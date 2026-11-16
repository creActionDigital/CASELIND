-- 0035_game_tournaments: lot 20b. A tournament is a time window; the ranking is computed from finished game_sessions. No prize, no fee. Forward-only.
CREATE TABLE game_tournaments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL CONSTRAINT game_tournaments_title_check CHECK (length(title) BETWEEN 1 AND 80),
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT game_tournaments_window_check CHECK (ends_at > starts_at)
);
CREATE INDEX game_tournaments_ends_idx ON game_tournaments (ends_at DESC);
