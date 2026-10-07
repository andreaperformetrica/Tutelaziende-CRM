import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getListPraticheQueryKey, useCreatePratica, useListTipiPraticaDisponibili } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FieldError } from "@/components/common";
import { parseApiError } from "@/lib/format";

/** Scelta del tipo di pratica per un assistito: crea la bozza e apre la pagina della pratica. */
export function DialogApriPratica({ assistito, onClose }: { assistito: { id: number; nome: string } | null; onClose: () => void }) {
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const [tipo, setTipo] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const tipi = useListTipiPraticaDisponibili({ query: { enabled: !!assistito, queryKey: ["tipi-pratica-disponibili"] } });
  const crea = useCreatePratica();
  useEffect(() => { if (assistito) { setTipo(""); setErrore(null); } }, [assistito]);
  const elenco = tipi.data ?? [];

  return (
    <Dialog open={!!assistito} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="dialog-apri-pratica">
        <DialogHeader>
          <DialogTitle>Apri pratica</DialogTitle>
          <DialogDescription>Scegli il tipo di pratica per {assistito?.nome}. Nella pagina successiva vedrai i moduli da scaricare e potrai caricare i documenti.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tipo di pratica</Label>
          <Select value={tipo} onValueChange={setTipo}>
            <SelectTrigger data-testid="select-tipo-pratica"><SelectValue placeholder={tipi.isLoading ? "Caricamento" : "Seleziona il tipo di pratica"} /></SelectTrigger>
            <SelectContent>{elenco.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.nome}</SelectItem>)}</SelectContent>
          </Select>
          {tipi.isError && <FieldError>{parseApiError(tipi.error).message}</FieldError>}
          {tipi.isSuccess && elenco.length === 0 && <FieldError>Nessun tipo di pratica disponibile. Contatta l'amministrazione.</FieldError>}
        </div>
        {errore && <FieldError>{errore}</FieldError>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-annulla-apri-pratica">Annulla</Button>
          <Button disabled={!tipo || crea.isPending} data-testid="button-conferma-apri-pratica"
            onClick={() => assistito && crea.mutate({ data: { assistitoId: assistito.id, tipoPraticaId: Number(tipo) } }, {
              onSuccess: (p) => { qc.invalidateQueries({ queryKey: getListPraticheQueryKey() }); onClose(); nav(`/collaboratore/pratiche/${p.id}`); },
              onError: (e) => setErrore(parseApiError(e).message),
            })}>
            {crea.isPending && <Loader2 className="size-4 mr-2 animate-spin" />} Apri pratica
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
