"use client";

import { useEffect, useState } from "react";
import { useSubject } from "subjecto/react";
import { $settings, $doTokenValid, loadSettings, saveSettingsField, validateDoToken } from "@/store";
import { type AppSettings } from "@/lib/genie-api";
import { Eye, EyeOff } from "lucide-react";
import { ViewHeader } from "@/components/view-header";
import { Select } from "@/components/ui/select";

const editorOptions = [
  { value: "", label: "System Default" },
  { value: "Visual Studio Code", label: "Visual Studio Code" },
  { value: "Cursor", label: "Cursor" },
  { value: "Zed", label: "Zed" },
  { value: "Sublime Text", label: "Sublime Text" },
  { value: "WebStorm", label: "WebStorm" },
];

export function SettingsPanel() {
  const [settings] = useSubject($settings);
  const [doTokenValid] = useSubject($doTokenValid);
  const [showDoToken, setShowDoToken] = useState(false);
  const [doTokenInput, setDoTokenInput] = useState("");
  const [doTokenDirty, setDoTokenDirty] = useState(false);
  const [showGitlabKey, setShowGitlabKey] = useState(false);
  const [gitlabKeyInput, setGitlabKeyInput] = useState("");
  const [gitlabKeyDirty, setGitlabKeyDirty] = useState(false);
  const [showGitToken, setShowGitToken] = useState(false);
  const [gitTokenInput, setGitTokenInput] = useState("");
  const [gitTokenDirty, setGitTokenDirty] = useState(false);

  useEffect(() => {
    loadSettings();
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

  return (
    <div className="flex-1 flex flex-col overflow-y-auto px-5 pb-5">
      <ViewHeader title="Settings" />

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

    </div>
  );
}
