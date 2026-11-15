-- 0034_games: lot 20a Play & Win, "quiz eclair" with a leaderboard (CDC §21). Forward-only.
-- Skill only: no money, no CSL Coins, no NFT, no bet, no lottery. The score is computed on the server.

INSERT INTO feature_flags (key, description, enabled, regulated) VALUES
  ('games', 'Jeux Play & Win : quiz éclair et classement (aucun argent, aucun pari)', true, false);

-- Questions are maintained by administrators. The correct answer never leaves the server before grading.
CREATE TABLE game_questions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt         text NOT NULL CONSTRAINT game_questions_prompt_check CHECK (length(prompt) BETWEEN 1 AND 300),
  options        jsonb NOT NULL CONSTRAINT game_questions_options_check CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) BETWEEN 2 AND 5),
  correct_index  integer NOT NULL CONSTRAINT game_questions_correct_check CHECK (correct_index >= 0),
  category       text NOT NULL DEFAULT '' CONSTRAINT game_questions_category_check CHECK (length(category) <= 40),
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE game_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_ids   uuid[] NOT NULL CONSTRAINT game_sessions_questions_check CHECK (cardinality(question_ids) > 0),
  started_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  finished_at    timestamptz,
  correct_count  integer,
  score          integer,
  CONSTRAINT game_sessions_finished_check CHECK ((finished_at IS NULL) = (score IS NULL))
);
CREATE INDEX game_sessions_user_idx ON game_sessions (user_id, started_at DESC);
CREATE INDEX game_sessions_score_idx ON game_sessions (score DESC) WHERE finished_at IS NOT NULL;
