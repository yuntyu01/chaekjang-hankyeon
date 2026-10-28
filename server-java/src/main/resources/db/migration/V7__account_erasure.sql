CREATE TABLE account_file_deletions (
    storage_key TEXT PRIMARY KEY,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE kakao_logins ADD COLUMN exchange_started BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE kakao_disconnect_jobs (
    subject TEXT PRIMARY KEY,
    account_id BIGINT NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts INTEGER NOT NULL DEFAULT 0
);
-- Anonymous device copies remain owned by the account they were explicitly moved to.
CREATE TABLE account_predecessors (
    source_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    target_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    CHECK(source_id<>target_id)
);
