-- SSH disconnect flight recorder (see src/vps/ssh-events.ts). One row per
-- attributed connection drop or wireproxy lifecycle event, so a "stream stopped
-- / connection lost" in prod can be triaged after the fact — including lining up
-- an all-hosts drop against a wireproxy exit on the same timeline.
CREATE TABLE IF NOT EXISTS ssh_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at TIMESTAMP NOT NULL,
    host TEXT NOT NULL,
    port INTEGER,
    username TEXT,
    kind TEXT NOT NULL,            -- client | pty | stats | tunnel | wireproxy
    event TEXT NOT NULL,           -- disconnect | wireproxy-exit | wireproxy-respawn | wireproxy-gaveup
    cause TEXT,                    -- keepalive-timeout | tcp-reset | socks-failure | ...
    lifetime_ms INTEGER,
    last_data_age_ms INTEGER,
    detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_ssh_events_host_time ON ssh_events (host, occurred_at);
CREATE INDEX IF NOT EXISTS idx_ssh_events_time ON ssh_events (occurred_at);
CREATE INDEX IF NOT EXISTS idx_ssh_events_cause ON ssh_events (cause);
