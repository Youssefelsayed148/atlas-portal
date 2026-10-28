import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { severityTokens } from "@/app/lib/severity-tokens";

export type Severity = "ok" | "info" | "warning" | "critical";

/** Hex values come from the shared severityTokens module — the same source the
 *  CSS custom properties are generated from (app/severity-vars.css). The glow
 *  effects build rgba strings from these hexes. Do not hand-edit hex values here. */
export const severityMeta: Record<
  Severity,
  { label: string; hex: string; Icon: LucideIcon }
> = {
  ok: { label: "Healthy", hex: severityTokens.ok, Icon: CheckCircle2 },
  info: { label: "Info", hex: severityTokens.info, Icon: Clock },
  warning: { label: "Warning", hex: severityTokens.warning, Icon: AlertTriangle },
  critical: { label: "Critical", hex: severityTokens.critical, Icon: XCircle },
};

/** Alert severities are info|warning|critical; absence of an open alert reads as ok. */
export function alertSeverity(severity?: string | null): Severity {
  if (severity === "critical" || severity === "warning" || severity === "info") {
    return severity;
  }
  return "ok";
}

/** Log levels (info|warning|error) mapped onto the same visual scale. */
export function logLevelSeverity(level: string): Severity {
  if (level === "error") return "critical";
  if (level === "warning") return "warning";
  return "info";
}

/** Icon + coloured label, used in the triage table and client detail header. */
export function SeverityTag({
  severity,
  showLabel = true,
  className = "",
}: {
  severity: Severity;
  showLabel?: boolean;
  className?: string;
}) {
  const { label, hex, Icon } = severityMeta[severity];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11.5px] font-medium ${className}`}
      style={{ color: hex }}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {showLabel ? label : <span className="sr-only">{label}</span>}
    </span>
  );
}

/** The logs explorer alone uses a brighter blue for info, so info rows stay scannable
 *  against a dense list. Everywhere else (KPI tiles, triage, client header) info stays
 *  the muted severityMeta.info hex. */
const LOG_INFO_HEX = "#38BDF8";

/** Pill form for log levels in the logs explorer. */
export function LogLevelBadge({ level }: { level: string }) {
  const severity = logLevelSeverity(level);
  const { hex, Icon } = severityMeta[severity];
  const color = severity === "info" ? LOG_INFO_HEX : hex;
  return (
    <span
      className="inline-flex h-5 w-fit items-center gap-1 rounded-4xl border px-2 text-xs font-medium"
      style={{
        color,
        borderColor: `${color}55`,
        backgroundColor: `${color}1A`,
      }}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {level}
    </span>
  );
}
