-- 0077_wishlist: products a user wishes to buy later (max 200 per user, enforced by the API). Forward-only.
CREATE TABLE wishlist_items (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);
CREATE INDEX wishlist_items_user_idx ON wishlist_items (user_id, created_at DESC, product_id DESC);
