# TazCloud — SSH Bastion Setup

Your VMs are provisioned on a private VXLAN network. SSH access goes through a
bastion jump host at `188.213.48.230`. This document explains how to configure
your manager to reach tenant VMs.

---

## What you received

- `<customer>-bastion.pem` — private key pre-authorized on the bastion

---

## Step 1 — Store the private key

Place the key somewhere your manager process can read it and restrict permissions:

```bash
mkdir -p ~/.ssh
cp <customer>-bastion.pem ~/.ssh/tazcloud_bastion.pem
chmod 600 ~/.ssh/tazcloud_bastion.pem
```

---

## Step 2 — Configure your manager

Set the following environment variable (exact name depends on your manager):

| Variable | Value |
|---|---|
| `TAZCLOUD_BASTION_PRIVATE_KEY` | path to `tazcloud_bastion.pem`, or its contents |

If your manager accepts a file path:
```
TAZCLOUD_BASTION_PRIVATE_KEY=/home/youruser/.ssh/tazcloud_bastion.pem
```

If your manager accepts inline key content (base64):
```bash
TAZCLOUD_BASTION_PRIVATE_KEY=$(base64 -w0 ~/.ssh/tazcloud_bastion.pem)
```

---

## Step 3 — Verify manually

Test that the key works before starting the manager:

```bash
ssh -i ~/.ssh/tazcloud_bastion.pem -o StrictHostKeyChecking=no \
    almalinux@188.213.48.230 "echo bastion ok"
```

Expected output: `bastion ok`

Then test a full hop to one of your VMs (replace `10.128.N.x` with the IP from `GET /v1/vm/{id}`):

```bash
ssh -i ~/.ssh/tazcloud_bastion.pem \
    -o ProxyCommand="ssh -i ~/.ssh/tazcloud_bastion.pem -o StrictHostKeyChecking=no -W %h:%p almalinux@188.213.48.230" \
    genie@10.128.N.x
```

---

## Connection details

| Parameter | Value |
|---|---|
| Bastion host | `188.213.48.230` |
| Bastion user | `almalinux` |
| VM user | `genie` |
| VM IPs | `10.128.N.x` — returned by `GET /v1/vm/{id}` as `ip` |
| SSH command | returned by the API as `ssh_command` |

---

## Troubleshooting

**`Permission denied (publickey)`** — key file permissions are wrong or wrong key used. Run `chmod 600` on the `.pem` file.

**`Connection refused` or `Connection timed out` to bastion** — contact TazCloud support.

**`Connection timed out` to VM** — the VM may still be booting. Wait 60 seconds and retry. Check `GET /v1/vm/{id}` — status should be `ACTIVE`.
