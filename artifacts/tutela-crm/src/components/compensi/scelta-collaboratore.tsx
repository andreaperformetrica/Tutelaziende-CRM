import { useListCollaboratori } from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Elenco dei collaboratori per i filtri dei compensi. `valore` e' l'id come testo, oppure "all" quando e' ammesso. */
export function SceltaCollaboratore({ valore, onChange, conTutti, testid }: { valore: string; onChange: (v: string) => void; conTutti?: boolean; testid?: string }) {
  const lista = useListCollaboratori({ stato: "tutti" });
  return (
    <Select value={valore} onValueChange={onChange}>
      <SelectTrigger className="w-64 bg-card" data-testid={testid}><SelectValue placeholder="Scegli il collaboratore" /></SelectTrigger>
      <SelectContent>
        {conTutti && <SelectItem value="all">Tutti i collaboratori</SelectItem>}
        {(lista.data ?? []).map((c) => (
          <SelectItem key={c.id} value={String(c.id)}>{c.cognome} {c.nome} · sportello {c.numeroSportello}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
