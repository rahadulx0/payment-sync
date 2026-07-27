-- Task 05: at most one ACTIVE parser rule per provider.
CREATE UNIQUE INDEX "parser_rules_active_uq" ON "parser_rules" ("provider") WHERE "is_active" = true;
