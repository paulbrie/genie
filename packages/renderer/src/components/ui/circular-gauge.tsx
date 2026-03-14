const ARC_DEG = 240;
const GAP_DEG = 360 - ARC_DEG;
const START_ANGLE = 90 + GAP_DEG / 2;

function gaugeColor(percent: number): string {
  return percent >= 90 ? "var(--color-red)" : percent >= 70 ? "var(--color-peach)" : "var(--color-green)";
}

export function CircularGauge({
  label,
  percent,
  size = 34,
  strokeWidth = 3,
  subtitle,
  showPercentSign = false,
  labelClassName = "text-xs text-overlay0 font-medium leading-none",
  valueClassName = "text-subtext0 font-mono",
  valueFontSize = 9,
}: {
  label: string;
  percent: number;
  size?: number;
  strokeWidth?: number;
  subtitle?: string;
  showPercentSign?: boolean;
  labelClassName?: string;
  valueClassName?: string;
  valueFontSize?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const fullCirc = 2 * Math.PI * radius;
  const arcLen = (ARC_DEG / 360) * fullCirc;
  const offset = arcLen - (Math.min(percent, 100) / 100) * arcLen;

  return (
    <div className="flex flex-col items-center gap-0.5" title={`${label}: ${percent}%${subtitle ? ` (${subtitle})` : ""}`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: `rotate(${START_ANGLE}deg)` }}>
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke="var(--color-surface1)" strokeWidth={strokeWidth}
            strokeDasharray={`${arcLen} ${fullCirc}`}
            strokeLinecap="round"
          />
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke={gaugeColor(percent)} strokeWidth={strokeWidth}
            strokeDasharray={`${arcLen} ${fullCirc}`}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-500"
          />
        </svg>
        <span
          className={`absolute inset-0 flex items-center justify-center ${valueClassName}`}
          style={{ fontSize: valueFontSize }}
        >
          {percent}{showPercentSign && "%"}
        </span>
      </div>
      <span className={labelClassName}>{label}</span>
      {subtitle && <span className="text-xs text-overlay0 font-mono leading-none">{subtitle}</span>}
    </div>
  );
}
