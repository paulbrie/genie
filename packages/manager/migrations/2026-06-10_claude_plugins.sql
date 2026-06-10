-- Official Claude Code plugins catalog for the per-VM Manager popup's
-- "Claude Plugins" tab. Mirrors the recipes table but kept separate so its
-- slug namespace doesn't collide with recipes. Built-ins are seeded on boot
-- from packages/manager/src/default-claude-plugins.ts.
CREATE TABLE IF NOT EXISTS claude_plugins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT DEFAULT '' NOT NULL,
  icon TEXT DEFAULT 'Puzzle' NOT NULL,
  homepage_url TEXT DEFAULT '' NOT NULL,
  check_script TEXT NOT NULL,
  install_script TEXT NOT NULL,
  uninstall_script TEXT DEFAULT '' NOT NULL,
  commands JSONB DEFAULT '[]'::jsonb NOT NULL,
  options JSONB DEFAULT '[]'::jsonb NOT NULL,
  secrets JSONB DEFAULT '[]'::jsonb NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claude_plugins_slug ON claude_plugins(slug);
