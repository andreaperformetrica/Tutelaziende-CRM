import type { PrioritaPratica, ScadenzaPratica } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { fmtIstante } from "@/lib/format";

export const PRIORITA: { value: PrioritaPratica; label: string; colore: string }[] = [
  { value: "urgente", label: "Urgente", colore: "#b91c1c" },
  { value: "media", label: "Media", colore: "#b45309" },
  { value: "bassa", label: "Bassa", colore: "#15803d" },
];

/** Etichetta colorata della priorità: Urgente rosso, Media arancio, Bassa verde. */
export function PrioritaBadge({ priorita, className, testId }: { priorita: PrioritaPratica; className?: string; testId?: string }) {
  const p = PRIORITA.find((x) => x.value === priorita) ?? PRIORITA[1]!;
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold text-white whitespace-nowrap", className)}
      style={{ backgroundColor: p.colore }} data-testid={testId}>
      {p.label}
    </span>
  );
}

/** Quanto manca alla scadenza (o da quanto è scaduta), in parole. */
export function testoGiorni(s: Pick<ScadenzaPratica, "stato" | "giorniResidui">): string {
  const g = Math.abs(s.giorniResidui);
  const giorni = g === 1 ? "1 giorno" : `${g} giorni`;
  if (s.stato === "superata") return `scaduta da ${giorni}`;
  return s.giorniResidui === 0 ? "scade oggi" : `mancano ${giorni}`;
}

/** Scadenza della pratica: data e ora, colorata se è vicina (arancio) o superata (rosso). */
export function ScadenzaEtichetta({ scadenza, testId }: { scadenza: ScadenzaPratica | null | undefined; testId?: string }) {
  if (!scadenza) return <span className="text-muted-foreground">—</span>;
  const colore = scadenza.stato === "superata" ? "text-red-700 font-semibold" : scadenza.stato === "vicina" ? "text-amber-700 font-semibold" : "";
  return (
    <span className={cn("tabular-nums whitespace-nowrap", colore)} data-testid={testId}>
      {fmtIstante(scadenza.scadenzaIl)}
      {scadenza.stato !== "in_corso" && <span className="block text-xs font-medium">{testoGiorni(scadenza)}</span>}
    </span>
  );
}
