"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Zap,
  Code2,
  Rocket,
  Activity,
  MessageSquare,
  Bot,
  Terminal,
  Shield,
  Eye,
  Globe,
  Layers,
  Lock,
  Cpu,
  GitBranch,
  ArrowRight,
  Check,
  Sparkles,
  TrendingUp,
  Users,
  Grid3x3,
  Keyboard,
  X,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────────
   Palette — Catppuccin Mocha, with extra named utilities
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
   Reusable primitives
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
          fontSize: 48,
          fontWeight: 700,
          color: C.text,
          lineHeight: 1.1,
          letterSpacing: -1,
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
            maxWidth: 760,
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

/* Animated counter that runs when the slide is active */
function AnimatedNumber({
  value,
  active,
  duration = 1200,
  prefix = "",
  suffix = "",
  format,
}: {
  value: number;
  active: boolean;
  duration?: number;
  prefix?: string;
  suffix?: string;
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

  return (
    <>
      {prefix}
      {format ? format(n) : Math.round(n).toLocaleString()}
      {suffix}
    </>
  );
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
      {/* Ambient radial glow */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          width: 900,
          height: 900,
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
          gap: 14,
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
          INVESTOR BRIEF · SEED ROUND · 2026
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
          fontSize: 28,
          color: C.text,
          maxWidth: 760,
          lineHeight: 1.35,
          fontWeight: 400,
          marginTop: 8,
          opacity: active ? 1 : 0,
          animation: active ? "fadeUp 0.7s ease-out 0.3s both" : undefined,
        }}
      >
        The agent platform for{" "}
        <span style={{ color: C.mauve, fontWeight: 600 }}>building</span>,{" "}
        <span style={{ color: C.blue, fontWeight: 600 }}>shipping</span>, and{" "}
        <span style={{ color: C.teal, fontWeight: 600 }}>operating</span> software.
      </p>

      <div
        style={{
          position: "relative",
          marginTop: 48,
          display: "flex",
          alignItems: "center",
          gap: 16,
          fontSize: 14,
          color: C.overlay1,
          opacity: active ? 1 : 0,
          animation: active ? "fadeUp 0.7s ease-out 0.5s both" : undefined,
        }}
      >
        <span>Paul Brie · Founder & CEO</span>
        <span style={{ width: 4, height: 4, borderRadius: 2, background: C.overlay0 }} />
        <span>Previously TeleportHQ</span>
        <span style={{ width: 4, height: 4, borderRadius: 2, background: C.overlay0 }} />
        <span>paul.brie@teleporthq.io</span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Slide 02 — Inflection point / Why now
   ───────────────────────────────────────────────────────────── */
function SlideInflection({ active }: { active: boolean }) {
  const milestones = [
    { year: "1985", label: "The IDE", desc: "Borland, Visual Studio", color: C.overlay1 },
    { year: "2008", label: "Cloud", desc: "AWS, Heroku, Vercel", color: C.overlay1 },
    { year: "2022", label: "Copilots", desc: "GitHub Copilot, ChatGPT", color: C.sapphire },
    { year: "2025", label: "Agents", desc: "Claude · MCP · SWE-bench", color: C.mauve },
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
      <DotGrid opacity={0.08} />
      <Eyebrow color={C.mauve}>Why now</Eyebrow>
      <h2
        style={{
          fontSize: 64,
          fontWeight: 700,
          color: C.text,
          lineHeight: 1.05,
          letterSpacing: -2,
          marginBottom: 24,
          maxWidth: 1000,
        }}
      >
        In 2025, AI moved from{" "}
        <span style={{ color: C.overlay1, fontStyle: "italic", fontWeight: 500 }}>autocomplete</span>{" "}
        <br />
        to{" "}
        <GradientText from={C.mauve} to={C.blue}>
          autonomous
        </GradientText>
        .
      </h2>
      <p style={{ fontSize: 18, color: C.subtext0, maxWidth: 800, lineHeight: 1.55, marginBottom: 56 }}>
        Three forces converged this year: frontier models cleared 70%+ on SWE-bench, MCP
        standardized agent tooling, and the first $1B+ AI dev companies emerged. We are at
        the start of a 20-year platform shift.
      </p>

      {/* Timeline */}
      <div style={{ position: "relative", marginTop: 8 }}>
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            right: 12,
            height: 2,
            background: `linear-gradient(90deg, ${C.surface1} 0%, ${C.surface1} 60%, ${C.mauve} 100%)`,
          }}
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 24 }}>
          {milestones.map((m, i) => (
            <div
              key={m.year}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                opacity: active ? 1 : 0,
                animation: active ? `fadeUp 0.5s ease-out ${0.15 + i * 0.12}s both` : undefined,
              }}
            >
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: i === 3 ? `linear-gradient(135deg, ${C.mauve}, ${C.blue})` : C.surface1,
                  border: `4px solid ${C.base}`,
                  marginBottom: 18,
                  boxShadow: i === 3 ? `0 0 24px ${C.mauve}80` : undefined,
                }}
              />
              <div style={{ fontSize: 13, fontWeight: 600, color: m.color, letterSpacing: 0.5 }}>{m.year}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: C.text, marginTop: 4 }}>{m.label}</div>
              <div style={{ fontSize: 13, color: C.overlay1, marginTop: 4 }}>{m.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Slide 03 — The Problem
   ───────────────────────────────────────────────────────────── */
function SlideProblem({ active }: { active: boolean }) {
  const tools = [
    { name: "Cursor · Copilot", role: "Write code", limit: "Trapped in the IDE", color: C.sapphire },
    { name: "Devin · Cognition", role: "Run autonomously", limit: "Opaque, no human in the loop", color: C.mauve },
    { name: "Vercel · Railway", role: "Deploy code", limit: "Agent-blind, no live feedback", color: C.peach },
    { name: "Datadog · Sentry", role: "Observe code", limit: "See problems, can't fix them", color: C.red },
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
        <Eyebrow color={C.red}>The problem</Eyebrow>
        <h2 style={{ fontSize: 56, fontWeight: 700, color: C.text, lineHeight: 1.05, letterSpacing: -2, marginBottom: 28 }}>
          AI can write code. <br />
          <GradientText from={C.red} to={C.peach}>
            Shipping software is everything else.
          </GradientText>
        </h2>
        <p style={{ fontSize: 18, color: C.subtext0, lineHeight: 1.6, marginBottom: 28 }}>
          The agent stack is fragmented. Each tool sees one slice. None can take a feature from{" "}
          <em style={{ color: C.text }}>idea</em> to{" "}
          <em style={{ color: C.text }}>production</em> without a human stitching together
          7+ systems by hand.
        </p>
        <div
          style={{
            padding: "18px 22px",
            borderRadius: 14,
            background: `linear-gradient(135deg, ${C.red}11, ${C.peach}08)`,
            border: `1px solid ${C.red}33`,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: C.red, marginBottom: 6, letterSpacing: 1 }}>
            THE COST
          </div>
          <div style={{ fontSize: 16, color: C.text, lineHeight: 1.5 }}>
            Engineers still spend{" "}
            <span style={{ color: C.peach, fontWeight: 700 }}>~60%</span> of their day on
            non-coding work: deploys, debugging, comms, hand-offs.
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {tools.map((t, i) => (
          <div
            key={t.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 18,
              padding: "20px 22px",
              borderRadius: 14,
              background: C.surface0,
              border: `1px solid ${C.surface1}`,
              opacity: active ? 1 : 0,
              animation: active ? `fadeUp 0.4s ease-out ${0.1 + i * 0.08}s both` : undefined,
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                background: `${t.color}18`,
                color: t.color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                fontSize: 18,
                fontWeight: 700,
                fontFamily: "'SF Mono', monospace",
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: t.color, marginBottom: 2 }}>{t.name}</div>
              <div style={{ fontSize: 14, color: C.text }}>{t.role}</div>
              <div style={{ fontSize: 13, color: C.overlay1, marginTop: 2 }}>{t.limit}</div>
            </div>
            <X size={20} color={C.red} strokeWidth={2.5} style={{ flexShrink: 0, opacity: 0.6 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Slide 04 — The Solution
   ───────────────────────────────────────────────────────────── */
function SlideSolution({ active }: { active: boolean }) {
  const pillars = [
    { icon: <Code2 size={24} />, label: "Code", desc: "Agents read, write, refactor — with full repo context.", color: C.mauve },
    { icon: <Rocket size={24} />, label: "Ship", desc: "One click provisions a VPS. Docker, SSH, firewall — done.", color: C.blue },
    { icon: <Activity size={24} />, label: "Operate", desc: "Live metrics, logs, security scans, in-browser terminals.", color: C.teal },
    { icon: <MessageSquare size={24} />, label: "Collab", desc: "Team chat, real-time review, Slack-native handoffs.", color: C.peach },
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
      <h2 style={{ fontSize: 56, fontWeight: 700, color: C.text, lineHeight: 1.05, letterSpacing: -2, marginBottom: 24, maxWidth: 1000 }}>
        Genie unifies the agent and the{" "}
        <GradientText from={C.green} to={C.teal}>
          infrastructure it works on
        </GradientText>
        .
      </h2>
      <p style={{ fontSize: 19, color: C.subtext0, maxWidth: 820, lineHeight: 1.55, marginBottom: 56 }}>
        One control plane for the entire loop: write code, deploy to a real VPS, observe live
        behavior, and let the agent close issues end-to-end — with humans always in review.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18 }}>
        {pillars.map((p, i) => (
          <div
            key={p.label}
            style={{
              padding: "28px 24px",
              borderRadius: 18,
              background: `linear-gradient(160deg, ${p.color}10, ${C.surface0}cc)`,
              border: `1px solid ${p.color}33`,
              position: "relative",
              overflow: "hidden",
              opacity: active ? 1 : 0,
              animation: active ? `fadeUp 0.5s ease-out ${0.15 + i * 0.1}s both` : undefined,
            }}
          >
            <div
              aria-hidden
              style={{
                position: "absolute",
                top: -40,
                right: -40,
                width: 120,
                height: 120,
                borderRadius: "50%",
                background: `radial-gradient(circle, ${p.color}30 0%, transparent 60%)`,
              }}
            />
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                background: `${p.color}22`,
                color: p.color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 18,
              }}
            >
              {p.icon}
            </div>
            <h3 style={{ fontSize: 24, fontWeight: 700, color: C.text, marginBottom: 6 }}>{p.label}</h3>
            <p style={{ fontSize: 14, color: C.subtext0, lineHeight: 1.5 }}>{p.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Slide 05 — Product surface
   ───────────────────────────────────────────────────────────── */
function SlideProduct({ active }: { active: boolean }) {
  const features = [
    { icon: <Bot size={18} />, title: "AI Chat", desc: "Claude with full VPS access — runs commands, edits files, takes screenshots.", color: C.mauve },
    { icon: <Layers size={18} />, title: "Projects", desc: "Multi-project workspace, live VPS stats, environment & secret management.", color: C.blue },
    { icon: <Terminal size={18} />, title: "Terminals", desc: "Shared in-browser SSH with command library and PTY persistence.", color: C.green },
    { icon: <Rocket size={18} />, title: "Deploy", desc: "One-click DigitalOcean provisioning. Docker, firewall, hot-reload baked in.", color: C.peach },
    { icon: <Activity size={18} />, title: "Live Stats", desc: "CPU, memory, disk, docker containers, process trees — streamed at 5s.", color: C.teal },
    { icon: <Shield size={18} />, title: "Security", desc: "Port scans, web vuln checks, severity-ranked findings, fix workflows.", color: C.red },
    { icon: <Eye size={18} />, title: "Browser Agent", desc: "Chrome extension lets Claude see and act in the user's tabs.", color: C.yellow },
    { icon: <Cpu size={18} />, title: "MCP Servers", desc: "genie-tracker, genie-security, genie-browser — agents that connect.", color: C.pink },
    { icon: <MessageSquare size={18} />, title: "Team Chat", desc: "DMs and rooms, @-mentions for the agent, reactions, presence.", color: C.lavender },
  ];
  return (
    <div style={{ height: "100%", padding: "0 80px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <SlideHeader
        eyebrow="Product"
        eyebrowColor={C.peach}
        title={
          <>
            One pane of glass for{" "}
            <GradientText from={C.peach} to={C.yellow}>
              AI-native development
            </GradientText>
          </>
        }
        subtitle="A single workspace replaces seven SaaS subscriptions — and gives the agent the breadth it needs to actually close work."
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        {features.map((f, i) => (
          <div
            key={f.title}
            style={{
              padding: "18px 18px",
              borderRadius: 12,
              background: C.surface0,
              border: `1px solid ${C.surface1}`,
              transition: "transform 0.2s",
              opacity: active ? 1 : 0,
              animation: active ? `fadeUp 0.35s ease-out ${0.1 + i * 0.04}s both` : undefined,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 9,
                  background: `${f.color}1c`,
                  color: f.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {f.icon}
              </div>
              <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{f.title}</span>
            </div>
            <p style={{ fontSize: 13, color: C.subtext0, lineHeight: 1.5 }}>{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Slide 06 — Architecture
   ───────────────────────────────────────────────────────────── */
function ArchNode({
  x,
  y,
  w,
  h,
  label,
  sub,
  color,
  active,
  delay,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub: string;
  color: string;
  active: boolean;
  delay: number;
}) {
  return (
    <foreignObject
      x={x}
      y={y}
      width={w}
      height={h}
      style={{
        opacity: active ? 1 : 0,
        animation: active ? `fadeUp 0.5s ease-out ${delay}s both` : undefined,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 14,
          background: C.surface0,
          border: `1.5px solid ${color}55`,
          padding: "14px 16px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          boxShadow: `0 8px 24px ${C.crust}80`,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color, marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 12, color: C.subtext0, lineHeight: 1.4 }}>{sub}</div>
      </div>
    </foreignObject>
  );
}

function SlideArchitecture({ active }: { active: boolean }) {
  return (
    <div style={{ height: "100%", padding: "0 80px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <SlideHeader
        eyebrow="Architecture"
        eyebrowColor={C.sapphire}
        title={
          <>
            Why our agents are{" "}
            <GradientText from={C.sapphire} to={C.lavender}>
              10× more capable
            </GradientText>
          </>
        }
        subtitle="The agent runs on the same machine as the code. One SSH session, 40 tool rounds. Credentials never leave the manager."
      />
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 40, alignItems: "center" }}>
        <svg viewBox="0 0 720 360" style={{ width: "100%", height: "auto" }}>
          <defs>
            <linearGradient id="flow1" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={C.blue} stopOpacity="0" />
              <stop offset="50%" stopColor={C.blue} stopOpacity="0.9" />
              <stop offset="100%" stopColor={C.blue} stopOpacity="0" />
            </linearGradient>
            <linearGradient id="flow2" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={C.mauve} stopOpacity="0" />
              <stop offset="50%" stopColor={C.mauve} stopOpacity="0.9" />
              <stop offset="100%" stopColor={C.mauve} stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Connection lines */}
          <line x1="170" y1="80" x2="280" y2="80" stroke={C.surface2} strokeWidth="1.5" strokeDasharray="4 4" />
          <line x1="170" y1="280" x2="280" y2="280" stroke={C.surface2} strokeWidth="1.5" strokeDasharray="4 4" />
          <line x1="430" y1="180" x2="540" y2="180" stroke={C.surface2} strokeWidth="1.5" strokeDasharray="4 4" />
          <line x1="280" y1="120" x2="280" y2="240" stroke={C.surface2} strokeWidth="1.5" strokeDasharray="4 4" />

          {/* Animated pulses along edges (purely decorative) */}
          {active && (
            <>
              <rect x="180" y="78" width="100" height="4" fill="url(#flow1)">
                <animate attributeName="x" from="170" to="200" dur="2.2s" repeatCount="indefinite" />
              </rect>
              <rect x="180" y="278" width="100" height="4" fill="url(#flow2)">
                <animate attributeName="x" from="170" to="200" dur="2.6s" repeatCount="indefinite" />
              </rect>
              <rect x="440" y="178" width="100" height="4" fill="url(#flow1)">
                <animate attributeName="x" from="430" to="460" dur="2.0s" repeatCount="indefinite" />
              </rect>
            </>
          )}

          <ArchNode x={20} y={45} w={150} h={70} label="Web UI" sub="Dashboard · chat" color={C.blue} active={active} delay={0.1} />
          <ArchNode x={20} y={245} w={150} h={70} label="Chrome Ext" sub="Browser agent" color={C.mauve} active={active} delay={0.2} />
          <ArchNode x={280} y={145} w={150} h={70} label="Manager" sub="WS · MCP · DB" color={C.green} active={active} delay={0.3} />
          <ArchNode x={540} y={145} w={160} h={70} label="VPS Agent" sub="Claude on the box" color={C.peach} active={active} delay={0.4} />

          {/* SSH tunnel callout */}
          <foreignObject x="430" y="240" width="180" height="50">
            <div
              style={{
                fontSize: 10,
                color: C.green,
                fontWeight: 600,
                textAlign: "center",
                padding: "6px 10px",
                background: `${C.green}10`,
                border: `1px solid ${C.green}40`,
                borderRadius: 8,
              }}
            >
              <Lock size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
              SSH tunneled — keys never on VPS
            </div>
          </foreignObject>
        </svg>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {[
            { stat: "40", unit: "tool rounds", desc: "per agent turn (vs. 10 over SSH).", color: C.mauve },
            { stat: "1", unit: "SSH session", desc: "Persistent stdio, no handshake overhead.", color: C.blue },
            { stat: "0", unit: "secrets on VPS", desc: "All credentials stay on the manager.", color: C.green },
          ].map((s, i) => (
            <div
              key={s.unit}
              style={{
                padding: "16px 20px",
                borderRadius: 14,
                background: C.surface0,
                border: `1px solid ${C.surface1}`,
                display: "flex",
                alignItems: "baseline",
                gap: 14,
                opacity: active ? 1 : 0,
                animation: active ? `fadeUp 0.5s ease-out ${0.5 + i * 0.1}s both` : undefined,
              }}
            >
              <div style={{ fontSize: 40, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.stat}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 2 }}>{s.unit}</div>
                <div style={{ fontSize: 12, color: C.subtext0 }}>{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Slide 07 — Competitive landscape (2x2)
   ───────────────────────────────────────────────────────────── */
function SlideCompetition({ active }: { active: boolean }) {
  // Layout: quadrants. We label them carefully.
  const players = [
    { name: "VS Code", x: 0.2, y: 0.18, color: C.overlay1 },
    { name: "JetBrains", x: 0.32, y: 0.32, color: C.overlay1 },
    { name: "Cursor", x: 0.28, y: 0.62, color: C.sapphire },
    { name: "Copilot", x: 0.18, y: 0.72, color: C.sapphire },
    { name: "Windsurf", x: 0.36, y: 0.78, color: C.sapphire },
    { name: "Vercel", x: 0.72, y: 0.22, color: C.peach },
    { name: "Railway", x: 0.62, y: 0.32, color: C.peach },
    { name: "Render", x: 0.82, y: 0.16, color: C.peach },
    { name: "Devin", x: 0.6, y: 0.7, color: C.maroon },
    { name: "Replit", x: 0.55, y: 0.55, color: C.maroon },
  ];

  return (
    <div style={{ height: "100%", padding: "0 80px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center" }}>
      <div>
        <Eyebrow color={C.lavender}>Why we win</Eyebrow>
        <h2 style={{ fontSize: 52, fontWeight: 700, color: C.text, lineHeight: 1.05, letterSpacing: -2, marginBottom: 24 }}>
          We own the{" "}
          <GradientText from={C.lavender} to={C.mauve}>
            empty quadrant
          </GradientText>
          .
        </h2>
        <p style={{ fontSize: 17, color: C.subtext0, lineHeight: 1.6, marginBottom: 24 }}>
          IDE-focused tools never touch production. Production tools don't run agents.
          Devin runs autonomously but you can't see what it does. Genie is the only
          platform where an AI agent <em style={{ color: C.text }}>and</em> a human can
          drive a live production system together.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[
            "Full transparency: every tool call visible in real time",
            "Human-in-the-loop review at every checkpoint",
            "Real infra, not sandboxes — the agent ships to production",
          ].map((line) => (
            <div key={line} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  background: `${C.green}22`,
                  color: C.green,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Check size={13} strokeWidth={3} />
              </div>
              <span style={{ fontSize: 14, color: C.text }}>{line}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 2x2 matrix */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "1 / 1",
          background: C.surface0 + "55",
          border: `1px solid ${C.surface1}`,
          borderRadius: 18,
          overflow: "hidden",
        }}
      >
        {/* Quadrant dividers */}
        <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" }}>
          <div style={{ borderRight: `1px dashed ${C.surface2}`, borderBottom: `1px dashed ${C.surface2}` }} />
          <div style={{ borderBottom: `1px dashed ${C.surface2}` }} />
          <div style={{ borderRight: `1px dashed ${C.surface2}` }} />
          <div />
        </div>

        {/* Axis labels */}
        <div style={{ position: "absolute", top: -28, left: "50%", transform: "translateX(-50%)", fontSize: 12, color: C.overlay1, fontWeight: 600, letterSpacing: 1 }}>
          ← IDE-BOUND          PRODUCTION-BOUND →
        </div>
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: -22,
            transform: "rotate(-90deg) translateX(0)",
            transformOrigin: "0 0",
            fontSize: 12,
            color: C.overlay1,
            fontWeight: 600,
            letterSpacing: 1,
            whiteSpace: "nowrap",
          }}
        >
          ← HUMAN-DRIVEN          AI-DRIVEN →
        </div>

        {/* Existing players */}
        {players.map((p) => (
          <div
            key={p.name}
            style={{
              position: "absolute",
              left: `${p.x * 100}%`,
              top: `${p.y * 100}%`,
              transform: "translate(-50%, -50%)",
              padding: "5px 11px",
              borderRadius: 999,
              background: C.mantle,
              border: `1px solid ${p.color}55`,
              fontSize: 11,
              fontWeight: 600,
              color: p.color,
              whiteSpace: "nowrap",
              opacity: active ? 0.9 : 0,
              transition: "opacity 0.3s ease-out",
              transitionDelay: "0.2s",
            }}
          >
            {p.name}
          </div>
        ))}

        {/* Genie target — bottom right, glowing */}
        <div
          style={{
            position: "absolute",
            left: "75%",
            top: "78%",
            transform: "translate(-50%, -50%)",
            opacity: active ? 1 : 0,
            animation: active ? "fadeUp 0.6s ease-out 0.7s both" : undefined,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: -60,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${C.mauve}40 0%, transparent 70%)`,
              filter: "blur(10px)",
            }}
          />
          <div
            style={{
              position: "relative",
              padding: "10px 18px",
              borderRadius: 999,
              background: `linear-gradient(135deg, ${C.mauve}, ${C.blue})`,
              fontSize: 16,
              fontWeight: 700,
              color: C.crust,
              boxShadow: `0 10px 30px ${C.mauve}50`,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Zap size={14} fill={C.crust} stroke="none" />
            Genie
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Slide 08 — Market
   ───────────────────────────────────────────────────────────── */
function SlideMarket({ active }: { active: boolean }) {
  const bars = [
    { label: "SOM · AI dev tools", value: 12, color: C.mauve },
    { label: "SAM · Developer tools", value: 38, color: C.blue },
    { label: "TAM · Cloud + DevOps + dev tools", value: 108, color: C.teal },
  ];
  const max = 120;

  return (
    <div style={{ height: "100%", padding: "0 80px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <SlideHeader
        eyebrow="Market"
        eyebrowColor={C.teal}
        title={
          <>
            A category-defining opportunity at{" "}
            <GradientText from={C.teal} to={C.green}>
              the inflection
            </GradientText>
          </>
        }
        subtitle="Developer tools is now a top-5 enterprise software category. The AI-native slice is doubling YoY — and the platform layer hasn't been won yet."
      />

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 56, alignItems: "center" }}>
        {/* Bar chart */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {bars.map((b, i) => (
            <div key={b.label}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{b.label}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: b.color }}>
                  $<AnimatedNumber value={b.value} active={active} duration={1400} />B
                </span>
              </div>
              <div
                style={{
                  height: 14,
                  width: "100%",
                  background: C.surface0,
                  borderRadius: 7,
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: active ? `${(b.value / max) * 100}%` : "0%",
                    background: `linear-gradient(90deg, ${b.color}aa, ${b.color})`,
                    borderRadius: 7,
                    transition: `width 1.2s cubic-bezier(0.22, 0.61, 0.36, 1) ${0.15 + i * 0.12}s`,
                    boxShadow: `0 0 16px ${b.color}50`,
                  }}
                />
              </div>
            </div>
          ))}
          <p style={{ fontSize: 11, color: C.overlay0, marginTop: 8 }}>
            Sources: Gartner, IDC, public filings, 2024–25 estimates.
          </p>
        </div>

        {/* Tailwinds */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {[
            { stat: "189%", label: "AI dev tools YoY growth", color: C.mauve },
            { stat: "$9B", label: "Cursor valuation (24 months in)", color: C.blue },
            { stat: "92%", label: "of orgs piloting agents by 2026", color: C.teal },
          ].map((m, i) => (
            <div
              key={m.label}
              style={{
                padding: "18px 22px",
                borderRadius: 14,
                background: C.surface0,
                border: `1px solid ${C.surface1}`,
                opacity: active ? 1 : 0,
                animation: active ? `fadeUp 0.4s ease-out ${0.6 + i * 0.1}s both` : undefined,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <TrendingUp size={14} color={m.color} />
                <span style={{ fontSize: 28, fontWeight: 800, color: m.color, letterSpacing: -0.5 }}>{m.stat}</span>
              </div>
              <div style={{ fontSize: 13, color: C.subtext0 }}>{m.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Slide 09 — Business model
   ───────────────────────────────────────────────────────────── */
function SlideBusinessModel({ active }: { active: boolean }) {
  const tiers = [
    {
      tier: "Open Source",
      price: "Free",
      sub: "Self-hosted, single dev",
      color: C.overlay1,
      features: ["Unlimited local projects", "Bring your own VPS", "Bring your own API keys"],
      cta: "MIT license",
    },
    {
      tier: "Team",
      price: "$49",
      unit: "/seat/mo",
      sub: "Managed, multi-user",
      color: C.mauve,
      featured: true,
      features: ["Hosted manager + dashboard", "Shared team workspace", "Audit log + role-based access", "Email support"],
      cta: "Pilots open",
    },
    {
      tier: "Enterprise",
      price: "Custom",
      sub: "On-prem, SSO, SOC2",
      color: C.blue,
      features: ["VPC / on-prem deploy", "SAML SSO, SCIM", "Dedicated success + SLA", "Custom MCP servers"],
      cta: "Contact sales",
    },
  ];
  return (
    <div style={{ height: "100%", padding: "0 80px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <SlideHeader
        eyebrow="Business model"
        eyebrowColor={C.yellow}
        title={
          <>
            Open-source funnel into{" "}
            <GradientText from={C.yellow} to={C.peach}>
              high-margin SaaS
            </GradientText>
          </>
        }
        subtitle="Seat-based SaaS with a free self-hosted OSS edition driving the top of the funnel. Two compounding margin lines on top: managed compute and a future MCP marketplace."
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
        {tiers.map((t, i) => (
          <div
            key={t.tier}
            style={{
              padding: "26px 24px",
              borderRadius: 16,
              background: t.featured ? `linear-gradient(170deg, ${C.mauve}18, ${C.surface0})` : C.surface0,
              border: t.featured ? `1.5px solid ${C.mauve}80` : `1px solid ${C.surface1}`,
              position: "relative",
              transform: t.featured ? "translateY(-10px)" : "none",
              boxShadow: t.featured ? `0 16px 48px ${C.mauve}30` : "none",
              opacity: active ? 1 : 0,
              animation: active ? `fadeUp 0.5s ease-out ${0.15 + i * 0.1}s both` : undefined,
            }}
          >
            {t.featured && (
              <div
                style={{
                  position: "absolute",
                  top: -12,
                  left: 24,
                  padding: "4px 12px",
                  borderRadius: 99,
                  background: `linear-gradient(135deg, ${C.mauve}, ${C.blue})`,
                  fontSize: 11,
                  fontWeight: 700,
                  color: C.crust,
                  letterSpacing: 0.5,
                }}
              >
                FLAGSHIP
              </div>
            )}
            <div style={{ fontSize: 13, fontWeight: 600, color: t.color, marginBottom: 6, letterSpacing: 1, textTransform: "uppercase" }}>
              {t.tier}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 4 }}>
              <span style={{ fontSize: 38, fontWeight: 800, color: C.text, letterSpacing: -1 }}>{t.price}</span>
              {t.unit && <span style={{ fontSize: 14, color: C.overlay1 }}>{t.unit}</span>}
            </div>
            <div style={{ fontSize: 13, color: C.subtext0, marginBottom: 20 }}>{t.sub}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
              {t.features.map((f) => (
                <div key={f} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Check size={14} color={t.color} strokeWidth={3} />
                  <span style={{ fontSize: 13, color: C.text }}>{f}</span>
                </div>
              ))}
            </div>
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                background: `${t.color}15`,
                border: `1px solid ${t.color}33`,
                fontSize: 12,
                fontWeight: 600,
                color: t.color,
                textAlign: "center",
              }}
            >
              {t.cta}
            </div>
          </div>
        ))}
      </div>

      {/* Margin lines */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 24 }}>
        {[
          { icon: <Rocket size={16} />, label: "Managed compute", desc: "VPS + agent minutes margin (~25%)", color: C.green },
          { icon: <Grid3x3 size={16} />, label: "MCP marketplace", desc: "Plugins & templates rev-share (planned 2027)", color: C.pink },
        ].map((m) => (
          <div
            key={m.label}
            style={{
              padding: "14px 18px",
              borderRadius: 12,
              background: `${m.color}0c`,
              border: `1px solid ${m.color}30`,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: `${m.color}22`,
                color: m.color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {m.icon}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{m.label}</div>
              <div style={{ fontSize: 12, color: C.subtext0 }}>{m.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Slide 10 — Traction
   ───────────────────────────────────────────────────────────── */
function SlideTraction({ active }: { active: boolean }) {
  return (
    <div style={{ height: "100%", padding: "0 80px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <SlideHeader
        eyebrow="Traction"
        eyebrowColor={C.green}
        title={
          <>
            Live product. Real workloads.{" "}
            <GradientText from={C.green} to={C.teal}>
              Compounding usage.
            </GradientText>
          </>
        }
        subtitle="The product has been running internal and design-partner workloads for six months. Below is the snapshot we share with prospective customers."
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
        {[
          { v: 14, suffix: "", label: "Design partners", color: C.mauve },
          { v: 1850, suffix: "", label: "Projects deployed", color: C.blue },
          { v: 9300, suffix: "+", label: "Agent hours / mo", color: C.green },
          { v: 4.7, suffix: "/5", label: "User NPS", color: C.peach, format: (n: number) => n.toFixed(1) },
        ].map((m, i) => (
          <div
            key={m.label}
            style={{
              padding: "26px 22px",
              borderRadius: 16,
              background: `linear-gradient(155deg, ${m.color}10, ${C.surface0})`,
              border: `1px solid ${m.color}33`,
              opacity: active ? 1 : 0,
              animation: active ? `fadeUp 0.5s ease-out ${0.1 + i * 0.08}s both` : undefined,
            }}
          >
            <div style={{ fontSize: 44, fontWeight: 800, color: m.color, letterSpacing: -1, lineHeight: 1 }}>
              <AnimatedNumber value={m.v} active={active} duration={1400} suffix={m.suffix} format={m.format} />
            </div>
            <div style={{ fontSize: 13, color: C.subtext0, marginTop: 8 }}>{m.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div
          style={{
            padding: "22px 24px",
            borderRadius: 16,
            background: C.surface0,
            border: `1px solid ${C.surface1}`,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: C.lavender, letterSpacing: 1, marginBottom: 12 }}>
            DESIGN PARTNERS
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {["TeleportHQ", "Medical · early access", "FinTech · undisclosed", "Agency · seed", "AI lab · stealth"].map((p) => (
              <div
                key={p}
                style={{
                  padding: "6px 12px",
                  borderRadius: 99,
                  background: C.mantle,
                  border: `1px solid ${C.surface1}`,
                  fontSize: 12,
                  color: C.text,
                  fontWeight: 500,
                }}
              >
                {p}
              </div>
            ))}
          </div>
        </div>
        <div
          style={{
            padding: "22px 24px",
            borderRadius: 16,
            background: C.surface0,
            border: `1px solid ${C.surface1}`,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: C.peach, letterSpacing: 1, marginBottom: 12 }}>
            VALIDATION
          </div>
          <div style={{ fontSize: 14, color: C.text, lineHeight: 1.6, fontStyle: "italic" }}>
            "Genie cut our deploy + debug cycle from 40 minutes to 4. The agent reads our
            tracker, ships the fix, opens a review — we just approve."
          </div>
          <div style={{ fontSize: 12, color: C.overlay1, marginTop: 10 }}>— Head of Engineering, design partner</div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Slide 11 — Roadmap
   ───────────────────────────────────────────────────────────── */
function SlideRoadmap({ active }: { active: boolean }) {
  const milestones = [
    { q: "Q2 2026", title: "Public beta", desc: "Freemium launch. PLG funnel from OSS to Team.", color: C.green, status: "now" },
    { q: "Q3 2026", title: "Enterprise tier", desc: "SAML SSO, RBAC, audit logs, first 5 paid customers.", color: C.blue },
    { q: "Q4 2026", title: "Marketplace + SOC 2", desc: "MCP plugin store. SOC 2 Type I.", color: C.mauve },
    { q: "Q1 2027", title: "Multi-cloud", desc: "AWS, GCP, Azure. Bring-your-own-cloud deploys.", color: C.peach },
    { q: "Q2 2027", title: "On-prem GA", desc: "SOC 2 Type II. Enterprise on-prem GA. Series A ready.", color: C.pink },
  ];
  return (
    <div style={{ height: "100%", padding: "0 80px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <SlideHeader
        eyebrow="Roadmap"
        eyebrowColor={C.peach}
        title={
          <>
            From beta to{" "}
            <GradientText from={C.peach} to={C.pink}>
              Series A
            </GradientText>{" "}
            in 12 months
          </>
        }
        subtitle="Five public milestones, each tied to a revenue or distribution unlock."
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14, position: "relative" }}>
        {/* Connecting line */}
        <div
          style={{
            position: "absolute",
            top: 32,
            left: 32,
            right: 32,
            height: 2,
            background: `linear-gradient(90deg, ${C.green}, ${C.blue}, ${C.mauve}, ${C.peach}, ${C.pink})`,
            opacity: 0.4,
          }}
        />
        {milestones.map((m, i) => (
          <div
            key={m.q}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              opacity: active ? 1 : 0,
              animation: active ? `fadeUp 0.4s ease-out ${0.15 + i * 0.1}s both` : undefined,
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: m.status === "now" ? m.color : C.mantle,
                border: `2px solid ${m.color}`,
                marginLeft: 21,
                marginBottom: 18,
                marginTop: 22,
                position: "relative",
                boxShadow: m.status === "now" ? `0 0 16px ${m.color}80` : undefined,
              }}
            >
              {m.status === "now" && (
                <div
                  style={{
                    position: "absolute",
                    inset: -8,
                    borderRadius: "50%",
                    border: `2px solid ${m.color}`,
                    opacity: 0.5,
                    animation: "pulse 2s ease-in-out infinite",
                  }}
                />
              )}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: m.color, letterSpacing: 1, marginBottom: 6 }}>{m.q}</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.text, lineHeight: 1.2, marginBottom: 6 }}>{m.title}</div>
            <div style={{ fontSize: 12, color: C.subtext0, lineHeight: 1.5 }}>{m.desc}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 40,
          padding: "18px 22px",
          borderRadius: 12,
          background: `linear-gradient(135deg, ${C.mauve}10, ${C.blue}06)`,
          border: `1px solid ${C.mauve}33`,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <Sparkles size={18} color={C.mauve} />
        <div style={{ fontSize: 14, color: C.text }}>
          Target by EOY 2026:{" "}
          <span style={{ color: C.mauve, fontWeight: 700 }}>$1.2M ARR</span> · 30 paying teams · 1,200 self-hosted installs.
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Slide 12 — Team
   ───────────────────────────────────────────────────────────── */
function TeamCard({ name, role, bio, color, active, delay }: { name: string; role: string; bio: string; color: string; active: boolean; delay: number }) {
  const initials = name.split(" ").map((n) => n[0]).join("").slice(0, 2);
  return (
    <div
      style={{
        padding: "26px 24px",
        borderRadius: 16,
        background: C.surface0,
        border: `1px solid ${C.surface1}`,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        opacity: active ? 1 : 0,
        animation: active ? `fadeUp 0.45s ease-out ${delay}s both` : undefined,
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: `linear-gradient(135deg, ${color}, ${color}88)`,
          color: C.crust,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 22,
          fontWeight: 700,
        }}
      >
        {initials}
      </div>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{name}</div>
        <div style={{ fontSize: 13, color, fontWeight: 600, marginTop: 2 }}>{role}</div>
      </div>
      <div style={{ fontSize: 13, color: C.subtext0, lineHeight: 1.55 }}>{bio}</div>
    </div>
  );
}

function SlideTeam({ active }: { active: boolean }) {
  return (
    <div style={{ height: "100%", padding: "0 80px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <SlideHeader
        eyebrow="Team"
        eyebrowColor={C.pink}
        title={
          <>
            Operators who have{" "}
            <GradientText from={C.pink} to={C.mauve}>
              already built this market
            </GradientText>
          </>
        }
        subtitle="A founding team with prior dev-tools exits, deep agent / LLM systems experience, and direct relationships across the design-partner pipeline."
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
        <TeamCard
          name="Paul Brie"
          role="Founder & CEO"
          color={C.mauve}
          active={active}
          delay={0.15}
          bio="Co-founded TeleportHQ — visual code generation platform used by thousands of teams. 15+ years building developer tools. Leads product & vision."
        />
        <TeamCard
          name="Co-founder · CTO"
          role="Engineering"
          color={C.blue}
          active={active}
          delay={0.25}
          bio="To be announced. Distributed systems lead from a top AI infrastructure company. Owns the agent runtime, MCP, and platform engineering."
        />
        <TeamCard
          name="Founding Engineer"
          role="Agent platform"
          color={C.teal}
          active={active}
          delay={0.35}
          bio="Open seat. We have offers out. Looking for an applied-LLM engineer who has shipped agent infrastructure in production."
        />
      </div>

      <div
        style={{
          marginTop: 28,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderRadius: 12,
            background: C.surface0,
            border: `1px solid ${C.surface1}`,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: C.yellow, letterSpacing: 1, marginBottom: 8 }}>
            ADVISORS
          </div>
          <div style={{ fontSize: 13, color: C.subtext0, lineHeight: 1.6 }}>
            Active advisors from <span style={{ color: C.text }}>Anthropic</span>,{" "}
            <span style={{ color: C.text }}>Vercel</span>, and a leading EU venture studio —
            named on request.
          </div>
        </div>
        <div
          style={{
            padding: "16px 20px",
            borderRadius: 12,
            background: C.surface0,
            border: `1px solid ${C.surface1}`,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: C.green, letterSpacing: 1, marginBottom: 8 }}>
            HIRING WITH THE ROUND
          </div>
          <div style={{ fontSize: 13, color: C.subtext0, lineHeight: 1.6 }}>
            6 engineering, 1 design, 1 GTM — all roles scoped and pipelined. First 3 hires
            already in final rounds.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Slide 13 — The Ask
   ───────────────────────────────────────────────────────────── */
function SlideAsk({ active }: { active: boolean }) {
  const allocation = [
    { label: "Engineering — 6 hires", pct: 65, color: C.mauve },
    { label: "GTM & growth", pct: 20, color: C.blue },
    { label: "Security, SOC 2, infra", pct: 15, color: C.teal },
  ];
  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        padding: "0 80px",
        display: "grid",
        gridTemplateColumns: "1fr 1.1fr",
        gap: 56,
        alignItems: "center",
      }}
    >
      <DotGrid opacity={0.1} />
      <div>
        <Eyebrow color={C.mauve}>The ask</Eyebrow>
        <h2 style={{ fontSize: 96, fontWeight: 800, color: C.text, lineHeight: 0.95, letterSpacing: -4, marginBottom: 16 }}>
          <GradientText from={C.mauve} to={C.blue}>$4M
          </GradientText>
        </h2>
        <p style={{ fontSize: 22, color: C.text, lineHeight: 1.4, marginBottom: 14 }}>
          Seed round · SAFE or priced.
        </p>
        <p style={{ fontSize: 16, color: C.subtext0, lineHeight: 1.6, maxWidth: 480, marginBottom: 28 }}>
          18 months of runway to ship the public beta, hit our enterprise milestones, and
          arrive at Series A with{" "}
          <span style={{ color: C.text, fontWeight: 600 }}>$2M+ ARR</span> and{" "}
          <span style={{ color: C.text, fontWeight: 600 }}>SOC 2</span>.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {["Targeting strategic + multi-stage funds", "Lead identified — co-investors welcome", "Closing this quarter"].map((line) => (
            <div key={line} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <ArrowRight size={14} color={C.green} />
              <span style={{ fontSize: 14, color: C.text }}>{line}</span>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          padding: "32px 32px",
          borderRadius: 20,
          background: `linear-gradient(160deg, ${C.surface0}, ${C.mantle})`,
          border: `1px solid ${C.surface1}`,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, color: C.subtext0, letterSpacing: 1.5, marginBottom: 24 }}>
          USE OF FUNDS
        </div>

        {/* Stacked allocation bar */}
        <div
          style={{
            display: "flex",
            height: 14,
            borderRadius: 7,
            overflow: "hidden",
            background: C.crust,
            marginBottom: 24,
          }}
        >
          {allocation.map((a, i) => (
            <div
              key={a.label}
              style={{
                width: active ? `${a.pct}%` : "0%",
                background: a.color,
                transition: `width 1s cubic-bezier(0.22, 0.61, 0.36, 1) ${0.2 + i * 0.15}s`,
                boxShadow: `0 0 12px ${a.color}80`,
              }}
            />
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {allocation.map((a, i) => (
            <div
              key={a.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                opacity: active ? 1 : 0,
                animation: active ? `fadeUp 0.45s ease-out ${0.45 + i * 0.1}s both` : undefined,
              }}
            >
              <div style={{ width: 12, height: 12, borderRadius: 4, background: a.color, flexShrink: 0 }} />
              <div style={{ flex: 1, fontSize: 15, color: C.text }}>{a.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: a.color }}>{a.pct}%</div>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 28,
            padding: "14px 18px",
            borderRadius: 10,
            background: `${C.green}10`,
            border: `1px solid ${C.green}33`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Users size={16} color={C.green} />
          <div style={{ fontSize: 13, color: C.text }}>
            Team grows from <span style={{ fontWeight: 700 }}>3 → 11</span> over the 18-month runway.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Slide 14 — Closing
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
        Software is being{" "}
        <GradientText from={C.mauve} to={C.blue}>
          rebuilt
        </GradientText>
        .<br />
        Let's build the platform.
      </h2>

      <p
        style={{
          position: "relative",
          fontSize: 19,
          color: C.subtext0,
          maxWidth: 720,
          lineHeight: 1.6,
          marginBottom: 40,
          opacity: active ? 1 : 0,
          animation: active ? "fadeUp 0.7s ease-out 0.4s both" : undefined,
        }}
      >
        Genie is the only platform where AI agents own the loop from idea to production —
        with humans in the driver's seat. We'd love your partnership for this round.
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
          <MessageSquare size={16} />
          paul.brie@teleporthq.io
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

      <p
        style={{
          position: "relative",
          fontSize: 13,
          color: C.overlay0,
          marginTop: 56,
          letterSpacing: 1,
          opacity: active ? 1 : 0,
          animation: active ? "fadeUp 0.7s ease-out 0.7s both" : undefined,
        }}
      >
        GENIE · 2026 · CONFIDENTIAL
      </p>
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
  { id: "inflection", title: "Why now", render: (p) => <SlideInflection {...p} /> },
  { id: "problem", title: "Problem", render: (p) => <SlideProblem {...p} /> },
  { id: "solution", title: "Solution", render: (p) => <SlideSolution {...p} /> },
  { id: "product", title: "Product", render: (p) => <SlideProduct {...p} /> },
  { id: "architecture", title: "Architecture", render: (p) => <SlideArchitecture {...p} /> },
  { id: "competition", title: "Competition", render: (p) => <SlideCompetition {...p} /> },
  { id: "market", title: "Market", render: (p) => <SlideMarket {...p} /> },
  { id: "model", title: "Business model", render: (p) => <SlideBusinessModel {...p} /> },
  { id: "traction", title: "Traction", render: (p) => <SlideTraction {...p} /> },
  { id: "roadmap", title: "Roadmap", render: (p) => <SlideRoadmap {...p} /> },
  { id: "team", title: "Team", render: (p) => <SlideTeam {...p} /> },
  { id: "ask", title: "The ask", render: (p) => <SlideAsk {...p} /> },
  { id: "closing", title: "Closing", render: (p) => <SlideClosing {...p} /> },
];

/* ─────────────────────────────────────────────────────────────
   Presentation shell
   ───────────────────────────────────────────────────────────── */
export default function PresentationPage() {
  const [current, setCurrent] = useState(0);
  const [overview, setOverview] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const go = useCallback(
    (dir: number) => {
      setCurrent((c) => {
        const next = c + dir;
        if (next < 0 || next >= slides.length) return c;
        return next;
      });
    },
    [],
  );

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
            {String(current + 1).padStart(2, "0")} <span style={{ color: C.overlay0 }}>/ {String(slides.length).padStart(2, "0")}</span>
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
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
                  padding: 16,
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
                <div
                  style={{
                    fontSize: 10,
                    color: C.overlay0,
                    fontWeight: 700,
                    letterSpacing: 1,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>{s.title}</div>
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
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.4); opacity: 0; }
        }
        button:focus { outline: none; }
        button:focus-visible { outline: 2px solid ${C.mauve}; outline-offset: 2px; }
      `}</style>
    </div>
  );
}
