import { useEffect, useState } from "react";
import { useListCollaboratori } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { nomeCollaboratore } from "@/lib/format";

/** Dialogo per scegliere un collaboratore attivo (usato per cambiare collaboratore o associare una segnalazione). */
export function DialogCollaboratore({ open, onClose, titolo, descrizione, etichettaConferma, iniziale, escludiId, conNota, pending, errore, onConfirm }: {
  open: boolean; onClose: () => void; titolo: string; descrizione: string; etichettaConferma: string;
  iniziale?: number | null; escludiId?: number | null; conNota?: boolean; pending: boolean; errore: string | null;
  onConfirm: (collaboratoreId: number, nota: string) => void;
}) {
  const lista = useListCollaboratori({ stato: "attivi" }, { query: { enabled: open, queryKey: ["collaboratori-attivi-dialogo"] } });
  const [scelto, setScelto] = useState("");
  const [nota, setNota] = useState("");
  useEffect(() => { if (open) { setScelto(iniziale ? String(iniziale) : ""); setNota(""); } }, [open, iniziale]);
  const opzioni = (lista.data ?? []).filter((c) => c.id !== escludiId);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="dialog-collaboratore">
        <DialogHeader>
          <DialogTitle>{titolo}</DialogTitle>
          <DialogDescription>{descrizione}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Collaboratore</Label>
          <Select value={scelto} onValueChange={setScelto}>
            <SelectTrigger data-testid="select-collaboratore-destinazione"><SelectValue placeholder="Seleziona un collaboratore" /></SelectTrigger>
            <SelectContent>
              {opzioni.map((c) => <SelectItem key={c.id} value={String(c.id)}>{nomeCollaboratore(c)} · sportello {c.numeroSportello}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {conNota && (
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nota (facoltativa)</Label>
            <Textarea value={nota} onChange={(e) => setNota(e.target.value)} maxLength={1000} data-testid="input-nota" />
          </div>
        )}
        {errore && <p className="text-sm font-medium text-destructive" role="alert" data-testid="errore-dialogo">{errore}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} data-testid="button-annulla-dialogo">Annulla</Button>
          <Button disabled={pending || !scelto} onClick={() => onConfirm(Number(scelto), nota)} data-testid="button-conferma-dialogo">
            {pending && <Loader2 className="size-4 mr-2 animate-spin" />} {etichettaConferma}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
