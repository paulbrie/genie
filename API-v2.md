# TazCloud API v2.0.0

## Overview

TazCloud provisions on-demand VMs backed by OpenStack. v2.0.0 introduces **projects** — isolated private networks per tenant — and SSH access via a **shared bastion** instead of direct IPv6.

New VMs are placed in a private VXLAN network (`10.128.N.0/24`). SSH access goes through a bastion at `188.213.48.230` using ProxyJump. All VMs, regardless of OS, are accessible with the same `genie` user and `genie-key`.

## Base URL

```
https://api.taz.ro
```

## Authentication

All endpoints except `GET /health` require a Bearer token:

```
Authorization: Bearer <token>
```

## Rate Limits

- `POST /v1/vm` — 20 req/min per IP
- `POST /v1/project` — 10 req/min per IP

Exceeding returns `429 Too Many Requests`.

---

## Health

```
GET /health
```

No auth required.

**Response**

```json
{
  "status": "ok",
  "mode": "vxlan-bastion",
  "ingress": true,
  "bastion": true,
  "router": true
}
```

---

## Capabilities

```
GET /v1/capabilities
```

**Response**

```json
{
  "images": ["almalinux-9", "debian-12", "ubuntu-22", "ubuntu-24"],
  "sizes": ["large", "medium", "small", "xlarge"],
  "vm_access": {
    "mode": "vxlan-bastion",
    "bastion_ip": "188.213.48.230",
    "ssh_via_bastion": true
  },
  "ingress": {
    "available": true,
    "public_ip": "188.213.48.229",
    "tls": true
  },
  "projects": {
    "available": true
  }
}
```

---

## Projects

A project is an isolated private network (`10.128.N.0/24`). Every VM must belong to a project. VMs in the same project can reach each other directly. Internet egress works via SNAT.

### Create Project

```
POST /v1/project
Content-Type: application/json
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Lowercase, alphanumeric + hyphens, 3–63 chars |

**Example**

```bash
curl -X POST https://api.taz.ro/v1/project \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "acme-prod"}'
```

**Response — 201 Created**

```json
{
  "id": "4a1f9c2d-7e83-4b1a-9f2e-1a2b3c4d5e6f",
  "name": "acme-prod",
  "subnet_cidr": "10.128.3.0/24",
  "network_id": "b2c3d4e5-...",
  "created": "2026-05-25T10:00:00"
}
```

| Code | Meaning |
|------|---------|
| `409` | Project name already exists |

---

### List Projects

```
GET /v1/project
```

**Response**

```json
{
  "projects": [
    {
      "id": "4a1f9c2d-...",
      "name": "acme-prod",
      "subnet_cidr": "10.128.3.0/24",
      "vm_count": 2,
      "created": "2026-05-25T10:00:00"
    }
  ]
}
```

---

### Get Project

```
GET /v1/project/{id}
```

**Response**

```json
{
  "id": "4a1f9c2d-...",
  "name": "acme-prod",
  "subnet_cidr": "10.128.3.0/24",
  "network_id": "b2c3d4e5-...",
  "vm_count": 2,
  "created": "2026-05-25T10:00:00"
}
```

| Code | Meaning |
|------|---------|
| `404` | Project not found |

---

### Delete Project

```
DELETE /v1/project/{id}
```

Tears down the VXLAN network, subnet, security group, and router interface. Fails if any VMs still exist in the project.

**Response**

```json
{"status": "deleted", "id": "4a1f9c2d-..."}
```

| Code | Meaning |
|------|---------|
| `404` | Project not found |
| `409` | Project still has VMs — delete them first |

---

## VMs

### Create VM

```
POST /v1/vm
Content-Type: application/json
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Lowercase, alphanumeric + hyphens, 3–63 chars |
| `project_id` | string | yes | ID from `POST /v1/project` |
| `image` | string | no | Base image key. Default: `almalinux-9`. Ignored if `snapshot_id` set. |
| `size` | string | no | Size key. Default: `small` |
| `snapshot_id` | string | no | Boot from an existing snapshot instead of a base image |

`image` and `snapshot_id` are mutually exclusive — providing both returns `400`.

**Example — base image**

```bash
curl -X POST https://api.taz.ro/v1/vm \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "worker-01", "project_id": "4a1f9c2d-...", "image": "ubuntu-22", "size": "small"}'
```

**Example — from snapshot**

```bash
curl -X POST https://api.taz.ro/v1/vm \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "worker-02", "project_id": "4a1f9c2d-...", "snapshot_id": "3f2a1b4c-...", "size": "small"}'
```

**Response**

```json
{
  "id": "88d8cfc8-d13b-4679-a402-8cd0d0129f0a",
  "name": "worker-01",
  "status": "ACTIVE",
  "ip": "10.128.3.14",
  "ipv6": null,
  "project_id": "4a1f9c2d-...",
  "ssh_host": "10.128.3.14",
  "ssh_port": 22,
  "ssh_user": "genie",
  "ssh_bastion": "almalinux@188.213.48.230",
  "ssh_command": "ssh -J almalinux@188.213.48.230 genie@10.128.3.14",
  "image": "ubuntu-22",
  "size": "small",
  "networks": {
    "v4": [{"type": "private", "ip_address": "10.128.3.14"}],
    "v6": []
  }
}
```

The VM is `ACTIVE` and reachable by the time the response is returned. Typical boot time: 25–70 seconds. Boot-from-snapshot is usually faster.

| Code | Meaning |
|------|---------|
| `400` | Unknown image or size, or both `image` + `snapshot_id` provided |
| `400` | Size disk smaller than snapshot requires |
| `404` | Project not found |
| `404` | Snapshot not found |
| `409` | Snapshot not yet `active` |

---

### Get VM

```
GET /v1/vm/{id}
```

Returns the same shape as create. If ingress is registered, an `ingress` block is included:

```json
{
  "id": "88d8cfc8-...",
  "name": "worker-01",
  "status": "ACTIVE",
  "ip": "10.128.3.14",
  "ssh_user": "genie",
  "ssh_command": "ssh -J almalinux@188.213.48.230 genie@10.128.3.14",
  "ingress": {
    "ip": "188.213.48.229",
    "domain": "myapp.yourdomain.com",
    "url": "https://myapp.yourdomain.com",
    "dns_action": "Add A record: myapp.yourdomain.com -> 188.213.48.229",
    "status": "pending_dns"
  }
}
```

| Code | Meaning |
|------|---------|
| `404` | VM not found |

---

### List VMs

```
GET /v1/vm
```

**Response**

```json
{
  "vms": [
    {
      "id": "88d8cfc8-...",
      "name": "worker-01",
      "status": "ACTIVE",
      "ip": "10.128.3.14",
      "project_id": "4a1f9c2d-...",
      "ssh_user": "genie",
      "ssh_command": "ssh -J almalinux@188.213.48.230 genie@10.128.3.14"
    }
  ]
}
```

Infrastructure VMs (`tazcloud-api`, `tazcloud-ingress`, `tazcloud-bastion`, `edge-v6`) are excluded from this list.

---

### Delete VM

```
DELETE /v1/vm/{id}
```

Deletes the VM, waits for full removal, releases the Neutron port, and removes any registered ingress. The project is not deleted — only the VM.

**Response**

```json
{
  "status": "deleted",
  "id": "88d8cfc8-...",
  "deleted_ports": ["a411cbe3-..."]
}
```

| Code | Meaning |
|------|---------|
| `404` | VM not found |
| `504` | Deletion timed out |

---

## SSH Access via Bastion

All VMs are on private networks (`10.128.N.0/24`) with no direct public access. SSH goes through the bastion at `188.213.48.230`.

**One key for everything:** `genie-key` authenticates to both the bastion and the VM. All images (`almalinux-9`, `ubuntu-22`, `ubuntu-24`, `debian-12`) use the `genie` user.

### Method 1 — use ssh_command directly (simplest)

The API returns a ready-to-run command in `ssh_command`. With `genie-key` in your ssh-agent:

```bash
eval $(ssh-agent)
ssh-add ~/.ssh/genie_key

ssh -J almalinux@188.213.48.230 genie@10.128.3.14
```

### Method 2 — explicit key flags

```bash
ssh \
  -o ProxyCommand="ssh -i ~/.ssh/genie_key -o StrictHostKeyChecking=no -W %h:%p almalinux@188.213.48.230" \
  -i ~/.ssh/genie_key \
  genie@10.128.3.14
```

### Method 3 — ~/.ssh/config (persistent setup)

Add to `~/.ssh/config`:

```
Host tazcloud-bastion
    HostName 188.213.48.230
    User almalinux
    IdentityFile ~/.ssh/genie_key
    StrictHostKeyChecking no

Host 10.128.*
    User genie
    IdentityFile ~/.ssh/genie_key
    ProxyJump tazcloud-bastion
    StrictHostKeyChecking no
```

Then just:

```bash
ssh 10.128.3.14
```

SSH key auth only — password authentication is disabled on all VMs.

---

## Ingress

Expose a VM's HTTP app over HTTPS via a custom domain. TLS is automatic via Let's Encrypt.

```
Internet → myapp.yourdomain.com (A → 188.213.48.229)
  → Traefik (TLS termination)
  → http://10.128.N.x:app_port
```

All ingress domains resolve to the same IP: `188.213.48.229`.

### Register Ingress

```
POST /v1/vm/{id}/ingress
Content-Type: application/json
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `domain` | string | yes | FQDN, e.g. `myapp.yourdomain.com` |
| `app_port` | integer | no | Port your app listens on. Default: `80`. Range: 1–65535 |

**Example**

```bash
curl -X POST https://api.taz.ro/v1/vm/88d8cfc8-.../ingress \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"domain": "myapp.yourdomain.com", "app_port": 3000}'
```

**Response**

```json
{
  "ip": "188.213.48.229",
  "domain": "myapp.yourdomain.com",
  "url": "https://myapp.yourdomain.com",
  "dns_action": "Add A record: myapp.yourdomain.com -> 188.213.48.229",
  "status": "pending_dns"
}
```

Add the A record at your DNS provider. TLS certificate is issued automatically within ~60 seconds once DNS resolves.

| Code | Meaning |
|------|---------|
| `400` | Invalid domain format |
| `404` | VM not found |
| `409` | VM has no IP yet (still booting), or domain already registered to another VM |
| `502` | Could not reach ingress service |
| `503` | Ingress not configured on this deployment |

---

### Remove Ingress

```
DELETE /v1/vm/{id}/ingress
```

Removes domain routing without deleting the VM.

**Response**

```json
{"status": "removed", "vm_id": "88d8cfc8-..."}
```

| Code | Meaning |
|------|---------|
| `404` | VM not found or no ingress registered |

---

## Snapshots

Snapshot a VM's disk to Glance. Boot new VMs from a snapshot to skip setup time.

**Status lifecycle:** `pending` → `active` | `error`

### Create Snapshot

```
POST /v1/vm/{id}/snapshot
Content-Type: application/json
```

Returns `202 Accepted` immediately. Poll `GET /v1/snapshot/{id}` until `status` is `active`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Lowercase, alphanumeric + hyphens |
| `stop_first` | bool | no | Stop VM before snapshotting for disk consistency. VM restarts automatically after. Default: `false` |

**Example**

```bash
curl -X POST https://api.taz.ro/v1/vm/88d8cfc8-.../snapshot \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-template", "stop_first": true}'
```

**Response — 202 Accepted**

```json
{
  "id": "3f2a1b4c-...",
  "name": "my-template",
  "source_vm_id": "88d8cfc8-...",
  "status": "pending",
  "size_gb": 20,
  "created": "2026-05-25T10:00:00Z"
}
```

Typical wait for `active`: 1–5 minutes. Add ~30–90 seconds if `stop_first: true`.

---

### Get Snapshot

```
GET /v1/snapshot/{id}
```

**Response**

```json
{
  "id": "3f2a1b4c-...",
  "name": "my-template",
  "source_vm_id": "88d8cfc8-...",
  "status": "active",
  "size_gb": 20,
  "created": "2026-05-25T10:00:00Z"
}
```

---

### List Snapshots

```
GET /v1/snapshot
```

**Response**

```json
{
  "snapshots": [
    {
      "id": "3f2a1b4c-...",
      "name": "my-template",
      "source_vm_id": "88d8cfc8-...",
      "status": "active",
      "size_gb": 20,
      "created": "2026-05-25T10:00:00Z"
    }
  ]
}
```

---

### Delete Snapshot

```
DELETE /v1/snapshot/{id}
```

VMs already booted from this snapshot are unaffected.

**Response**

```json
{"status": "deleted", "id": "3f2a1b4c-..."}
```

| Code | Meaning |
|------|---------|
| `404` | Snapshot not found |
| `409` | Snapshot still pending |

---

## Available Images

| Key | OS |
|-----|----|
| `almalinux-9` | AlmaLinux 9 |
| `ubuntu-22` | Ubuntu 22.04 LTS |
| `ubuntu-24` | Ubuntu 24.04 LTS |
| `debian-12` | Debian 12 (Bookworm) |

## Available Sizes

| Key | vCPU | RAM | Disk |
|-----|------|-----|------|
| `small` | 1 | 1 GB | 20 GB |
| `medium` | 2 | 2 GB | 40 GB |
| `large` | 4 | 8 GB | 80 GB |
| `xlarge` | 8 | 16 GB | 160 GB |

---

## Error Responses

All errors return JSON with a `detail` field:

```json
{"detail": "Project not found"}
```

| Code | Meaning |
|------|---------|
| `400` | Bad request — invalid field value or conflicting parameters |
| `401` | Missing or invalid token |
| `404` | Resource not found |
| `409` | Conflict — resource not ready, name/domain already in use, or VMs still exist in project |
| `429` | Rate limit exceeded |
| `500` | Internal error |
| `502` | Ingress service unreachable |
| `503` | Feature not available (ingress or ROUTER_ID not configured) |
| `504` | VM deletion timed out |

---

## Quick Start

```bash
TOKEN="your-token-here"
API="https://api.taz.ro"

# 0. Add your key to ssh-agent once
eval $(ssh-agent) && ssh-add ~/.ssh/genie_key

# 1. Check API
curl $API/health

# 2. Create a project
PROJECT=$(curl -s -X POST $API/v1/project \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-project"}')
PROJECT_ID=$(echo $PROJECT | jq -r .id)

# 3. Create a VM
VM=$(curl -s -X POST $API/v1/vm \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"worker-01\", \"project_id\": \"$PROJECT_ID\", \"image\": \"ubuntu-22\", \"size\": \"small\"}")
VM_ID=$(echo $VM | jq -r .id)
VM_IP=$(echo $VM | jq -r .ip)

echo "VM IP: $VM_IP"
echo "SSH:   $(echo $VM | jq -r .ssh_command)"

# 4. SSH in
ssh -J almalinux@188.213.48.230 genie@$VM_IP

# 5. (Optional) Expose your app over HTTPS
curl -X POST $API/v1/vm/$VM_ID/ingress \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"domain": "myapp.yourdomain.com", "app_port": 3000}'
# → add the A record shown in dns_action at your DNS provider

# 6. (Optional) Snapshot the VM
SNAP=$(curl -s -X POST $API/v1/vm/$VM_ID/snapshot \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-template", "stop_first": true}')
SNAP_ID=$(echo $SNAP | jq -r .id)

# Poll until active
until [ "$(curl -s $API/v1/snapshot/$SNAP_ID \
  -H "Authorization: Bearer $TOKEN" | jq -r .status)" = "active" ]; do
  sleep 10
done

# Boot a clone from snapshot
curl -s -X POST $API/v1/vm \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"worker-02\", \"project_id\": \"$PROJECT_ID\", \"snapshot_id\": \"$SNAP_ID\"}"

# 7. Cleanup
curl -X DELETE $API/v1/vm/$VM_ID -H "Authorization: Bearer $TOKEN"
curl -X DELETE $API/v1/project/$PROJECT_ID -H "Authorization: Bearer $TOKEN"
```
