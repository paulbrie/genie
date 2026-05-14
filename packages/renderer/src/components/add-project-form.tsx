"use client";

import { useState, useEffect } from "react";
import { useDeepSubjectAll } from "@/lib/hooks";
import { $admin, hideAddProjectForm, loadBaseImageConfigs, type BaseImageTemplate } from "@/store";
import { wsSend } from "@/lib/ws";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

type Provider = "digitalocean" | "tazcloud";

export function AddProjectForm() {
  const [name, setName] = useState("");
  const [vpsProvider, setVpsProvider] = useState<Provider>("digitalocean");
  const [vpsRegion, setVpsRegion] = useState("nyc1");
  const [vpsSize, setVpsSize] = useState("s-2vcpu-4gb");
  const [vpsImage, setVpsImage] = useState("ubuntu-22");
  const [vpsTazSize, setVpsTazSize] = useState("small");
  const [vpsBaseImageConfigName, setVpsBaseImageConfigName] = useState("");
  const [doToken, setDoToken] = useState("");
  const [gitlabDeployKey, setGitlabDeployKey] = useState("");

  const admin = useDeepSubjectAll($admin);
  const baseImageTemplates = admin.baseImage.templates;

  useEffect(() => {
    loadBaseImageConfigs();
  }, []);

  function handleSave() {
    const trimName = name.trim();
    if (!trimName) return;

    wsSend("project:add", {
      name: trimName,
      vpsProvider,
      vpsRegion: vpsProvider === "digitalocean" ? vpsRegion : undefined,
      vpsSize: vpsProvider === "digitalocean" ? vpsSize : vpsTazSize,
      vpsImage: vpsProvider === "tazcloud" ? vpsImage : undefined,
      vpsBaseImageConfigName: vpsProvider === "digitalocean" && vpsBaseImageConfigName ? vpsBaseImageConfigName : undefined,
      doToken: vpsProvider === "digitalocean" && doToken ? doToken : undefined,
      gitlabDeployKey: gitlabDeployKey || undefined,
    });
    hideAddProjectForm();
  }

  function handleCancel() {
    hideAddProjectForm();
  }

  return (
    <div className="px-5 py-6 flex flex-col gap-3.5 max-w-[560px]">
      <h2 className="text-lg font-semibold text-text mb-1">
        Add New Project
      </h2>

      <div className="flex flex-col gap-1">
        <label className="text-md font-semibold text-subtext0">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Project"
          className="bg-surface0 border border-surface1 rounded-md px-2.5 py-2 text-base text-text outline-none font-sans placeholder:text-overlay0 focus:border-mauve"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-md font-semibold text-subtext0">VPS Configuration</label>

        <div className="flex flex-col gap-1">
          <label className="text-md text-overlay0">Provider</label>
          <Select
            value={vpsProvider}
            onChange={(e) => setVpsProvider(e.target.value as Provider)}
            className="py-2 text-base font-sans focus:border-mauve"
          >
            <option value="digitalocean">DigitalOcean</option>
            <option value="tazcloud">TazCloud</option>
          </Select>
        </div>

        {vpsProvider === "digitalocean" ? (
          <>
            <div className="flex gap-2">
              <div className="flex-1 flex flex-col gap-1">
                <label className="text-md text-overlay0">Region</label>
                <Select
                  value={vpsRegion}
                  onChange={(e) => setVpsRegion(e.target.value)}
                  className="py-2 text-base font-sans focus:border-mauve"
                >
                  <option value="nyc1">NYC 1 (New York)</option>
                  <option value="sfo3">SFO 3 (San Francisco)</option>
                  <option value="ams3">AMS 3 (Amsterdam)</option>
                  <option value="lon1">LON 1 (London)</option>
                  <option value="fra1">FRA 1 (Frankfurt)</option>
                  <option value="sgp1">SGP 1 (Singapore)</option>
                  <option value="blr1">BLR 1 (Bangalore)</option>
                  <option value="syd1">SYD 1 (Sydney)</option>
                </Select>
              </div>
              <div className="flex-1 flex flex-col gap-1">
                <label className="text-md text-overlay0">Droplet Size</label>
                <Select
                  value={vpsSize}
                  onChange={(e) => setVpsSize(e.target.value)}
                  className="py-2 text-base font-sans focus:border-mauve"
                >
                  <option value="s-1vcpu-1gb">1 vCPU / 1 GB</option>
                  <option value="s-1vcpu-2gb">1 vCPU / 2 GB</option>
                  <option value="s-2vcpu-2gb">2 vCPU / 2 GB</option>
                  <option value="s-2vcpu-4gb">2 vCPU / 4 GB</option>
                  <option value="s-4vcpu-8gb">4 vCPU / 8 GB</option>
                  <option value="s-8vcpu-16gb">8 vCPU / 16 GB</option>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-md text-overlay0">Template</label>
              <Select
                value={vpsBaseImageConfigName}
                onChange={(e) => setVpsBaseImageConfigName(e.target.value)}
                className="py-2 text-base font-sans focus:border-mauve"
              >
                <option value="">Default</option>
                {Object.keys(baseImageTemplates).filter((n) => n !== "default").map((tplName) => (
                  <option key={tplName} value={tplName}>{tplName}</option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-md text-overlay0">DO API Token</label>
              <input
                type="password"
                value={doToken}
                onChange={(e) => setDoToken(e.target.value)}
                placeholder="Leave blank to use global default from Settings"
                className="bg-surface0 border border-surface1 rounded-md px-2.5 py-2 text-base text-text outline-none font-sans placeholder:text-overlay0 focus:border-mauve font-mono"
              />
            </div>
          </>
        ) : (
          <>
            <div className="flex gap-2">
              <div className="flex-1 flex flex-col gap-1">
                <label className="text-md text-overlay0">Image</label>
                <Select
                  value={vpsImage}
                  onChange={(e) => setVpsImage(e.target.value)}
                  className="py-2 text-base font-sans focus:border-mauve"
                >
                  <option value="ubuntu-22">Ubuntu 22.04</option>
                  <option value="ubuntu-24">Ubuntu 24.04</option>
                  <option value="debian-12">Debian 12</option>
                  <option value="almalinux-9">AlmaLinux 9</option>
                </Select>
              </div>
              <div className="flex-1 flex flex-col gap-1">
                <label className="text-md text-overlay0">VM Size</label>
                <Select
                  value={vpsTazSize}
                  onChange={(e) => setVpsTazSize(e.target.value)}
                  className="py-2 text-base font-sans focus:border-mauve"
                >
                  <option value="small">small — 1 vCPU / 1 GB / 20 GB</option>
                  <option value="medium">medium — 2 vCPU / 2 GB / 40 GB</option>
                  <option value="large">large — 4 vCPU / 8 GB / 80 GB</option>
                  <option value="xlarge">xlarge — 8 vCPU / 16 GB / 160 GB</option>
                </Select>
              </div>
            </div>
            <p className="text-xs text-overlay0 italic">
              TazCloud credentials must be set via TAZCLOUD_API_TOKEN and TAZCLOUD_SSH_PRIVATE_KEY env vars on the manager. Snapshots, base-image templates, and hibernation are not available for this provider.
            </p>
          </>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-md text-overlay0">Deploy Key</label>
          <textarea
            value={gitlabDeployKey}
            onChange={(e) => setGitlabDeployKey(e.target.value)}
            placeholder="Leave blank to use global default from Settings"
            spellCheck={false}
            className="bg-surface0 border border-surface1 rounded-md px-2.5 py-2 text-base text-text outline-none font-sans placeholder:text-overlay0 focus:border-mauve font-mono resize-y min-h-[60px] max-h-[120px]"
            rows={2}
          />
        </div>
      </div>

      <div className="flex gap-1.5 justify-end pt-1">
        <Button size="sm" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave}>
          Save
        </Button>
      </div>
    </div>
  );
}
