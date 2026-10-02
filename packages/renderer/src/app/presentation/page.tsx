"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Zap,
  Sparkles,
  ArrowRight,
  Check,
  X,
  Keyboard,
  Grid3x3,
  MessageSquare,
  Code2,
  Cloud,
  Bot,
  Layers,
  ListTodo,
  AlertTriangle,
  FileText,
  Activity,
  Briefcase,
  PenTool,
  Crown,
  Wrench,
  Globe,
  Users,
  Plus,
  Minus,
  Terminal,
  GitBranch,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────────
   Palette — Catppuccin Mocha
   ───────────────────────────────────────────────────────────── */
const C = {
  base: "#1e1e2e",
  mantle: "#181825",
  crust: "#11111b",
  surface0: "#313244",
  surface1: "#45475a",
  surface2: "#585b70",
  overlay0: "#6c7086",
  overlay1: "#7f849c",
  subtext0: "#a6adc8",
  text: "#cdd6f4",
  mauve: "#cba6f7",
  lavender: "#b4befe",
  blue: "#89b4fa",
  sapphire: "#74c7ec",
  sky: "#89dceb",
  teal: "#94e2d5",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  peach: "#fab387",
  maroon: "#eba0ac",
  red: "#f38ba8",
  pink: "#f5c2e7",
} as const;

/* ─────────────────────────────────────────────────────────────
   Primitives
   ───────────────────────────────────────────────────────────── */
function GradientText({
  children,
  from,
  to,
  angle = 135,
}: {
  children: React.ReactNode;
  from: string;
  to: string;
  angle?: number;
}) {
  return (
    <span
      style={{
        background: `linear-gradient(${angle}deg, ${from}, ${to})`,
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        backgroundClip: "text",
      }}
    >
      {children}
    </span>
  );
}

function Eyebrow({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: 12,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 3,
        color,
        marginBottom: 20,
      }}
    >
      {children}
    </p>
  );
}

function SlideHeader({
  eyebrow,
  eyebrowColor,
  title,
  subtitle,
}: {
  eyebrow: string;
  eyebrowColor: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 40 }}>
      <Eyebrow color={eyebrowColor}>{eyebrow}</Eyebrow>
      <h2
        style={{
          fontSize: 52,
          fontWeight: 700,
          color: C.text,
          lineHeight: 1.05,
          letterSpacing: -1.5,
          marginBottom: subtitle ? 18 : 0,
        }}
      >
        {title}
      </h2>
      {subtitle && (
        <p
          style={{
            fontSize: 19,
            color: C.subtext0,
            lineHeight: 1.55,
            maxWidth: 820,
          }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}

function DotGrid({ opacity = 0.12 }: { opacity?: number }) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage: `radial-gradient(${C.overlay0} 1px, transparent 1px)`,
        backgroundSize: "32px 32px",
        opacity,
        pointerEvents: "none",
        maskImage: "radial-gradient(ellipse at center, #000 30%, transparent 75%)",
        WebkitMaskImage: "radial-gradient(ellipse at center, #000 30%, transparent 75%)",
      }}
    />
  );
}

function AnimatedNumber({
  value,
  active,
  duration = 1200,
  format,
}: {
  value: number;
  active: boolean;
  duration?: number;
  format?: (n: number) => string;
}) {
  const [n, setN] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      setN(0);
      startRef.current = null;
      return;
    }
    let raf = 0;
    const step = (t: number) => {
      if (startRef.current === null) startRef.current = t;
      const p = Math.min(1, (t - startRef.current) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(value * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [active, value, duration]);

  return <>{format ? format(n) : Math.round(n).toString()}</>;
}

/* ─────────────────────────────────────────────────────────────
   Slide 01 — Title
   ───────────────────────────────────────────────────────────── */
function SlideTitle({ active }: { active: boolean }) {
  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        overflow: "hidden",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          width: 1000,
          height: 1000,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${C.mauve}22 0%, ${C.blue}11 40%, transparent 70%)`,
          filter: "blur(40px)",
          top: -120,
          left: "50%",
          transform: "translateX(-50%)",
        }}
      />
      <DotGrid opacity={0.18} />

      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 32,
          padding: "8px 16px",
          borderRadius: 100,
          background: C.surface0 + "aa",
          border: `1px solid ${C.surface1}`,
          backdropFilter: "blur(10px)",
          opacity: active ? 1 : 0,
          animation: active ? "fadeUp 0.6s ease-out 0.05s both" : undefined,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: C.green,
            boxShadow: `0 0 12px ${C.green}`,
          }}
        />
        <span style={{ fontSize: 12, fontWeight: 600, color: C.subtext0, letterSpacing: 0.5 }}>
          THE ALL-IN-ONE WORKSPACE WHERE SOFTWARE GETS BUILT
        </span>
      </div>

      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 24,
          marginBottom: 16,
          opacity: active ? 1 : 0,
          animation: active ? "fadeUp 0.7s ease-out 0.15s both" : undefined,
        }}
      >
        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: 24,
            background: `linear-gradient(135deg, ${C.mauve}, ${C.blue})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0 20px 60px ${C.mauve}40, 0 0 0 1px ${C.mauve}40 inset`,
          }}
        >
          <Zap size={44} fill={C.crust} stroke={C.crust} strokeWidth={2.5} />
        </div>
        <h1
          style={{
            fontSize: 120,
            fontWeight: 800,
            letterSpacing: -4,
            lineHeight: 0.95,
            margin: 0,
          }}
        >
          <GradientText from={C.mauve} to={C.blue}>
            Genie
          </GradientText>
        </h1>
      </div>

      <p
        style={{
          position: "relative",
          fontSize: 30,
          color: C.text,
          maxWidth: 880,
          lineHeight: 1.3,
          fontWeight: 400,
          marginTop: 12,
          opacity: active ? 1 : 0,
          animation: active ? "fadeUp 0.7s ease-out 0.3s both" : undefined,
        }}
      >
        One platform for{" "}
        <span style={{ color: C.mauve, fontWeight: 600 }}>everyone</span> who builds software.
        <br />
        Replaces chat, tracker, IDE, and cloud — and lets{" "}
        <span style={{ color: C.blue, fontWeight: 600 }}>AI do the work</span>.
      </p>

      <div
        style={{
          position: "relative",
          marginTop: 48,
          display: "flex",
          alignItems: "center",
          gap: 12,
          opacity: active ? 1 : 0,
          animation: active ? "fadeUp 0.7s ease-out 0.5s both" : undefined,
        }}
      >
        {["Chat", "Tracker", "Code", "Cloud", "AI Agent"].map((w, i) => (
          <span
            key={w}
            style={{
              padding: "8px 18px",
              borderRadius: 99,
              fontSize: 13,
              fontWeight: 600,
              background: [C.mauve, C.blue, C.teal, C.peach, C.pink][i] + "18",
              color: [C.mauve, C.blue, C.teal, C.peach, C.pink][i],
              border: `1px solid ${[C.mauve, C.blue, C.teal, C.peach, C.pink][i]}40`,
            }}
          >
            {w}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Slide 02 — The fragmented stack (Problem)
   ───────────────────────────────────────────────────────────── */
function ToolChip({
  name,
  role,
  color,
  icon,
  active,
  delay,
  rotate = 0,
}: {
  name: string;
  role: string;
  color: string;
  icon: React.ReactNode;
  active: boolean;
  delay: number;
  rotate?: number;
}) {
  return (
    <div
      style={{
        padding: "14px 18px",
        borderRadius: 14,
        background: C.surface0,
        border: `1px solid ${C.surface1}`,
        display: "flex",
        alignItems: "center",
        gap: 12,
        transform: `rotate(${rotate}deg)`,
        opacity: active ? 1 : 0,
        animation: active ? `fadeUp 0.5s ease-out ${delay}s both` : undefined,
        boxShadow: `0 8px 24px ${C.crust}80`,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: `${color}22`,
          color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{name}</div>
        <div style={{ fontSize: 11, color: C.overlay1, marginTop: 1 }}>{role}</div>
      </div>
    </div>
  );
}

function SlideProblem({ active }: { active: boolean }) {
  const tools = [
    { name: "Slack", role: "Team chat", icon: <MessageSquare size={18} />, color: C.peach, rot: -2 },
    { name: "Linear", role: "Tracker", icon: <ListTodo size={18} />, color: C.lavender, rot: 1.5 },
    { name: "GitHub", role: "Code & reviews", icon: <GitBranch size={18} />, color: C.subtext0, rot: -1 },
    { name: "Cursor", role: "IDE + AI", icon: <Code2 size={18} />, color: C.text, rot: 2 },
    { name: "Vercel", role: "Cloud deploys", icon: <Cloud size={18} />, color: C.sky, rot: -1.5 },
    { name: "Sentry", role: "Monitoring", icon: <AlertTriangle size={18} />, color: C.mauve, rot: 1 },
    { name: "Notion", role: "Docs & wiki", icon: <FileText size={18} />, color: C.subtext0, rot: -2 },
  ];

  return (
    <div
      style={{
        height: "100%",
        padding: "0 80px",
        display: "grid",
        gridTemplateColumns: "1fr 1.1fr",
        gap: 56,
        alignItems: "center",
      }}
    >
      <div>
        <Eyebrow color={C.red}>The status quo</Eyebrow>
        <h2 style={{ fontSize: 60, fontWeight: 700, color: C.text, lineHeight: 1.05, letterSpacing: -2, marginBottom: 24 }}>
          Shipping software takes a{" "}
          <GradientText from={C.red} to={C.peach}>
            tower of disconnected tools
          </GradientText>
          .
        </h2>
        <p style={{ fontSize: 18, color: C.subtext0, lineHeight: 1.6, marginBottom: 28 }}>
          Every team licenses, integrates, and trains people on a different patchwork. None
          of the tools share state. None of them let an AI agent see the whole picture.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[
            { label: "Context shatters between tools", color: C.red },
            { label: "AI agents only see one slice", color: C.peach },
            { label: "Non-technical teammates locked out", color: C.yellow },
          ].map((row, i) => (
            <div
              key={row.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "14px 16px",
                borderRadius: 12,
                background: `${row.color}0c`,
                borderLeft: `3px solid ${row.color}`,
                opacity: active ? 1 : 0,
                animation: active ? `fadeUp 0.4s ease-out ${0.5 + i * 0.08}s both` : undefined,
              }}
            >
              <X size={14} color={row.color} strokeWidth={3} />
              <span style={{ fontSize: 15, color: C.text }}>{row.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, alignContent: "center" }}>
        <DotGrid opacity={0.08} />
        {tools.map((t, i) => (
          <ToolChip
            key={t.name}
            name={t.name}
            role={t.role}
            color={t.color}
            icon={t.icon}
            active={active}
            delay={0.1 + i * 0.06}
            rotate={t.rot}
          />
        ))}
        {/* "And more..." */}
        <div
          style={{
            padding: "14px 18px",
            borderRadius: 14,
            background: "transparent",
            border: `1.5px dashed ${C.surface2}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: C.overlay1,
            fontSize: 13,
            fontStyle: "italic",
            opacity: active ? 1 : 0,
            animation: active ? `fadeUp 0.5s ease-out ${0.1 + tools.length * 0.06}s both` : undefined,
          }}
        >
          + more tickets to license…
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Slide 03 — One platform replaces them all
   ───────────────────────────────────────────────────────────── */
function SlideSolution({ active }: { active: boolean }) {
  const replaced = [
    { name: "Slack", icon: <MessageSquare size={14} />, color: C.peach },
    { name: "Linear", icon: <ListTodo size={14} />, color: C.lavender },
    { name: "GitHub", icon: <GitBranch size={14} />, color: C.subtext0 },
    { name: "Cursor", icon: <Code2 size={14} />, color: C.text },
    { name: "Vercel", icon: <Cloud size={14} />, color: C.sky },
    { name: "Sentry", icon: <AlertTriangle size={14} />, color: C.mauve },
    { name: "Notion", icon: <FileText size={14} />, color: C.subtext0 },
  ];

  const pillars = [
    { icon: <MessageSquare size={20} />, label: "Chat", color: C.peach },
    { icon: <ListTodo size={20} />, label: "Tracker", color: C.lavender },
    { icon: <Code2 size={20} />, label: "Code", color: C.teal },
    { icon: <Cloud size={20} />, label: "Cloud", color: C.blue },
    { icon: <Bot size={20} />, label: "AI Agent", color: C.mauve },
  ];

  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        padding: "0 80px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <DotGrid opacity={0.07} />
      <Eyebrow color={C.green}>The solution</Eyebrow>
      <h2 style={{ fontSize: 60, fontWeight: 700, color: C.text, lineHeight: 1.05, letterSpacing: -2, marginBottom: 24, maxWidth: 1050 }}>
        One workspace.{" "}
        <GradientText from={C.green} to={C.teal}>
          Everyone in the same room
        </GradientText>
        .
      </h2>
      <p style={{ fontSize: 19, color: C.subtext0, maxWidth: 800, lineHeight: 1.55, marginBottom: 48 }}>
        Genie collapses the tool stack into a single place where the team talks, tracks work,
        writes code, runs production — and where an AI agent has full context to actually help.
      </p>

      {/* Replaced row → → → Genie center → → → Pillars row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          gap: 40,
          alignItems: "center",
          marginTop: 8,
        }}
      >
        {/* Replaced tools */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "flex-end" }}>
          {replaced.map((r, i) => (
            <div
              key={r.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                borderRadius: 99,
                background: C.mantle,
                border: `1px solid ${C.surface1}`,
                fontSize: 13,
                color: C.subtext0,
                textDecoration: "line-through",
                textDecorationColor: C.red + "aa",
                textDecorationThickness: 1.5,
                opacity: active ? 0.7 : 0,
                animation: active ? `fadeUp 0.4s ease-out ${0.15 + i * 0.05}s both` : undefined,
              }}
            >
              <span style={{ color: r.color, opacity: 0.7 }}>{r.icon}</span>
              {r.name}
            </div>
          ))}
        </div>

        {/* Center: Genie target */}
        <div
          style={{
            position: "relative",
            width: 140,
            height: 140,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: active ? 1 : 0,
            animation: active ? "fadeUp 0.6s ease-out 0.4s both" : undefined,
          }}
        >
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: -30,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${C.mauve}45 0%, transparent 70%)`,
              filter: "blur(10px)",
            }}
          />
          <div
            style={{
              position: "relative",
              width: 120,
              height: 120,
              borderRadius: 32,
              background: `linear-gradient(135deg, ${C.mauve}, ${C.blue})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: `0 20px 50px ${C.mauve}55, inset 0 0 0 1px ${C.mauve}80`,
            }}
          >
            <Zap size={56} fill={C.crust} stroke={C.crust} strokeWidth={2.5} />
          </div>
        </div>

        {/* Pillars */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {pillars.map((p, i) => (
            <div
              key={p.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 16px",
                borderRadius: 12,
                background: `${p.color}14`,
                border: `1px solid ${p.color}40`,
                opacity: active ? 1 : 0,
                animation: active ? `fadeUp 0.4s ease-out ${0.6 + i * 0.08}s both` : undefined,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 9,
                  background: `${p.color}25`,
                  color: p.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {p.icon}
              </div>
              <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{p.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Slide 04 — Inside the platform (product surface)
   ───────────────────────────────────────────────────────────── */
function PanelMock({
  icon,
  title,
  color,
  rows,
  active,
  delay,
}: {
  icon: React.ReactNode;
  title: string;
  color: string;
  rows: { text: string; muted?: boolean; tag?: string; tagColor?: string }[];
  active: boolean;
  delay: number;
}) {
  return (
    <div
      style={{
        padding: "18px 18px",
        borderRadius: 14,
        background: C.surface0,
        border: `1px solid ${C.surface1}`,
        display: "flex",
        flexDirection: "column",
        opacity: active ? 1 : 0,
        animation: active ? `fadeUp 0.45s ease-out ${delay}s both` : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: `${color}22`,
            color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {icon}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{title}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r, i) => (
          <div
            key={i}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              background: C.mantle,
              fontSize: 12,
              color: r.muted ? C.overlay1 : C.text,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.text}</span>
            {r.tag && (
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: 99,
                  fontSize: 10,
                  fontWeight: 600,
                  background: `${r.tagColor || color}22`,
                  color: r.tagColor || color,
                  flexShrink: 0,
                }}
              >
                {r.tag}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SlideProduct({ active }: { active: boolean }) {
  return (
    <div style={{ height: "100%", padding: "0 80px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <SlideHeader
        eyebrow="Inside the platform"
        eyebrowColor={C.lavender}
        title={
          <>
            Every surface a software team needs —{" "}
            <GradientText from={C.lavender} to={C.mauve}>
              in one shell
            </GradientText>
          </>
        }
        subtitle="Chat, tracker, code, cloud, monitoring — and the AI agent that ties them together. Identity, billing, and audit log are unified."
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        <PanelMock
          icon={<MessageSquare size={14} />}
          title="Team chat"
          color={C.peach}
          active={active}
          delay={0.15}
          rows={[
            { text: "@genie ship the auth fix", tag: "you", tagColor: C.peach },
            { text: "Opened PR #482", muted: true, tag: "agent", tagColor: C.mauve },
            { text: "Reviewed and merged", muted: true },
          ]}
        />
        <PanelMock
          icon={<ListTodo size={14} />}
          title="Tracker"
          color={C.lavender}
          active={active}
          delay={0.25}
          rows={[
            { text: "Fix login redirect loop", tag: "in review", tagColor: C.yellow },
            { text: "Add SSO for enterprise", tag: "doing", tagColor: C.blue },
            { text: "Pricing page polish", tag: "done", tagColor: C.green },
          ]}
        />
        <PanelMock
          icon={<Code2 size={14} />}
          title="Code & terminal"
          color={C.teal}
          active={active}
          delay={0.35}
          rows={[
            { text: "src/auth/session.ts" },
            { text: "$ npm test", muted: true },
            { text: "All tests pass", tag: "ok", tagColor: C.green },
          ]}
        />
        <PanelMock
          icon={<Cloud size={14} />}
          title="Cloud & live VPS"
          color={C.blue}
          active={active}
          delay={0.45}
          rows={[
            { text: "production · healthy", tag: "live", tagColor: C.green },
            { text: "cpu 14%  mem 41%", muted: true },
            { text: "logs · last 5m", muted: true },
          ]}
        />
      </div>

      {/* AI agent thread underneath spanning the row */}
      <div
        style={{
          marginTop: 18,
          padding: "18px 22px",
          borderRadius: 14,
          background: `linear-gradient(135deg, ${C.mauve}12, ${C.blue}08)`,
          border: `1px solid ${C.mauve}40`,
          display: "flex",
          alignItems: "center",
          gap: 16,
          opacity: active ? 1 : 0,
          animation: active ? "fadeUp 0.5s ease-out 0.6s both" : undefined,
        }}
      >
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 11,
            background: `linear-gradient(135deg, ${C.mauve}, ${C.blue})`,
            color: C.crust,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Bot size={20} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.mauve, marginBottom: 3, letterSpacing: 0.5 }}>
            AI AGENT · running across every surface
          </div>
          <div style={{ fontSize: 14, color: C.text, lineHeight: 1.5 }}>
            Reads the ticket. Writes the code. Runs the tests. Opens the PR. Deploys to staging.
            Pings the team in chat when it's ready for review.
          </div>
        </div>
        <Sparkles size={16} color={C.mauve} />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Slide 05 — 10× for developers
   ───────────────────────────────────────────────────────────── */
function BigTenX({ active, color }: { active: boolean; color: string }) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "baseline",
        justifyContent: "center",
        lineHeight: 0.85,
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: -40,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${color}30 0%, transparent 65%)`,
          filter: "blur(20px)",
        }}
      />
      <span
        style={{
          position: "relative",
          fontSize: 260,
          fontWeight: 800,
          letterSpacing: -10,
          color: C.text,
          background: `linear-gradient(135deg, ${color}, ${C.text})`,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}
      >
        <AnimatedNumber value={10} active={active} duration={1100} />
      </span>
      <span
        style={{
          position: "relative",
          fontSize: 180,
          fontWeight: 700,
          color,
          marginLeft: 4,
          letterSpacing: -4,
        }}
      >
        ×
      </span>
    </div>
  );
}

function SlideDevs({ active }: { active: boolean }) {
  const wins = [
    {
      icon: <Bot size={18} />,
      title: "Agent has full context",
      desc: "Tracker, repo, chat history, live infra — all in one prompt. No more pasting between tabs.",
      color: C.mauve,
    },
    {
      icon: <Terminal size={18} />,
      title: "Ship from anywhere",
      desc: "\"Deploy\" / \"scan\" / \"show logs\" from the same chat that holds your tickets and PRs.",
      color: C.teal,
    },
    {
      icon: <Layers size={18} />,
      title: "One identity, one audit",
      desc: "No bouncing between seven dashboards. SSO, permissions, and history live in one place.",
      color: C.blue,
    },
    {
      icon: <Sparkles size={18} />,
      title: "The boring work is gone",
      desc: "Tracker hygiene, status updates, deploy babysitting — all handled by the agent.",
      color: C.green,
    },
  ];

  return (
    <div
      style={{
        height: "100%",
        padding: "0 80px",
        display: "grid",
        gridTemplateColumns: "1fr 1.05fr",
        gap: 56,
        alignItems: "center",
      }}
    >
      <div>
        <Eyebrow color={C.mauve}>For developers</Eyebrow>
        <h2 style={{ fontSize: 52, fontWeight: 700, color: C.text, lineHeight: 1.05, letterSpacing: -2, marginBottom: 28 }}>
          Ship{" "}
          <GradientText from={C.mauve} to={C.blue}>
            10×
          </GradientText>{" "}
          faster, without the tool tax.
        </h2>
        <p style={{ fontSize: 17, color: C.subtext0, lineHeight: 1.6, marginBottom: 28 }}>
          Most of a developer's day is not writing code — it's hunting for context, switching
          tabs, updating tickets, watching deploys. Genie collapses all of that into one
          continuous loop the agent can run.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {wins.map((w, i) => (
            <div
              key={w.title}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
                padding: "14px 16px",
                borderRadius: 12,
                background: C.surface0,
                border: `1px solid ${C.surface1}`,
                opacity: active ? 1 : 0,
                animation: active ? `fadeUp 0.4s ease-out ${0.15 + i * 0.08}s both` : undefined,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: `${w.color}20`,
                  color: w.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {w.icon}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 2 }}>{w.title}</div>
                <div style={{ fontSize: 13, color: C.subtext0, lineHeight: 1.5 }}>{w.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <DotGrid opacity={0.07} />
        <BigTenX active={active} color={C.mauve} />
        <div
          style={{
            position: "relative",
            padding: "8px 18px",
            borderRadius: 99,
            background: `${C.mauve}18`,
            border: `1px solid ${C.mauve}40`,
            color: C.mauve,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 1,
            opacity: active ? 1 : 0,
            animation: active ? "fadeUp 0.5s ease-out 0.5s both" : undefined,
          }}
        >
          DEVELOPER PRODUCTIVITY
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Slide 06 — 10× for non-tech users
   ───────────────────────────────────────────────────────────── */
function SlideNonTech({ active }: { active: boolean }) {
  const personas = [
    {
      icon: <Briefcase size={18} />,
      role: "Product manager",
      verb: "Writes a ticket → ships the fix.",
      desc: "Describes the change in plain English. Genie's agent writes the code and opens a review.",
      color: C.lavender,
    },
    {
      icon: <PenTool size={18} />,
      role: "Designer",
      verb: "Drops a screenshot → matches the layout.",
      desc: "Hands the agent a mockup. It restyles components and shows the live preview in the same window.",
      color: C.pink,
    },
    {
      icon: <Crown size={18} />,
      role: "Founder",
      verb: "Runs the roadmap from chat.",
      desc: "Talks to the team and the agent in the same thread. Decisions become tickets become commits.",
      color: C.yellow,
    },
    {
      icon: <Wrench size={18} />,
      role: "Ops / support",
      verb: "Closes incidents without a ticket.",
      desc: "Describes the bug from a customer. Agent reproduces, ships the patch, replies to the user.",
      color: C.teal,
    },
  ];

  return (
    <div
      style={{
        height: "100%",
        padding: "0 80px",
        display: "grid",
        gridTemplateColumns: "1.05fr 1fr",
        gap: 56,
        alignItems: "center",
      }}
    >
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <DotGrid opacity={0.07} />
        <BigTenX active={active} color={C.blue} />
        <div
          style={{
            position: "relative",
            padding: "8px 18px",
            borderRadius: 99,
            background: `${C.blue}18`,
            border: `1px solid ${C.blue}40`,
            color: C.blue,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 1,
            opacity: active ? 1 : 0,
            animation: active ? "fadeUp 0.5s ease-out 0.5s both" : undefined,
          }}
        >
          NON-TECHNICAL CONTRIBUTORS
        </div>
      </div>

      <div>
        <Eyebrow color={C.blue}>For everyone else</Eyebrow>
        <h2 style={{ fontSize: 52, fontWeight: 700, color: C.text, lineHeight: 1.05, letterSpacing: -2, marginBottom: 24 }}>
          Anyone on the team can{" "}
          <GradientText from={C.blue} to={C.teal}>
            ship software
          </GradientText>
          .
        </h2>
        <p style={{ fontSize: 17, color: C.subtext0, lineHeight: 1.6, marginBottom: 28 }}>
          Product, design, ops, founders — the people who know what's broken are usually the
          last to fix it. Genie lets them describe a change and watch it ship, with the agent
          doing the work and a developer optionally reviewing.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {personas.map((p, i) => (
            <div
              key={p.role}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
                padding: "14px 16px",
                borderRadius: 12,
                background: C.surface0,
                border: `1px solid ${C.surface1}`,
                opacity: active ? 1 : 0,
                animation: active ? `fadeUp 0.4s ease-out ${0.15 + i * 0.08}s both` : undefined,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: `${p.color}20`,
                  color: p.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {p.icon}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: p.color, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>
                  {p.role}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 3 }}>
                  {p.verb}
                </div>
                <div style={{ fontSize: 13, color: C.subtext0, lineHeight: 1.5 }}>{p.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Slide 07 — Why a single platform wins (moat)
   ───────────────────────────────────────────────────────────── */
function SlideMoat({ active }: { active: boolean }) {
  // Two contexts: limited vs full
  return (
    <div style={{ height: "100%", padding: "0 80px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <SlideHeader
        eyebrow="Why this wins"
        eyebrowColor={C.green}
        title={
          <>
            The agent that sees{" "}
            <GradientText from={C.green} to={C.teal}>
              everything
            </GradientText>{" "}
            beats the one that sees a slice.
          </>
        }
        subtitle="An AI agent is only as good as the context it can read and the surface it can act on. Single-purpose tools cap themselves. Genie doesn't."
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Single-purpose tool */}
        <div
          style={{
            padding: "24px 24px",
            borderRadius: 18,
            background: C.surface0,
            border: `1px solid ${C.surface1}`,
            opacity: active ? 1 : 0,
            animation: active ? "fadeUp 0.5s ease-out 0.15s both" : undefined,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: C.red, letterSpacing: 1, marginBottom: 14 }}>
            SINGLE-PURPOSE TOOL
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 16, lineHeight: 1.2 }}>
            Sees only its own surface.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { label: "Repo", has: true },
              { label: "Tickets", has: false },
              { label: "Team chat", has: false },
              { label: "Live infra", has: false },
              { label: "Customer messages", has: false },
              { label: "Deploy state", has: false },
            ].map((row) => (
              <div
                key={row.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: row.has ? `${C.green}10` : C.mantle,
                }}
              >
                {row.has ? (
                  <Check size={14} color={C.green} strokeWidth={3} />
                ) : (
                  <Minus size={14} color={C.overlay0} strokeWidth={3} />
                )}
                <span
                  style={{
                    fontSize: 14,
                    color: row.has ? C.text : C.overlay1,
                    textDecoration: row.has ? "none" : "line-through",
                    textDecorationColor: C.overlay0,
                  }}
                >
                  {row.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Genie */}
        <div
          style={{
            position: "relative",
            padding: "24px 24px",
            borderRadius: 18,
            background: `linear-gradient(160deg, ${C.mauve}10, ${C.surface0})`,
            border: `1.5px solid ${C.mauve}80`,
            boxShadow: `0 16px 48px ${C.mauve}25`,
            opacity: active ? 1 : 0,
            animation: active ? "fadeUp 0.5s ease-out 0.3s both" : undefined,
          }}
        >
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: -40,
              right: -40,
              width: 160,
              height: 160,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${C.mauve}30 0%, transparent 70%)`,
              filter: "blur(20px)",
            }}
          />
          <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.mauve, letterSpacing: 1 }}>
              GENIE
            </div>
            <Zap size={14} fill={C.mauve} stroke="none" />
          </div>
          <div style={{ position: "relative", fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 16, lineHeight: 1.2 }}>
            Sees the whole team.
          </div>
          <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 8 }}>
            {["Repo", "Tickets", "Team chat", "Live infra", "Customer messages", "Deploy state"].map((label) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: `${C.green}10`,
                }}
              >
                <Check size={14} color={C.green} strokeWidth={3} />
                <span style={{ fontSize: 14, color: C.text }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 24,
          padding: "14px 20px",
          borderRadius: 12,
          background: `linear-gradient(135deg, ${C.green}0e, ${C.teal}06)`,
          border: `1px solid ${C.green}33`,
          display: "flex",
          alignItems: "center",
          gap: 12,
          opacity: active ? 1 : 0,
          animation: active ? "fadeUp 0.4s ease-out 0.55s both" : undefined,
        }}
      >
        <Sparkles size={16} color={C.green} />
        <div style={{ fontSize: 14, color: C.text }}>
          More context in →{" "}
          <span style={{ color: C.green, fontWeight: 700 }}>better decisions out</span>. The
          single platform compounds, the patchwork can't.
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Slide 08 — Vision
   ───────────────────────────────────────────────────────────── */
function SlideVision({ active }: { active: boolean }) {
  const horizons = [
    {
      tag: "Today",
      title: "The cockpit for software teams",
      desc: "Dev, product, design and ops working with one AI agent that ships real code on real infra.",
      icon: <Users size={20} />,
      color: C.mauve,
    },
    {
      tag: "Next",
      title: "Every product team builds software",
      desc: "Marketing pages, internal tools, customer dashboards — described once, shipped from the same workspace.",
      icon: <Layers size={20} />,
      color: C.blue,
    },
    {
      tag: "Eventually",
      title: "Any organization authors software",
      desc: "Software stops being something only engineers make. It becomes how every team expresses its work.",
      icon: <Globe size={20} />,
      color: C.teal,
    },
  ];

  return (
    <div style={{ height: "100%", padding: "0 80px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <SlideHeader
        eyebrow="Where this goes"
        eyebrowColor={C.peach}
        title={
          <>
            From <GradientText from={C.mauve} to={C.blue}>dev teams</GradientText> today to{" "}
            <GradientText from={C.blue} to={C.teal}>every team</GradientText> tomorrow.
          </>
        }
        subtitle="The same platform expands outward as more of the work that used to require an engineer can be authored in chat."
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {horizons.map((h, i) => (
          <div
            key={h.tag}
            style={{
              padding: "26px 24px",
              borderRadius: 18,
              background: `linear-gradient(160deg, ${h.color}10, ${C.surface0})`,
              border: `1px solid ${h.color}40`,
              position: "relative",
              overflow: "hidden",
              opacity: active ? 1 : 0,
              animation: active ? `fadeUp 0.5s ease-out ${0.15 + i * 0.12}s both` : undefined,
            }}
          >
            <div
              aria-hidden
              style={{
                position: "absolute",
                top: -50,
                right: -50,
                width: 140,
                height: 140,
                borderRadius: "50%",
                background: `radial-gradient(circle, ${h.color}30 0%, transparent 60%)`,
              }}
            />
            <div
              style={{
                position: "relative",
                width: 48,
                height: 48,
                borderRadius: 13,
                background: `${h.color}22`,
                color: h.color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 18,
              }}
            >
              {h.icon}
            </div>
            <div style={{ position: "relative", fontSize: 11, fontWeight: 700, color: h.color, letterSpacing: 1.5, marginBottom: 6 }}>
              {h.tag.toUpperCase()}
            </div>
            <h3 style={{ position: "relative", fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 10, lineHeight: 1.2 }}>
              {h.title}
            </h3>
            <p style={{ position: "relative", fontSize: 14, color: C.subtext0, lineHeight: 1.55 }}>{h.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Slide 09 — Closing
   ───────────────────────────────────────────────────────────── */
function SlideClosing({ active }: { active: boolean }) {
  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        overflow: "hidden",
        padding: "0 80px",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          width: 1000,
          height: 1000,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${C.blue}1f 0%, ${C.mauve}10 40%, transparent 70%)`,
          filter: "blur(50px)",
          bottom: -200,
        }}
      />
      <DotGrid opacity={0.12} />

      <div
        style={{
          position: "relative",
          opacity: active ? 1 : 0,
          animation: active ? "fadeUp 0.6s ease-out 0.1s both" : undefined,
        }}
      >
        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: 24,
            background: `linear-gradient(135deg, ${C.mauve}, ${C.blue})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 32px",
            boxShadow: `0 20px 60px ${C.mauve}50`,
          }}
        >
          <Zap size={44} fill={C.crust} stroke={C.crust} strokeWidth={2.5} />
        </div>
      </div>

      <h2
        style={{
          position: "relative",
          fontSize: 80,
          fontWeight: 800,
          letterSpacing: -3,
          lineHeight: 1.05,
          maxWidth: 1100,
          marginBottom: 28,
          opacity: active ? 1 : 0,
          animation: active ? "fadeUp 0.7s ease-out 0.25s both" : undefined,
        }}
      >
        One workspace.
        <br />
        <GradientText from={C.mauve} to={C.blue}>
          One team.
        </GradientText>{" "}
        Software, shipped.
      </h2>

      <p
        style={{
          position: "relative",
          fontSize: 20,
          color: C.subtext0,
          maxWidth: 740,
          lineHeight: 1.6,
          marginBottom: 40,
          opacity: active ? 1 : 0,
          animation: active ? "fadeUp 0.7s ease-out 0.4s both" : undefined,
        }}
      >
        Genie replaces the patchwork your team uses today and gives the AI agent everything
        it needs to do the boring work, so people can stay in flow.
      </p>

      <div
        style={{
          position: "relative",
          display: "flex",
          gap: 12,
          opacity: active ? 1 : 0,
          animation: active ? "fadeUp 0.7s ease-out 0.55s both" : undefined,
        }}
      >
        <div
          style={{
            padding: "14px 28px",
            borderRadius: 12,
            background: `linear-gradient(135deg, ${C.mauve}, ${C.blue})`,
            color: C.crust,
            fontSize: 15,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <ArrowRight size={16} />
          Get a demo
        </div>
        <div
          style={{
            padding: "14px 24px",
            borderRadius: 12,
            background: C.surface0,
            border: `1px solid ${C.surface1}`,
            color: C.text,
            fontSize: 15,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Globe size={16} color={C.blue} />
          genie.teleporthq.ai
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Slide registry
   ───────────────────────────────────────────────────────────── */
interface SlideMeta {
  id: string;
  title: string;
  render: (props: { active: boolean }) => React.ReactNode;
}

const slides: SlideMeta[] = [
  { id: "title", title: "Title", render: (p) => <SlideTitle {...p} /> },
  { id: "problem", title: "Fragmented stack", render: (p) => <SlideProblem {...p} /> },
  { id: "solution", title: "One workspace", render: (p) => <SlideSolution {...p} /> },
  { id: "product", title: "Inside Genie", render: (p) => <SlideProduct {...p} /> },
  { id: "devs", title: "10× for devs", render: (p) => <SlideDevs {...p} /> },
  { id: "non-tech", title: "10× for everyone", render: (p) => <SlideNonTech {...p} /> },
  { id: "moat", title: "Why we win", render: (p) => <SlideMoat {...p} /> },
  { id: "vision", title: "Vision", render: (p) => <SlideVision {...p} /> },
  { id: "closing", title: "Closing", render: (p) => <SlideClosing {...p} /> },
];

/* ─────────────────────────────────────────────────────────────
   Presentation shell
   ───────────────────────────────────────────────────────────── */
export default function PresentationPage() {
  const [current, setCurrent] = useState(0);
  const [overview, setOverview] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const go = useCallback((dir: number) => {
    setCurrent((c) => {
      const next = c + dir;
      if (next < 0 || next >= slides.length) return c;
      return next;
    });
  }, []);

  const jump = useCallback((i: number) => {
    setCurrent(Math.max(0, Math.min(slides.length - 1, i)));
    setOverview(false);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "Home") {
        e.preventDefault();
        setCurrent(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setCurrent(slides.length - 1);
      } else if (e.key.toLowerCase() === "o") {
        e.preventDefault();
        setOverview((v) => !v);
      } else if (e.key === "?" || e.key === "/") {
        e.preventDefault();
        setHelpOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOverview(false);
        setHelpOpen(false);
      } else if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen?.().catch(() => {});
        } else {
          document.exitFullscreen?.().catch(() => {});
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const progress = ((current + 1) / slides.length) * 100;
  const slide = slides[current];
  const renderedSlide = useMemo(() => slide.render({ active: true }), [slide]);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: C.base,
        color: C.text,
        fontFamily:
          "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Inter', 'SF Pro Display', 'Helvetica Neue', sans-serif",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        userSelect: "none",
        position: "relative",
      }}
    >
      {/* Top progress bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: C.surface0,
          zIndex: 50,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${progress}%`,
            background: `linear-gradient(90deg, ${C.mauve}, ${C.blue})`,
            transition: "width 0.4s cubic-bezier(0.22, 0.61, 0.36, 1)",
            boxShadow: `0 0 12px ${C.mauve}80`,
          }}
        />
      </div>

      {/* Slide area */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <div
          key={slide.id}
          style={{
            position: "absolute",
            inset: 0,
            padding: "60px 0 40px",
            animation: "slideEnter 0.5s cubic-bezier(0.22, 0.61, 0.36, 1)",
          }}
        >
          {renderedSlide}
        </div>

        {/* Edge click zones */}
        <button
          aria-label="Previous slide"
          onClick={() => go(-1)}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: "8%",
            background: "transparent",
            border: "none",
            cursor: current > 0 ? "pointer" : "default",
            zIndex: 5,
          }}
        />
        <button
          aria-label="Next slide"
          onClick={() => go(1)}
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: "8%",
            background: "transparent",
            border: "none",
            cursor: current < slides.length - 1 ? "pointer" : "default",
            zIndex: 5,
          }}
        />
      </div>

      {/* Bottom bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 32px",
          borderTop: `1px solid ${C.surface0}`,
          background: C.mantle + "ee",
          backdropFilter: "blur(10px)",
          zIndex: 40,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              background: `linear-gradient(135deg, ${C.mauve}, ${C.blue})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Zap size={12} fill={C.crust} stroke="none" />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Genie</span>
          <span style={{ fontSize: 12, color: C.overlay0, marginLeft: 4 }}>· {slide.title}</span>
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {slides.map((s, i) => (
            <button
              key={s.id}
              onClick={() => jump(i)}
              title={s.title}
              style={{
                width: i === current ? 28 : 8,
                height: 8,
                borderRadius: 4,
                border: "none",
                cursor: "pointer",
                background: i === current ? C.mauve : i < current ? C.surface2 : C.surface1,
                transition: "all 0.3s ease",
              }}
            />
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => setOverview(true)}
            title="Overview (O)"
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: `1px solid ${C.surface1}`,
              cursor: "pointer",
              background: C.surface0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: C.subtext0,
            }}
          >
            <Grid3x3 size={14} />
          </button>
          <button
            onClick={() => setHelpOpen(true)}
            title="Shortcuts (?)"
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: `1px solid ${C.surface1}`,
              cursor: "pointer",
              background: C.surface0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: C.subtext0,
            }}
          >
            <Keyboard size={14} />
          </button>
          <span style={{ fontSize: 12, color: C.overlay1, margin: "0 8px", fontVariantNumeric: "tabular-nums" }}>
            {String(current + 1).padStart(2, "0")}{" "}
            <span style={{ color: C.overlay0 }}>/ {String(slides.length).padStart(2, "0")}</span>
          </span>
          <button
            onClick={() => go(-1)}
            disabled={current === 0}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: `1px solid ${C.surface1}`,
              cursor: current === 0 ? "default" : "pointer",
              background: C.surface0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: current === 0 ? 0.3 : 1,
              color: C.text,
            }}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => go(1)}
            disabled={current === slides.length - 1}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: `1px solid ${C.surface1}`,
              cursor: current === slides.length - 1 ? "default" : "pointer",
              background: C.surface0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: current === slides.length - 1 ? 0.3 : 1,
              color: C.text,
            }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Overview overlay */}
      {overview && (
        <div
          onClick={() => setOverview(false)}
          style={{
            position: "absolute",
            inset: 0,
            background: C.crust + "ee",
            backdropFilter: "blur(20px)",
            zIndex: 100,
            padding: "60px 60px 40px",
            overflow: "auto",
            animation: "fadeIn 0.3s ease-out",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
            <h3 style={{ fontSize: 22, color: C.text, fontWeight: 700 }}>All slides</h3>
            <button
              onClick={() => setOverview(false)}
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: C.surface0,
                border: `1px solid ${C.surface1}`,
                color: C.text,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X size={16} />
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            {slides.map((s, i) => (
              <button
                key={s.id}
                onClick={() => jump(i)}
                style={{
                  aspectRatio: "16 / 9",
                  borderRadius: 12,
                  background: C.surface0,
                  border: i === current ? `2px solid ${C.mauve}` : `1px solid ${C.surface1}`,
                  cursor: "pointer",
                  padding: 18,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  textAlign: "left",
                  position: "relative",
                  overflow: "hidden",
                  transition: "transform 0.15s ease",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-2px)")}
                onMouseLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}
              >
                <div style={{ fontSize: 10, color: C.overlay0, fontWeight: 700, letterSpacing: 1 }}>
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{s.title}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Help overlay */}
      {helpOpen && (
        <div
          onClick={() => setHelpOpen(false)}
          style={{
            position: "absolute",
            inset: 0,
            background: C.crust + "cc",
            backdropFilter: "blur(8px)",
            zIndex: 110,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            animation: "fadeIn 0.2s ease-out",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              padding: "28px 32px",
              borderRadius: 16,
              background: C.surface0,
              border: `1px solid ${C.surface1}`,
              minWidth: 360,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 18 }}>Shortcuts</div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "10px 16px", fontSize: 13 }}>
              {[
                ["→ / Space", "Next slide"],
                ["←", "Previous slide"],
                ["Home / End", "First / last slide"],
                ["O", "Slide overview"],
                ["F", "Fullscreen"],
                ["?", "Show this"],
                ["Esc", "Close overlay"],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <kbd
                    style={{
                      fontSize: 12,
                      padding: "2px 8px",
                      borderRadius: 6,
                      background: C.mantle,
                      border: `1px solid ${C.surface1}`,
                      color: C.lavender,
                      fontFamily: "'SF Mono', monospace",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {k}
                  </kbd>
                  <span style={{ color: C.text }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideEnter {
          from { opacity: 0; transform: translateY(16px) scale(0.995); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        button:focus { outline: none; }
        button:focus-visible { outline: 2px solid ${C.mauve}; outline-offset: 2px; }
      `}</style>
    </div>
  );
}
