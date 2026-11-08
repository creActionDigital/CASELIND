-- 0023_ai: lot 12 multi-provider AI assistant (ADR-022). Forward-only.
-- The system prompt lives in code. Conversations are private to their owner; no row ever holds a provider key.

INSERT INTO feature_flags (key, description, enabled, regulated) VALUES
  ('ai', 'Assistant IA multi-fournisseurs (Gemini par défaut, Groq, Mistral, OpenRouter, compatible OpenAI)', true, false);

-- Admin activation of catalogue models (the catalogue itself comes from AI_MODELS). Absent row = disabled.
CREATE TABLE ai_model_settings (
  model_id   text PRIMARY KEY,
  enabled    boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_user_settings (
  user_id                  uuid PRIMARY KEY REFERENCES users(id),
  model_id                 text,
  allow_fallback           boolean NOT NULL DEFAULT false,
  acknowledged_data_notice boolean NOT NULL DEFAULT false,
  acknowledged_at          timestamptz,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id),
  title      text NOT NULL CONSTRAINT ai_conversations_title_check CHECK (char_length(title) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_conversations_user_idx ON ai_conversations (user_id, updated_at DESC);

CREATE TABLE ai_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CONSTRAINT ai_messages_role_check CHECK (role IN ('user', 'assistant')),
  content         text NOT NULL CONSTRAINT ai_messages_content_check CHECK (char_length(content) BETWEEN 1 AND 20000),
  model_id        text,
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ai_messages_conv_idx ON ai_messages (conversation_id, created_at, id);

-- Daily usage counter (UTC day), incremented atomically up to AI_DAILY_MESSAGES.
CREATE TABLE ai_usage_daily (
  user_id uuid NOT NULL REFERENCES users(id),
  day     date NOT NULL,
  count   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
