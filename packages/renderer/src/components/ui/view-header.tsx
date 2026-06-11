import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

interface ViewHeaderProps {
  title: string;
  subtitle?: ReactNode;
  statusIndicator?: ReactNode;
  actions?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
}

export function ViewHeader({ title, subtitle, statusIndicator, actions, onBack, backLabel = "Back" }: ViewHeaderProps) {
  return (
    <div className="flex items-center justify-between h-12 border-b border-surface0 shrink-0">
      <div className="flex items-center gap-2.5 min-w-0">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center justify-center w-7 h-7 -ml-1 rounded text-overlay0 hover:text-text hover:bg-surface0 transition-colors shrink-0"
            title={backLabel}
            aria-label={backLabel}
          >
            <ArrowLeft size={16} />
          </button>
        )}
        {statusIndicator}
        <div className="flex items-baseline gap-2 min-w-0">
          <h2 className="text-lg font-semibold text-text whitespace-nowrap">{title}</h2>
          {subtitle && <span className="text-md text-overlay0 truncate">{subtitle}</span>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
    </div>
  );
}
