"use client";

import { useEffect, useState } from "react";
import { useSubject } from "subjecto/react";
import { $settings, $doTokenValid, $railwayTestResult, $admin, loadSettings, saveSettingsField, validateDoToken, testRailwayToken, loadSshKey, regenerateSshKey, deleteSshKey } from "@/store";
import { useDeepSubject } from "subjecto/react";
import { type AppSettings } from "@/lib/genie-api";
import { Eye, EyeOff, Key, Copy, Check, Loader2, Trash2, RefreshCw } from "lucide-react";
import { ViewHeader } from "@/components/view-header";
import { ViewTabs } from "@/components/view-tabs";
import { Select } from "@/components/ui/select";
import { buildSettingsPath, type SettingsTab } from "@/lib/routes";
import { useRouter } from "next/navigation";

const editorOptions = [
  { value: "", label: "System Default" },
  { value: "Visual Studio Code", label: "Visual Studio Code" },
  { value: "Cursor", label: "Cursor" },
  { value: "Zed", label: "Zed" },
  { value: "Sublime Text", label: "Sublime Text" },
  { value: "WebStorm", label: "WebStorm" },
];

const DEPLOY_STEPS = [
  {
    title: "Ensure SSH Key",
    description: "Checks if a Genie SSH key pair (ed25519) exists in the database. If not, generates a new one. The public key is registered with DigitalOcean if not already present.",
  },
  {
    title: "Create Droplet",
    description: "Creates a new DigitalOcean droplet named genie-<project>-<timestamp> using either a custom base snapshot or the default docker-20-04 image. The Genie deploy key is attached and the droplet is tagged with \"genie\". A cloud-init script configures UFW: default deny incoming, SSH restricted to manager IP, port 3000 open.",
  },
  {
    title: "Wait for Droplet Activation",
    description: "Polls the DigitalOcean API every 5 seconds (up to 120s timeout) until the droplet has status \"active\" and a public IPv4 address.",
  },
  {
    title: "Wait for SSH & Docker Readiness",
    description: "Attempts SSH connections to the droplet as root (up to 180s) and verifies Docker is installed by running docker --version. Each attempt has a 15-second timeout.",
  },
  {
    title: "Wait for Cloud-Init",
    description: "Polls cloud-init status every 5 seconds (up to 2 minutes) until complete. Skipped when using a pre-built base image. Cloud-init applies the initial UFW firewall rules: default deny incoming, SSH from manager IP only, port 3000 open.",
  },
  {
    title: "Configure Firewall",
    description: "Sets UFW to default deny incoming, default allow outgoing. Allows SSH (port 22) only from MANAGER_PUBLIC_IP. Allows port 3000 from all sources. No other ports are opened.",
    conditional: true,
  },
  {
    title: "Create genie User",
    description: "Creates a non-root \"genie\" user with passwordless sudo, SSH key access (copied from root), docker group membership, and ownership of /opt/project. Claude Code's --dangerously-skip-permissions flag requires a non-root user. All subsequent steps run as genie.",
  },
  {
    title: "Install GitLab Deploy Key",
    description: "Writes the GitLab deploy key to ~/.ssh/id_gitlab on the droplet (as genie) and configures SSH to use it when connecting to gitlab.com.",
    conditional: true,
  },
  {
    title: "Install VPS Agent",
    description: "Checks if the genie-agent command exists on the droplet. If not, installs the @genie/vps-agent npm package globally (via sudo).",
  },
  {
    title: "Create Project Directory",
    description: "Creates the /opt/project directory on the droplet (owned by genie) where all project files will be deployed.",
  },
  {
    title: "Wait for SSH Stabilization",
    description: "Cloud-init may restart sshd during provisioning. Retries SSH connections (up to 60s) to ensure the connection is stable before writing files.",
  },
  {
    title: "Update Claude Code",
    description: "Installs or updates Claude Code CLI globally via sudo npm install -g @anthropic-ai/claude-code.",
  },
  {
    title: "Write Setup Files",
    description: "All project setup files from the database (docker-compose.yml, Dockerfile, .env, setup.sh, etc.) are written to /opt/project on the droplet.",
  },
  {
    title: "Write MCP Configuration",
    description: "Writes .mcp.json to /opt/project with genie-browser (http://127.0.0.1:9877/mcp) and genie-tracker (http://127.0.0.1:9878/mcp) MCP server entries so the VPS agent can use browser and tracker tools via reverse SSH tunnels.",
  },
  {
    title: "Run setup.sh",
    description: "Executes the project's setup.sh via sudo as the single entry point for deployment. Typically runs docker compose build and docker compose up. Genie monitors container lifecycle events and considers deployment complete when all containers have started. Timeout: 30 minutes max, 5 minutes idle.",
  },
];

export function SettingsPanel({ activeTab = "general" }: { activeTab?: SettingsTab }) {
  const router = useRouter();
  const tab = activeTab;
  const [settings] = useSubject($settings);
  const [doTokenValid] = useSubject($doTokenValid);
  const [railwayTestResult] = useSubject($railwayTestResult);
  const [railwayTesting, setRailwayTesting] = useState(false);
  const [showDoToken, setShowDoToken] = useState(false);
  const [doTokenInput, setDoTokenInput] = useState("");
  const [doTokenDirty, setDoTokenDirty] = useState(false);
  const [showGitlabKey, setShowGitlabKey] = useState(false);
  const [gitlabKeyInput, setGitlabKeyInput] = useState("");
  const [gitlabKeyDirty, setGitlabKeyDirty] = useState(false);
  const [showGitToken, setShowGitToken] = useState(false);
  const [gitTokenInput, setGitTokenInput] = useState("");
  const [gitTokenDirty, setGitTokenDirty] = useState(false);
  const [showRailwayToken, setShowRailwayToken] = useState(false);
  const [railwayTokenInput, setRailwayTokenInput] = useState("");
  const [railwayTokenDirty, setRailwayTokenDirty] = useState(false);
  const [railwayProjectIdInput, setRailwayProjectIdInput] = useState("");
  const [railwayProjectIdDirty, setRailwayProjectIdDirty] = useState(false);

  const [sshKey] = useDeepSubject($admin, "sshKey");
  const [copiedKey, setCopiedKey] = useState(false);

  useEffect(() => {
    loadSettings();
    loadSshKey();
  }, []);

  useEffect(() => {
    setDoTokenInput(settings.digitaloceanApiToken || "");
    setDoTokenDirty(false);
  }, [settings.digitaloceanApiToken]);

  useEffect(() => {
    setGitlabKeyInput(settings.gitlabDeployKey || "");
    setGitlabKeyDirty(false);
  }, [settings.gitlabDeployKey]);

  useEffect(() => {
    setGitTokenInput(settings.gitToken || "");
    setGitTokenDirty(false);
  }, [settings.gitToken]);

  useEffect(() => {
    setRailwayTokenInput(settings.railwayToken || "");
    setRailwayTokenDirty(false);
  }, [settings.railwayToken]);

  useEffect(() => {
    setRailwayProjectIdInput(settings.railwayProjectId || "");
    setRailwayProjectIdDirty(false);
  }, [settings.railwayProjectId]);

  useEffect(() => {
    if (railwayTestResult) setRailwayTesting(false);
  }, [railwayTestResult]);

  function handleTestRailway() {
    setRailwayTesting(true);
    testRailwayToken();
  }

  function handleSaveDoToken() {
    saveSettingsField("digitaloceanApiToken", doTokenInput);
    setDoTokenDirty(false);
    setTimeout(() => validateDoToken(), 300);
  }

  function handleSaveGitlabKey() {
    saveSettingsField("gitlabDeployKey", gitlabKeyInput);
    setGitlabKeyDirty(false);
  }

  function handleSaveGitToken() {
    saveSettingsField("gitToken", gitTokenInput);
    setGitTokenDirty(false);
  }

  function handleSaveRailwayToken() {
    saveSettingsField("railwayToken", railwayTokenInput);
    setRailwayTokenDirty(false);
  }

  function handleSaveRailwayProjectId() {
    saveSettingsField("railwayProjectId", railwayProjectIdInput);
    setRailwayProjectIdDirty(false);
  }

  return (
    <div className="flex-1 flex flex-col overflow-y-auto px-5 pb-5">
      <ViewHeader title="Settings" />
      <ViewTabs
        tabs={[
          { key: "general" as const, label: "General" },
          { key: "deploy" as const, label: "Deploy" },
        ]}
        activeTab={tab}
        onTabChange={(t) => router.push(buildSettingsPath(t))}
      />

      {tab === "general" ? (
        <div className="pt-4">
          <div className="bg-mantle rounded-lg p-4 mb-4">
            <label className="block text-md font-medium text-subtext0 mb-2">
              Default Code Editor
              <span className="ml-2 text-md text-overlay0 font-normal">Per user</span>
            </label>
            <Select
              value={settings.defaultEditor}
              onChange={(e) => saveSettingsField("defaultEditor", e.target.value)}
              className="w-full max-w-xs bg-background border-surface0"
            >
              {editorOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
            <p className="text-md text-overlay0 mt-2">
              Choose which application opens when you double-click files in the file explorer.
            </p>
          </div>

          <div className="bg-mantle rounded-lg p-4">
            <label className="block text-md font-medium text-subtext0 mb-2">
              DigitalOcean API Token
              <span className="ml-2 text-md text-overlay0 font-normal">Global default</span>
            </label>
            <div className="flex items-center gap-2 max-w-md">
              <div className="relative flex-1">
                <input
                  type={showDoToken ? "text" : "password"}
                  value={doTokenInput}
                  onChange={(e) => {
                    setDoTokenInput(e.target.value);
                    setDoTokenDirty(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && doTokenDirty) handleSaveDoToken();
                  }}
                  placeholder="dop_v1_..."
                  className="w-full bg-background text-text border border-surface0 rounded-md px-3 py-2 pr-9 text-md outline-none focus:border-blue font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowDoToken(!showDoToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-overlay0 hover:text-text transition-colors"
                >
                  {showDoToken ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {doTokenDirty && (
                <button
                  onClick={handleSaveDoToken}
                  className="px-3 py-2 bg-blue text-background text-md rounded-md hover:opacity-90 transition-opacity shrink-0"
                >
                  Save
                </button>
              )}
              {!doTokenDirty && doTokenInput && (
                <button
                  onClick={() => validateDoToken()}
                  className="px-3 py-2 bg-surface0 text-text text-md rounded-md hover:bg-surface1 transition-colors shrink-0"
                >
                  Validate
                </button>
              )}
            </div>
            {doTokenValid && !doTokenDirty && (
              <p className={`text-md mt-2 ${doTokenValid.valid ? "text-green" : "text-red"}`}>
                {doTokenValid.valid
                  ? `Valid — ${doTokenValid.email}`
                  : "Invalid token"}
              </p>
            )}
            <p className="text-md text-overlay0 mt-2">
              Get your token from DigitalOcean dashboard &rarr; API &rarr; Tokens.
              Can be overridden per project.
            </p>
          </div>

          <div className="bg-mantle rounded-lg p-4 mt-4">
            <label className="block text-md font-medium text-subtext0 mb-2">
              GitLab Deploy Key (Private)
              <span className="ml-2 text-md text-overlay0 font-normal">Global default</span>
            </label>
            <div className="max-w-md">
              <div className="relative">
                <textarea
                  value={showGitlabKey ? gitlabKeyInput : gitlabKeyInput ? "••••••••••••••••" : ""}
                  onChange={(e) => {
                    setGitlabKeyInput(e.target.value);
                    setGitlabKeyDirty(true);
                    if (!showGitlabKey) setShowGitlabKey(true);
                  }}
                  onFocus={() => {
                    if (!showGitlabKey && gitlabKeyInput) setShowGitlabKey(true);
                  }}
                  placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"}
                  spellCheck={false}
                  className="w-full bg-background text-text border border-surface0 rounded-md px-3 py-2 text-md outline-none focus:border-blue font-mono resize-y min-h-[80px] max-h-[200px]"
                  rows={4}
                />
                <button
                  type="button"
                  onClick={() => setShowGitlabKey(!showGitlabKey)}
                  className="absolute right-2 top-2 text-overlay0 hover:text-text transition-colors"
                >
                  {showGitlabKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {gitlabKeyDirty && (
                <button
                  onClick={handleSaveGitlabKey}
                  className="mt-2 px-3 py-2 bg-blue text-background text-md rounded-md hover:opacity-90 transition-opacity shrink-0"
                >
                  Save
                </button>
              )}
              {!gitlabKeyDirty && gitlabKeyInput && (
                <p className="text-md text-green mt-2">Saved</p>
              )}
            </div>
            <p className="text-md text-overlay0 mt-2">
              SSH private key used to clone private repos from GitLab on provisioned droplets.
              This key will be installed as <code className="text-text">~/.ssh/id_gitlab</code> on each new droplet.
              Can be overridden per project.
            </p>
          </div>

          <div className="bg-mantle rounded-lg p-4 mt-4">
            <label className="block text-md font-medium text-subtext0 mb-2">
              Git Access Token
              <span className="ml-2 text-md text-overlay0 font-normal">Per user</span>
            </label>
            <div className="flex items-center gap-2 max-w-md">
              <div className="relative flex-1">
                <input
                  type={showGitToken ? "text" : "password"}
                  value={gitTokenInput}
                  onChange={(e) => {
                    setGitTokenInput(e.target.value);
                    setGitTokenDirty(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && gitTokenDirty) handleSaveGitToken();
                  }}
                  placeholder="glpat-..."
                  className="w-full bg-background text-text border border-surface0 rounded-md px-3 py-2 pr-9 text-md outline-none focus:border-blue font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowGitToken(!showGitToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-overlay0 hover:text-text transition-colors"
                >
                  {showGitToken ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {gitTokenDirty && (
                <button
                  onClick={handleSaveGitToken}
                  className="px-3 py-2 bg-blue text-background text-md rounded-md hover:opacity-90 transition-opacity shrink-0"
                >
                  Save
                </button>
              )}
            </div>
            {!gitTokenDirty && gitTokenInput && (
              <p className="text-md text-green mt-2">Saved</p>
            )}
            <p className="text-md text-overlay0 mt-2">
              GitLab/GitHub personal access token injected as <code className="text-text">GIT_TOKEN</code> in <code className="text-text">.env</code> on provisioned droplets.
              Used by Dockerfiles to clone private repos during build.
            </p>
          </div>

          <div className="bg-mantle rounded-lg p-4 mt-4">
            <label className="block text-md font-medium text-subtext0 mb-2">
              Railway API Token
              <span className="ml-2 text-md text-overlay0 font-normal">Global</span>
            </label>
            <div className="flex items-center gap-2 max-w-md">
              <div className="relative flex-1">
                <input
                  type={showRailwayToken ? "text" : "password"}
                  value={railwayTokenInput}
                  onChange={(e) => {
                    setRailwayTokenInput(e.target.value);
                    setRailwayTokenDirty(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && railwayTokenDirty) handleSaveRailwayToken();
                  }}
                  placeholder="Enter Railway API token"
                  className="w-full bg-background text-text border border-surface0 rounded-md px-3 py-2 pr-9 text-md outline-none focus:border-blue font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowRailwayToken(!showRailwayToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-overlay0 hover:text-text transition-colors"
                >
                  {showRailwayToken ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {railwayTokenDirty && (
                <button
                  onClick={handleSaveRailwayToken}
                  className="px-3 py-2 bg-blue text-background text-md rounded-md hover:opacity-90 transition-opacity shrink-0"
                >
                  Save
                </button>
              )}
            </div>
            {!railwayTokenDirty && railwayTokenInput && (
              <p className="text-md text-green mt-2">Saved</p>
            )}
            <p className="text-md text-overlay0 mt-2">
              Used to fetch deployments and logs from Railway. Get it from Railway dashboard &rarr; Account Settings &rarr; Tokens.
            </p>
          </div>

          <div className="bg-mantle rounded-lg p-4 mt-4">
            <label className="block text-md font-medium text-subtext0 mb-2">
              Railway Project ID
              <span className="ml-2 text-md text-overlay0 font-normal">Global</span>
            </label>
            <div className="flex items-center gap-2 max-w-md">
              <input
                type="text"
                value={railwayProjectIdInput}
                onChange={(e) => {
                  setRailwayProjectIdInput(e.target.value);
                  setRailwayProjectIdDirty(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && railwayProjectIdDirty) handleSaveRailwayProjectId();
                }}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="flex-1 bg-background text-text border border-surface0 rounded-md px-3 py-2 text-md outline-none focus:border-blue font-mono"
              />
              {railwayProjectIdDirty && (
                <button
                  onClick={handleSaveRailwayProjectId}
                  className="px-3 py-2 bg-blue text-background text-md rounded-md hover:opacity-90 transition-opacity shrink-0"
                >
                  Save
                </button>
              )}
            </div>
            {!railwayProjectIdDirty && railwayProjectIdInput && (
              <p className="text-md text-green mt-2">Saved</p>
            )}
            <p className="text-md text-overlay0 mt-2">
              The Railway project to monitor. Find it in the Railway dashboard URL or project settings.
            </p>
          </div>

          {/* Railway connection test */}
          {railwayTokenInput && railwayProjectIdInput && !railwayTokenDirty && !railwayProjectIdDirty && (
            <div className="bg-mantle rounded-lg p-4 mt-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={handleTestRailway}
                  disabled={railwayTesting}
                  className="px-3 py-2 bg-surface0 text-text text-md rounded-md hover:bg-surface1 transition-colors disabled:opacity-50"
                >
                  {railwayTesting ? "Testing..." : "Test Railway Connection"}
                </button>
                {railwayTestResult && (
                  <span className={`text-md ${railwayTestResult.ok ? "text-green" : "text-red"}`}>
                    {railwayTestResult.message}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="pt-4">
          {/* Deploy tab: SSH Key */}
          <div className="bg-mantle rounded-lg p-4 mb-4">
            <label className="block text-md font-medium text-subtext0 mb-2">
              <span className="flex items-center gap-1.5">
                <Key size={14} />
                Genie Deploy SSH Key
              </span>
              <span className="ml-5 text-md text-overlay0 font-normal">ed25519 — used for VPS provisioning</span>
            </label>

            {sshKey.loading ? (
              <div className="flex items-center gap-2 text-overlay0 text-md py-2">
                <Loader2 size={14} className="animate-spin" /> Loading...
              </div>
            ) : sshKey.exists ? (
              <div className="flex flex-col gap-3 max-w-lg">
                <div>
                  <span className="text-md text-overlay0 mb-1 block">Public Key</span>
                  <div className="flex items-start gap-2">
                    <pre className="flex-1 bg-background text-text border border-surface0 rounded-md px-3 py-2 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-all select-text">
                      {sshKey.publicKey}
                    </pre>
                    <button
                      onClick={() => {
                        if (sshKey.publicKey) {
                          navigator.clipboard.writeText(sshKey.publicKey);
                          setCopiedKey(true);
                          setTimeout(() => setCopiedKey(false), 2000);
                        }
                      }}
                      className="shrink-0 p-2 text-overlay0 hover:text-text bg-background border border-surface0 rounded-md transition-colors"
                      title="Copy public key"
                    >
                      {copiedKey ? <Check size={14} className="text-green" /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>

                {sshKey.fingerprint && (
                  <div>
                    <span className="text-md text-overlay0">Fingerprint</span>
                    <p className="text-md text-text font-mono select-text">{sshKey.fingerprint}</p>
                  </div>
                )}

                {sshKey.createdAt && (
                  <div>
                    <span className="text-md text-overlay0">Created</span>
                    <p className="text-md text-text">{new Date(sshKey.createdAt).toLocaleString()}</p>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => {
                      if (confirm("Generate a new SSH key? The new key will be used for all future deploys. Existing droplets will keep using the old key.")) {
                        regenerateSshKey();
                      }
                    }}
                    disabled={sshKey.regenerating}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-surface0 text-text text-md rounded-md hover:bg-surface1 transition-colors disabled:opacity-50"
                  >
                    {sshKey.regenerating ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    Regenerate
                  </button>
                  <button
                    onClick={() => {
                      if (confirm("Delete the SSH key? You won't be able to deploy until a new key is generated.")) {
                        deleteSshKey();
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-red hover:bg-red/10 text-md rounded-md transition-colors"
                  >
                    <Trash2 size={13} />
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-md text-overlay0">No SSH key exists. Generate one to enable VPS deployments.</p>
                <button
                  onClick={() => regenerateSshKey()}
                  disabled={sshKey.regenerating}
                  className="flex items-center gap-1.5 px-3 py-2 bg-mauve text-crust text-md rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 w-fit"
                >
                  {sshKey.regenerating ? <Loader2 size={13} className="animate-spin" /> : <Key size={13} />}
                  Generate SSH Key
                </button>
              </div>
            )}
            <p className="text-md text-overlay0 mt-3">
              This key is registered with DigitalOcean and used to SSH into provisioned droplets.
              The last generated key is used for all new deploys.
            </p>

            {sshKey.history.length > 0 && (
              <div className="mt-4 pt-4 border-t border-surface0">
                <span className="text-md font-medium text-subtext0 block mb-2">Previous Keys</span>
                <div className="flex flex-col gap-2 max-w-lg">
                  {sshKey.history.map((entry, i) => (
                    <div key={i} className="bg-background border border-surface0 rounded-md px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono text-overlay1 truncate flex-1 select-text">{entry.fingerprint}</span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(entry.publicKey);
                          }}
                          className="shrink-0 p-1 text-overlay0 hover:text-text transition-colors"
                          title="Copy public key"
                        >
                          <Copy size={12} />
                        </button>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-overlay0 mt-1">
                        {entry.createdAt && <span>Created: {new Date(entry.createdAt).toLocaleDateString()}</span>}
                        <span>Archived: {new Date(entry.archivedAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Deploy tab: Default Deploy Steps */}
          <div className="bg-mantle rounded-lg p-4">
            <label className="block text-md font-medium text-subtext0 mb-2">
              Default Deploy Steps
            </label>
            <p className="text-md text-overlay0 mb-4">
              These are the steps Genie executes in sequence when provisioning a new droplet and deploying a project.
            </p>
            <div className="flex flex-col gap-0">
              {DEPLOY_STEPS.map((step, i) => (
                <div key={i} className="flex gap-3 pb-4 last:pb-0">
                  <div className="flex flex-col items-center">
                    <div className="w-6 h-6 rounded-full bg-surface0 text-overlay1 flex items-center justify-center text-[11px] font-medium shrink-0">
                      {i + 1}
                    </div>
                    {i < DEPLOY_STEPS.length - 1 && <div className="w-px flex-1 bg-surface0 mt-1" />}
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <span className="text-md font-medium text-text">
                      {step.title}
                      {step.conditional && <span className="ml-1.5 text-[11px] text-overlay0 font-normal">conditional</span>}
                    </span>
                    <p className="text-md text-overlay1 mt-0.5 leading-relaxed">{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
