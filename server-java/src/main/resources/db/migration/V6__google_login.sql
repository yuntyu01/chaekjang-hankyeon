CREATE TABLE google_logins (
    state_hash TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    return_url TEXT NOT NULL,
    nonce_hash TEXT NOT NULL,
    upstream_verifier TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '10 minutes'
);
CREATE TABLE google_login_tickets (
    ticket_hash TEXT PRIMARY KEY,
    source_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    result_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '2 minutes'
);
CREATE INDEX google_logins_expiry ON google_logins(expires_at);
CREATE INDEX google_tickets_expiry ON google_login_tickets(expires_at);
