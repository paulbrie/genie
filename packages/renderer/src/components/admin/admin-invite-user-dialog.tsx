import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inviteUser, loadAdminOrgs } from "@/store/actions";
import type { AdminOrg } from "@/store/types";

export function InviteUserDialog({
  orgs,
  isSuperadmin,
  onClose,
}: {
  orgs: AdminOrg[];
  isSuperadmin: boolean;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"user" | "tazcloud" | "admin" | "superadmin">("user");
  const [orgIds, setOrgIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Make sure the orgs list is populated so the admin can pick where to assign.
    if (orgs.length === 0) loadAdminOrgs();
  }, [orgs.length]);

  const toggleOrg = (orgId: string) => {
    setOrgIds((prev) => {
      const next = new Set(prev);
      if (next.has(orgId)) next.delete(orgId);
      else next.add(orgId);
      return next;
    });
  };

  const handleSubmit = () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes("@")) return;
    if (orgIds.size === 0) {
      if (!confirm("No organization selected. Invitee will exist as a stub user with no org access. Continue?")) {
        return;
      }
    }
    inviteUser({
      email: trimmedEmail,
      name: name.trim() || undefined,
      role,
      orgIds: Array.from(orgIds),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-base/80" onClick={onClose}>
      <div
        className="bg-mantle border border-surface0 rounded-lg shadow-xl w-full max-w-md p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">Invite User</h3>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>

        <p className="text-md text-subtext0">
          Pre-creates a user record. The invitee activates by signing in with Google using the
          same email — no email is sent automatically.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-md text-subtext1 mb-1">Email *</label>
            <input
              type="email"
              autoFocus
              className="w-full bg-surface0 border border-surface1 rounded px-3 py-1.5 text-md text-text"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-md text-subtext1 mb-1">Display name</label>
            <input
              className="w-full bg-surface0 border border-surface1 rounded px-3 py-1.5 text-md text-text"
              placeholder="(defaults to email)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-md text-subtext1 mb-1">Role</label>
            <select
              className="w-full bg-surface0 border border-surface1 rounded px-3 py-1.5 text-md text-text"
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
            >
              <option value="user">User</option>
              <option value="tazcloud">TazCloud</option>
              {isSuperadmin && <option value="admin">Admin</option>}
              {isSuperadmin && <option value="superadmin">Superadmin</option>}
            </select>
            {!isSuperadmin && (
              <p className="text-xs text-overlay0 mt-1">Only superadmins can invite admins.</p>
            )}
          </div>

          <div>
            <label className="block text-md text-subtext1 mb-1">Organizations</label>
            {orgs.length === 0 ? (
              <p className="text-md text-overlay0">No organizations available.</p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-auto">
                {orgs.map((org) => (
                  <label
                    key={org.id}
                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface0/50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={orgIds.has(org.id)}
                      onChange={() => toggleOrg(org.id)}
                    />
                    <span className="text-md">{org.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!email.trim()}>
            Invite
          </Button>
        </div>
      </div>
    </div>
  );
}
