import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListServiziImportQueryKey, getGetImportazioneQueryKey, useUpdateServizioImport, type ServizioImport } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { parseApiError } from "@/lib/format";

type Regola = "fisso" | "percentuale";
type TipoChiave = "sportello" | "email" | "nome";

export const TESTO_REGOLA = (s: ServizioImport): string => {
  if (!s.configurato || !s.regola || s.valore === null) return "Regola non ancora impostata";
  const v = String(s.valore).replace(".", ",");
  return s.regola === "fisso" ? `${v} euro per ogni riga` : `${v}% della colonna «${s.colonnaImporto}»`;
};

export const TESTO_CHIAVE: Record<TipoChiave, string> = { sportello: "Numero sportello", email: "Email", nome: "Cognome e nome" };

/** Regola di calcolo e colonne del file di un servizio. Con le intestazioni del file le colonne si scelgono da elenco. */
export function RegolaImportForm({ servizio, intestazioni, aperto, onChiudi, importazioneId }: {
  servizio: ServizioImport | null; intestazioni?: string[]; aperto: boolean; onChiudi: () => void; importazioneId?: number;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const salva = useUpdateServizioImport();
  const [regola, setRegola] = useState<Regola>("fisso");
  const [valore, setValore] = useState("");
  const [tipo, setTipo] = useState<TipoChiave>("sportello");
  const [colChiave, setColChiave] = useState("");
  const [colImporto, setColImporto] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!aperto || !servizio) return;
    setRegola((servizio.regola as Regola | null) ?? "fisso");
    setValore(servizio.valore === null ? "" : String(servizio.valore).replace(".", ","));
    setTipo(servizio.tipoChiave as TipoChiave);
    setColChiave(servizio.colonnaChiave ?? "");
    setColImporto(servizio.colonnaImporto ?? "");
    setErr(null);
  }, [aperto, servizio]);

  if (!servizio) return null;
  const colonna = (v: string, set: (x: string) => void, id: string) =>
    intestazioni?.length ? (
      <Select value={v} onValueChange={set}>
        <SelectTrigger id={id} data-testid={`select-${id}`}><SelectValue placeholder="Scegli la colonna" /></SelectTrigger>
        <SelectContent>{intestazioni.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
      </Select>
    ) : (
      <Input id={id} value={v} maxLength={120} placeholder="Titolo della colonna nel file" onChange={(e) => set(e.target.value)} data-testid={`input-${id}`} />
    );

  const conferma = () => {
    const n = Number(valore.replace(",", "."));
    if (!valore.trim() || !Number.isFinite(n) || n < 0) return setErr(regola === "fisso" ? "Inserisci l'importo per riga in euro." : "Inserisci la percentuale.");
    if (!colChiave.trim()) return setErr("Indica la colonna che identifica il collaboratore.");
    if (regola === "percentuale" && !colImporto.trim()) return setErr("Indica la colonna dell'importo.");
    setErr(null);
    salva.mutate({ servizio: servizio.servizio, data: { regola, valore: n, colonnaChiave: colChiave.trim(), tipoChiave: tipo, colonnaImporto: regola === "percentuale" ? colImporto.trim() : null } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListServiziImportQueryKey() });
        if (importazioneId) qc.invalidateQueries({ queryKey: getGetImportazioneQueryKey(importazioneId) });
        toast({ title: "Regola salvata", description: `Import ${servizio.etichetta} aggiornato.` });
        onChiudi();
      },
      onError: (x) => setErr(parseApiError(x).message),
    });
  };

  return (
    <Dialog open={aperto} onOpenChange={(o) => { if (!o) onChiudi(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Regola di calcolo · {servizio.etichetta}</DialogTitle>
          <DialogDescription>Vale per i prossimi file importati di questo servizio.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="regola">Compenso</Label>
              <Select value={regola} onValueChange={(v) => setRegola(v as Regola)}>
                <SelectTrigger id="regola" data-testid="select-regola"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="fisso">Importo fisso per riga</SelectItem><SelectItem value="percentuale">Percentuale di una colonna</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="valore">{regola === "fisso" ? "Importo per riga (euro)" : "Percentuale (%)"}</Label>
              <Input id="valore" inputMode="decimal" placeholder={regola === "fisso" ? "0,00" : "0,00"} value={valore} onChange={(e) => setValore(e.target.value)} data-testid="input-valore-regola" />
            </div>
          </div>
          {regola === "percentuale" && <div className="space-y-1.5"><Label htmlFor="col-importo">Colonna dell'importo</Label>{colonna(colImporto, setColImporto, "col-importo")}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="tipo-chiave">Il collaboratore si riconosce da</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoChiave)}>
                <SelectTrigger id="tipo-chiave" data-testid="select-tipo-chiave"><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(TESTO_CHIAVE) as TipoChiave[]).map((k) => <SelectItem key={k} value={k}>{TESTO_CHIAVE[k]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="col-chiave">Colonna del collaboratore</Label>{colonna(colChiave, setColChiave, "col-chiave")}</div>
          </div>
          {err && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 text-destructive px-3 py-2 text-sm">{err}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onChiudi}>Annulla</Button>
          <Button onClick={conferma} disabled={salva.isPending} data-testid="button-salva-regola">Salva regola</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
