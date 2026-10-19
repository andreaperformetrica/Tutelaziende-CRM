import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useListScadenzeInCarico } from "@workspace/api-client-react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { testoGiorni } from "@/components/pratiche/priorita";
import { fmtIstante } from "@/lib/format";
import { cn } from "@/lib/utils";

const CHIAVE = "scadenze-popup-chiuso";

/**
 * Avviso nelle "Le mie pratiche": elenca le pratiche in carico all'utente con scadenza vicina o superata.
 * Non compare se non ce ne sono (e quindi neppure per i tipi di pratica senza scadenza). Chiuso, non riappare in questa sessione
 * finché l'elenco delle pratiche in scadenza non cambia.
 */
export function PopupScadenze() {
  const [, nav] = useLocation();
  const q = useListScadenzeInCarico({ query: { queryKey: ["pratiche-backoffice", "scadenze"], refetchOnWindowFocus: true } });
  const [aperto, setAperto] = useState(false);
  const elenco = q.data ?? [];
  const firma = elenco.map((x) => `${x.id}:${x.stato}`).join(",");

  useEffect(() => {
    if (!firma) { setAperto(false); return; }
    setAperto(sessionStorage.getItem(CHIAVE) !== firma);
  }, [firma]);

  const chiudi = () => { sessionStorage.setItem(CHIAVE, firma); setAperto(false); };
  const superate = elenco.filter((x) => x.stato === "superata").length;

  return (
    <Dialog open={aperto} onOpenChange={(o) => { if (!o) chiudi(); }}>
      <DialogContent className="max-w-2xl" data-testid="popup-scadenze">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><AlertTriangle className="size-5 text-amber-600" /> Pratiche in scadenza</DialogTitle>
          <DialogDescription>
            {elenco.length === 1 ? "Hai 1 pratica" : `Hai ${elenco.length} pratiche`} in carico con scadenza vicina o superata
            {superate > 0 ? ` (${superate} già scadut${superate === 1 ? "a" : "e"})` : ""}.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-[50vh] overflow-y-auto divide-y divide-border rounded-md border border-border">
          {elenco.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5" data-testid={`scadenza-pratica-${x.id}`}>
              <div className="min-w-0">
                <div className="text-sm font-semibold">Pratica n. {x.numero} · {x.assistito}</div>
                <div className="text-xs text-muted-foreground">{x.tipoNome} · scadenza {fmtIstante(x.scadenzaIl)}</div>
                <div className={cn("text-xs font-semibold", x.stato === "superata" ? "text-red-700" : "text-amber-700")}>{x.stato === "superata" ? "Scaduta" : "In scadenza"}: {testoGiorni(x)}</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => { chiudi(); nav(`/admin/pratiche/${x.id}`); }}>Apri</Button>
            </li>
          ))}
        </ul>
        <DialogFooter><Button onClick={chiudi} data-testid="button-chiudi-scadenze">Ho capito</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
