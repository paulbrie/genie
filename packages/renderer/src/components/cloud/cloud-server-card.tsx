"use client";

import type { ReactNode } from "react";
import { Loader2, MoreVertical, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { ActionMenuBackdrop, ActionMenuPanel } from "@/components/ui/action-menu";
import { CloudVmResourceBlock } from "@/components/cloud/cloud-vm-resource-block";

/** Status chip shared by every server card (Taz / DO / Hetzner admin panels and
 *  the org Servers tab). Green for active, blue for hibernated, grey otherwise. */
export function cardStatusPill(status: string) {
  const s = status.toLowerCase();
  const isActive = s === "active";
  const isHibernated = s === "hibernated";
  const isBusy = s === "reboot" || s === "rebooting" || s === "provisioning";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium px-1.5 py-0.5 rounded shrink-0",
        isActive ? "bg-green/15 text-green"
          : isHibernated ? "bg-blue/15 text-blue"
          : isBusy ? "bg-peach/15 text-peach"
          : "bg-overlay0/15 text-overlay0",
      )}
    >
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full shrink-0",
          isActive && "bg-green shadow-[0_0_3px_var(--color-green)]",
          isHibernated && "bg-blue shadow-[0_0_3px_var(--color-blue)]",
          isBusy && "bg-peach animate-pulse",
          !isActive && !isHibernated && !isBusy && "bg-overlay0",
        )}
      />
      {s}
    </span>
  );
}

export interface CloudServerCardDetail {
  label: string;
  value: ReactNode;
  /** Hover title for truncated values (IDs, hosts). */
  title?: string;
  /** Render the value in monospace (hosts, IDs). */
  mono?: boolean;
}

export interface CloudServerCardNotice {
  text: ReactNode;
  tone: "red" | "blue" | "muted";
}

/** Live restart state for the card's reboot banner. `active` while the
 *  provider round-trip is in flight; `error` sticks after a failure. */
export interface CloudServerRebootState {
  active: boolean;
  messages: string[];
  error: string | null;
  /** Banner title while active / after a failure. Default "Restarting…" / "Restart failed". */
  activeLabel?: string;
  errorLabel?: string;
}

export type CloudServerCardResourceProps = Omit<
  React.ComponentProps<typeof CloudVmResourceBlock>,
  "className"
>;

export interface CloudServerCardProps {
  name: string;
  /** Chips rendered right after the name: provider tag, tunnel indicator,
   *  locked badge, … */
  nameExtras?: ReactNode;
  /** Fed to `cardStatusPill`. */
  status: string;
  /** When set, replaces the header row (used for inline rename). The body and
   *  footer stay hidden while renaming so the input has the card to itself. */
  renaming?: ReactNode;
  /** Card-level click target (opens the Manage popup). Clicks on interactive
   *  descendants are ignored so buttons/links inside the card keep working. */
  onOpen?: () => void;
  /** Extra classes on the outer card (e.g. a red border for locked/failed). */
  className?: string;
  /** Domain / IP / gauges / history block. Omit to hide (failed, hibernated,
   *  no reachable host). */
  resource?: CloudServerCardResourceProps | null;
  /** Full-width banner under the resource block ("Deploy failed", "VM is
   *  shutoff", "Hibernated — snapshot x"). */
  notice?: CloudServerCardNotice | null;
  /** Restart banner. Rendered when `active` or when an `error` is present. */
  reboot?: CloudServerRebootState | null;
  /** Label → value rows under the banner. */
  details: CloudServerCardDetail[];
  /** Small status text at the footer's left ("Provisioning", "Deleting…"). */
  footerStatus?: ReactNode;
  /** Right-aligned footer controls (SSH button, actions menu). Hidden when
   *  `footerStatus` is set and `footerControlsWhileBusy` is false. */
  footerControls?: ReactNode;
  /** Keep showing `footerControls` next to a `footerStatus`. Default true. */
  footerControlsWhileBusy?: boolean;
  /** Trailing content inside the card (delete confirm, snapshot / ingress forms). */
  children?: ReactNode;
}

const noticeTone: Record<CloudServerCardNotice["tone"], string> = {
  red: "text-red bg-red/10",
  blue: "text-blue bg-blue/10",
  muted: "text-overlay0 bg-base/40",
};

/** One card for every server surface. The org Servers tab and the Clouds
 *  admin panels differ only in *what* they put in the slots (name chips,
 *  details rows, menu items) — the chrome, layout, resource block, reboot
 *  banner and footer are identical, so they live here. */
export function CloudServerCard({
  name,
  nameExtras,
  status,
  renaming,
  onOpen,
  className,
  resource,
  notice,
  reboot,
  details,
  footerStatus,
  footerControls,
  footerControlsWhileBusy = true,
  children,
}: CloudServerCardProps) {
  const clickable = !!onOpen && !renaming;
  const onClick = (e: React.MouseEvent) => {
    if (!clickable) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea, label")) return;
    onOpen?.();
  };
  const showReboot = !!reboot && (reboot.active || !!reboot.error);

  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-mantle rounded-lg px-3 py-2 border border-overlay0/10 transition-colors",
        clickable && "cursor-pointer hover:border-blue/30",
        className,
      )}
    >
      {renaming ?? (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-semibold text-text truncate" title={name}>{name}</span>
                {nameExtras}
              </div>
            </div>
            {cardStatusPill(status)}
          </div>

          {resource && <CloudVmResourceBlock {...resource} />}

          {notice && (
            <div className={cn("flex items-center justify-center mt-3 py-3 text-xs rounded-md", noticeTone[notice.tone])}>
              {notice.text}
            </div>
          )}

          {showReboot && reboot && <CloudServerRebootBanner reboot={reboot} />}

          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 mt-3 text-xs">
            {details.map((d) => (
              <DetailRow key={d.label} {...d} />
            ))}
          </div>

          <div className="flex items-center gap-2 mt-3 pt-2 border-t border-overlay0/10">
            <div className="flex-1" />
            {footerStatus && (
              <span className="inline-flex items-center gap-1 text-xs text-overlay0">{footerStatus}</span>
            )}
            {(!footerStatus || footerControlsWhileBusy) && footerControls}
          </div>
        </>
      )}
      {children}
    </div>
  );
}

function DetailRow({ label, value, title, mono }: CloudServerCardDetail) {
  return (
    <>
      <span className="text-overlay0">{label}</span>
      <span className={cn("text-subtext0 min-w-0 truncate", mono && "font-mono")} title={title}>{value}</span>
    </>
  );
}

/** Restart progress / error banner. Progress lines scroll in a small log so a
 *  3-minute provider poll doesn't stretch the card. */
export function CloudServerRebootBanner({ reboot }: { reboot: CloudServerRebootState }) {
  return (
    <div className="mt-3 border border-peach/20 rounded-lg px-3 py-2">
      <div className="flex items-center gap-2">
        {reboot.active
          ? <Loader2 size={13} className="text-peach animate-spin shrink-0" />
          : <RotateCw size={13} className="text-red shrink-0" />}
        <span className={cn("text-md font-medium", reboot.active ? "text-peach" : "text-red")}>
          {reboot.active ? (reboot.activeLabel ?? "Restarting…") : (reboot.errorLabel ?? "Restart failed")}
        </span>
      </div>
      {reboot.messages.length > 0 && (
        <div className="max-h-[96px] overflow-y-auto scrollbar-thin bg-crust rounded-lg p-2 mt-2">
          {reboot.messages.map((line, i) => (
            <div key={i} className="text-xs text-overlay1 font-mono whitespace-pre-wrap">{line}</div>
          ))}
        </div>
      )}
      {reboot.error && <div className="text-xs text-red mt-1">{reboot.error}</div>}
    </div>
  );
}

/** `⋮` trigger + backdrop + auto-flipping panel. Stops propagation so a menu
 *  that flips up over the card body doesn't also fire the card's `onOpen`. */
export function CloudServerCardMenu({
  open,
  onToggle,
  onClose,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="relative inline-flex items-center" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={onToggle}
        className={cn("p-1 transition-colors", open ? "text-blue" : "text-overlay0 hover:text-blue")}
        title="More actions"
      >
        <MoreVertical size={13} />
      </button>
      {open && (
        <>
          <ActionMenuBackdrop onClose={onClose} />
          <ActionMenuPanel autoFlip className="absolute right-0">
            {children}
          </ActionMenuPanel>
        </>
      )}
    </div>
  );
}
