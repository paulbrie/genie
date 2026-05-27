"use client";

import { useEffect, useState } from "react";
import { useSubject } from "subjecto/react";
import { X, Server, Copy, Check, Loader2 } from "lucide-react";
import { $auth, $vpsDeploy } from "@/store/subjects";
import { connectServer, testServerConnection, type ConnectServerInput } from "@/store/actions";
import { useDeepSubjectAll } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Modal to connect a generic ("bring-your-own") SSH server to a project.
 *  Connect-only: it validates + registers the SSH connection, no provisioning.
 *  Default auth = authorize Genie's public key on the box; optional = paste a
 *  private key (only when the server has encryption-at-rest configured). */
export function ConnectServerForm({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [auth] = useSubject($auth);
  const pasteEnabled = auth.pasteKeyEnabled === true;
  const geniePublicKey = auth.geniePublicKey || "";
  const testResult = useDeepSubjectAll($vpsDeploy).testResult;

  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("root");
  const [label, setLabel] = useState("");
  const [authMethod, setAuthMethod] = useState<"genie-key" | "stored-key">("genie-key");
  const [privateKey, setPrivateKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onOk = () => { setConnecting(false); onClose(); };
    const onErr = (e: Event) => { setConnecting(false); setError((e as CustomEvent).detail?.message || "Connect failed"); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("genie:vps:connect:ok", onOk);
    window.addEventListener("genie:vps:connect:error", onErr);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("genie:vps:connect:ok", onOk);
      window.removeEventListener("genie:vps:connect:error", onErr);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const buildInput = (): ConnectServerInput => ({
    host: host.trim(),
    port: Number(port) || 22,
    username: username.trim() || "root",
    label: label.trim() || undefined,
    authMethod,
    ...(authMethod === "stored-key" ? { privateKey } : {}),
  });

  const canSubmit = !!host.trim() && !!username.trim() && (authMethod === "genie-key" || !!privateKey.trim());

  const copyKey = () => {
    navigator.clipboard?.writeText(geniePublicKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[60]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] max-w-[95vw] bg-mantle border border-surface0 rounded-lg shadow-xl z-[61] flex flex-col max-h-[90vh]">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-surface0 shrink-0">
          <Server size={14} className="text-blue" />
          <span className="text-text font-medium text-md">Connect a server</span>
          <span className="text-overlay0 text-xs">— register an existing SSH server (no changes made to it)</span>
          <div className="flex-1" />
          <button onClick={onClose} className="text-overlay1 hover:text-text transition-colors bg-transparent border-none cursor-pointer" title="Close (Esc)">
            <X size={14} />
          </button>
        </div>

        <div className="px-4 py-3 flex flex-col gap-3 overflow-y-auto">
          <div className="flex gap-2">
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-xs text-overlay0">Host / IP</label>
              <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="203.0.113.10" spellCheck={false}
                className="bg-background border border-surface0 rounded px-2 py-1.5 text-md text-text font-mono outline-none focus:border-blue" />
            </div>
            <div className="flex flex-col gap-1 w-20">
              <label className="text-xs text-overlay0">Port</label>
              <input value={port} onChange={(e) => setPort(e.target.value)} spellCheck={false}
                className="bg-background border border-surface0 rounded px-2 py-1.5 text-md text-text font-mono outline-none focus:border-blue" />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-xs text-overlay0">SSH user</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="root" spellCheck={false}
                className="bg-background border border-surface0 rounded px-2 py-1.5 text-md text-text font-mono outline-none focus:border-blue" />
            </div>
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-xs text-overlay0">Label (optional)</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="prod-db" spellCheck={false}
                className="bg-background border border-surface0 rounded px-2 py-1.5 text-md text-text outline-none focus:border-blue" />
            </div>
          </div>

          {/* Auth method */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-overlay0">Authentication</label>
            <div className="inline-flex rounded border border-surface0 overflow-hidden text-md w-fit">
              <button onClick={() => setAuthMethod("genie-key")}
                className={cn("px-3 py-1 transition-colors", authMethod === "genie-key" ? "bg-blue/20 text-blue" : "text-overlay0 hover:text-text")}>
                Genie key
              </button>
              <button onClick={() => pasteEnabled && setAuthMethod("stored-key")} disabled={!pasteEnabled}
                title={pasteEnabled ? undefined : "Disabled — set GENIE_SECRET on the manager to store keys"}
                className={cn("px-3 py-1 border-l border-surface0 transition-colors", authMethod === "stored-key" ? "bg-blue/20 text-blue" : "text-overlay0 hover:text-text", !pasteEnabled && "opacity-40 cursor-not-allowed")}>
                Paste a key
              </button>
            </div>
          </div>

          {authMethod === "genie-key" ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-md text-overlay1">Add Genie&rsquo;s public key to <span className="font-mono text-overlay0">~/.ssh/authorized_keys</span> on the server, then connect:</span>
              <div className="relative">
                <pre className="bg-background border border-surface0 rounded p-2 pr-9 text-xs font-mono text-overlay1 whitespace-pre-wrap break-all max-h-24 overflow-auto select-text">
                  {geniePublicKey || "(no Genie key configured on the manager)"}
                </pre>
                {geniePublicKey && (
                  <button onClick={copyKey} className="absolute top-1.5 right-1.5 text-overlay0 hover:text-text" title="Copy">
                    {copied ? <Check size={13} className="text-green" /> : <Copy size={13} />}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-overlay0">Private key (PEM / OpenSSH) — stored encrypted, never shown again</label>
              <textarea value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} rows={5} spellCheck={false}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                className="bg-background border border-surface0 rounded px-2 py-1.5 text-xs text-text font-mono outline-none focus:border-blue resize-none" />
            </div>
          )}

          {testResult && (
            <div className={cn("text-md", testResult.ok ? "text-green" : "text-red")}>
              {testResult.ok ? `✓ Reachable — hostname: ${testResult.hostname}` : `✗ ${testResult.error}`}
            </div>
          )}
          {error && <div className="text-md text-red">{error}</div>}

          <div className="flex items-center justify-end gap-2 mt-1">
            <Button size="sm" disabled={!canSubmit || connecting} onClick={() => { setError(null); testServerConnection(buildInput()); }}>
              Test
            </Button>
            <Button size="sm" variant="primary" disabled={!canSubmit || connecting}
              onClick={() => { setError(null); setConnecting(true); connectServer(projectId, buildInput()); }}>
              {connecting ? <Loader2 size={13} className="animate-spin mr-1" /> : null}
              {connecting ? "Connecting…" : "Connect"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
