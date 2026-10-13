import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useListAssistiti } from "@workspace/api-client-react";
import { ChevronRight, Search, UserPlus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FieldError } from "@/components/common";
import { DialogApriPratica } from "@/components/pratiche/dialog-apri-pratica";
import { useSession } from "@/lib/auth";
import { parseApiError } from "@/lib/format";

/**
 * Nuova pratica dall'elenco delle pratiche: si cerca uno dei propri assistiti (che può avere più pratiche aperte),
 * poi si sceglie il tipo di pratica.
 */
export function DialogNuovaPratica({ aperto, onClose }: { aperto: boolean; onClose: () => void }) {
  const [, nav] = useLocation();
  const { session } = useSession();
  const mioId = session?.collaboratore?.id;
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [scelto, setScelto] = useState<{ id: number; nome: string } | null>(null);
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (aperto) { setQ(""); setDq(""); setScelto(null); } }, [aperto]);

  const lista = useListAssistiti({ ...(dq ? { q: dq } : {}), ...(mioId ? { collaboratoreId: mioId } : {}), pagina: 1, perPagina: 30 }, { query: { enabled: aperto && !!mioId, queryKey: ["assistiti-nuova-pratica", dq, mioId] } });
  const elenco = (lista.data?.elementi ?? []).filter((a) => a.modificabile);

  return (
    <>
      <Dialog open={aperto && !scelto} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[90dvh] flex flex-col" data-testid="dialog-nuova-pratica">
          <DialogHeader>
            <DialogTitle>Nuova pratica</DialogTitle>
            <DialogDescription>Scegli l'assistito. Un assistito può avere più pratiche aperte.</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca nome, cognome o codice fiscale" className="pl-9" data-testid="input-cerca-assistito-pratica" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto -mx-1 px-1">
            {lista.isLoading ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
            ) : lista.isError ? (
              <FieldError>{parseApiError(lista.error).message}</FieldError>
            ) : elenco.length === 0 ? (
              <div className="text-center py-6 space-y-3">
                <p className="text-sm text-muted-foreground">{dq ? "Nessun tuo assistito corrisponde alla ricerca." : "Non hai ancora assistiti."}</p>
                <Button variant="outline" onClick={() => { onClose(); nav("/collaboratore/assistiti/nuovo"); }} data-testid="button-nuovo-assistito-da-pratica"><UserPlus className="size-4 mr-1.5" /> Registra un nuovo assistito</Button>
              </div>
            ) : (
              <ul className="space-y-2">
                {elenco.map((a) => (
                  <li key={a.id}>
                    <button onClick={() => setScelto({ id: a.id, nome: `${a.cognome} ${a.nome}` })} data-testid={`scelta-assistito-${a.id}`}
                      className="w-full flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-3 text-left hover:border-primary active:bg-secondary/60 transition-colors">
                      <span className="min-w-0">
                        <span className="block font-semibold truncate">{a.cognome} {a.nome}</span>
                        <span className="block font-mono text-xs text-muted-foreground tracking-wider">{a.codiceFiscale}</span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <DialogApriPratica assistito={aperto ? scelto : null} onClose={() => { setScelto(null); onClose(); }} />
    </>
  );
}
