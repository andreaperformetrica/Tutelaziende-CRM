import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { iniziali } from "@/lib/format";

/** Tavolozza proposta per gli utenti interni: tutti i colori reggono il testo bianco. */
export const COLORI_UTENTI: { valore: string; nome: string }[] = [
  { valore: "#1d4ed8", nome: "Blu" },
  { valore: "#0e7490", nome: "Ciano" },
  { valore: "#0f766e", nome: "Verde acqua" },
  { valore: "#15803d", nome: "Verde" },
  { valore: "#a16207", nome: "Ocra" },
  { valore: "#c2410c", nome: "Arancio" },
  { valore: "#b91c1c", nome: "Rosso" },
  { valore: "#be185d", nome: "Rosa" },
  { valore: "#7e22ce", nome: "Viola" },
  { valore: "#4338ca", nome: "Indaco" },
  { valore: "#475569", nome: "Ardesia" },
  { valore: "#78350f", nome: "Marrone" },
];

/** Colore da mostrare: quello scelto, altrimenti uno automatico ma stabile ricavato dall'id. */
export function coloreUtente(colore: string | null | undefined, id: number): string {
  return colore ?? COLORI_UTENTI[Math.abs(id) % COLORI_UTENTI.length]!.valore;
}

export function UtenteAvatar({ id, colore, nome, cognome, className }: { id: number; colore?: string | null; nome?: string; cognome?: string; className?: string }) {
  return (
    <span
      className={cn("inline-grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white", className)}
      style={{ backgroundColor: coloreUtente(colore, id) }}
      aria-hidden="true"
    >
      {iniziali(nome, cognome)}
    </span>
  );
}

/** Pallino colorato seguito dal testo (nome dell'utente interno). */
export function UtenteChip({ id, colore, children, className }: { id: number; colore?: string | null; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: coloreUtente(colore, id) }} aria-hidden="true" />
      {children}
    </span>
  );
}

export function SelettoreColore({ value, onChange, idUtente }: { value: string | null; onChange: (c: string | null) => void; idUtente: number | null }) {
  const effettivo = idUtente !== null ? coloreUtente(value, idUtente) : value;
  return (
    <div className="space-y-2" data-testid="selettore-colore">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colore dell'utente">
        {COLORI_UTENTI.map((c) => {
          const scelto = value?.toLowerCase() === c.valore;
          return (
            <button key={c.valore} type="button" role="radio" aria-checked={scelto} title={c.nome} aria-label={c.nome}
              onClick={() => onChange(c.valore)} data-testid={`colore-${c.valore.slice(1)}`}
              className={cn("grid size-8 place-items-center rounded-full text-white outline-none ring-offset-2 ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring", scelto && "ring-2 ring-foreground")}
              style={{ backgroundColor: c.valore }}>
              {scelto && <Check className="size-4" />}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {effettivo && <span className="size-3 rounded-full" style={{ backgroundColor: effettivo }} aria-hidden="true" />}
        {value ? (
          <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => onChange(null)} data-testid="colore-automatico">Torna al colore automatico</button>
        ) : "Colore automatico: scegline uno per fissarlo."}
      </div>
    </div>
  );
}
