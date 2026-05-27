# WireGuard Setup — TazCloud Bastion

## What this replaces

Before: `ssh -J almalinux@188.213.48.230 genie@10.128.N.x`  
After:  `ssh genie@10.128.N.x`

WireGuard runs on the bastion. Once your tunnel is up, all `10.128.0.0/16`
traffic routes through it automatically. Everything else (internet, your normal
traffic) is unaffected.

---

## Endpoint & keys

| | |
|---|---|
| **Endpoint** | `188.213.48.230:51820` (UDP) |
| **Server public key** | `t5o+t4A3tf+5UjRbLQcsb58GMSm5lxNYc2igICuj3h4=` |
| **Tunnel subnet** | `10.200.0.0/24` |

---

## Peer configs

### Prod (Genie Linux server) — `10.200.0.2`

File: `wireguard-peers/prod.conf`

```ini
[Interface]
Address = 10.200.0.2/32
PrivateKey = uLtKz8fBHrnjAqA3mhiDyaDscQKOHCn8BetR0ecDQ2k=

[Peer]
PublicKey = t5o+t4A3tf+5UjRbLQcsb58GMSm5lxNYc2igICuj3h4=
Endpoint = 188.213.48.230:51820
AllowedIPs = 10.128.0.0/16
PersistentKeepalive = 25
```

### Dev (macOS) — `10.200.0.3`

File: `wireguard-peers/dev.conf`

```ini
[Interface]
Address = 10.200.0.3/32
PrivateKey = ULSkUIRb1f/6o2lfZJRKPhqr4lnytqZzVIqTVGzNjkg=
DNS = 1.1.1.1

[Peer]
PublicKey = t5o+t4A3tf+5UjRbLQcsb58GMSm5lxNYc2igICuj3h4=
Endpoint = 188.213.48.230:51820
AllowedIPs = 10.128.0.0/16
PersistentKeepalive = 25
```

---

## Install — Linux (Genie prod server)

```bash
# Install
sudo dnf install -y wireguard-tools        # AlmaLinux / RHEL / Rocky
# sudo apt install -y wireguard            # Ubuntu / Debian

# Deploy config
sudo cp prod.conf /etc/wireguard/wg0.conf
sudo chmod 600 /etc/wireguard/wg0.conf

# Start + enable on boot
sudo systemctl enable --now wg-quick@wg0
```

Verify:

```bash
sudo wg show
# expected output:
#   interface: wg0
#   peer: t5o+t4A3...
#     endpoint: 188.213.48.230:51820
#     latest handshake: X seconds ago
#     transfer: ...

ssh genie@10.128.2.92    # direct — no -J
```

---

## Install — macOS (dev machine)

**Step 1** — Install WireGuard from the Mac App Store:
[https://apps.apple.com/app/wireguard/id1451685025](https://apps.apple.com/app/wireguard/id1451685025)

**Step 2** — Import the config:
- Open WireGuard
- Click **+** → **Import tunnel(s) from file**
- Select `wireguard-peers/dev.conf`

**Step 3** — Activate the tunnel (toggle it on)

Verify:

```bash
ping 10.200.0.1          # bastion WireGuard IP — should respond
ssh genie@10.128.2.92    # direct VM access
```

---

## Stop / restart

```bash
# Linux
sudo systemctl stop wg-quick@wg0
sudo systemctl restart wg-quick@wg0

# macOS — toggle in the WireGuard app, or:
sudo wg-quick down wg0
sudo wg-quick up wg0
```

---

## Add a new peer

Run from this machine (needs access to control host):

```bash
./wireguard-add-peer.sh <name>
# example:
./wireguard-add-peer.sh ci
```

Prints a ready-to-use client config to stdout. IPs are auto-assigned
(`10.200.0.4`, `.5`, etc.). Peer is added live — no restart needed.

---

## Railway (userspace WireGuard via wireproxy)

Railway containers can't load kernel modules or open a TUN device, so they
can't run `wg-quick`. Instead the manager spawns
[`wireproxy`](https://github.com/windtf/wireproxy) at boot — a userspace
WireGuard that exposes a local SOCKS5 proxy. SSH connections to `10.128/16`
are auto-routed through it; everything else dials directly.

`wireproxy` is bundled via Nixpacks (see `nixpacks.toml`). Set these on the
Railway service:

| Env var | Example | Notes |
|---|---|---|
| `WG_PRIVATE_KEY` | `uLtKz8…=` | The client's WG private key (`prod.conf` `[Interface].PrivateKey`). |
| `WG_PEER_PUBLIC_KEY` | `t5o+t4A…=` | The bastion's WG public key. |
| `WG_ENDPOINT` | `188.213.48.230:51820` | Bastion `host:port` (UDP). |
| `WG_ADDRESS` | `10.200.0.2/32` | Manager's address inside the tunnel. |
| `WG_ALLOWED_IPS` | `10.128.0.0/16` | Optional — defaults to `10.128.0.0/16`. |
| `WG_KEEPALIVE` | `25` | Optional. |
| `GENIE_TAZ_SOCKS_PORT` | `25344` | Optional — local SOCKS5 port. |

When all four `WG_*` vars are present the launcher renders a wireproxy config
to `/tmp/genie-wireproxy/wireproxy.conf`, spawns it, waits for the SOCKS port
to listen, then sets `process.env.GENIE_TAZ_SOCKS=127.0.0.1:25344` so the rest
of the manager (and `connectSsh` / `spawnSshPty`) route through it. A failed
wireproxy startup fails the manager process — better than running with no path
to Taz VMs.

To leave the manager Taz-disabled on Railway, simply don't set `WG_*`.

---

## Testing the Railway path locally (no kernel WG)

If you want to exercise the wireproxy code path on your Mac before deploying
(rather than relying on the macOS WireGuard.app's kernel routing):

**Step 1** — install wireproxy (not in Homebrew; either build with Go or grab
a release binary):

```bash
# Option A — build from source (needs Go ≥1.21)
go install github.com/windtf/wireproxy/cmd/wireproxy@latest
# ensure ~/go/bin is on PATH

# Option B — download a release binary
#   https://github.com/windtf/wireproxy/releases
#   pick the darwin-arm64 (Apple Silicon) or darwin-amd64 build,
#   move it to /usr/local/bin/wireproxy, chmod +x
```

**Step 2** — stop the macOS WireGuard.app tunnel so it doesn't mask the SOCKS
path.

**Step 3** — set the same env vars Railway uses (e.g. in `.env`):

```bash
WG_PRIVATE_KEY=ULSkUIRb1f/6o2lfZJRKPhqr4lnytqZzVIqTVGzNjkg=   # from dev.conf
WG_PEER_PUBLIC_KEY=t5o+t4A3tf+5UjRbLQcsb58GMSm5lxNYc2igICuj3h4=
WG_ENDPOINT=188.213.48.230:51820
WG_ADDRESS=10.200.0.3/32
```

**Step 4** — `npm run dev:manager`. The launcher will spawn wireproxy and
report `[wireproxy] ready — Taz traffic now routes via SOCKS5 127.0.0.1:25344`.
Recipes, the Manage popup, and direct SSH terminals against Taz VMs should
work exactly as they do over kernel WG.

To go back to the kernel-WG path, unset `WG_PRIVATE_KEY` and re-enable the
macOS WireGuard.app.

---

## Troubleshooting

**Tunnel up but can't reach VMs**

Check that the route and NAT are active on the bastion:

```bash
# From bastion (via control host SSH):
ip route show | grep 10.128
# must show: 10.128.0.0/16 via 10.107.3.1 dev eth0

sudo iptables -t nat -L POSTROUTING -n | grep 10.200
# must show a MASQUERADE rule for 10.200.0.0/24
```

If missing, WireGuard PostUp rules didn't run. Fix:

```bash
sudo wg-quick down wg0 && sudo wg-quick up wg0
```

**Handshake never happens (tunnel stuck)**

UDP 51820 might be blocked by a local firewall or ISP. Test:

```bash
nc -zvu 188.213.48.230 51820
```

If blocked, there is no workaround without changing network — WireGuard is UDP-only.

**Bastion WireGuard down after reboot**

Should auto-start via systemd. If it doesn't:

```bash
sudo systemctl start wg-quick@wg0
sudo wg show
```

**Bastion VM was recreated**

Server keypair changes on recreation. Run `wireguard-bastion-setup.sh` from
the control host, then regenerate peer configs with `wireguard-add-peer.sh`
and redistribute them. Old `prod.conf` / `dev.conf` will stop working until
the new `PublicKey` is in place.
