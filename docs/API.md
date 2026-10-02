# TazCloud API

## Overview

TazCloud is a VM provisioning API. Create, inspect, and delete virtual machines on demand. VMs are reachable via direct IPv6 SSH immediately after creation.

Optional features:
- **Ingress** — expose your VM's web app over HTTPS using your own domain. TLS is automatic via Let's Encrypt.
- **Snapshots** — snapshot a VM's disk to Glance, then clone from it to boot pre-configured VMs instantly.

## Base URL

```
https://api.taz.ro
```

## Authentication

All endpoints except `GET /health` require a Bearer token:

```
Authorization: Bearer <token>
```

Tokens are issued by the TazCloud team. Include the header on every authenticated request.

## Rate Limit

20 requests per minute per IP. Exceeding the limit returns `429 Too Many Requests`.

---

## Endpoints

### Health check

```
GET /health
```

Public — no auth required.

**Response**

```json
{"status": "ok", "mode": "direct-ipv6", "ingress": true}
```

`ingress: true` means the ingress feature is available on this deployment.

---

### Capabilities

```
GET /v1/capabilities
```

Returns available images, sizes, and feature availability.

**Response**

```json
{
  "images": ["almalinux-9", "debian-12", "ubuntu-22", "ubuntu-24"],
  "sizes": ["small", "medium", "large", "xlarge"],
  "vm_access": {
    "ssh": "direct-ipv6",
    "public_ipv6_prefix": "2001:470:1f15:97::/64",
    "tenant_ipv6_gateway": "2001:470:1f15:97::1"
  },
  "ingress": {
    "available": true,
    "public_ip": "188.213.48.229",
    "tls": true
  }
}
```

---

### Create VM

```
POST /v1/vm
Content-Type: application/json
```

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | VM name. Must match `^[a-z][a-z0-9-]{1,61}[a-z0-9]$` |
| `image` | string | no | Base image key. Default: `almalinux-9`. Ignored if `snapshot_id` is set. |
| `size` | string | no | Size key. Default: `small` |
| `snapshot_id` | string | no | Boot from an existing active snapshot instead of a base image |

`image` and `snapshot_id` are mutually exclusive. If both are provided the request fails with `400`.

**Example — base image**

```bash
curl -X POST https://api.taz.ro/v1/vm \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-vm", "image": "ubuntu-22", "size": "small"}'
```

**Example — from snapshot**

```bash
curl -X POST https://api.taz.ro/v1/vm \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "clone-1", "snapshot_id": "3f2a1b4c-...", "size": "small"}'
```

**Response — base image**

```json
{
  "id": "88d8cfc8-d13b-4679-a402-8cd0d0129f0a",
  "name": "my-vm",
  "status": "ACTIVE",
  "ip": "10.107.3.114",
  "ipv6": "2001:470:1f15:97:f816:3eff:fe9c:bc39",
  "ssh_host": "2001:470:1f15:97:f816:3eff:fe9c:bc39",
  "ssh_port": 22,
  "image": "ubuntu-22",
  "size": "small",
  "networks": {
    "v4": [{"type": "private", "ip_address": "10.107.3.114"}],
    "v6": [{"type": "public", "ip_address": "2001:470:1f15:97:f816:3eff:fe9c:bc39"}]
  }
}
```

**Response — from snapshot**

```json
{
  "id": "3588c1a4-...",
  "name": "clone-1",
  "status": "ACTIVE",
  "ip": "10.107.3.73",
  "ipv6": "2001:470:1f15:97:f816:3eff:feb6:4b17",
  "ssh_host": "2001:470:1f15:97:f816:3eff:feb6:4b17",
  "ssh_port": 22,
  "image": null,
  "snapshot_id": "3f2a1b4c-...",
  "size": "small",
  "networks": {
    "v4": [{"type": "private", "ip_address": "10.107.3.73"}],
    "v6": [{"type": "public", "ip_address": "2001:470:1f15:97:f816:3eff:feb6:4b17"}]
  }
}
```

The VM is ACTIVE and reachable by the time the response is returned. Boot time is typically 25–70 seconds. Boot-from-snapshot is usually faster.

**Additional errors for snapshot boot**

| Code | Meaning |
|---|---|
| `400` | Both `image` and `snapshot_id` provided |
| `400` | Selected size disk is smaller than snapshot's recorded size |
| `404` | Snapshot not found |
| `409` | Snapshot is not yet `active` |

---

### Get VM

```
GET /v1/vm/{id}
```

**Example**

```bash
curl https://api.taz.ro/v1/vm/88d8cfc8-d13b-4679-a402-8cd0d0129f0a \
  -H "Authorization: Bearer $TOKEN"
```

Returns the same structure as create. If ingress is registered, an `ingress` block is included:

```json
{
  "id": "88d8cfc8-...",
  "name": "my-vm",
  "status": "ACTIVE",
  "ip": "10.107.3.114",
  "ipv6": "2001:470:1f15:97:f816:3eff:fe9c:bc39",
  "ssh_host": "2001:470:1f15:97:f816:3eff:fe9c:bc39",
  "ssh_port": 22,
  "networks": {"...": "..."},
  "ingress": {
    "ip": "188.213.48.229",
    "domain": "myapp.yourdomain.com",
    "url": "https://myapp.yourdomain.com",
    "dns_action": "Add A record: myapp.yourdomain.com -> 188.213.48.229",
    "status": "pending_dns"
  }
}
```

Returns `404` if not found.

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
      "name": "my-vm",
      "status": "ACTIVE",
      "ip": "10.107.3.114",
      "ipv6": "2001:470:1f15:97:f816:3eff:fe9c:bc39"
    }
  ]
}
```

---

### Delete VM

```
DELETE /v1/vm/{id}
```

Deletes the VM, releases Neutron ports, and removes any registered ingress. Waits for full removal before responding.

**Response**

```json
{
  "status": "deleted",
  "id": "88d8cfc8-d13b-4679-a402-8cd0d0129f0a",
  "deleted_ports": ["a411cbe3-687f-44c2-84e2-63b8bf7e41a9"]
}
```

Returns `404` if the VM does not exist. Returns `504` if deletion times out.

---

## Ingress

Expose your VM's web app to the public internet over HTTPS using your own domain. TLS is handled automatically via Let's Encrypt. Your app receives plain HTTP internally.

```
End user (any) → myapp.yourdomain.com (A record → 188.213.48.229)
  → Traefik (TLS termination)
  → Your VM's app on app_port (via IPv6 internally)
```

> **All domains always point to the same ingress IP: `188.213.48.229`.** Every customer, every VM, every domain — one A record target. The ingress layer routes each domain to the correct VM automatically.

**Flow:**

1. Create a VM and deploy your app inside it
2. Call `POST /v1/vm/{id}/ingress` with your domain and app port
3. The response includes a `dns_action` telling you exactly which A record to add
4. Add that A record at your DNS provider (`app1.yourdomain.com → 188.213.48.229`)
5. HTTPS goes live automatically once DNS propagates — TLS certificate is issued automatically via Let's Encrypt within ~60 seconds

Your app just needs to listen on `app_port` over plain HTTP. TLS is terminated at the ingress layer — your VM never handles certificates.

### Register Ingress

```
POST /v1/vm/{id}/ingress
Content-Type: application/json
```

`{id}` is the VM's `id` field returned by `POST /v1/vm` or `GET /v1/vm`.

| Field | Type | Required | Description |
|---|---|---|---|
| `domain` | string | yes | Your FQDN, e.g. `myapp.yourdomain.com` |
| `app_port` | integer | no | Port your app listens on. Default: `80`. Range: 1–65535 |

**Example** — `88d8cfc8-d13b-4679-a402-8cd0d0129f0a` is the VM ID from the create response

```bash
curl -X POST https://api.taz.ro/v1/vm/88d8cfc8-d13b-4679-a402-8cd0d0129f0a/ingress \
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

Follow the `dns_action` instruction to add the A record at your DNS provider. The TLS certificate is issued automatically once DNS resolves correctly.

| Code | Meaning |
|---|---|
| `400` | Invalid domain format |
| `404` | VM not found |
| `409` | VM has no IPv6 yet (still booting), or domain already registered to another VM |
| `502` | Could not reach the ingress service |
| `503` | Ingress not available on this deployment |

---

### Remove Ingress

```
DELETE /v1/vm/{id}/ingress
```

Removes domain routing without deleting the VM. Use this to detach or swap a domain.

**Response**

```json
{"status": "removed", "vm_id": "88d8cfc8-d13b-4679-a402-8cd0d0129f0a"}
```

| Code | Meaning |
|---|---|
| `404` | VM not found or no ingress registered for this VM |
| `503` | Ingress not available on this deployment |

---

## Snapshots

Snapshot a VM's disk to create a reusable image. Boot new VMs from a snapshot to skip setup time.

**Snapshot status lifecycle:** `pending` → `active` | `error`

### Create Snapshot

```
POST /v1/vm/{id}/snapshot
Content-Type: application/json
```

Returns `202 Accepted` immediately. Poll `GET /v1/snapshot/{id}` until `status` is `active`.

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Label for the snapshot. Must match `^[a-z][a-z0-9-]{1,61}[a-z0-9]$` |
| `stop_first` | bool | no | Stop VM before snapshotting for disk consistency. Default: `false`. VM restarts automatically after. |

**Example**

```bash
curl -X POST https://api.taz.ro/v1/vm/88d8cfc8-d13b-4679-a402-8cd0d0129f0a/snapshot \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-template", "stop_first": true}'
```

**Response — `202 Accepted`**

```json
{
  "id": "3f2a1b4c-...",
  "name": "my-template",
  "source_vm_id": "88d8cfc8-d13b-4679-a402-8cd0d0129f0a",
  "status": "pending",
  "size_gb": 20,
  "created": "2026-05-18T10:00:00Z"
}
```

Typical wait for `active`: 1–5 minutes depending on volume size. If `stop_first: true` add ~30–90 seconds for VM stop/restart.

| Code | Meaning |
|---|---|
| `404` | VM not found |
| `409` | VM not in a stable state, or snapshot name already in use |

---

### Get Snapshot

```
GET /v1/snapshot/{snapshot_id}
```

**Response**

```json
{
  "id": "3f2a1b4c-...",
  "name": "my-template",
  "source_vm_id": "88d8cfc8-...",
  "status": "active",
  "size_gb": 20,
  "created": "2026-05-18T10:00:00Z"
}
```

Returns `404` if not found.

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
      "created": "2026-05-18T10:00:00Z"
    }
  ]
}
```

---

### Delete Snapshot

```
DELETE /v1/snapshot/{snapshot_id}
```

Frees the Glance image and storage. VMs already booted from this snapshot are unaffected.

**Response**

```json
{"status": "deleted", "id": "3f2a1b4c-..."}
```

| Code | Meaning |
|---|---|
| `404` | Snapshot not found |
| `409` | Snapshot is still in `pending` state |

---

## VM Access

VMs are accessible via **SSH over IPv6** using the `ssh_host` field.

**SSH user by image:**

| Image | User |
|---|---|
| `almalinux-9` | `almalinux` |
| `ubuntu-22` | `ubuntu` |
| `ubuntu-24` | `ubuntu` |
| `debian-12` | `debian` |

```bash
ssh ubuntu@2001:470:1f15:97:f816:3eff:fe9c:bc39
```

SSH key authentication only — passwords are disabled. Provide your public key to the TazCloud team before testing; it is injected automatically at VM creation.

---

## Available Images

| Key | OS |
|---|---|
| `almalinux-9` | AlmaLinux 9 |
| `ubuntu-22` | Ubuntu 22.04 LTS |
| `ubuntu-24` | Ubuntu 24.04 LTS |
| `debian-12` | Debian 12 (Bookworm) |

## Available Sizes

| Key | vCPU | RAM | Disk |
|---|---|---|---|
| `small` | 1 | 1 GB | 20 GB |
| `medium` | 2 | 2 GB | 40 GB |
| `large` | 4 | 8 GB | 80 GB |
| `xlarge` | 8 | 16 GB | 160 GB |

---

## Error Responses

All errors return JSON with a `detail` field:

```json
{"detail": "VM not found"}
```

| Code | Meaning |
|---|---|
| `400` | Bad request — invalid image, size, name, domain, or conflicting fields |
| `401` | Missing or invalid token |
| `404` | Resource not found |
| `409` | Conflict — resource not ready, or name/domain already in use |
| `429` | Rate limit exceeded |
| `500` | Internal error |
| `502` | Ingress service unreachable |
| `503` | Feature not available on this deployment |
| `504` | VM deletion timed out |

---

## Quick Start

```bash
TOKEN="your-token-here"

# 1. Check API
curl https://api.taz.ro/health

# 2. Create a VM
VM=$(curl -s -X POST https://api.taz.ro/v1/vm \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-vm", "image": "ubuntu-22", "size": "small"}')
ID=$(echo $VM | jq -r .id)
IPV6=$(echo $VM | jq -r .ipv6)

# 3. SSH in
ssh ubuntu@$IPV6

# 4. (Optional) Expose your app
curl -X POST https://api.taz.ro/v1/vm/$ID/ingress \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"domain": "myapp.yourdomain.com", "app_port": 3000}'
# → add the A record shown in dns_action at your DNS provider

# 5. (Optional) Snapshot the VM
SNAP=$(curl -s -X POST https://api.taz.ro/v1/vm/$ID/snapshot \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-template", "stop_first": true}')
SNAP_ID=$(echo $SNAP | jq -r .id)

# Poll until active
until [ "$(curl -s https://api.taz.ro/v1/snapshot/$SNAP_ID \
  -H "Authorization: Bearer $TOKEN" | jq -r .status)" = "active" ]; do sleep 10; done

# Boot a clone from it
curl -X POST https://api.taz.ro/v1/vm \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"clone-1\", \"snapshot_id\": \"$SNAP_ID\"}"

# 6. Delete when done (also removes ingress)
curl -X DELETE https://api.taz.ro/v1/vm/$ID \
  -H "Authorization: Bearer $TOKEN"
```
