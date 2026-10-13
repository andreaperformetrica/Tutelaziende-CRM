import { cn } from "@/lib/utils";
import { COLORI_UTENTI } from "@/components/utenti/colore-utente";

type DatiStato = { id?: number | null; nome: string; chiuso?: boolean; colore?: string | null };

/**
 * Colore dell'etichetta di uno stato: quello scelto dall'admin; se manca, uno automatico che riconosce
 * gli stati iniziali dal nome e per gli altri usa la tavolozza in base all'id (verde se lo stato è chiuso).
 */
export function coloreStato(s: DatiStato): string {
  if (s.colore) return s.colore;
  const n = s.nome.toLowerCase();
  if (n.includes("bozza")) return "#64748b";
  if (n.includes("inps")) return "#7e22ce";
  if (n.includes("lavorazione")) return "#a16207";
  if (n.includes("positiv")) return "#15803d";
  if (n.includes("da pagare")) return "#c2410c";
  if (n.includes("pagata")) return "#0f766e";
  if (n.includes("inviata")) return "#1d4ed8";
  if (s.chiuso) return "#15803d";
  const libera = COLORI_UTENTI.filter((c) => c.valore !== "#15803d");
  return libera[Math.abs(s.id ?? 0) % libera.length]!.valore;
}

/** Etichetta colorata di uno stato pratica. */
export function StatoBadge({ stato, className, testId }: { stato: DatiStato; className?: string; testId?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold text-white whitespace-nowrap", className)}
      style={{ backgroundColor: coloreStato(stato) }} data-testid={testId}>
      {stato.nome}
    </span>
  );
}
