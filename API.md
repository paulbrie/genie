# TazCloud API — External Tester Guide

## Overview

TazCloud is a VM provisioning API. You can create, inspect, and delete virtual machines on demand. VMs are reachable via direct IPv6 SSH immediately after creation.

## Base URL

```
https://api.taz.ro
```

## Authentication

All endpoints except `/health` require a Bearer token:

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

Public — no auth required. Use this to verify the API is reachable.

**Response**

```json
{"status": "ok", "mode": "direct-ipv6"}
```

---

### Capabilities

```
GET /v1/capabilities
```

Returns available images and sizes.

**Response**

```json
{
  "images": ["almalinux-9", "debian-12", "ubuntu-22", "ubuntu-24"],
  "sizes": ["small", "medium", "large", "xlarge"],
  "vm_access": {
    "ssh": "direct-ipv6",
    "public_ipv6_prefix": "2001:470:1f15:97::/64",
    "tenant_ipv6_gateway": "2001:470:1f15:97::1"
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
| `image` | string | no | One of the available images. Default: `almalinux-9` |
| `size` | string | no | One of the available sizes. Default: `small` |

**Example request**

```bash
curl -X POST https://api.taz.ro/v1/vm \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-vm", "image": "ubuntu-22", "size": "small"}'
```

**Response**

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

The VM is ACTIVE and reachable by the time the response is returned. Boot time is typically 25–70 seconds depending on size.

---

### Get VM

```
GET /v1/vm/{id}
```

**Example**

```bash
curl https://api.taz.ro/v1/vm/88d8cfc8-d13b-4679-a402-8cd0d0129f0a \
  -H "Authorization: Bearer <token>"
```

Returns the same structure as the create response (without `image` and `size`). Returns `404` if not found.

---

### List VMs

```
GET /v1/vm
```

**Example**

```bash
curl https://api.taz.ro/v1/vm \
  -H "Authorization: Bearer <token>"
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
      "ipv6": "2001:470:1f15:97:f816:3eff:fe9c:bc39",
      ...
    }
  ]
}
```

---

### Delete VM

```
DELETE /v1/vm/{id}
```

Deletes the VM and releases all associated resources. Waits for full removal before responding.

**Example**

```bash
curl -X DELETE https://api.taz.ro/v1/vm/88d8cfc8-d13b-4679-a402-8cd0d0129f0a \
  -H "Authorization: Bearer <token>"
```

**Response**

```json
{
  "status": "deleted",
  "id": "88d8cfc8-d13b-4679-a402-8cd0d0129f0a",
  "deleted_ports": ["a411cbe3-687f-44c2-84e2-63b8bf7e41a9"]
}
```

Returns `404` if the VM does not exist.

---

## VM Access

VMs are accessible via **SSH over IPv6** using the `ssh_host` field from the create/get response.

**SSH user by image:**

| Image | User |
|---|---|
| `almalinux-9` | `almalinux` |
| `ubuntu-22` | `ubuntu` |
| `ubuntu-24` | `ubuntu` |
| `debian-12` | `debian` |

**Example**

```bash
ssh ubuntu@2001:470:1f15:97:f816:3eff:fe9c:bc39
```

SSH key authentication only — passwords are disabled. Provide your public key to the TazCloud team before testing; it will be injected automatically at VM creation.

> **Note:** Root login is disabled on all VMs.

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
| `400` | Bad request — invalid image, size, or name |
| `401` | Missing or invalid token |
| `404` | VM not found |
| `429` | Rate limit exceeded |
| `500` | Internal error |
| `504` | VM deletion timed out |

---

## Quick Start

```bash
TOKEN="your-token-here"

# 1. Check API is up
curl https://api.taz.ro/health

# 2. See available options
curl -H "Authorization: Bearer $TOKEN" https://api.taz.ro/v1/capabilities

# 3. Create a VM
curl -X POST https://api.taz.ro/v1/vm \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "test-vm", "image": "ubuntu-22", "size": "small"}'

# 4. SSH in (use the ipv6 from the response)
ssh ubuntu@<ipv6>

# 5. Delete when done
curl -X DELETE -H "Authorization: Bearer $TOKEN" https://api.taz.ro/v1/vm/<id>
```
