-- 0083_variant_cost: cout moyen pondere d'une variante (unite mineure de sa devise), mis a jour a la reception d'un bon de commande. NULL = inconnu. Forward-only.
ALTER TABLE product_variants ADD COLUMN cost_minor bigint CONSTRAINT product_variants_cost_check CHECK (cost_minor >= 0);
