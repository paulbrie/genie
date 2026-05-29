// Built-in VPS recipes — seeded into the `recipes` DB table on manager boot.
// The DB is the single source of truth at runtime: the renderer reads only
// from `recipes:list`, so adding/editing recipes here flows into the DB on
// next boot (the seed upserts by slug).
//
// Important: the install/uninstall/setupSh scripts use `${BASH_HELPERS}` to
// inline shared bash helpers (`log`, `force_ipv4_dns`, `wait_apt`). That
// substitution happens *here* (TS template literal) — what lands in the DB
// is the fully-resolved bash. The renderer never needs to know about it.
import type { RecipeInput } from "./recipes-service.js";

export const BASH_HELPERS = `log() { printf '[%s] %s\\n' "$(date '+%H:%M:%S')" "$*"; }
# Make glibc prefer IPv4 over IPv6 for DNS resolution, plus export NODE_OPTIONS
# for the current shell. TazCloud VMs have broken v6 routing to Cloudflare/Fastly
# CDNs (registry.npmjs.org, apt.postgresql.org, etc.) — see taz-ipv6-quirk.
# The gai.conf rule persists across the system; the env var covers the current
# script (which runs in a non-login shell, so /etc/profile.d isn't sourced).
force_ipv4_dns() {
  if ! grep -qE "^precedence ::ffff:0:0/96\\s+100" /etc/gai.conf 2>/dev/null; then
    echo 'precedence ::ffff:0:0/96  100' | sudo tee -a /etc/gai.conf > /dev/null
  fi
  export NODE_OPTIONS="\${NODE_OPTIONS:+\$NODE_OPTIONS }--dns-result-order=ipv4first"
}
wait_apt() {
  local i=0
  local LOCKS="/var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock /var/cache/apt/archives/lock"
  # Returns "<pid> <elapsed> <cmd>" lines for every PID holding any apt/dpkg lock.
  apt_lock_holder_details() {
    local pids
    pids=$(sudo fuser $LOCKS 2>/dev/null | tr -s ' \\t' '\\n' | sed '/^$/d' | sort -u)
    [ -z "$pids" ] && { echo "unknown"; return; }
    local out=""
    for pid in $pids; do
      local row
      row=$(ps -o pid=,etime=,args= -p "$pid" 2>/dev/null | sed 's/^ *//; s/ *$//; s/  */ /g')
      if [ -n "$row" ]; then
        # Truncate to keep heartbeat lines readable.
        out="$out\\n  $(echo "$row" | head -c 110)"
      fi
    done
    [ -z "$out" ] && { echo "unknown"; return; }
    printf '%b' "$out"
  }
  if ! sudo fuser $LOCKS >/dev/null 2>&1; then return; fi
  log "Waiting for apt lock — held by:$(apt_lock_holder_details)"
  while sudo fuser $LOCKS >/dev/null 2>&1; do
    i=$((i+1))
    [ "$i" -gt 600 ] && { log "Timeout waiting for apt lock (10min)"; exit 1; }
    if [ $((i % 10)) = 0 ]; then
      log "Still waiting (\${i}s) — held by:$(apt_lock_holder_details)"
    fi
    sleep 1
  done
  log "apt lock released after \${i}s."
}`;

export const DEFAULT_RECIPES: RecipeInput[] = [
  {
    slug: "genie-standard",
    label: "Genie Standard Setup",
    icon: "Sparkles",
    description: "Baseline Genie expects on every VPS: the 'genie' deploy user (passwordless sudo, same SSH key), Docker + compose, Node.js 20, Claude Code, /opt/project owned by genie, and a genie-stats systemd service (manager syncs the bundle after install).",
    // NOTE: we intentionally do NOT verify docker-group membership here.
    // `usermod -aG docker` only takes effect on the user's NEXT login, and
    // even a fresh SSH session can hold a stale group list (NSS cache,
    // systemd-logind, sshd PAM session reuse). That made the button report
    // NOT_INSTALLED for the first page load after a successful install,
    // which is exactly the bug "Genie button not active even though Genie
    // Standard Setup has been done". The docker group is a UX nicety (run
    // `docker` without sudo), not a marker of "is the recipe installed".
    // The authorized_keys check uses `sudo -n` because /home/genie/.ssh is mode
    // 700 (owned by genie); when the saved SSH connection user is the image
    // default (almalinux/ubuntu/debian) — typical when Standard Setup is run
    // after a bare VM deploy — a direct `[ -s ... ]` test silently fails on
    // the unreadable parent dir and reports NOT_INSTALLED on every refresh,
    // exactly the bug "Genie button not green after refresh". -n is safe: the
    // install script itself relies on passwordless sudo, so if install
    // succeeded, `sudo -n` works.
    checkScript: `if id genie >/dev/null 2>&1 && sudo -n test -s /home/genie/.ssh/authorized_keys && command -v docker > /dev/null 2>&1 && docker compose version > /dev/null 2>&1 && command -v node > /dev/null 2>&1 && command -v npm > /dev/null 2>&1 && command -v claude > /dev/null 2>&1 && command -v dtach > /dev/null 2>&1 && [ -d /opt/project ] && [ "$(stat -c %U /opt/project 2>/dev/null || stat -f %Su /opt/project)" = "genie" ] && systemctl list-unit-files --type=service 2>/dev/null | grep -q '^genie-stats.service'; then echo "INSTALLED"; else echo "NOT_INSTALLED"; fi`,
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
${BASH_HELPERS}
# Prefer IPv4 globally for the rest of this script. The NodeSource setup_20.x
# script runs its own apt-get update against deb.nodesource.com (Cloudflare-
# fronted), which stalls over IPv6 on Taz VMs — see taz-ipv6-quirk. The outer
# curl -4 only fixes the initial download, not what the script does internally,
# so we patch /etc/gai.conf to make all subsequent DNS prefer v4.
force_ipv4_dns
log "Applying Genie standard setup (Docker, Node 20, Claude Code, /opt/project)..."
if command -v apt-get > /dev/null 2>&1; then
  log "apt-get update..."
  wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 update -qq
  log "apt-get install docker.io git curl ca-certificates dtach..."
  # dtach is the persistence wrapper for remote PTYs (Claude popup + shell tabs):
  # closing the popup/tab/laptop detaches the SSH channel without killing the
  # inner process. Tiny (~50KB), no daemon, no escape keys to surprise users.
  wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 install -y -qq docker.io git curl ca-certificates dtach > /dev/null
  # Always run NodeSource's setup — Ubuntu 22.04 ships nodejs 12 without npm,
  # so even when 'command -v node' succeeds we can't trust the version. NodeSource
  # installs a higher-priority apt pin so the subsequent 'apt install nodejs'
  # *replaces* Ubuntu's old package with v20 (which bundles npm).
  node_major=$(node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\\1/' || echo 0)
  if [ "$node_major" -lt 20 ] || ! command -v npm > /dev/null 2>&1; then
    log "Adding NodeSource repo (apt update inside — usually 30–60 s)..."
    curl -4 -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>&1 | sed 's/^/  /'
    log "Installing Node.js 20 (bundles npm)..."
    wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 install -y -qq nodejs 2>&1 | sed 's/^/  /'
  else
    log "Node.js \${node_major}.x with npm already present, skipping NodeSource."
  fi
elif command -v dnf > /dev/null 2>&1; then
  log "dnf install docker git curl dtach..."
  # dtach lives in EPEL on RHEL-family. epel-release is idempotent and a no-op
  # if the repo is already enabled (CentOS Stream/AlmaLinux 9 base + EPEL).
  sudo dnf install -y -q epel-release > /dev/null 2>&1 || true
  sudo dnf install -y -q docker git curl dtach > /dev/null
  node_major=$(node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\\1/' || echo 0)
  if [ "$node_major" -lt 20 ] || ! command -v npm > /dev/null 2>&1; then
    log "Adding NodeSource repo (dnf install inside)..."
    curl -4 -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - 2>&1 | sed 's/^/  /'
    log "Installing Node.js 20 (bundles npm)..."
    sudo dnf install -y -q nodejs 2>&1 | sed 's/^/  /'
  else
    log "Node.js \${node_major}.x with npm already present, skipping NodeSource."
  fi
else
  log "Unsupported package manager (need apt-get or dnf)"; exit 1
fi
log "Enabling and starting docker..."
sudo systemctl enable --now docker > /dev/null 2>&1 || true
# Docker Compose v2 is shipped by Ubuntu only on 24.04+, and the package name
# varies across distros (docker-compose-v2 / docker-compose-plugin / absent).
# Drop the CLI plugin binary directly from the official GitHub release — works
# on any apt or dnf distro and any arch we'd realistically see. Force IPv4 for
# Taz VMs (Fastly-fronted CDN is v6-flaky).
if ! docker compose version > /dev/null 2>&1; then
  COMPOSE_VER=v2.29.7
  ARCH=$(uname -m)
  log "Installing Docker Compose $COMPOSE_VER for $ARCH from GitHub..."
  sudo mkdir -p /usr/local/lib/docker/cli-plugins
  sudo curl -4 -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \\
    "https://github.com/docker/compose/releases/download/$\{COMPOSE_VER}/docker-compose-linux-$\{ARCH}"
  sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi
# Same v4 + retry workaround as the standalone claude-code recipe — registry.npmjs.org
# is Fastly-fronted and v6-broken from some Taz VMs.
log "Installing Claude Code globally (npm install -g @anthropic-ai/claude-code)..."
# Pin HOME=/root so npm's cache lands in /root/.npm. With -E + HOME=/home/genie
# (which happens when this recipe is re-run as the genie user — the Manage
# popup auto-switches once genie exists), root-owned cache files would land
# in /home/genie/.npm and break every subsequent npm install run as genie
# (EACCES on /home/genie/.npm/_cacache).
sudo HOME=/root NODE_OPTIONS="--dns-result-order=ipv4first" \\
  npm install -g \\
    --no-audit --no-fund \\
    --fetch-retries=2 --fetch-retry-mintimeout=5000 \\
    @anthropic-ai/claude-code 2>&1 | tail -10
# Create the 'genie' deploy user. We do this last so npm install of Claude
# Code (which can be flaky on Taz VMs) doesn't block the user creation step —
# but before the /opt/project chown so we can hand it to genie directly.
log "Creating 'genie' deploy user (idempotent)..."
sudo useradd -m -s /bin/bash genie 2>/dev/null || true
echo 'genie ALL=(ALL) NOPASSWD:ALL' | sudo tee /etc/sudoers.d/genie > /dev/null
sudo chmod 440 /etc/sudoers.d/genie

# Copy the *calling* user's authorized_keys so the same SSH key (the one Genie
# uses to reach this VM) also lets us SSH in as 'genie' afterwards. /root may
# not have keys when the recipe runs as ubuntu/debian/almalinux, so source from
# $HOME and fail loudly if it's missing — silently skipping would create a user
# nobody can log into.
src_keys="$HOME/.ssh/authorized_keys"
if [ ! -s "$src_keys" ]; then
  log "ERROR: no $src_keys to copy from — cannot grant SSH access to the genie user."
  exit 1
fi
sudo mkdir -p /home/genie/.ssh
# When the recipe is re-run as the genie user itself (the Manage popup
# auto-switches once genie is set up), src and dest are the same file —
# cp errors out. Skip the copy in that case; the keys are already in place.
dest_keys="/home/genie/.ssh/authorized_keys"
if [ "$(readlink -f "$src_keys")" != "$(readlink -f "$dest_keys" 2>/dev/null || echo "$dest_keys")" ]; then
  sudo cp "$src_keys" "$dest_keys"
fi
sudo chown -R genie:genie /home/genie/.ssh
sudo chmod 700 /home/genie/.ssh
sudo chmod 600 /home/genie/.ssh/authorized_keys

log "Ensuring /opt/project exists and is owned by genie..."
sudo mkdir -p /opt/project
sudo chown -R genie:genie /opt/project
log "Adding $(whoami) and genie to docker group (no-op if already there)..."
sudo usermod -aG docker "$(whoami)" 2>/dev/null || true
sudo usermod -aG docker genie 2>/dev/null || true
log "Installing genie-stats systemd service (bundle synced by Genie after this recipe)..."
sudo mkdir -p /usr/lib/node_modules/@genie/vps-stats
sudo tee /etc/systemd/system/genie-stats.service > /dev/null << 'GENIE_STATS_UNIT'
[Unit]
Description=Genie VM stats publisher
After=network-online.target
ConditionPathExists=/usr/lib/node_modules/@genie/vps-stats/dist/daemon.js

[Service]
Type=simple
User=genie
Group=genie
RuntimeDirectory=genie
ExecStart=/usr/bin/node /usr/lib/node_modules/@genie/vps-stats/dist/daemon.js --interval 5 --output /run/genie/stats.jsonl
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
GENIE_STATS_UNIT
sudo systemctl daemon-reload
sudo systemctl enable genie-stats.service > /dev/null 2>&1 || true
log "Versions:"
log "  Docker:  $(docker --version 2>/dev/null || echo MISSING)"
log "  Node:    $(node --version 2>/dev/null || echo MISSING)"
log "  Claude:  $(claude --version 2>&1 | head -1 || echo MISSING)"
log "  dtach:   $(dtach -v 2>&1 | head -1 || echo MISSING)"
log "Genie standard setup complete. SSH in as: ssh genie@$(hostname -I 2>/dev/null | awk '{print $1}')"
log "Note: @genie/vps-agent is uploaded on-demand by the manager. genie-stats bundle is synced when this recipe finishes."`,
    uninstallScript: `set -e
${BASH_HELPERS}
log "Stopping genie-stats service..."
sudo systemctl disable --now genie-stats.service 2>/dev/null || true
sudo rm -f /etc/systemd/system/genie-stats.service
sudo systemctl daemon-reload 2>/dev/null || true
log "Removing Claude Code (user-facing global)..."
sudo npm uninstall -g @anthropic-ai/claude-code 2>&1 | tail -3 || true
rm -rf "$HOME/.claude" 2>/dev/null || true
log "Note: Docker, Node.js, and /opt/project are left in place — uninstall those individually if needed."
log "Done."`,
    setupShSnippet: `# Genie standard setup: 'genie' user, Docker, Node 20, Claude Code, /opt/project
export DEBIAN_FRONTEND=noninteractive
apt-get -o Acquire::ForceIPv4=true update -qq && apt-get -o Acquire::ForceIPv4=true install -y -qq docker.io git curl ca-certificates > /dev/null
# Docker Compose v2 from GitHub release (apt has no consistent package across distros)
COMPOSE_VER=v2.29.7; ARCH=$(uname -m); mkdir -p /usr/local/lib/docker/cli-plugins
curl -4 -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose "https://github.com/docker/compose/releases/download/$\{COMPOSE_VER}/docker-compose-linux-$\{ARCH}"
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
curl -4 -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
apt-get -o Acquire::ForceIPv4=true install -y -qq nodejs > /dev/null
systemctl enable --now docker
NODE_OPTIONS="--dns-result-order=ipv4first" npm install -g --no-audit --no-fund @anthropic-ai/claude-code
# 'genie' deploy user: passwordless sudo, same SSH key as root, owns /opt/project.
useradd -m -s /bin/bash genie 2>/dev/null || true
echo 'genie ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/genie
chmod 440 /etc/sudoers.d/genie
mkdir -p /home/genie/.ssh
cp /root/.ssh/authorized_keys /home/genie/.ssh/authorized_keys
chown -R genie:genie /home/genie/.ssh
chmod 700 /home/genie/.ssh && chmod 600 /home/genie/.ssh/authorized_keys
mkdir -p /opt/project && chown -R genie:genie /opt/project
usermod -aG docker genie 2>/dev/null || true`,
    commands: [
      { name: "Versions (all)", command: `echo "Docker:  $(docker --version 2>/dev/null || echo MISSING)"; echo "Node:    $(node --version 2>/dev/null || echo MISSING)"; echo "npm:     $(npm --version 2>/dev/null || echo MISSING)"; echo "Claude:  $(claude --version 2>&1 | head -1 || echo MISSING)"; echo "Agent:   $(command -v genie-agent 2>/dev/null || echo MISSING)"; echo "Stats:   $(systemctl is-active genie-stats 2>/dev/null || echo MISSING)"` },
      { name: "genie-stats service status", command: "systemctl status genie-stats --no-pager 2>&1 | head -15 || echo '(unit not installed)'" },
      { name: "Latest stats sample", command: "tail -1 /run/genie/stats.jsonl 2>/dev/null | head -c 500 || echo '(no stats yet — open Cloud view or re-run Standard Setup)'" },
      { name: "Show genie user", command: "id genie 2>/dev/null || echo '(no genie user)'" },
      { name: "Verify /opt/project ownership", command: "ls -ld /opt/project" },
      { name: "Test login as genie (whoami)", command: "sudo -H -u genie whoami" },
      { name: "Test sudo as genie (NOPASSWD)", command: "sudo -H -u genie sudo -n true && echo 'OK: genie has passwordless sudo' || echo 'FAIL: genie missing NOPASSWD sudo'" },
      { name: "Show genie authorized keys (fingerprints)", command: "sudo ssh-keygen -l -f /home/genie/.ssh/authorized_keys 2>/dev/null || echo '(no authorized_keys)'" },
      { name: "Verify user in docker group", command: `id -nG | tr ' ' '\\n' | grep -qx docker && echo "OK: $(whoami) is in docker group" || echo "NOT in docker group — log out + back in after install"` },
      { name: "Re-run setup (idempotent)", command: `sudo HOME=/root NODE_OPTIONS="--dns-result-order=ipv4first" npm install -g --no-audit --no-fund @anthropic-ai/claude-code 2>&1 | tail -5` },
      { name: "Docker info", command: "docker info 2>&1 | head -20" },
    ],
  },
  {
    slug: "chrome",
    label: "Chrome",
    icon: "Globe",
    description: "Install headless Chrome browser",
    port: 9222,
    checkScript: `if google-chrome-stable --version > /dev/null 2>&1; then echo "INSTALLED"; else echo "NOT_INSTALLED"; fi`,
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
${BASH_HELPERS}
log "Installing Chrome dependencies..."
# ForceIPv4: apt iterates ALL configured sources during update; on Taz VMs the
# v6 path to Fastly-fronted repos (apt.postgresql.org) stalls — see taz-ipv6-quirk.
wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 update -qq
wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 install -y -qq wget curl gnupg2 > /dev/null
log "Adding Chrome repository..."
# Ensure keyring dir exists and clear any stale keyring from a prior partial
# install — gpg --dearmor -o refuses to overwrite, which would close the pipe
# and surface as curl: (23) Failure writing output to destination. Don't
# suppress gpg stderr — when it fails, we want to see it in the recipe output.
sudo install -d -m 0755 /usr/share/keyrings
sudo rm -f /usr/share/keyrings/google-chrome.gpg
curl -4 -fsSL https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list > /dev/null
log "Refreshing package list (with new Chrome repo)..."
wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 update -qq
log "Installing google-chrome-stable (download ~80MB, takes 1-2 min)..."
wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 install -y -qq google-chrome-stable > /dev/null
log "Verifying..."
google-chrome-stable --version
log "Chrome installed successfully."`,
    uninstallScript: `set -e
export DEBIAN_FRONTEND=noninteractive
${BASH_HELPERS}
log "Removing Chrome..."
wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 remove -y -qq google-chrome-stable > /dev/null 2>&1 || true
sudo rm -f /etc/apt/sources.list.d/google-chrome.list
sudo rm -f /usr/share/keyrings/google-chrome.gpg
log "Autoremove..."
wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 autoremove -y -qq > /dev/null
log "Chrome removed."`,
    setupShSnippet: `# Install Chrome
export DEBIAN_FRONTEND=noninteractive
apt-get -o Acquire::ForceIPv4=true update -qq && apt-get -o Acquire::ForceIPv4=true install -y -qq wget gnupg2 > /dev/null
# Idempotency: ensure keyring dir exists + clear any stale keyring so the gpg
# --dearmor doesn't fail with "File exists" (which would close the pipe and
# surface as a broken-pipe error upstream). Mirrors the install script.
install -d -m 0755 /usr/share/keyrings
rm -f /usr/share/keyrings/google-chrome.gpg
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list
apt-get -o Acquire::ForceIPv4=true update -qq && apt-get -o Acquire::ForceIPv4=true install -y -qq google-chrome-stable > /dev/null`,
    commands: [
      { name: "Check version", command: "google-chrome-stable --version" },
      { name: "Launch headless", command: "google-chrome-stable --headless --no-sandbox --disable-gpu --remote-debugging-port=9222 &" },
      { name: "Launch with URL", command: "google-chrome-stable --headless --no-sandbox --disable-gpu --remote-debugging-port=9222 http://localhost:3000 &" },
      { name: "Screenshot a page", command: "google-chrome-stable --headless --no-sandbox --disable-gpu --screenshot=/tmp/screenshot.png --window-size=1280,720 http://localhost:3000" },
      { name: "Print page to PDF", command: "google-chrome-stable --headless --no-sandbox --disable-gpu --print-to-pdf=/tmp/page.pdf http://localhost:3000" },
      { name: "Kill all Chrome", command: "pkill -f google-chrome || true" },
    ],
  },
  {
    slug: "postgres",
    label: "PostgreSQL",
    icon: "Database",
    description: "Install and start PostgreSQL",
    port: 5432,
    checkScript: `command -v psql > /dev/null 2>&1 && echo "INSTALLED" || echo "NOT_INSTALLED"`,
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
${BASH_HELPERS}
PG_VERSION="\${PG_VERSION:-default}"
log "Installing PostgreSQL (version: $PG_VERSION)..."
if [ "$PG_VERSION" = "default" ]; then
  log "apt-get update..."
  wait_apt; sudo DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 update -qq
  log "apt-get install postgresql (this can take 1-2 min)..."
  wait_apt; sudo DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 install -y -qq postgresql postgresql-contrib > /dev/null
  log "apt-get install done."
else
  # Add PGDG repository to get specific PG versions (Ubuntu/Debian only).
  # apt.postgresql.org and www.postgresql.org are Fastly-fronted; v6 egress to
  # Fastly hangs from some VMs (e.g. TazCloud), so force IPv4 for these fetches.
  log "Installing prereqs (curl, ca-certificates, lsb-release)..."
  wait_apt; sudo DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 install -y -qq curl ca-certificates lsb-release > /dev/null
  log "Adding PGDG repository key + source..."
  sudo install -d /etc/apt/keyrings
  curl -4 -fsSL --max-time 60 https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo tee /etc/apt/keyrings/postgresql.asc > /dev/null
  CODENAME=$(lsb_release -cs)
  echo "deb [signed-by=/etc/apt/keyrings/postgresql.asc] https://apt.postgresql.org/pub/repos/apt $CODENAME-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list > /dev/null
  log "Codename: $CODENAME — apt-get update (refresh PGDG)..."
  wait_apt; sudo DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 update -qq
  log "apt-get install postgresql-$PG_VERSION (can take 1-3 min)..."
  wait_apt; sudo DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 install -y -qq postgresql-$PG_VERSION postgresql-contrib-$PG_VERSION > /dev/null
  log "apt-get install done."
fi
log "Starting PostgreSQL..."
# Prefer systemctl (modern Ubuntu/Debian/Almalinux); fall back to legacy 'service'.
if command -v systemctl >/dev/null 2>&1; then
  # Unmask in case a previous install/uninstall cycle left the unit masked
  # (postgresql.service is a Type=oneshot meta-unit; postgres-common postinst
  # can mask it under certain reinstall paths). systemctl start on a masked
  # unit exits 5 and the cluster never starts.
  if systemctl status postgresql 2>&1 | grep -q "Loaded: masked"; then
    log "postgresql.service is masked — unmasking..."
    sudo systemctl unmask postgresql 2>/dev/null || true
  fi
  # Also unmask the per-cluster instance unit (this is the one that actually
  # runs the postmaster — postgresql.service is just a oneshot dispatcher).
  if [ "$PG_VERSION" != "default" ] && systemctl status "postgresql@$PG_VERSION-main" 2>&1 | grep -q "Loaded: masked"; then
    log "postgresql@$PG_VERSION-main.service is masked — unmasking..."
    sudo systemctl unmask "postgresql@$PG_VERSION-main" 2>/dev/null || true
  fi
  sudo systemctl enable postgresql > /dev/null 2>&1 || true
  sudo systemctl start postgresql || sudo systemctl restart postgresql
else
  sudo service postgresql start
fi
# Wait for the postgres socket to actually accept connections — start may return
# before initdb-on-first-boot has finished creating the cluster.
log "Waiting for PostgreSQL to accept connections..."
for i in $(seq 1 30); do
  if sudo -i -u postgres psql -tAc "SELECT 1" > /dev/null 2>&1; then
    log "Connected after $i second(s)."
    break
  fi
  if [ "$i" = 5 ] || [ "$i" = 15 ] || [ "$i" = 25 ]; then log "Still waiting ($i s)..."; fi
  sleep 1
done
if ! sudo -i -u postgres psql -tAc "SELECT 1" > /dev/null 2>&1; then
  log "PostgreSQL did not become reachable within 30s. Diagnostics:"
  sudo systemctl status postgresql --no-pager 2>&1 | head -30 || true
  echo "--- last 50 lines of postgres log ---"
  sudo journalctl -u postgresql --no-pager -n 50 2>&1 || true
  exit 1
fi
log "Setting postgres password..."
sudo -i -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';" > /dev/null
INSTALLED_VERSION=$(sudo -i -u postgres psql -tAc "SHOW server_version" 2>/dev/null | head -1)
log "PostgreSQL ready (user: postgres, password: postgres, port: 5432, version: $INSTALLED_VERSION)"`,
    uninstallScript: `set -e
export DEBIAN_FRONTEND=noninteractive
${BASH_HELPERS}
log "Stopping PostgreSQL..."
sudo service postgresql stop 2>/dev/null || true
log "Removing PostgreSQL packages..."
wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 remove -y -qq postgresql postgresql-contrib > /dev/null
log "Autoremove..."
wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 autoremove -y -qq > /dev/null
log "PostgreSQL removed."`,
    setupShSnippet: `# Install and start PostgreSQL
export DEBIAN_FRONTEND=noninteractive
apt-get -o Acquire::ForceIPv4=true update -qq && apt-get -o Acquire::ForceIPv4=true install -y -qq postgresql postgresql-contrib > /dev/null
service postgresql start
cd / && su - postgres -c "psql -c \\"ALTER USER postgres PASSWORD 'postgres';\\""`,
    commands: [
      { name: "Start service", command: "sudo service postgresql start" },
      { name: "Stop service", command: "sudo service postgresql stop" },
      { name: "Restart service", command: "sudo service postgresql restart" },
      { name: "Check status", command: "sudo service postgresql status" },
      { name: "Connect as postgres", command: "sudo -i -u postgres psql" },
      { name: "List databases", command: "sudo -i -u postgres psql -l" },
      { name: "Create database", command: "sudo -i -u postgres createdb myapp" },
      { name: "Connection string", command: "echo 'postgresql://postgres:postgres@localhost:5432/postgres'" },
    ],
    options: [
      {
        name: "PG_VERSION",
        label: "Version",
        defaultValue: "default",
        choices: [
          { value: "default", label: "Ubuntu default (14 on 22.04, 16 on 24.04)" },
          { value: "14", label: "14" },
          { value: "15", label: "15" },
          { value: "16", label: "16" },
          { value: "17", label: "17 (latest)" },
        ],
      },
    ],
  },
  {
    slug: "genie-browser",
    label: "Genie Browser",
    icon: "Globe",
    description: "MCP browser automation via reverse SSH tunnel",
    port: 9877,
    checkScript: `curl -sf http://127.0.0.1:9877/mcp > /dev/null 2>&1 && echo "INSTALLED" || echo "NOT_INSTALLED"`,
    installScript: `set -e
${BASH_HELPERS}
log "Configuring genie-browser MCP..."
# /opt/project is created by the Genie project-deploy flow; for bare VMs we create it.
if [ ! -d /opt/project ]; then
  log "Creating /opt/project directory..."
  sudo mkdir -p /opt/project && sudo chown "$(whoami):$(whoami)" /opt/project
fi
if [ ! -f /opt/project/.mcp.json ]; then
  log "Seeding empty .mcp.json..."
  echo '{"mcpServers":{}}' > /opt/project/.mcp.json
fi
log "Merging genie-browser entry into .mcp.json..."
# Use jq if available, else fall back to node, else a python one-liner.
if command -v jq >/dev/null 2>&1; then
  tmp=$(mktemp)
  jq '.mcpServers["genie-browser"] = {"type":"http","url":"http://127.0.0.1:9877/mcp"}' /opt/project/.mcp.json > "$tmp" && mv "$tmp" /opt/project/.mcp.json
elif command -v node >/dev/null 2>&1; then
  node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync('/opt/project/.mcp.json', 'utf8'));
    if (!cfg.mcpServers) cfg.mcpServers = {};
    cfg.mcpServers['genie-browser'] = { type: 'http', url: 'http://127.0.0.1:9877/mcp' };
    fs.writeFileSync('/opt/project/.mcp.json', JSON.stringify(cfg, null, 2));
  "
else
  python3 -c "
import json
with open('/opt/project/.mcp.json') as f: cfg = json.load(f)
cfg.setdefault('mcpServers', {})['genie-browser'] = {'type': 'http', 'url': 'http://127.0.0.1:9877/mcp'}
with open('/opt/project/.mcp.json', 'w') as f: json.dump(cfg, f, indent=2)
"
fi
log "genie-browser MCP configured in .mcp.json"
log "Note: the browser tunnel is established when the Chrome extension connects."`,
    uninstallScript: `set -e
${BASH_HELPERS}
log "Removing genie-browser from .mcp.json..."
if [ -f /opt/project/.mcp.json ]; then
  if command -v jq >/dev/null 2>&1; then
    tmp=$(mktemp); jq 'del(.mcpServers["genie-browser"])' /opt/project/.mcp.json > "$tmp" && mv "$tmp" /opt/project/.mcp.json
  elif command -v node >/dev/null 2>&1; then
    node -e "
      const fs = require('fs');
      const cfg = JSON.parse(fs.readFileSync('/opt/project/.mcp.json', 'utf8'));
      delete cfg.mcpServers['genie-browser'];
      fs.writeFileSync('/opt/project/.mcp.json', JSON.stringify(cfg, null, 2));
    "
  fi
fi
log "genie-browser removed."`,
    setupShSnippet: `# Configure genie-browser MCP
if [ ! -f /opt/project/.mcp.json ]; then echo '{"mcpServers":{}}' > /opt/project/.mcp.json; fi
node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('/opt/project/.mcp.json','utf8'));c.mcpServers=c.mcpServers||{};c.mcpServers['genie-browser']={type:'http',url:'http://127.0.0.1:9877/mcp'};fs.writeFileSync('/opt/project/.mcp.json',JSON.stringify(c,null,2));"`,
    commands: [
      { name: "Check tunnel status", command: "curl -sf http://127.0.0.1:9877/mcp && echo 'Tunnel active' || echo 'Tunnel not connected'" },
      { name: "View .mcp.json", command: "cat /opt/project/.mcp.json" },
      { name: "Test browser snapshot", command: `curl -s -X POST http://127.0.0.1:9877/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"browser_get_snapshot","arguments":{}}}'` },
    ],
  },
  {
    slug: "navision",
    label: "Navision (BC)",
    icon: "Package",
    description: "Microsoft Dynamics 365 Business Central (Navision) sandbox",
    port: 8080,
    checkScript: `docker ps --format "{{.Names}}" 2>/dev/null | grep -qx "bc-sandbox" && echo "INSTALLED" || echo "NOT_INSTALLED"`,
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
${BASH_HELPERS}
# Ensure Docker is installed — Navision depends on it.
if ! command -v docker >/dev/null 2>&1; then
  log "Docker not found — installing first..."
  if command -v apt-get >/dev/null 2>&1; then
    wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 update -qq
    wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 install -y -qq docker.io curl ca-certificates > /dev/null
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y -q docker curl > /dev/null
  else
    log "Unsupported package manager (need apt-get or dnf)"; exit 1
  fi
  sudo systemctl enable --now docker > /dev/null 2>&1
  sudo usermod -aG docker "$USER" 2>/dev/null || true
  # Cross-distro Compose v2 from official GitHub release.
  if ! docker compose version >/dev/null 2>&1; then
    COMPOSE_VER=v2.29.7; ARCH=$(uname -m)
    sudo mkdir -p /usr/local/lib/docker/cli-plugins
    sudo curl -4 -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \\
      "https://github.com/docker/compose/releases/download/$\{COMPOSE_VER}/docker-compose-linux-$\{ARCH}"
    sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
  fi
  log "Docker installed: $(docker --version)"
fi
log "Pulling Business Central image — ~5GB, takes several minutes..."
sudo docker pull mcr.microsoft.com/businesscentral:latest 2>&1 | while IFS= read -r line; do
  # Docker pull emits dozens of "Pulling fs layer / Downloading / Extracting" lines.
  # Surface only the high-signal ones so the panel doesn't spam.
  case "$line" in
    *"Pull complete"*|*"Status:"*|*"Digest:"*) log "$line" ;;
  esac
done
log "Creating BC sandbox container..."
sudo docker run -d --name bc-sandbox \\
  -e ACCEPT_EULA=Y \\
  -e USESSL=N \\
  -e USERNAME=admin \\
  -e PASSWORD=P@ssw0rd123! \\
  -p 8080:80 \\
  -p 7049:7049 \\
  -p 7048:7048 \\
  --memory=8g \\
  mcr.microsoft.com/businesscentral:latest > /dev/null
log "Waiting for BC to initialize (3-5 min)..."
for i in $(seq 1 60); do
  if sudo docker logs bc-sandbox 2>&1 | grep -q "Ready for connections"; then
    log "Business Central is ready!"
    log "Web Client: http://\$(hostname -I | awk '{print \$1}'):8080/BC/"
    log "Username: admin"
    log "Password: P@ssw0rd123!"
    log "OData:     http://\$(hostname -I | awk '{print \$1}'):7048/BC/ODataV4"
    log "Dev:       http://\$(hostname -I | awk '{print \$1}'):7049/BC"
    exit 0
  fi
  if [ $((i % 6)) = 0 ]; then log "Still initializing ($((i*5))s elapsed)..."; fi
  sleep 5
done
log "BC container started but still initializing. Check with: docker logs -f bc-sandbox"`,
    uninstallScript: `set -e
${BASH_HELPERS}
log "Stopping Business Central..."
sudo docker stop bc-sandbox 2>/dev/null || true
sudo docker rm bc-sandbox 2>/dev/null || true
log "Business Central removed."
log "Note: Docker image still cached. Run 'docker rmi mcr.microsoft.com/businesscentral:latest' to free disk space."`,
    setupShSnippet: `# Business Central (Navision) sandbox
docker pull mcr.microsoft.com/businesscentral:latest
docker run -d --name bc-sandbox \\
  -e ACCEPT_EULA=Y -e USESSL=N \\
  -e USERNAME=admin -e PASSWORD=\${BC_PASSWORD:-P@ssw0rd123!} \\
  -p 8080:80 -p 7049:7049 -p 7048:7048 \\
  --memory=8g \\
  mcr.microsoft.com/businesscentral:latest`,
    commands: [
      { name: "Web Client URL", command: `echo "http://$(hostname -I | awk '{print $1}'):8080/BC/"` },
      { name: "Container status", command: "docker ps --filter name=bc-sandbox --format 'table {{.Status}}\t{{.Ports}}'" },
      { name: "View logs", command: "docker logs --tail 50 bc-sandbox" },
      { name: "Follow logs", command: "docker logs -f bc-sandbox" },
      { name: "Restart BC", command: "docker restart bc-sandbox" },
      { name: "Stop BC", command: "docker stop bc-sandbox" },
      { name: "Start BC", command: "docker start bc-sandbox" },
      { name: "Check readiness", command: `docker logs bc-sandbox 2>&1 | grep -c "Ready for connections" > /dev/null && echo "BC is ready" || echo "BC still initializing..."` },
      { name: "OData endpoint", command: `echo "http://$(hostname -I | awk '{print $1}'):7048/BC/ODataV4"` },
      { name: "Dev endpoint", command: `echo "http://$(hostname -I | awk '{print $1}'):7049/BC"` },
      { name: "PowerShell into BC", command: "docker exec -it bc-sandbox powershell" },
      { name: "List extensions", command: `docker exec bc-sandbox powershell -Command "Get-NAVAppInfo -ServerInstance BC" 2>/dev/null || echo "BC still starting..."` },
    ],
  },
  {
    slug: "docker",
    label: "Docker",
    icon: "Container",
    description: "Container runtime (engine + compose)",
    checkScript: `if command -v docker > /dev/null 2>&1 && sudo systemctl is-active --quiet docker 2>/dev/null; then echo "INSTALLED"; else echo "NOT_INSTALLED"; fi`,
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
${BASH_HELPERS}
if command -v apt-get > /dev/null 2>&1; then
  log "Installing Docker via apt..."
  log "apt-get update..."
  wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 update -qq
  log "apt-get install docker.io (~250MB, 1-2 min)..."
  wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 install -y -qq docker.io curl ca-certificates > /dev/null
elif command -v dnf > /dev/null 2>&1; then
  log "Installing Docker via dnf..."
  sudo dnf install -y -q docker curl > /dev/null
else
  log "Unsupported package manager (need apt-get or dnf)"; exit 1
fi
log "Enabling and starting docker service..."
sudo systemctl enable --now docker > /dev/null 2>&1
sudo usermod -aG docker "$USER" 2>/dev/null || true
# Docker Compose v2 from GitHub release — package name is inconsistent across
# distros (docker-compose-v2 on Ubuntu 24.04+, docker-compose-plugin on
# docker-ce repos, absent on stock Ubuntu 22.04 / Debian 12). The plugin
# binary works on any distro and survives apt-get upgrades.
if ! docker compose version > /dev/null 2>&1; then
  COMPOSE_VER=v2.29.7
  ARCH=$(uname -m)
  log "Installing Docker Compose $COMPOSE_VER for $ARCH from GitHub..."
  sudo mkdir -p /usr/local/lib/docker/cli-plugins
  sudo curl -4 -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \\
    "https://github.com/docker/compose/releases/download/$\{COMPOSE_VER}/docker-compose-linux-$\{ARCH}"
  sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi
log "Docker installed: $(docker --version)"
log "Compose:          $(docker compose version 2>/dev/null || echo MISSING)"`,
    uninstallScript: `set -e
export DEBIAN_FRONTEND=noninteractive
${BASH_HELPERS}
log "Stopping Docker..."
sudo systemctl stop docker > /dev/null 2>&1 || true
sudo systemctl disable docker > /dev/null 2>&1 || true
if command -v apt-get > /dev/null 2>&1; then
  log "apt-get remove docker.io..."
  wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 remove -y -qq docker.io > /dev/null 2>&1 || true
  log "Autoremove..."
  wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 autoremove -y -qq > /dev/null
elif command -v dnf > /dev/null 2>&1; then
  log "dnf remove docker..."
  sudo dnf remove -y -q docker > /dev/null 2>&1 || true
fi
log "Removing Compose CLI plugin..."
sudo rm -f /usr/local/lib/docker/cli-plugins/docker-compose
log "Docker removed."`,
    setupShSnippet: `# Install Docker + Compose v2 (Compose binary from GitHub release for distro-independent install)
export DEBIAN_FRONTEND=noninteractive
if command -v apt-get > /dev/null 2>&1; then
  apt-get -o Acquire::ForceIPv4=true update -qq && apt-get -o Acquire::ForceIPv4=true install -y -qq docker.io curl ca-certificates > /dev/null
elif command -v dnf > /dev/null 2>&1; then
  dnf install -y -q docker curl > /dev/null
fi
systemctl enable --now docker
if ! docker compose version > /dev/null 2>&1; then
  COMPOSE_VER=v2.29.7; ARCH=$(uname -m); mkdir -p /usr/local/lib/docker/cli-plugins
  curl -4 -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose "https://github.com/docker/compose/releases/download/$\{COMPOSE_VER}/docker-compose-linux-$\{ARCH}"
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi`,
    commands: [
      { name: "Version", command: "docker --version && docker compose version 2>/dev/null || true" },
      { name: "List running containers", command: "docker ps" },
      { name: "List all containers", command: "docker ps -a" },
      { name: "List images", command: "docker images" },
      { name: "Disk usage", command: "docker system df" },
      { name: "Live stats", command: "docker stats --no-stream" },
      { name: "Prune (containers/images/volumes)", command: "docker system prune -f" },
      { name: "Service status", command: "sudo systemctl status docker --no-pager | head -10" },
      { name: "Restart Docker", command: "sudo systemctl restart docker && echo restarted" },
      { name: "Compose: up", command: "cd /opt/project && sudo docker compose up -d" },
      { name: "Compose: down", command: "cd /opt/project && sudo docker compose down" },
      { name: "Compose: ps", command: "cd /opt/project && sudo docker compose ps" },
      { name: "Compose: logs (tail 100)", command: "cd /opt/project && sudo docker compose logs --tail 100" },
    ],
  },
  {
    slug: "rkhunter",
    label: "rkhunter",
    icon: "Bug",
    description: "Rootkit Hunter — scan for rootkits, backdoors, local exploits",
    checkScript: `command -v rkhunter > /dev/null 2>&1 && echo "INSTALLED" || echo "NOT_INSTALLED"`,
    installScript: `set -e
export DEBIAN_FRONTEND=noninteractive
${BASH_HELPERS}
if command -v apt-get > /dev/null 2>&1; then
  log "Installing rkhunter via apt..."
  wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 update -qq
  wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 install -y -qq rkhunter > /dev/null
elif command -v dnf > /dev/null 2>&1; then
  log "Installing rkhunter via dnf (requires EPEL on AlmaLinux/RHEL)..."
  sudo dnf install -y -q epel-release > /dev/null 2>&1 || true
  sudo dnf install -y -q rkhunter > /dev/null
else
  log "Unsupported package manager (need apt-get or dnf)"; exit 1
fi
log "Updating rkhunter signature database..."
# --update fetches new rules; non-zero exit just means "no updates available", not failure.
sudo rkhunter --update --nocolors 2>&1 | tail -20 || true
log "Baselining file properties (rkhunter --propupd)..."
# Without a baseline, every subsequent --check reports thousands of "file properties
# changed" warnings. Running this once after install is the standard post-install step.
sudo rkhunter --propupd --nocolors > /dev/null
log "rkhunter installed: $(rkhunter --version 2>&1 | head -1)"`,
    uninstallScript: `set -e
export DEBIAN_FRONTEND=noninteractive
${BASH_HELPERS}
if command -v apt-get > /dev/null 2>&1; then
  log "apt-get remove rkhunter..."
  wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 remove -y -qq rkhunter > /dev/null 2>&1 || true
  log "Autoremove..."
  wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 autoremove -y -qq > /dev/null
elif command -v dnf > /dev/null 2>&1; then
  log "dnf remove rkhunter..."
  sudo dnf remove -y -q rkhunter > /dev/null 2>&1 || true
fi
log "Removing rkhunter data dirs..."
sudo rm -rf /var/lib/rkhunter /var/log/rkhunter.log /etc/rkhunter.conf 2>/dev/null || true
log "rkhunter removed."`,
    setupShSnippet: `# Install rkhunter
export DEBIAN_FRONTEND=noninteractive
apt-get -o Acquire::ForceIPv4=true update -qq && apt-get -o Acquire::ForceIPv4=true install -y -qq rkhunter > /dev/null
rkhunter --update --nocolors 2>&1 | tail -5 || true
rkhunter --propupd --nocolors > /dev/null`,
    commands: [
      { name: "Version", command: "rkhunter --version | head -1" },
      { name: "Full check (skip keypress prompts)", command: "sudo rkhunter --check --sk" },
      { name: "Rootkits only", command: "sudo rkhunter --check --sk --enable rootkits" },
      { name: "Update signatures", command: "sudo rkhunter --update --nocolors" },
      { name: "Re-baseline file properties", command: "sudo rkhunter --propupd --nocolors" },
      { name: "Show last warnings", command: "sudo grep -E 'Warning|Found' /var/log/rkhunter.log | tail -50" },
      { name: "List installed tests", command: "rkhunter --list tests" },
    ],
  },
  {
    slug: "git-credentials",
    label: "Git Credentials",
    icon: "KeyRound",
    description: "Configure git to clone private repos from github.com and/or gitlab.com. Tokens are prompted each apply — never stored.",
    secrets: [
      {
        name: "GIT_TOKEN",
        label: "GitHub token",
        placeholder: "ghp_… or github_pat_…",
        description: "Classic PAT with 'repo' scope (works for org repos), or a fine-grained PAT with read access. Pasted token is used once and discarded.",
      },
      {
        name: "GITLAB_TOKEN",
        label: "GitLab token",
        placeholder: "glpat-…",
        description: "GitLab personal access token with 'read_repository' (or broader) scope. Leave empty if you only use GitHub.",
      },
    ],
    checkScript: `set -e
# Treat the recipe as "installed" only if BOTH the credential.helper is set AND
# the .git-credentials file has at least one entry. That way removing the file
# (or wiping the helper) flips the check back to NOT_INSTALLED.
helper=$(git config --global --get credential.helper 2>/dev/null || true)
if [ "$helper" = "store" ] && [ -s "$HOME/.git-credentials" ]; then
  echo "INSTALLED"
else
  echo "NOT_INSTALLED"
fi`,
    installScript: `set -e
${BASH_HELPERS}
# Tokens are prompted via the Install / Re-apply modal in the admin panel, then
# passed as env vars for this one exec call. They are NOT stored anywhere — the
# user re-enters them each time.
if [ -z "$\{GIT_TOKEN:-}" ] && [ -z "$\{GITLAB_TOKEN:-}" ]; then
  log "ERROR: no token supplied. Click Install or Re-apply and paste at least one token in the dialog."
  exit 1
fi

# Write credential helper config + ~/.git-credentials for one target user.
# Uses sudo when the target isn't the current user so the admin-panel install
# path (which runs as ubuntu/debian/almalinux) can still configure the genie
# deploy account.
write_creds_for_user() {
  local target="$1"
  local home_dir
  home_dir=$(getent passwd "$target" | cut -d: -f6)
  if [ -z "$home_dir" ] || [ ! -d "$home_dir" ]; then
    log "  skip $target: no home directory"
    return 0
  fi

  local creds="$home_dir/.git-credentials"
  local run
  # -H resets $HOME to the target's home dir. Without it, 'git config --global'
  # writes credential.helper into the CALLER's ~/.gitconfig instead of the
  # target's — silently breaking the mirror.
  if [ "$target" = "$(id -un)" ]; then run=""; else run="sudo -H -u $target"; fi

  $run git config --global credential.helper store
  $run touch "$creds"
  $run chmod 600 "$creds"

  # Dedup-then-append per host so re-running with new tokens updates in place
  # rather than accumulating duplicates.
  if [ -n "$\{GIT_TOKEN:-}" ]; then
    $run bash -c "grep -v 'https://[^@]*@github\\.com' '$creds' > '$creds.tmp' || true; echo 'https://x-access-token:$\{GIT_TOKEN}@github.com' >> '$creds.tmp'; mv '$creds.tmp' '$creds'; chmod 600 '$creds'"
  fi
  if [ -n "$\{GITLAB_TOKEN:-}" ]; then
    $run bash -c "grep -v 'https://[^@]*@gitlab\\.com' '$creds' > '$creds.tmp' || true; echo 'https://oauth2:$\{GITLAB_TOKEN}@gitlab.com' >> '$creds.tmp'; mv '$creds.tmp' '$creds'; chmod 600 '$creds'"
  fi
  log "  $target → $creds"
}

current_user=$(id -un)
log "Configuring git credentials for $current_user..."
write_creds_for_user "$current_user"

# Mirror to the 'genie' deploy account so private clones inside setup.sh /
# project containers / per-project recipes also work. The admin "Manage VM"
# panel runs recipes as the image-default user (ubuntu/debian/almalinux), so
# without this mirror, a clone-as-genie later would still prompt.
if [ "$current_user" != "genie" ] && id genie >/dev/null 2>&1; then
  log "Mirroring credentials to the 'genie' deploy account..."
  write_creds_for_user "genie"
fi

log "Done. Try: git clone https://github.com/<org>/<private-repo>.git"`,
    uninstallScript: `set -e
${BASH_HELPERS}
log "Removing stored git credentials for $(id -un)..."
rm -f "$HOME/.git-credentials"
git config --global --unset credential.helper 2>/dev/null || true

# Also clean up the mirror on the genie account if we created it.
if [ "$(id -un)" != "genie" ] && id genie >/dev/null 2>&1; then
  log "Removing mirrored credentials for genie..."
  sudo rm -f /home/genie/.git-credentials
  sudo -H -u genie git config --global --unset credential.helper 2>/dev/null || true
fi
log "Removed."`,
    setupShSnippet: `# Git Credentials — adds GIT_TOKEN / GITLAB_TOKEN entries to ~/.git-credentials
# so private repos can be cloned over HTTPS. The runner injects the tokens; you
# don't need to put them in setup.sh in plaintext.
git config --global credential.helper store
: "$\{GIT_TOKEN:?GIT_TOKEN env var is required for this snippet}"
echo "https://x-access-token:$\{GIT_TOKEN}@github.com" >> "$HOME/.git-credentials"
if [ -n "$\{GITLAB_TOKEN:-}" ]; then
  echo "https://oauth2:$\{GITLAB_TOKEN}@gitlab.com" >> "$HOME/.git-credentials"
fi
chmod 600 "$HOME/.git-credentials"`,
    commands: [
      { name: "Show configured hosts (masked)", command: "sed 's#https://[^@]*@#https://***@#' $HOME/.git-credentials 2>/dev/null || echo '(no .git-credentials yet)'" },
      { name: "Show credential helper", command: "git config --global --get credential.helper" },
      { name: "Show genie mirror (masked)", command: "sudo -H -u genie sed 's#https://[^@]*@#https://***@#' /home/genie/.git-credentials 2>/dev/null || echo '(no /home/genie/.git-credentials yet)'" },
      { name: "Show genie credential.helper", command: "sudo -H -u genie git config --global --get credential.helper || echo '(not set for genie)'" },
      { name: "Test github clone", command: "git ls-remote https://github.com/anthropics/anthropic-sdk-typescript.git HEAD" },
      { name: "Test github clone (as genie)", command: "sudo -H -u genie git ls-remote https://github.com/anthropics/anthropic-sdk-typescript.git HEAD" },
    ],
  },
  {
    slug: "claude-code",
    label: "Claude Code",
    icon: "Sparkles",
    description: "Install the Claude Code CLI (Anthropic) — installs Node.js 20 first if missing",
    checkScript: `if command -v claude > /dev/null 2>&1; then echo "INSTALLED"; else echo "NOT_INSTALLED"; fi`,
    installScript: `set -e
${BASH_HELPERS}

# 1. Ensure Node.js (the CLI is npm-distributed). Anything ≥18 works.
if ! command -v node > /dev/null 2>&1; then
  log "Node.js not found — installing Node 20 via NodeSource..."
  if command -v apt-get > /dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    # Same v4-forcing pattern as the bootstrap — Fastly-fronted nodesource is
    # v6-flaky from some Taz VMs.
    wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 update -qq
    wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 install -y -qq curl ca-certificates > /dev/null
    curl -4 -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - > /dev/null 2>&1
    wait_apt; sudo -E apt-get -o Acquire::ForceIPv4=true -o DPkg::Lock::Timeout=300 install -y -qq nodejs > /dev/null
  elif command -v dnf > /dev/null 2>&1; then
    sudo dnf install -y -q curl > /dev/null
    curl -4 -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - > /dev/null 2>&1
    sudo dnf install -y -q nodejs > /dev/null
  else
    log "ERROR: no supported package manager (need apt-get or dnf) and Node.js is missing."
    exit 1
  fi
fi
log "Node: $(node --version), npm: $(npm --version)"

# 2. Install Claude Code globally via npm. Two Taz-specific workarounds:
#    - NODE_OPTIONS=--dns-result-order=ipv4first forces Node's resolver to try
#      IPv4 first; registry.npmjs.org is Fastly-fronted and v6-broken from
#      Taz VMs, so without this npm hangs ~30s per package fetch.
#    - --fetch-retries=2 --fetch-retry-mintimeout=5000 keeps a single failed
#      tarball download from stalling the install for minutes.
#    Dropped --silent so the progress is visible (the tail -3 hid the hang).
log "Installing @anthropic-ai/claude-code (npm install -g)..."
# HOME=/root pins npm's cache to /root/.npm — see comment in genie-standard.
sudo HOME=/root NODE_OPTIONS="--dns-result-order=ipv4first" \
  npm install -g \
    --no-audit --no-fund \
    --fetch-retries=2 --fetch-retry-mintimeout=5000 \
    @anthropic-ai/claude-code 2>&1 | tail -20

# 3. Verify.
if command -v claude > /dev/null 2>&1; then
  log "Installed: $(claude --version 2>&1 | head -1)"
else
  log "ERROR: 'claude' is not on PATH after install — check 'npm root -g' and ensure it's in PATH."
  exit 1
fi

log "Claude Code installed. Run 'claude' on the VM to authenticate (interactive)."`,
    uninstallScript: `set -e
${BASH_HELPERS}
log "Uninstalling Claude Code..."
sudo npm uninstall -g @anthropic-ai/claude-code 2>&1 | tail -3 || true
# Defensive cleanup of the user-local config (only this user's; doesn't touch others).
rm -rf "$HOME/.claude" 2>/dev/null || true
log "Removed."`,
    setupShSnippet: `# Install Claude Code CLI (assumes Node.js already present from Genie bootstrap)
sudo HOME=/root NODE_OPTIONS="--dns-result-order=ipv4first" npm install -g @anthropic-ai/claude-code 2>&1 | tail -3`,
    commands: [
      { name: "Version", command: "claude --version" },
      { name: "Help", command: "claude --help | head -40" },
      { name: "Where installed", command: "command -v claude && ls -la $(command -v claude)" },
      { name: "Update", command: "sudo HOME=/root NODE_OPTIONS=--dns-result-order=ipv4first npm install -g @anthropic-ai/claude-code 2>&1 | tail -5" },
    ],
  },
  {
    slug: "nextjs",
    label: "Next.js (latest)",
    icon: "Layers",
    description: "Scaffold a default Next.js (latest) app at /opt/project and run 'npm run dev' as the 'nextjs-dev' systemd service. Logs append to /var/log/nextjs-dev.log (see CLAUDE.md → VPS Service Logs).",
    port: 3000,
    checkScript: `if [ -f /opt/project/package.json ] && grep -q '"next"' /opt/project/package.json && systemctl is-enabled --quiet nextjs-dev 2>/dev/null; then echo "INSTALLED"; else echo "NOT_INSTALLED"; fi`,
    installScript: `set -e
set -o pipefail  # so 'npx ... | sed' fails the script when npx errors instead of silently continuing
${BASH_HELPERS}
# Log path is the convention in CLAUDE.md → VPS Service Logs. Keep these in sync.
LOG_FILE=/var/log/nextjs-dev.log
force_ipv4_dns

# Prereqs (provided by 'Genie Standard Setup'): node, npm, the 'genie' user, /opt/project.
if ! command -v node > /dev/null 2>&1 || ! command -v npm > /dev/null 2>&1; then
  log "ERROR: node/npm missing — install 'Genie Standard Setup' first."; exit 1
fi
if ! id genie > /dev/null 2>&1; then
  log "ERROR: 'genie' user missing — install 'Genie Standard Setup' first."; exit 1
fi
sudo mkdir -p /opt/project
sudo chown -R genie:genie /opt/project
# Defensive: older versions of the Genie Standard Setup recipe ran
# sudo -E npm install -g with HOME preserved, which left root-owned files
# in /home/genie/.npm and broke every later npm run as genie (EACCES on
# /home/genie/.npm/_cacache). Reclaim the cache before any npm operation.
sudo chown -R genie:genie /home/genie/.npm 2>/dev/null || true
log "Node: $(node --version), npm: $(npm --version)"

# Scaffold only when /opt/project isn't already a Next.js app. create-next-app
# refuses to write into a non-empty dir, so bail loudly rather than clobber.
# Also treat a partial scaffold (package.json present but no node_modules) as
# "not installed" — that state is left behind when a previous attempt died
# during npm install and the systemd unit would just loop on "next: not found".
if [ -f /opt/project/package.json ] && grep -q '"next"' /opt/project/package.json && [ -d /opt/project/node_modules ]; then
  log "Next.js already initialized at /opt/project — skipping create-next-app."
else
  if [ -f /opt/project/package.json ] && [ ! -d /opt/project/node_modules ]; then
    log "Partial scaffold detected (package.json without node_modules) — wiping /opt/project before retry."
    sudo rm -rf /opt/project/* /opt/project/.[!.]* 2>/dev/null || true
  fi
  if [ -n "$(ls -A /opt/project 2>/dev/null)" ]; then
    log "ERROR: /opt/project not empty and not a Next.js app — refusing to overwrite."; exit 1
  fi
  log "Scaffolding Next.js (latest) at /opt/project (1-3 min)..."
  # create-next-app checks write access on the PARENT directory of the target
  # (so it can mkdir the project dir if missing) — /opt is root-owned 755 and
  # not writable by genie, which makes the chown + write-into-existing-dir
  # combo deceptively fail with "application path is not writable". Workaround:
  # scaffold inside a genie-owned tmp dir, then move contents into the
  # already-existing /opt/project. Avoids ever touching /opt's perms.
  SCRATCH=$(sudo -u genie mktemp -d /home/genie/nextjs-scaffold-XXXXXX)
  sudo -H -u genie bash -lc "cd '$SCRATCH' && NODE_OPTIONS='--dns-result-order=ipv4first' npx --yes create-next-app@latest app --ts --tailwind --eslint --app --src-dir --import-alias '@/*' --use-npm --yes" 2>&1 | sed 's/^/  /'
  # Move scaffold contents (including dotfiles) into /opt/project, then clean up.
  sudo -u genie bash -c "shopt -s dotglob && mv '$SCRATCH'/app/* /opt/project/"
  sudo -u genie rmdir "$SCRATCH/app" "$SCRATCH"
fi

# systemd 'append:' requires the file to be writable by the service User. genie
# can't create files in /var/log, so we pre-create + chown here.
log "Preparing log file $LOG_FILE..."
sudo touch "$LOG_FILE"
sudo chown genie:genie "$LOG_FILE"
sudo chmod 644 "$LOG_FILE"

# Resolve npm path now (systemd units don't inherit interactive PATH).
NPM_PATH=$(command -v npm)
log "Writing /etc/systemd/system/nextjs-dev.service (ExecStart=$NPM_PATH run dev)..."
sudo tee /etc/systemd/system/nextjs-dev.service > /dev/null <<UNIT
[Unit]
Description=Next.js dev server (Genie)
After=network.target

[Service]
Type=simple
User=genie
WorkingDirectory=/opt/project
Environment=NODE_OPTIONS=--dns-result-order=ipv4first
Environment=PORT=3000
ExecStart=$NPM_PATH run dev
Restart=on-failure
RestartSec=5
KillMode=mixed
StandardOutput=append:$LOG_FILE
StandardError=append:$LOG_FILE

[Install]
WantedBy=multi-user.target
UNIT

log "Reloading systemd and starting nextjs-dev..."
sudo systemctl daemon-reload
# 'restart' (not 'start') so a re-run picks up unit-file changes; --now on enable
# is intentionally left off so we control the wait/poll below.
sudo systemctl enable nextjs-dev > /dev/null 2>&1 || true
sudo systemctl restart nextjs-dev

# 1. Wait for systemd to report the service active. 'next dev' takes a few
#    seconds to fork before systemd marks it active (Type=simple).
log "Waiting for nextjs-dev to become active..."
for i in $(seq 1 30); do
  if sudo systemctl is-active --quiet nextjs-dev; then
    log "  systemd: active after \${i}s."
    break
  fi
  sleep 1
done
if ! sudo systemctl is-active --quiet nextjs-dev; then
  log "ERROR: nextjs-dev failed to reach active state. Recent status:"
  sudo systemctl status nextjs-dev --no-pager 2>&1 | head -30 || true
  log "Recent log lines ($LOG_FILE):"
  sudo tail -n 50 "$LOG_FILE" 2>/dev/null || true
  exit 1
fi

# 2. Wait for port 3000 to actually serve HTTP. First request triggers Next's
#    on-demand compile (5-30 s on a small VM), so this poll is the real
#    confirmation the user can hit the app — not just that npm spawned.
log "Waiting for HTTP on port 3000 (Next.js first-request compile can take 30s)..."
ready=0
for i in $(seq 1 60); do
  code=$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3000/ 2>/dev/null || echo 000)
  if [ "$code" != "000" ] && [ "$code" != "502" ] && [ "$code" != "503" ]; then
    log "  HTTP \${code} from http://127.0.0.1:3000/ after \${i}s — server is up."
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" != "1" ]; then
  log "WARNING: service is active but port 3000 did not respond in 60s. Recent log lines:"
  sudo tail -n 50 "$LOG_FILE" 2>/dev/null || true
  log "Check 'sudo journalctl -u nextjs-dev -n 100' and $LOG_FILE for compile errors."
  exit 1
fi

sudo systemctl status nextjs-dev --no-pager 2>&1 | head -10 || true
log "Done. Service: nextjs-dev   Port: 3000 (responding)   Logs: $LOG_FILE"`,
    uninstallScript: `set -e
${BASH_HELPERS}
log "Stopping and disabling nextjs-dev.service..."
sudo systemctl disable --now nextjs-dev 2>/dev/null || true
sudo rm -f /etc/systemd/system/nextjs-dev.service
sudo systemctl daemon-reload
log "Note: /opt/project source and /var/log/nextjs-dev.log are left in place — remove manually if desired."
log "Done."`,
    setupShSnippet: `# Next.js (latest) at /opt/project + nextjs-dev systemd service (logs → /var/log/nextjs-dev.log)
LOG_FILE=/var/log/nextjs-dev.log
mkdir -p /opt/project && chown -R genie:genie /opt/project
if [ ! -f /opt/project/package.json ] || ! grep -q '"next"' /opt/project/package.json; then
  # Scaffold in a genie-owned tmp dir then move into /opt/project — create-next-app
  # checks the parent dir's writability and /opt is root-owned.
  SCRATCH=$(sudo -u genie mktemp -d /home/genie/nextjs-scaffold-XXXXXX)
  sudo -H -u genie bash -lc "cd '$SCRATCH' && NODE_OPTIONS='--dns-result-order=ipv4first' npx --yes create-next-app@latest app --ts --tailwind --eslint --app --src-dir --import-alias '@/*' --use-npm --yes" 2>&1 | tail -10
  sudo -u genie bash -c "shopt -s dotglob && mv '$SCRATCH'/app/* /opt/project/"
  sudo -u genie rmdir "$SCRATCH/app" "$SCRATCH"
fi
touch "$LOG_FILE" && chown genie:genie "$LOG_FILE" && chmod 644 "$LOG_FILE"
NPM_PATH=$(command -v npm)
cat > /etc/systemd/system/nextjs-dev.service <<UNIT
[Unit]
Description=Next.js dev server (Genie)
After=network.target
[Service]
Type=simple
User=genie
WorkingDirectory=/opt/project
Environment=NODE_OPTIONS=--dns-result-order=ipv4first
Environment=PORT=3000
ExecStart=$NPM_PATH run dev
Restart=on-failure
RestartSec=5
KillMode=mixed
StandardOutput=append:$LOG_FILE
StandardError=append:$LOG_FILE
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable --now nextjs-dev`,
    commands: [
      { name: "Service status", command: "sudo systemctl status nextjs-dev --no-pager 2>&1 | head -25" },
      { name: "Tail logs (last 80)", command: "sudo tail -n 80 /var/log/nextjs-dev.log" },
      { name: "Follow logs (5s)", command: "sudo timeout 5 tail -n 30 -f /var/log/nextjs-dev.log || true" },
      { name: "Restart service", command: "sudo systemctl restart nextjs-dev && sleep 2 && sudo systemctl status nextjs-dev --no-pager 2>&1 | head -10" },
      { name: "Stop service", command: "sudo systemctl stop nextjs-dev" },
      { name: "Start service", command: "sudo systemctl start nextjs-dev" },
      { name: "Next.js version", command: "cd /opt/project && node -e 'console.log(require(\"./package.json\").dependencies.next)'" },
      { name: "Clear log file", command: "sudo truncate -s 0 /var/log/nextjs-dev.log && echo 'cleared'" },
      { name: "Hit local URL", command: "curl -fsS -o /dev/null -w 'HTTP %{http_code} in %{time_total}s\\n' http://127.0.0.1:3000/ || echo 'not reachable yet'" },
    ],
  },
];
