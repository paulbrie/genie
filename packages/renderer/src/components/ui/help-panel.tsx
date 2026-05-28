import { ViewHeader } from "@/components/ui/view-header";

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="w-4 h-4 text-green inline-block">
      <path
        d="M3 8.5 L7 12 L13 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DashIcon() {
  return (
    <svg viewBox="0 0 16 16" className="w-4 h-4 text-overlay0 inline-block">
      <path
        d="M4 8 L12 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RolePyramid() {
  return (
    <svg viewBox="0 0 320 220" className="w-full max-w-sm mx-auto" role="img" aria-label="Role hierarchy pyramid">
      <polygon points="160,20 115,80 205,80" className="fill-mauve" />
      <polygon points="115,80 205,80 235,150 85,150" className="fill-blue" />
      <polygon points="85,150 235,150 265,210 55,210" className="fill-overlay0" />
      <text x="160" y="62" textAnchor="middle" className="fill-background text-[11px] font-semibold">superadmin</text>
      <text x="160" y="120" textAnchor="middle" className="fill-background text-[11px] font-semibold">admin</text>
      <text x="160" y="185" textAnchor="middle" className="fill-background text-[11px] font-semibold">user</text>
    </svg>
  );
}

function BootstrapFlow() {
  return (
    <svg viewBox="0 0 560 170" className="w-full max-w-2xl" role="img" aria-label="How a new user is assigned a role">
      <rect x="20" y="65" width="110" height="40" rx="6" className="fill-surface0 stroke-overlay0" strokeWidth="1.5" />
      <text x="75" y="90" textAnchor="middle" className="fill-text text-[12px]">New sign-up</text>

      <line x1="130" y1="85" x2="200" y2="85" className="stroke-overlay0" strokeWidth="1.5" />
      <polygon points="200,80 210,85 200,90" className="fill-overlay0" />

      <polygon
        points="270,40 330,85 270,130 210,85"
        className="fill-surface0 stroke-overlay0"
        strokeWidth="1.5"
      />
      <text x="270" y="80" textAnchor="middle" className="fill-text text-[11px]">first non-agent</text>
      <text x="270" y="94" textAnchor="middle" className="fill-text text-[11px]">user?</text>

      <line x1="330" y1="65" x2="420" y2="30" className="stroke-overlay0" strokeWidth="1.5" />
      <polygon points="416,24 426,28 421,38" className="fill-overlay0" />
      <text x="378" y="40" textAnchor="middle" className="fill-overlay0 text-[11px]">yes</text>

      <line x1="330" y1="105" x2="420" y2="140" className="stroke-overlay0" strokeWidth="1.5" />
      <polygon points="416,132 426,142 421,148" className="fill-overlay0" />
      <text x="378" y="140" textAnchor="middle" className="fill-overlay0 text-[11px]">no</text>

      <rect x="420" y="12" width="120" height="32" rx="6" className="fill-mauve" />
      <text x="480" y="33" textAnchor="middle" className="fill-background text-[12px] font-semibold">superadmin</text>

      <rect x="420" y="126" width="120" height="32" rx="6" className="fill-overlay0" />
      <text x="480" y="147" textAnchor="middle" className="fill-background text-[12px] font-semibold">user</text>
    </svg>
  );
}

function TeamRolesDiagram() {
  return (
    <svg viewBox="0 0 480 200" className="w-full max-w-xl" role="img" aria-label="Per-team roles are independent of the global role">
      <circle cx="80" cy="100" r="34" className="fill-surface0 stroke-blue" strokeWidth="1.5" />
      <text x="80" y="97" textAnchor="middle" className="fill-text text-[12px] font-semibold">Alice</text>
      <text x="80" y="113" textAnchor="middle" className="fill-overlay0 text-[10px]">global: user</text>

      <line x1="114" y1="85" x2="280" y2="50" className="stroke-overlay0" strokeWidth="1.5" />
      <line x1="114" y1="115" x2="280" y2="150" className="stroke-overlay0" strokeWidth="1.5" />

      <rect x="280" y="20" width="170" height="60" rx="8" className="fill-surface0 stroke-surface1" strokeWidth="1.5" />
      <text x="295" y="42" className="fill-text text-[12px] font-semibold">Team Alpha</text>
      <text x="295" y="60" className="fill-overlay0 text-[11px]">team role:</text>
      <rect x="350" y="48" width="62" height="18" rx="4" className="fill-mauve" />
      <text x="381" y="61" textAnchor="middle" className="fill-background text-[11px] font-semibold">owner</text>

      <rect x="280" y="120" width="170" height="60" rx="8" className="fill-surface0 stroke-surface1" strokeWidth="1.5" />
      <text x="295" y="142" className="fill-text text-[12px] font-semibold">Team Beta</text>
      <text x="295" y="160" className="fill-overlay0 text-[11px]">team role:</text>
      <rect x="350" y="148" width="62" height="18" rx="4" className="fill-blue" />
      <text x="381" y="161" textAnchor="middle" className="fill-background text-[11px] font-semibold">member</text>
    </svg>
  );
}

export function HelpPanel() {
  return (
    <>
      <ViewHeader title="Help" subtitle="How user roles work" />
      <div className="overflow-auto flex-1 px-8 py-8 space-y-12 text-md text-text">
        <section className="max-w-3xl space-y-3">
          <p className="text-subtext0">
            Genie has <strong className="text-text">two independent role systems</strong>: a global app role
            stored on each user, and a per-team role assigned via team membership. The two are orthogonal —
            a global <code className="text-mauve">user</code> can still be the <code className="text-mauve">owner</code> of a team,
            and a global <code className="text-mauve">superadmin</code> may be a plain <code className="text-mauve">member</code> in any given team.
          </p>
        </section>

        <section className="space-y-6">
          <h3 className="text-lg font-semibold text-text">Global roles</h3>

          <div className="flex flex-col items-center gap-6">
            <RolePyramid />
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div className="border border-mauve/40 rounded-md p-4 bg-mauve/5">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2.5 h-2.5 rounded-full bg-mauve" />
                <h4 className="font-semibold text-text">superadmin</h4>
              </div>
              <p className="text-subtext0 text-md">
                Full app access. Sees <strong className="text-text">Recipes</strong> and <strong className="text-text">Clouds</strong> in the
                admin top bar (plus Connected Users, Logs, History, Topology), can manage system-wide settings, and can impersonate other users.
              </p>
            </div>

            <div className="border border-blue/40 rounded-md p-4 bg-blue/5">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2.5 h-2.5 rounded-full bg-blue" />
                <h4 className="font-semibold text-text">admin</h4>
              </div>
              <p className="text-subtext0 text-md">
                Counts as admin for permission checks across chat, projects, and the WebSocket API.
                Sees <strong className="text-text">Connected Users</strong>, <strong className="text-text">Logs</strong>, <strong className="text-text">History</strong>, and <strong className="text-text">Topology</strong> in the
                admin top bar — not Recipes or Clouds (superadmin-only).
              </p>
            </div>

            <div className="border border-teal/40 rounded-md p-4 bg-teal/5">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2.5 h-2.5 rounded-full bg-teal" />
                <h4 className="font-semibold text-text">tazcloud</h4>
              </div>
              <p className="text-subtext0 text-md">
                Same access as <code className="text-mauve">user</code>, plus
                <strong className="text-text"> Recipes</strong> and the
                <strong className="text-text"> Clouds</strong> sidebar item — Clouds is restricted to
                the TazCloud tab. No DigitalOcean access and no admin privileges.
              </p>
            </div>

            <div className="border border-overlay0/50 rounded-md p-4 bg-surface0/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2.5 h-2.5 rounded-full bg-overlay0" />
                <h4 className="font-semibold text-text">user</h4>
              </div>
              <p className="text-subtext0 text-md">
                Default role for every new sign-up after the first. Regular access to projects and chat;
                no system-wide privileges.
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-text">How you get your role</h3>
          <p className="text-subtext0 max-w-3xl">
            Roles are assigned on first sign-in. The very first non-agent user becomes
            <code className="text-mauve"> superadmin</code> automatically — everyone after that gets
            <code className="text-mauve"> user</code> and can be promoted manually.
          </p>
          <BootstrapFlow />
          <p className="text-overlay0 text-md max-w-3xl">
            There is also an <strong className="text-subtext0">admin-equivalence rule</strong>: the
            permission check treats you as admin if your role is <code className="text-mauve">admin</code> or
            <code className="text-mauve"> superadmin</code>, <em>or</em> if you are the first non-agent user by
            creation date — so the bootstrap user keeps admin powers even if their stored role is later changed.
          </p>
        </section>

        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-text">Capability matrix</h3>
          <div className="border border-surface0 rounded-md overflow-hidden">
            <table className="w-full text-md">
              <thead>
                <tr className="bg-surface0/50 text-overlay0 text-left">
                  <th className="py-2 px-3 font-medium">Capability</th>
                  <th className="py-2 px-3 font-medium text-center w-24">user</th>
                  <th className="py-2 px-3 font-medium text-center w-24">tazcloud</th>
                  <th className="py-2 px-3 font-medium text-center w-24">admin</th>
                  <th className="py-2 px-3 font-medium text-center w-24">superadmin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface0">
                <tr>
                  <td className="py-2 px-3 text-text">Default for new sign-ups</td>
                  <td className="py-2 px-3 text-center"><CheckIcon /></td>
                  <td className="py-2 px-3 text-center"><DashIcon /></td>
                  <td className="py-2 px-3 text-center"><DashIcon /></td>
                  <td className="py-2 px-3 text-center"><DashIcon /></td>
                </tr>
                <tr>
                  <td className="py-2 px-3 text-text">Auto-assigned to the first user</td>
                  <td className="py-2 px-3 text-center"><DashIcon /></td>
                  <td className="py-2 px-3 text-center"><DashIcon /></td>
                  <td className="py-2 px-3 text-center"><DashIcon /></td>
                  <td className="py-2 px-3 text-center"><CheckIcon /></td>
                </tr>
                <tr>
                  <td className="py-2 px-3 text-text">Counts as admin in <code className="text-mauve">isAdmin()</code></td>
                  <td className="py-2 px-3 text-center"><DashIcon /></td>
                  <td className="py-2 px-3 text-center"><DashIcon /></td>
                  <td className="py-2 px-3 text-center"><CheckIcon /></td>
                  <td className="py-2 px-3 text-center"><CheckIcon /></td>
                </tr>
                <tr>
                  <td className="py-2 px-3 text-text">Sees Clouds in the sidebar</td>
                  <td className="py-2 px-3 text-center"><DashIcon /></td>
                  <td className="py-2 px-3 text-center"><CheckIcon /></td>
                  <td className="py-2 px-3 text-center"><DashIcon /></td>
                  <td className="py-2 px-3 text-center"><CheckIcon /></td>
                </tr>
                <tr>
                  <td className="py-2 px-3 text-text">Sees Recipes in the sidebar</td>
                  <td className="py-2 px-3 text-center"><DashIcon /></td>
                  <td className="py-2 px-3 text-center"><CheckIcon /></td>
                  <td className="py-2 px-3 text-center"><DashIcon /></td>
                  <td className="py-2 px-3 text-center"><CheckIcon /></td>
                </tr>
                <tr>
                  <td className="py-2 px-3 text-text">Access to DigitalOcean VMs</td>
                  <td className="py-2 px-3 text-center"><DashIcon /></td>
                  <td className="py-2 px-3 text-center"><DashIcon /></td>
                  <td className="py-2 px-3 text-center"><DashIcon /></td>
                  <td className="py-2 px-3 text-center"><CheckIcon /></td>
                </tr>
                <tr>
                  <td className="py-2 px-3 text-text">Access to TazCloud VMs</td>
                  <td className="py-2 px-3 text-center"><DashIcon /></td>
                  <td className="py-2 px-3 text-center"><CheckIcon /></td>
                  <td className="py-2 px-3 text-center"><DashIcon /></td>
                  <td className="py-2 px-3 text-center"><CheckIcon /></td>
                </tr>
                <tr>
                  <td className="py-2 px-3 text-text">Can impersonate other users</td>
                  <td className="py-2 px-3 text-center"><DashIcon /></td>
                  <td className="py-2 px-3 text-center"><DashIcon /></td>
                  <td className="py-2 px-3 text-center"><DashIcon /></td>
                  <td className="py-2 px-3 text-center"><CheckIcon /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-text">Team roles</h3>
          <p className="text-subtext0 max-w-3xl">
            Each team membership carries its own role — <code className="text-mauve">member</code> (default),
            <code className="text-mauve"> owner</code>, or <code className="text-mauve"> superadmin</code> — and applies
            only inside that team. The same person can hold different team roles in different teams, regardless of their global role.
          </p>
          <TeamRolesDiagram />
        </section>

        <section className="space-y-2 border-t border-surface0 pt-6">
          <h4 className="text-md font-semibold text-text">A note on agent users</h4>
          <p className="text-overlay0 text-md max-w-3xl">
            Agent users (accounts created on behalf of automation, with <code className="text-mauve">isAgent = true</code>)
            are excluded from the &quot;first user becomes superadmin&quot; rule. Only the first human sign-up gets the bootstrap.
          </p>
        </section>
      </div>
    </>
  );
}
