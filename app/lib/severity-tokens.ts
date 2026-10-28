/** Single source of truth for the severity hex scale.
 *
 *  Consumed by:
 *  - components/severity.tsx (severityMeta → icons, labels, inline colors)
 *  - scripts/sync-severity-css.ts (generates app/severity-vars.css at build
 *    time, so the CSS custom properties are derived from here — do not hand-
 *    edit hex values in app/globals.css or in severityMeta anymore).
 *
 *  Regenerate the CSS with `pnpm severity:sync` (runs automatically before
 *  `pnpm dev` / `pnpm build` / `pnpm start`).
 */
export const severityTokens = {
  ok: "#34D399",
  info: "#7C8AA8",
  warning: "#F0A34E",
  critical: "#F0576B",
} as const;

export type SeverityToken = keyof typeof severityTokens;