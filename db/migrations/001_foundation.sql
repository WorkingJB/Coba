CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);
CREATE TABLE matches (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  revision integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('lobby', 'playing', 'finished')),
  seats jsonb NOT NULL,
  state jsonb,
  deadline timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX matches_due ON matches(deadline) WHERE status = 'playing';
CREATE TABLE commands (
  match_id uuid NOT NULL REFERENCES matches(id),
  player_id uuid NOT NULL REFERENCES sessions(id),
  command_id uuid NOT NULL,
  payload jsonb NOT NULL,
  revision integer NOT NULL,
  PRIMARY KEY (match_id, player_id, command_id)
);
-- Append-only journal is private: action payloads contain hidden information.
CREATE TABLE match_events (
  match_id uuid NOT NULL REFERENCES matches(id),
  revision integer NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, revision)
);
-- One durable result per match. Future consumers use match_id as their dedupe key.
CREATE TABLE result_outbox (
  match_id uuid PRIMARY KEY REFERENCES matches(id),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
