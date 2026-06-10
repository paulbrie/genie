-- Per-minute roll-ups of manager-process throughput (stats-daemon postbacks and
-- WebSocket frames sent) powering the superadmin Server dashboard's 6h/24h
-- ranges. The live 1h view stays in-memory; these rows survive restarts.
CREATE TABLE IF NOT EXISTS server_metric_samples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sampled_at TIMESTAMP NOT NULL,
    window_sec INTEGER NOT NULL,
    stats_requests INTEGER NOT NULL,
    ws_sent INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_server_metric_samples_sampled_at ON server_metric_samples (sampled_at);
