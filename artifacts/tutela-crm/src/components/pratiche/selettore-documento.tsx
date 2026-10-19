import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListDocumentiNotiQueryKey, useCreateDocumentoNoto, useListDocumentiNoti } from "@workspace/api-client-react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { parseApiError } from "@/lib/format";

const NUOVO = "__nuovo__";

/**
 * Menu a tendina dei documenti già noti. L'ultima voce permette di crearne uno nuovo senza lasciare la pagina:
 * il documento creato entra nell'elenco e viene selezionato.
 */
export function SelettoreDocumento({
  id, etichetta, valore, onChange, esclusi = [], testId,
}: { id: string; etichetta: string; valore: string; onChange: (nome: string) => void; esclusi?: string[]; testId: string }) {
  const qc = useQueryClient();
  const noti = useListDocumentiNoti();
  const crea = useCreateDocumentoNoto();
  const [creando, setCreando] = useState(false);
  const [nuovo, setNuovo] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const usati = new Set(esclusi.map((n) => n.toLowerCase()));
  const elenco = (noti.data ?? []).filter((d) => !usati.has(d.nome.toLowerCase()) || d.nome === valore);

  const conferma = () => {
    if (!nuovo.trim()) return setErrore("Scrivi il nome del documento");
    setErrore(null);
    crea.mutate({ data: { nome: nuovo.trim() } }, {
      onSuccess: async (d) => {
        await qc.invalidateQueries({ queryKey: getListDocumentiNotiQueryKey() });
        onChange(d.nome); setCreando(false); setNuovo("");
      },
      onError: (e) => setErrore(parseApiError(e).message),
    });
  };

  return (
    <div className="min-w-56 flex-1 max-w-sm">
      <Label htmlFor={id}>{etichetta}</Label>
      <Select value={creando ? NUOVO : valore} onValueChange={(v) => { if (v === NUOVO) { setCreando(true); setErrore(null); } else { setCreando(false); onChange(v); } }}>
        <SelectTrigger id={id} className="bg-card w-full" data-testid={`select-${testId}`}><SelectValue placeholder="Scegli il documento" /></SelectTrigger>
        <SelectContent>
          {elenco.map((d) => <SelectItem key={d.nome} value={d.nome}>{d.nome}</SelectItem>)}
          {elenco.length > 0 && <SelectSeparator />}
          <SelectItem value={NUOVO} data-testid={`opzione-nuovo-${testId}`}>+ Crea un nuovo documento</SelectItem>
        </SelectContent>
      </Select>
      {creando && (
        <div className="mt-2 flex gap-2">
          <Input value={nuovo} onChange={(e) => setNuovo(e.target.value)} maxLength={100} placeholder="Nome del nuovo documento" autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); conferma(); } }} data-testid={`input-nuovo-${testId}`} />
          <Button type="button" onClick={conferma} disabled={crea.isPending} data-testid={`button-crea-${testId}`}>
            {crea.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Plus className="size-4 mr-2" />} Crea
          </Button>
        </div>
      )}
      {errore && <p className="mt-1 text-sm font-medium text-destructive" role="alert">{errore}</p>}
    </div>
  );
}
