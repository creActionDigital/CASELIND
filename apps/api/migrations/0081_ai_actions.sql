-- 0081_ai_actions: actions proposees par l'assistant IA (CDC section 22). Forward-only.
-- ai_actions : la proposition en attente de confirmation (arguments inclus, supprimee avec la conversation).
-- ai_action_log : journal sans argument (outil, statut, date).
CREATE TABLE ai_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  tool            text NOT NULL CONSTRAINT ai_actions_tool_check CHECK (tool IN ('search_products', 'search_places', 'summarize_text', 'prepare_cart', 'open_screen')),
  args            jsonb NOT NULL,
  label           text NOT NULL CONSTRAINT ai_actions_label_check CHECK (char_length(label) BETWEEN 1 AND 120),
  status          text NOT NULL DEFAULT 'proposed' CONSTRAINT ai_actions_status_check CHECK (status IN ('proposed', 'confirmed', 'dismissed', 'expired', 'failed')),
  result          jsonb,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz
);
CREATE INDEX ai_actions_conv_idx ON ai_actions (conversation_id, created_at);

CREATE TABLE ai_action_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id),
  tool       text NOT NULL CONSTRAINT ai_action_log_tool_check CHECK (tool IN ('search_products', 'search_places', 'summarize_text', 'prepare_cart', 'open_screen', 'unknown')),
  status     text NOT NULL CONSTRAINT ai_action_log_status_check CHECK (status IN ('proposed', 'confirmed', 'dismissed', 'expired', 'failed', 'ignored')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_action_log_user_idx ON ai_action_log (user_id, created_at DESC);

-- Arret d'urgence : en production les actions restent coupees tant que l'admin n'active pas ce drapeau.
INSERT INTO feature_flags (key, description, enabled, regulated) VALUES
  ('ai_actions', 'Actions proposees par l''assistant IA (confirmees une a une par l''utilisateur)', false, false);
