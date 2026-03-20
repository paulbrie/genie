"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, Zap, Shield, Terminal, GitBranch, MessageSquare, Eye, Bot, Globe, Cpu, Lock, Users, BarChart3, Layers, Rocket, ArrowRight } from "lucide-react";

// --- Catppuccin Mocha palette ---
const C = {
  base: "#1e1e2e", mantle: "#181825", crust: "#11111b",
  surface0: "#313244", surface1: "#45475a", surface2: "#585b70",
  overlay0: "#6c7086", overlay1: "#7f849c",
  subtext0: "#a6adc8", text: "#cdd6f4",
  mauve: "#cba6f7", lavender: "#b4befe", blue: "#89b4fa",
  green: "#a6e3a1", yellow: "#f9e2af", red: "#f38ba8",
  peach: "#fab387", teal: "#94e2d5", pink: "#f5c2e7",
};

function ClaudeLogo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 -.01 39.5 39.53" fill="none">
      <path d="m7.75 26.27 7.77-4.36.13-.38-.13-.21h-.38l-1.3-.08-4.44-.12-3.85-.16-3.73-.2-.94-.2-.88-1.16.09-.58.79-.53 1.13.1 2.5.17 3.75.26 2.72.16 4.03.42h.64l.09-.26-.22-.16-.17-.16-3.88-2.63-4.2-2.78-2.2-1.6-1.19-.81-.6-.76-.26-1.66 1.08-1.19 1.45.1.37.1 1.47 1.13 3.14 2.43 4.1 3.02.6.5.24-.17.03-.12-.27-.45-2.23-4.03-2.38-4.1-1.06-1.7-.28-1.02c-.1-.42-.17-.77-.17-1.2l1.23-1.67.68-.22 1.64.22.69.6 1.02 2.33 1.65 3.67 2.56 4.99.75 1.48.4 1.37.15.42h.26v-.24l.21-2.81.39-3.45.38-4.44.13-1.25.62-1.5 1.23-.81.96.46.79 1.13-.11.73-.47 3.05-.92 4.78-.6 3.2h.35l.4-.4 1.62-2.15 2.72-3.4 1.2-1.35 1.4-1.49.9-.71h1.7l1.25 1.86-.56 1.92-1.75 2.22-1.45 1.88-2.08 2.8-1.3 2.24.12.18.31-.03 4.7-1 2.54-.46 3.03-.52 1.37.64.15.65-.54 1.33-3.24.8-3.8.76-5.66 1.34-.07.05.08.1 2.55.24 1.09.06h2.67l4.97.37 1.3.86.78 1.05-.13.8-2 1.02-2.7-.64-6.3-1.5-2.16-.54h-.3v.18l1.8 1.76 3.3 2.98 4.13 3.84.21.95-.53.75-.56-.08-3.63-2.73-1.4-1.23-3.17-2.67h-.21v.28l.73 1.07 3.86 5.8.2 1.78-.28.58-1 .35-1.1-.2-2.26-3.17-2.33-3.57-1.88-3.2-.23.13-1.11 11.95-.52.61-1.2.46-1-.76-.53-1.23.53-2.43.64-3.17.52-2.52.47-3.13.28-1.04-.02-.07-.23.03-2.36 3.24-3.59 4.85-2.84 3.04-.68.27-1.18-.61.11-1.09.66-.97 3.93-5 2.37-3.1 1.53-1.79-.01-.26h-.09l-10.44 6.78-1.86.24-.8-.75.1-1.23.38-.4 3.14-2.16z" fill="currentColor"/>
    </svg>
  );
}

// --- Slide data ---

interface Slide {
  id: string;
  content: (props: { active: boolean }) => React.ReactNode;
}

function GradientText({ children, from, to }: { children: React.ReactNode; from: string; to: string }) {
  return (
    <span style={{ background: `linear-gradient(135deg, ${from}, ${to})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
      {children}
    </span>
  );
}

function FeatureCard({ icon, title, description, color, delay }: { icon: React.ReactNode; title: string; description: string; color: string; delay: number }) {
  return (
    <div
      className="feature-card"
      style={{ animationDelay: `${delay}ms`, border: `1px solid ${C.surface1}`, borderRadius: 16, padding: "28px 24px", background: `linear-gradient(135deg, ${C.surface0}80, ${C.mantle})`, flex: 1, minWidth: 220 }}
    >
      <div style={{ width: 44, height: 44, borderRadius: 12, background: `${color}15`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16, color }}>
        {icon}
      </div>
      <h3 style={{ fontSize: 18, fontWeight: 600, color: C.text, marginBottom: 8 }}>{title}</h3>
      <p style={{ fontSize: 15, color: C.subtext0, lineHeight: 1.6 }}>{description}</p>
    </div>
  );
}

function StatCard({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div style={{ textAlign: "center", flex: 1 }}>
      <div style={{ fontSize: 48, fontWeight: 700, color, lineHeight: 1, marginBottom: 8 }}>{value}</div>
      <div style={{ fontSize: 15, color: C.subtext0 }}>{label}</div>
    </div>
  );
}

function FlowStep({ number, title, description, color }: { number: number; title: string; description: string; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 20 }}>
      <div style={{ width: 40, height: 40, borderRadius: 12, background: `${color}20`, color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, flexShrink: 0 }}>
        {number}
      </div>
      <div>
        <h4 style={{ fontSize: 18, fontWeight: 600, color: C.text, marginBottom: 4 }}>{title}</h4>
        <p style={{ fontSize: 15, color: C.subtext0, lineHeight: 1.5 }}>{description}</p>
      </div>
    </div>
  );
}

const slides: Slide[] = [
  // --- Title ---
  {
    id: "title",
    content: () => (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", textAlign: "center", gap: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: `linear-gradient(135deg, ${C.mauve}30, ${C.blue}30)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Zap size={32} style={{ color: C.mauve }} />
          </div>
        </div>
        <h1 style={{ fontSize: 72, fontWeight: 800, letterSpacing: -2, lineHeight: 1 }}>
          <GradientText from={C.mauve} to={C.blue}>Genie</GradientText>
        </h1>
        <p style={{ fontSize: 26, color: C.subtext0, maxWidth: 600, lineHeight: 1.4 }}>
          AI-Powered Development Platform
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
          {["Deploy", "Monitor", "Iterate", "Ship"].map((word, i) => (
            <span key={word} style={{ padding: "8px 20px", borderRadius: 24, fontSize: 14, fontWeight: 500, background: `${[C.green, C.blue, C.peach, C.mauve][i]}15`, color: [C.green, C.blue, C.peach, C.mauve][i], border: `1px solid ${[C.green, C.blue, C.peach, C.mauve][i]}30` }}>
              {word}
            </span>
          ))}
        </div>
      </div>
    ),
  },

  // --- The Problem ---
  {
    id: "problem",
    content: () => (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: "0 80px" }}>
        <p style={{ fontSize: 14, fontWeight: 600, textTransform: "uppercase", letterSpacing: 2, color: C.red, marginBottom: 16 }}>The Problem</p>
        <h2 style={{ fontSize: 48, fontWeight: 700, color: C.text, lineHeight: 1.2, marginBottom: 40 }}>
          Cloud dev is <GradientText from={C.red} to={C.peach}>fragmented</GradientText>
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {[
            { text: "Devs juggle 5+ tools: hosting, CI/CD, monitoring, terminals, issue trackers", color: C.red },
            { text: "AI coding assistants can't see or interact with your live infrastructure", color: C.peach },
            { text: "Security scans, deployments, and debugging live in separate workflows", color: C.yellow },
            { text: "Team communication is disconnected from where the code actually runs", color: C.overlay1 },
          ].map(({ text, color }, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 20px", borderRadius: 12, background: `${color}08`, borderLeft: `3px solid ${color}` }}>
              <span style={{ fontSize: 17, color: C.text }}>{text}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },

  // --- The Solution ---
  {
    id: "solution",
    content: () => (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: "0 80px" }}>
        <p style={{ fontSize: 14, fontWeight: 600, textTransform: "uppercase", letterSpacing: 2, color: C.green, marginBottom: 16 }}>The Solution</p>
        <h2 style={{ fontSize: 48, fontWeight: 700, color: C.text, lineHeight: 1.2, marginBottom: 16 }}>
          One platform, <GradientText from={C.green} to={C.teal}>everything connected</GradientText>
        </h2>
        <p style={{ fontSize: 18, color: C.subtext0, marginBottom: 40, maxWidth: 700, lineHeight: 1.5 }}>
          Genie unifies cloud infrastructure, AI agents, team collaboration, and security into a single pane of glass.
        </p>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <FeatureCard icon={<Rocket size={22} />} title="One-Click VPS Deploy" description="Push code to a DigitalOcean droplet with SSH keys, firewall, and Docker in minutes." color={C.green} delay={0} />
          <FeatureCard icon={<Bot size={22} />} title="AI That Acts" description="Claude Code runs on your VPS with full access to your codebase, terminal, browser, and tools." color={C.mauve} delay={100} />
          <FeatureCard icon={<Shield size={22} />} title="Built-in Security" description="Automated vulnerability scanning, port analysis, and security reports on demand." color={C.blue} delay={200} />
        </div>
      </div>
    ),
  },

  // --- AI Architecture ---
  {
    id: "ai-arch",
    content: () => (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: "0 80px" }}>
        <p style={{ fontSize: 14, fontWeight: 600, textTransform: "uppercase", letterSpacing: 2, color: C.mauve, marginBottom: 16 }}>AI Architecture</p>
        <h2 style={{ fontSize: 44, fontWeight: 700, color: C.text, lineHeight: 1.2, marginBottom: 40 }}>
          Claude Code + <GradientText from={C.mauve} to={C.pink}>MCP Servers</GradientText>
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {[
            { icon: <Terminal size={18} />, name: "genie-tracker", desc: "Read/update issues, manage workflow, leave comments", color: C.blue },
            { icon: <Shield size={18} />, name: "genie-security", desc: "Run full security scans, review findings and open ports", color: C.green },
            { icon: <MessageSquare size={18} />, name: "genie-notify", desc: "Email admin or send chat messages with progress updates", color: C.peach },
            { icon: <Globe size={18} />, name: "genie-storage", desc: "Take screenshots, upload files to cloud storage", color: C.mauve },
            { icon: <Eye size={18} />, name: "genie-browser", desc: "DOM interactions via Chrome extension for live testing", color: C.teal },
            { icon: <Cpu size={18} />, name: "chrome-devtools", desc: "Headless Puppeteer on VPS for automated testing", color: C.yellow },
          ].map(({ icon, name, desc, color }) => (
            <div key={name} style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "16px 18px", borderRadius: 12, background: C.surface0, border: `1px solid ${C.surface1}` }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: `${color}15`, display: "flex", alignItems: "center", justifyContent: "center", color, flexShrink: 0 }}>
                {icon}
              </div>
              <div>
                <code style={{ fontSize: 14, fontWeight: 600, color }}>{name}</code>
                <p style={{ fontSize: 13, color: C.subtext0, marginTop: 4, lineHeight: 1.4 }}>{desc}</p>
              </div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 14, color: C.overlay1, marginTop: 24, textAlign: "center" }}>
          All MCP servers run locally on the manager and are tunneled via SSH — credentials never touch the VPS.
        </p>
      </div>
    ),
  },

  // --- How It Works ---
  {
    id: "workflow",
    content: () => (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: "0 80px" }}>
        <p style={{ fontSize: 14, fontWeight: 600, textTransform: "uppercase", letterSpacing: 2, color: C.blue, marginBottom: 16 }}>Workflow</p>
        <h2 style={{ fontSize: 44, fontWeight: 700, color: C.text, lineHeight: 1.2, marginBottom: 40 }}>
          From idea to <GradientText from={C.blue} to={C.lavender}>production</GradientText>
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <FlowStep number={1} title="Create a project" description="Define your repo, setup files, and environment. Genie scaffolds everything." color={C.green} />
          <FlowStep number={2} title="Deploy to VPS" description="One click provisions a DigitalOcean droplet with Docker, Node, SSH keys, and firewall rules." color={C.blue} />
          <FlowStep number={3} title="Let Claude work" description="Claude Code on the VPS reads your tracker, writes code, runs tests, takes screenshots, and notifies you when done." color={C.mauve} />
          <FlowStep number={4} title="Review and ship" description="Review changes in the built-in chat, check security scans, approve PRs. Claude sets issues to review — you mark them done." color={C.peach} />
        </div>
      </div>
    ),
  },

  // --- Platform Features ---
  {
    id: "features",
    content: () => (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: "0 80px" }}>
        <p style={{ fontSize: 14, fontWeight: 600, textTransform: "uppercase", letterSpacing: 2, color: C.peach, marginBottom: 16 }}>Platform</p>
        <h2 style={{ fontSize: 44, fontWeight: 700, color: C.text, lineHeight: 1.2, marginBottom: 40 }}>
          Everything your team <GradientText from={C.peach} to={C.yellow}>needs</GradientText>
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
          {[
            { icon: <Layers size={18} />, title: "Project Management", desc: "Multi-project dashboard with VPS instances, deploy history, and live stats", color: C.blue },
            { icon: <Terminal size={18} />, title: "SSH Terminals", desc: "In-browser terminals with shared sessions and command library", color: C.green },
            { icon: <GitBranch size={18} />, title: "Git Integration", desc: "View branches, commits, and diffs directly from the UI", color: C.mauve },
            { icon: <MessageSquare size={18} />, title: "Team Chat", desc: "DMs and rooms with real-time notifications, reactions, and mentions", color: C.peach },
            { icon: <BarChart3 size={18} />, title: "Live Monitoring", desc: "CPU, memory, disk, Docker containers, and process trees", color: C.teal },
            { icon: <Lock size={18} />, title: "Security Scans", desc: "Port scanning and web vulnerability detection on demand", color: C.red },
            { icon: <Users size={18} />, title: "Team Management", desc: "Role-based access, user validation, and connected user tracking", color: C.lavender },
            { icon: <Globe size={18} />, title: "Chrome Extension", desc: "Control Claude from any tab with full browser automation", color: C.yellow },
            { icon: <ClaudeLogo size={18} />, title: "Claude Code", desc: "AI agent with resume, MCP tools, and full VPS access", color: C.pink },
          ].map(({ icon, title, desc, color }) => (
            <div key={title} style={{ padding: "18px 16px", borderRadius: 12, background: C.surface0, border: `1px solid ${C.surface1}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span style={{ color }}>{icon}</span>
                <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{title}</span>
              </div>
              <p style={{ fontSize: 13, color: C.subtext0, lineHeight: 1.5 }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>
    ),
  },

  // --- Security ---
  {
    id: "security",
    content: () => (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: "0 80px" }}>
        <p style={{ fontSize: 14, fontWeight: 600, textTransform: "uppercase", letterSpacing: 2, color: C.green, marginBottom: 16 }}>Security First</p>
        <h2 style={{ fontSize: 44, fontWeight: 700, color: C.text, lineHeight: 1.2, marginBottom: 40 }}>
          Built for <GradientText from={C.green} to={C.blue}>trust</GradientText>
        </h2>
        <div style={{ display: "flex", gap: 24 }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 20 }}>
            {[
              { title: "SSH tunneled MCP", desc: "All AI tool calls travel through encrypted SSH tunnels. API keys and credentials stay on the manager." },
              { title: "Firewall by default", desc: "VPS droplets are locked to SSH + app port. UFW rules managed from the UI or Slack." },
              { title: "Automated scanning", desc: "Port scans + web vulnerability checks run on demand. Findings ranked by severity." },
              { title: "Role-based access", desc: "Superadmin, admin, and user roles. New users require validation before access." },
            ].map(({ title, desc }) => (
              <div key={title} style={{ display: "flex", gap: 14 }}>
                <div style={{ width: 8, height: 8, borderRadius: 4, background: C.green, marginTop: 8, flexShrink: 0 }} />
                <div>
                  <h4 style={{ fontSize: 16, fontWeight: 600, color: C.text, marginBottom: 4 }}>{title}</h4>
                  <p style={{ fontSize: 14, color: C.subtext0, lineHeight: 1.5 }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div style={{ flex: 1, background: C.surface0, borderRadius: 16, border: `1px solid ${C.surface1}`, padding: 28, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontFamily: "'SF Mono', monospace", fontSize: 13, color: C.subtext0, lineHeight: 2 }}>
              <div><span style={{ color: C.green }}>$</span> genie security scan http://app:3000</div>
              <div style={{ color: C.overlay0 }}>  Scanning 1000 ports...</div>
              <div style={{ color: C.overlay0 }}>  Testing web vulnerabilities...</div>
              <div style={{ marginTop: 8 }}><span style={{ color: C.green }}>Open ports:</span> 22 (ssh), 3000 (http)</div>
              <div><span style={{ color: C.yellow }}>Findings:</span> 3 medium, 1 low</div>
              <div style={{ color: C.overlay0, marginTop: 8 }}>  Missing X-Frame-Options header</div>
              <div style={{ color: C.overlay0 }}>  Server version disclosed</div>
              <div style={{ color: C.overlay0 }}>  No Content-Security-Policy</div>
              <div style={{ marginTop: 8, color: C.green }}>Scan complete. Results saved.</div>
            </div>
          </div>
        </div>
      </div>
    ),
  },

  // --- Why Genie ---
  {
    id: "why",
    content: () => (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", textAlign: "center", gap: 48 }}>
        <div>
          <p style={{ fontSize: 14, fontWeight: 600, textTransform: "uppercase", letterSpacing: 2, color: C.lavender, marginBottom: 16 }}>Why Genie</p>
          <h2 style={{ fontSize: 48, fontWeight: 700, color: C.text, lineHeight: 1.2 }}>
            Ship faster with <GradientText from={C.lavender} to={C.mauve}>confidence</GradientText>
          </h2>
        </div>
        <div style={{ display: "flex", gap: 48, maxWidth: 800 }}>
          <StatCard value="1" label="platform instead of 5+ tools" color={C.mauve} />
          <StatCard value="0" label="credentials on VPS" color={C.green} />
          <StatCard value="24/7" label="AI agent working on your code" color={C.blue} />
        </div>
        <div style={{ display: "flex", gap: 20, marginTop: 16 }}>
          {[
            "Managers get visibility into what AI is doing",
            "Tech leads keep control with review workflows",
            "Developers ship without context-switching",
          ].map((text, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", borderRadius: 12, background: C.surface0, border: `1px solid ${C.surface1}` }}>
              <ArrowRight size={14} style={{ color: C.green, flexShrink: 0 }} />
              <span style={{ fontSize: 14, color: C.text }}>{text}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },

  // --- CTA ---
  {
    id: "cta",
    content: () => (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", textAlign: "center", gap: 32 }}>
        <div style={{ width: 80, height: 80, borderRadius: 24, background: `linear-gradient(135deg, ${C.mauve}30, ${C.blue}30)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Zap size={40} style={{ color: C.mauve }} />
        </div>
        <h2 style={{ fontSize: 56, fontWeight: 800, letterSpacing: -1 }}>
          <GradientText from={C.mauve} to={C.blue}>Ready to build?</GradientText>
        </h2>
        <p style={{ fontSize: 20, color: C.subtext0, maxWidth: 500, lineHeight: 1.5 }}>
          Genie gives your team an AI-powered cloud IDE with deployment, monitoring, security, and collaboration built in.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <div style={{ padding: "14px 32px", borderRadius: 12, background: `linear-gradient(135deg, ${C.mauve}, ${C.blue})`, color: C.crust, fontSize: 16, fontWeight: 600 }}>
            Get Started
          </div>
        </div>
        <p style={{ fontSize: 13, color: C.overlay0, marginTop: 16 }}>
          Self-hosted. Your infrastructure. Your data.
        </p>
      </div>
    ),
  },
];

// --- Presentation shell ---

export default function PresentationPage() {
  const [current, setCurrent] = useState(0);
  const [transitioning, setTransitioning] = useState(false);

  const go = useCallback((dir: number) => {
    const next = current + dir;
    if (next < 0 || next >= slides.length || transitioning) return;
    setTransitioning(true);
    setCurrent(next);
    setTimeout(() => setTransitioning(false), 400);
  }, [current, transitioning]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") { e.preventDefault(); go(1); }
      if (e.key === "ArrowLeft" || e.key === "Backspace") { e.preventDefault(); go(-1); }
      if (e.key === "Home") { e.preventDefault(); setCurrent(0); }
      if (e.key === "End") { e.preventDefault(); setCurrent(slides.length - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const slide = slides[current];

  return (
    <div
      style={{
        width: "100vw", height: "100vh", background: C.base, color: C.text,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif",
        display: "flex", flexDirection: "column", overflow: "hidden", cursor: "default", userSelect: "none",
      }}
    >
      {/* Slide content */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <div
          key={slide.id}
          style={{
            position: "absolute", inset: 0, padding: "40px 60px",
            animation: "slideIn 0.4s ease-out",
          }}
        >
          {slide.content({ active: true })}
        </div>
      </div>

      {/* Bottom bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 32px", borderTop: `1px solid ${C.surface0}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Zap size={16} style={{ color: C.mauve }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: C.overlay1 }}>Genie</span>
        </div>

        {/* Dots */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {slides.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setCurrent(i)}
              style={{
                width: i === current ? 24 : 8, height: 8, borderRadius: 4, border: "none", cursor: "pointer",
                background: i === current ? C.mauve : C.surface1,
                transition: "all 0.3s ease",
              }}
            />
          ))}
        </div>

        {/* Nav arrows */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: C.overlay0, marginRight: 8 }}>
            {current + 1} / {slides.length}
          </span>
          <button
            onClick={() => go(-1)}
            disabled={current === 0}
            style={{
              width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.surface1}`, cursor: current === 0 ? "default" : "pointer",
              background: C.surface0, display: "flex", alignItems: "center", justifyContent: "center",
              opacity: current === 0 ? 0.3 : 1, color: C.text,
            }}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => go(1)}
            disabled={current === slides.length - 1}
            style={{
              width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.surface1}`, cursor: current === slides.length - 1 ? "default" : "pointer",
              background: C.surface0, display: "flex", alignItems: "center", justifyContent: "center",
              opacity: current === slides.length - 1 ? 0.3 : 1, color: C.text,
            }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .feature-card {
          animation: slideIn 0.4s ease-out both;
        }
        button:focus { outline: none; }
      `}</style>
    </div>
  );
}
