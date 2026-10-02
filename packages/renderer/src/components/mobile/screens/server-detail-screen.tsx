"use client";

import { ChevronLeft, ChevronRight, TerminalSquare, Terminal, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { CircularGauge } from "@/components/ui/circular-gauge";
import { ClaudeLogo } from "@/components/mobile/claude-logo";
import {
  useInstanceServices,
  useInstanceSessions,
  useInstanceStats,
} from "@/components/mobile/use-mobile-data";
import type {
  MockServer,
  MockService,
  MockSession,
  SessionKind,
} from "@/components/mobile/mock-data";

const HEALTH_BADGE: Record<MockServer["health"], string> = {
  healthy: "bg-green/15 text-green",
  degraded: "bg-yellow/15 text-yellow",
  down: "bg-red/15 text-red",
};

const HEALTH_LABEL: Record<MockServer["health"], string> = {
  healthy: "Running",
  degraded: "Degraded",
  down: "Down",
};

export function ServerDetailScreen({
  server: s,
  onBack,
  onSSH,
  onOpenClaude,
  onOpenSession,
}: {
  server: MockServer;
  onBack: () => void;
  onSSH: (server: MockServer) => void;
  onOpenClaude: (server: MockServer) => void;
  onOpenSession: (server: MockServer, session: MockSession) => void;
}) {
  const stats = useInstanceStats(s);
  const services = useInstanceServices(s);
  const sessions = useInstanceSessions(s);
  const isDown = s.health === "down";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-surface0 shrink-0">
        <button onClick={onBack} className="p-1 -ml-1 rounded-lg text-overlay0 active:bg-surface0" aria-label="Back">
          <ChevronLeft size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-md font-semibold text-text truncate leading-tight">{s.label}</p>
          <p className="text-xs text-overlay0 truncate">Manager · {s.project}</p>
        </div>
        <span className={cn("text-2xs font-semibold uppercase px-2 py-1 rounded-full", HEALTH_BADGE[s.health])}>
          {HEALTH_LABEL[s.health]}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin flex flex-col gap-4 px-4 py-4">
        {/* Live metrics — three circular gauges */}
        <div className="bg-mantle rounded-xl px-3.5 py-4 flex items-center justify-around">
          <Gauge label="CPU" percent={isDown ? 0 : stats.cpu} />
          <Gauge label="Memory" percent={isDown ? 0 : stats.mem} />
          <Gauge label="Disk" percent={isDown ? 0 : stats.disk} />
        </div>

        {/* Sessions — open SSH / Claude / tmux on this server, always visible */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-0.5">
            <h2 className="text-xs uppercase tracking-wide text-overlay0">Sessions · {sessions.length}</h2>
            <button className="flex items-center gap-1 text-xs text-blue active:opacity-70">
              <Plus size={13} /> New
            </button>
          </div>
          <div className="bg-mantle rounded-xl divide-y divide-surface0/50">
            {sessions.length === 0 ? (
              <p className="px-3.5 py-3 text-sm text-overlay0">No open sessions.</p>
            ) : (
              sessions.map((sess) => (
                <SessionRow
                  key={sess.id}
                  session={sess}
                  onOpen={() => onOpenSession(s, sess)}
                />
              ))
            )}
          </div>
        </section>

        {/* Actions */}
        <section className="flex flex-col gap-2">
          <h2 className="text-xs uppercase tracking-wide text-overlay0 px-0.5">Actions</h2>
          <div className="grid grid-cols-2 gap-2">
            <ActionTile
              icon={<ClaudeLogo size={16} />}
              label="Claude"
              className="bg-peach/15 text-peach"
              onClick={() => onOpenClaude(s)}
            />
            <ActionTile
              icon={<TerminalSquare size={18} />}
              label="SSH"
              className="bg-blue/15 text-blue"
              onClick={() => onSSH(s)}
            />
          </div>
        </section>

        {/* Services */}
        <section className="flex flex-col gap-2">
          <h2 className="text-xs uppercase tracking-wide text-overlay0 px-0.5">
            Services · {services.length}
          </h2>
          <div className="bg-mantle rounded-xl divide-y divide-surface0/50">
            {services.map((svc) => (
              <ServiceRow key={svc.name} service={svc} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/** Mobile-sized circular gauge, reusing the desktop CircularGauge primitive. */
function Gauge({ label, percent }: { label: string; percent: number }) {
  return (
    <CircularGauge
      label={label}
      percent={percent}
      size={68}
      strokeWidth={6}
      showPercentSign
      valueClassName="text-text font-mono font-semibold"
      valueFontSize={15}
      labelClassName="text-sm text-overlay0 mt-1"
    />
  );
}

function ActionTile({
  icon,
  label,
  className,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-2 px-3.5 py-3 rounded-xl text-md font-medium active:scale-[0.97] transition-transform",
        className ?? "bg-mantle text-subtext0",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// Mirror the desktop session accent: Claude = peach + Claude glyph, SSH = blue,
// plain tmux/shell = green + Terminal. The row itself carries the identity (real
// tmux session name) and glows in the accent when the session is active.
const SESSION_PALETTE: Record<SessionKind, { text: string; glow: string; tint: string }> = {
  claude: { text: "text-peach", glow: "tmux-running-glow-peach", tint: "bg-peach/[0.07]" },
  ssh: { text: "text-blue", glow: "tmux-running-glow-green", tint: "bg-blue/[0.07]" },
  tmux: { text: "text-green", glow: "tmux-running-glow-green", tint: "bg-green/[0.07]" },
};

function SessionRow({ session, onOpen }: { session: MockSession; onOpen: () => void }) {
  const claude = session.kind === "claude";
  const p = SESSION_PALETTE[session.kind];

  return (
    <button
      onClick={onOpen}
      className={cn(
        "w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors active:bg-surface0/40",
        session.running ? cn(p.tint, p.glow) : "",
      )}
    >
      <span className={cn("shrink-0", p.text)}>
        {claude ? <ClaudeLogo size={16} /> : <Terminal size={16} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-text truncate font-mono">{session.title}</p>
        <p className="text-xs text-overlay0 truncate">{session.detail}</p>
      </div>
      <ChevronRight size={15} className="text-overlay0 shrink-0" />
    </button>
  );
}

const SVC_DOT: Record<MockService["status"], string> = {
  running: "bg-green",
  restarted: "bg-blue",
  stopped: "bg-red",
};

function ServiceRow({ service: svc }: { service: MockService }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <span className={cn("w-2 h-2 rounded-full shrink-0", SVC_DOT[svc.status])} />
      <div className="min-w-0 flex-1">
        <p className="text-md text-text truncate">{svc.name}</p>
        <p className="text-xs text-overlay0 truncate font-mono">{svc.detail}</p>
      </div>
      <span className="text-2xs text-overlay0 capitalize shrink-0">{svc.status}</span>
    </div>
  );
}
