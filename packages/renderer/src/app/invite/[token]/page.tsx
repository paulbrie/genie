"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { useSubject, useDeepSubject } from "subjecto/react";
import { $auth } from "@/store/subjects/auth";
import { $orgSettings } from "@/store/subjects/org-settings";
import { acceptOrgInvite } from "@/store/actions/org-settings";
import { clearPendingInviteToken, setPendingInviteToken } from "@/lib/invite";
import { connectWs, setManagerRunning, triggerGoogleLogin } from "@/lib/ws";
import { Button } from "@/components/ui/button";

interface InvitePreview {
  orgName: string;
  teamName: string;
  expired: boolean;
  revoked: boolean;
}

export default function InvitePage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;
  const [auth] = useSubject($auth);
  const [inviteAcceptError] = useDeepSubject($orgSettings, "inviteAcceptError");
  const [inviteAccepted] = useDeepSubject($orgSettings, "inviteAccepted");
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [acceptSent, setAcceptSent] = useState(false);

  useEffect(() => {
    setManagerRunning(true);
    connectWs();
  }, []);

  useEffect(() => {
    if (!token) return;
    setPendingInviteToken(token);
    fetch(`/api/invite/${encodeURIComponent(token)}`)
      .then((r) => {
        if (!r.ok) throw new Error("Invite not found");
        return r.json();
      })
      .then(setPreview)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (auth.status !== "authenticated" || !token || acceptSent || preview?.expired || preview?.revoked) return;
    setAcceptSent(true);
    acceptOrgInvite(token);
    clearPendingInviteToken();
  }, [auth.status, token, preview, acceptSent]);

  const invalid = preview?.expired || preview?.revoked;
  const joined = inviteAccepted;

  const handleSignIn = () => {
    setPendingInviteToken(token);
    triggerGoogleLogin(token);
  };

  if (loading || auth.status === "loading") {
    return (
      <div className="min-h-screen bg-base text-text flex items-center justify-center">
        <p className="text-overlay0">Loading invite…</p>
      </div>
    );
  }

  if (error || !preview) {
    return (
      <div className="min-h-screen bg-base text-text flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <h1 className="text-xl font-semibold mb-2">Invite not found</h1>
          <p className="text-overlay0">This link may be invalid or no longer active.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base text-text flex items-center justify-center px-4">
      <div className="w-full max-w-md border border-surface0 rounded-xl bg-mantle p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-surface0">
            <Users size={20} className="text-mauve" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Team invitation</h1>
            <p className="text-sm text-overlay0">Join an organization on Genie</p>
          </div>
        </div>

        {invalid ? (
          <p className="text-red text-sm">
            {preview.revoked ? "This invite link has been revoked." : "This invite link has expired."}
          </p>
        ) : (
          <div className="text-sm space-y-1">
            <p>
              You&apos;ve been invited to join <span className="font-medium text-text">{preview.orgName}</span>
            </p>
            <p className="text-overlay0">
              Team: <span className="text-subtext0">{preview.teamName}</span>
            </p>
          </div>
        )}

        {inviteAcceptError && (
          <p className="text-red text-sm">{inviteAcceptError}</p>
        )}

        {!invalid && auth.status === "authenticated" && joined && (
          <div className="space-y-3">
            <p className="text-sm text-green">You&apos;ve joined {preview.teamName}.</p>
            <Button className="w-full" onClick={() => router.push("/projects")}>
              Go to Genie
            </Button>
          </div>
        )}

        {!invalid && auth.status === "authenticated" && !joined && acceptSent && (
          <p className="text-sm text-overlay0">Joining team…</p>
        )}

        {!invalid && auth.status !== "authenticated" && (
          <div className="space-y-3">
            <p className="text-sm text-overlay0">
              Sign in with Google to join. If you don&apos;t have an account yet, one will be created for you.
            </p>
            <Button className="w-full" onClick={handleSignIn}>
              Sign in with Google
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
