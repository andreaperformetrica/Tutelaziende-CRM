import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListStatiPraticaQueryKey, useCreateStatoPratica, useDeleteStatoPratica, useListStatiPratica, useOrdinaStatiPratica, useUpdateStatoPratica, type StatoPratica,
} from "@workspace/api-client-react";
import { ArrowDown, ArrowUp, Check, ListOrdered, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, FieldError, PageHeader } from "@/components/common";
import { ConfermaElimina } from "@/components/pratiche/conferma-elimina";
import { useToast } from "@/hooks/use-toast";
import { parseApiError } from "@/lib/format";

export default function StatiPraticaPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useListStatiPratica();
  const create = useCreateStatoPratica();
  const update = useUpdateStatoPratica();
  const del = useDeleteStatoPratica();
  const ordina = useOrdinaStatiPratica();
  const [nome, setNome] = useState("");
  const [chiuso, setChiuso] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [modId, setModId] = useState<number | null>(null);
  const [modNome, setModNome] = useState("");
  const [daEliminare, setDaEliminare] = useState<StatoPratica | null>(null);
  const stati = q.data ?? [];
  const ricarica = () => qc.invalidateQueries({ queryKey: getListStatiPraticaQueryKey() });
  const onError = (e: unknown) => setErr(parseApiError(e).message);

  const aggiungi = () => {
    if (!nome.trim()) return setErr("Inserisci il nome dello stato");
    setErr(null);
    create.mutate({ data: { nome: nome.trim(), chiuso } }, { onSuccess: () => { ricarica(); setNome(""); setChiuso(false); toast({ title: "Stato creato" }); }, onError });
  };
  const sposta = (i: number, d: -1 | 1) => {
    const ids = stati.map((s) => s.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    setErr(null);
    ordina.mutate({ data: { ids } }, { onSuccess: (r) => qc.setQueryData(getListStatiPraticaQueryKey(), r), onError: (e) => { onError(e); ricarica(); } });
  };
  const rinomina = (s: StatoPratica) => {
    if (!modNome.trim()) return setErr("Inserisci il nome dello stato");
    setErr(null);
    update.mutate({ id: s.id, data: { nome: modNome.trim(), chiuso: s.chiuso } }, { onSuccess: () => { ricarica(); setModId(null); }, onError });
  };

  return (
    <div>
      <PageHeader kicker="Configurazione" title="Stati pratica"
        subtitle="Gli stati che può assumere una pratica, nell'ordine in cui compaiono. Gli stati segnati come chiusi indicano pratiche concluse." />
      {q.isLoading ? <Skeleton className="h-64 w-full" />
        : q.isError ? <ErrorState message="Impossibile caricare gli stati." onRetry={() => q.refetch()} />
        : (
          <div className="space-y-5">
            {!stati.length ? <EmptyState icon={<ListOrdered className="size-6" />} title="Nessuno stato" text="Aggiungi il primo stato qui sotto." /> : (
              <ol className="divide-y divide-border rounded-lg border border-border bg-card rise" data-testid="elenco-stati">
                {stati.map((s, i) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 p-2.5" data-testid={`riga-stato-${s.id}`}>
                    <span className="w-6 text-center text-sm tabular-nums text-muted-foreground">{i + 1}</span>
                    <div className="flex">
                      <Button size="icon" variant="ghost" className="size-8" disabled={i === 0 || ordina.isPending} onClick={() => sposta(i, -1)} aria-label={`Sposta in alto ${s.nome}`} data-testid={`button-su-stato-${s.id}`}><ArrowUp className="size-4" /></Button>
                      <Button size="icon" variant="ghost" className="size-8" disabled={i === stati.length - 1 || ordina.isPending} onClick={() => sposta(i, 1)} aria-label={`Sposta in basso ${s.nome}`} data-testid={`button-giu-stato-${s.id}`}><ArrowDown className="size-4" /></Button>
                    </div>
                    {modId === s.id ? (
                      <div className="flex items-center gap-1">
                        <Input className="h-8 w-56" value={modNome} onChange={(e) => setModNome(e.target.value)} maxLength={60} autoFocus data-testid={`input-nome-stato-${s.id}`} onKeyDown={(e) => { if (e.key === "Enter") rinomina(s); }} />
                        <Button size="icon" variant="ghost" className="size-8" onClick={() => rinomina(s)} aria-label="Conferma" data-testid={`button-conferma-nome-stato-${s.id}`}><Check className="size-4" /></Button>
                        <Button size="icon" variant="ghost" className="size-8" onClick={() => setModId(null)} aria-label="Annulla"><X className="size-4" /></Button>
                      </div>
                    ) : <span className="font-semibold" data-testid={`nome-stato-${s.id}`}>{s.nome}</span>}
                    <div className="ml-auto flex items-center gap-3">
                      <label className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Switch checked={s.chiuso} disabled={update.isPending} onCheckedChange={(c) => update.mutate({ id: s.id, data: { nome: s.nome, chiuso: c } }, { onSuccess: ricarica, onError })} data-testid={`switch-chiuso-stato-${s.id}`} />
                        Chiusa
                      </label>
                      <Button size="icon" variant="ghost" className="size-8" onClick={() => { setModId(s.id); setModNome(s.nome); setErr(null); }} aria-label={`Rinomina ${s.nome}`} data-testid={`button-rinomina-stato-${s.id}`}><Pencil className="size-4" /></Button>
                      <Button size="icon" variant="ghost" className="size-8 text-destructive" onClick={() => setDaEliminare(s)} aria-label={`Elimina ${s.nome}`} data-testid={`button-elimina-stato-${s.id}`}><Trash2 className="size-4" /></Button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-56 flex-1 max-w-sm">
                <Label htmlFor="nuovo-stato">Nuovo stato</Label>
                <Input id="nuovo-stato" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} placeholder="Es. In attesa di documenti" data-testid="input-nuovo-stato" onKeyDown={(e) => { if (e.key === "Enter") aggiungi(); }} />
              </div>
              <label className="flex items-center gap-2 text-sm pb-2"><Switch checked={chiuso} onCheckedChange={setChiuso} data-testid="switch-nuovo-stato-chiuso" /> Chiusa</label>
              <Button onClick={aggiungi} disabled={create.isPending} data-testid="button-aggiungi-stato"><Plus className="size-4 mr-2" /> Aggiungi</Button>
            </div>
            <FieldError id="errore-stati">{err ?? undefined}</FieldError>
          </div>
        )}
      <ConfermaElimina aperto={!!daEliminare} titolo={`Eliminare lo stato "${daEliminare?.nome ?? ""}"?`} testo="L'azione non si può annullare."
        onAnnulla={() => setDaEliminare(null)}
        onConferma={() => { const s = daEliminare!; setDaEliminare(null); del.mutate({ id: s.id }, { onSuccess: () => { ricarica(); toast({ title: "Stato eliminato" }); }, onError }); }} />
    </div>
  );
}
