-- 0074_analytics_indexes: index de date pour les agregats de l'analytique admin (plages de dates uniquement). Forward-only.
CREATE INDEX IF NOT EXISTS users_created_at_idx ON users (created_at);
CREATE INDEX IF NOT EXISTS refresh_tokens_created_at_idx ON refresh_tokens (created_at);
CREATE INDEX IF NOT EXISTS messages_created_at_idx ON messages (created_at);
CREATE INDEX IF NOT EXISTS posts_created_at_idx ON posts (created_at);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at);
CREATE INDEX IF NOT EXISTS pos_sales_created_at_idx ON pos_sales (created_at);
