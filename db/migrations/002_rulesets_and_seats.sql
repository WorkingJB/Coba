-- A lobby has no game state yet, so the ruleset and seat count live on the row.
-- Defaults describe every match created before this migration, and keep an
-- older replica's inserts valid during a rolling deploy.
ALTER TABLE matches ADD COLUMN ruleset text NOT NULL DEFAULT 'frontier-1';
ALTER TABLE matches ADD COLUMN size smallint NOT NULL DEFAULT 2 CHECK (size IN (2, 4));
