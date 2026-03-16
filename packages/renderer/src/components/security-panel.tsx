"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useDeepSubjectAll } from "@/lib/hooks";
import { $security, startSecurityScan, stopSecurityScan, loadSecurityScans, deleteSecurityScan, type SecurityScan, type SecurityState, type Severity, type WebFinding, type PortResult } from "@/store";
import { Button } from "@/components/ui/button";
import { ViewHeader } from "@/components/view-header";
import { cn } from "@/lib/utils";
import { Shield, Play, Square, ChevronDown, Trash2 } from "lucide-react";

type ResultTab = "ports" | "vulnerabilities" | "headers" | "ssl" | "operations";

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: "bg-red text-background",
  high: "bg-peach text-background",
  medium: "bg-yellow text-background",
  low: "bg-blue text-background",
  info: "bg-overlay0 text-background",
};

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={cn("px-1.5 py-0.5 rounded text-md font-medium", SEVERITY_COLORS[severity])}>
      {severity}
    </span>
  );
}

function PortsTable({ ports }: { ports: PortResult[] }) {
  const sorted = useMemo(() => [...ports].sort((a, b) => a.port - b.port), [ports]);

  if (sorted.length === 0) {
    return <div className="text-overlay0 text-md py-8 text-center">No open ports discovered yet</div>;
  }

  return (
    <div className="overflow-auto flex-1">
      <table className="w-full text-md">
        <thead>
          <tr className="text-left text-overlay0 border-b border-surface0">
            <th className="py-1.5 px-2 font-medium">Port</th>
            <th className="py-1.5 px-2 font-medium">State</th>
            <th className="py-1.5 px-2 font-medium">Service</th>
            <th className="py-1.5 px-2 font-medium">Banner</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.port} className="border-b border-surface0 hover:bg-surface0/50">
              <td className="py-1.5 px-2 text-text font-mono">{p.port}</td>
              <td className="py-1.5 px-2">
                <span className={cn(
                  "px-1.5 py-0.5 rounded text-md",
                  p.state === "open" ? "bg-green/20 text-green" : "bg-surface1 text-overlay0",
                )}>
                  {p.state}
                </span>
              </td>
              <td className="py-1.5 px-2 text-subtext0">{p.service}</td>
              <td className="py-1.5 px-2 text-overlay0 font-mono truncate max-w-[300px]">{p.banner || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FindingsList({ findings }: { findings: WebFinding[] }) {
  const sorted = useMemo(
    () => [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    [findings],
  );

  if (sorted.length === 0) {
    return <div className="text-overlay0 text-md py-8 text-center">No findings in this category</div>;
  }

  return (
    <div className="overflow-auto flex-1 flex flex-col gap-1.5">
      {sorted.map((f) => (
        <div key={f.id} className="border border-surface0 rounded-md p-2.5 hover:bg-surface0/30">
          <div className="flex items-center gap-2 mb-1">
            <SeverityBadge severity={f.severity} />
            <span className="text-md font-medium text-text">{f.title}</span>
          </div>
          <p className="text-md text-subtext0 mb-1">{f.description}</p>
          <div className="flex flex-col gap-0.5">
            <span className="text-md text-overlay0 font-mono break-all">{f.url}</span>
            {f.evidence && (
              <span className="text-md text-overlay0 font-mono bg-surface0 px-1.5 py-0.5 rounded inline-block mt-0.5 break-all">
                {f.evidence}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function OperationsLog({ operations }: { operations: string[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [operations.length]);

  if (operations.length === 0) {
    return <div className="text-overlay0 text-md py-8 text-center">No operations recorded yet</div>;
  }

  return (
    <div className="overflow-auto flex-1 font-mono text-md">
      {operations.map((op, i) => {
        let color = "text-subtext0";
        if (op.includes("[CRITICAL]")) color = "text-red";
        else if (op.includes("[HIGH]")) color = "text-peach";
        else if (op.includes("[MEDIUM]")) color = "text-yellow";
        else if (op.includes("[LOW]")) color = "text-blue";
        else if (op.includes("open —")) color = "text-green";
        else if (op.includes("Starting") || op.includes("Beginning") || op.includes("Enumerating") || op.includes("Testing") || op.includes("Checking") || op.includes("Analyzing")) color = "text-overlay0";
        else if (op.includes("complete") || op.includes("finished")) color = "text-mauve";

        return (
          <div key={i} className={cn("py-0.5 leading-relaxed", color)}>
            {op}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

function ScanResults({ scan }: { scan: SecurityScan }) {
  const [activeTab, setActiveTab] = useState<ResultTab>("operations");

  const vulnFindings = useMemo(
    () => scan.findings.filter((f) => ["sqli", "xss", "redirect", "directory", "disclosure", "other"].includes(f.category)),
    [scan.findings],
  );
  const headerFindings = useMemo(
    () => scan.findings.filter((f) => f.category === "header"),
    [scan.findings],
  );
  const sslFindings = useMemo(
    () => scan.findings.filter((f) => f.category === "ssl"),
    [scan.findings],
  );

  const tabs: { key: ResultTab; label: string; count: number }[] = [
    { key: "operations", label: "Operations", count: scan.operations.length },
    { key: "ports", label: "Ports", count: scan.ports.length },
    { key: "vulnerabilities", label: "Vulnerabilities", count: vulnFindings.length },
    { key: "headers", label: "Headers", count: headerFindings.length },
    { key: "ssl", label: "SSL", count: sslFindings.length },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex gap-0.5 border-b border-surface0 mb-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-3 py-1.5 text-md font-medium cursor-pointer transition-colors border-b-2 bg-transparent border-x-0 border-t-0",
              activeTab === tab.key
                ? "border-mauve text-text"
                : "border-transparent text-overlay0 hover:text-subtext0",
            )}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className="ml-1.5 text-md text-overlay0 bg-surface0 px-1.5 py-0.5 rounded-full tabular-nums">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {activeTab === "operations" && <OperationsLog operations={scan.operations} />}
        {activeTab === "ports" && <PortsTable ports={scan.ports} />}
        {activeTab === "vulnerabilities" && <FindingsList findings={vulnFindings} />}
        {activeTab === "headers" && <FindingsList findings={headerFindings} />}
        {activeTab === "ssl" && <FindingsList findings={sslFindings} />}
      </div>
    </div>
  );
}

export function SecurityPanel() {
  const securityState = useDeepSubjectAll<SecurityState>($security);
  const [targetInput, setTargetInput] = useState(securityState.target || "");
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    loadSecurityScans();
  }, []);

  const activeScan = securityState.activeScanId
    ? securityState.scans.find((s: SecurityScan) => s.id === securityState.activeScanId)
    : null;

  // Default to showing the most recent scan if no active scan
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const displayScan = activeScan || (selectedScanId
    ? securityState.scans.find((s: SecurityScan) => s.id === selectedScanId)
    : securityState.scans[0]) || null;

  const isRunning = activeScan?.status === "running";

  const handleStart = () => {
    const target = targetInput.trim();
    if (!target) return;
    startSecurityScan(target);
  };

  const handleStop = () => {
    if (activeScan) {
      stopSecurityScan(activeScan.id);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isRunning) {
      handleStart();
    }
  };

  return (
    <div className="flex flex-col h-full px-4 pb-4 gap-3">
      <ViewHeader
        title="Security"
        statusIndicator={<Shield size={18} className="text-mauve" />}
      />

      {/* Target input bar */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={targetInput}
          onChange={(e) => setTargetInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter target IP or hostname (e.g. 192.168.1.1)"
          className="flex-1 bg-surface0 border border-surface1 rounded-md px-3 py-1.5 text-md text-text placeholder:text-overlay0 outline-none focus:border-mauve"
          disabled={isRunning}
        />
        {isRunning ? (
          <Button variant="danger" onClick={handleStop}>
            <Square size={14} className="mr-1.5" />
            Stop
          </Button>
        ) : (
          <Button variant="primary" onClick={handleStart} disabled={!targetInput.trim()}>
            <Play size={14} className="mr-1.5" />
            Start Scan
          </Button>
        )}
      </div>

      {/* Progress bar */}
      {activeScan && activeScan.status === "running" && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-md">
            <span className="text-subtext0">{activeScan.phase}</span>
            <span className="text-overlay0 tabular-nums">{activeScan.progress}%</span>
          </div>
          <div className="h-1.5 bg-surface0 rounded-full overflow-hidden">
            <div
              className="h-full bg-mauve rounded-full transition-all duration-300"
              style={{ width: `${activeScan.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error display */}
      {displayScan?.status === "error" && displayScan.error && (
        <div className="bg-red/10 border border-red/30 rounded-md px-3 py-2 text-md text-red">
          {displayScan.error}
        </div>
      )}

      {/* Scan history selector */}
      {securityState.scans.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-1.5 text-md text-overlay0 hover:text-subtext0 cursor-pointer bg-transparent border-none"
          >
            <ChevronDown size={14} className={cn("transition-transform", showHistory && "rotate-180")} />
            Scan history ({securityState.scans.length})
          </button>
          {showHistory && (
            <div className="absolute top-full left-0 mt-1 bg-mantle border border-surface0 rounded-md shadow-lg z-10 min-w-[400px] max-h-[250px] overflow-auto">
              {securityState.scans.map((s: SecurityScan) => (
                <div
                  key={s.id}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 text-md hover:bg-surface0",
                    displayScan?.id === s.id ? "bg-surface0 text-text" : "text-subtext0",
                  )}
                >
                  <button
                    onClick={() => { setSelectedScanId(s.id); setShowHistory(false); }}
                    className="flex-1 text-left cursor-pointer bg-transparent border-none truncate"
                  >
                    <span className="font-mono">{s.target}</span>
                    <span className="ml-2 text-overlay0">
                      {s.status === "completed" ? `${s.ports.length} ports, ${s.findings.length} findings` : s.status}
                    </span>
                    <span className="ml-2 text-overlay0">{new Date(s.startedAt).toLocaleString()}</span>
                  </button>
                  {s.status !== "running" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteSecurityScan(s.id); if (selectedScanId === s.id) setSelectedScanId(null); }}
                      className="shrink-0 p-1 rounded bg-transparent border-none cursor-pointer text-overlay0 hover:text-red hover:bg-red/10"
                      title="Delete scan"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {displayScan ? (
        <ScanResults scan={displayScan} />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-overlay0 text-md">
          <Shield size={40} className="text-surface1" />
          Enter a target and start a scan to begin
        </div>
      )}
    </div>
  );
}
