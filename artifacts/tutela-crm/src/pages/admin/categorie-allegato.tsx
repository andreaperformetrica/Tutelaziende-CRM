import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListCategorieAllegatoQueryKey, useCreateCategoriaAllegato, useDeleteCategoriaAllegato, useListCategorieAllegato, useUpdateCategoriaAllegato,
} from "@workspace/api-client-react";
import { Check, Paperclip, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, FieldError, PageHeader } from "@/components/common";
import { ConfermaElimina } from "@/components/pratiche/conferma-elimina";
import { useToast } from "@/hooks/use-toast";
import { parseApiError } from "@/lib/format";

export default function CategorieAllegatoPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useListCategorieAllegato();
  const create = useCreateCategoriaAllegato();
  const update = useUpdateCategoriaAllegato();
  const del = useDeleteCategoriaAllegato();
  const [nome, setNome] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [modId, setModId] = useState<number | null>(null);
  const [modNome, setModNome] = useState("");
  const [daEliminare, setDaEliminare] = useState<{ id: number; nome: string } | null>(null);
  const categorie = q.data ?? [];
  const ricarica = () => qc.invalidateQueries({ queryKey: getListCategorieAllegatoQueryKey() });
  const onError = (e: unknown) => setErr(parseApiError(e).message);

  const aggiungi = () => {
    if (!nome.trim()) return setErr("Inserisci il nome della categoria");
    setErr(null);
    create.mutate({ data: { nome: nome.trim() } }, { onSuccess: () => { ricarica(); setNome(""); toast({ title: "Categoria creata" }); }, onError });
  };
  const rinomina = (id: number) => {
    if (!modNome.trim()) return setErr("Inserisci il nome della categoria");
    setErr(null);
    update.mutate({ id, data: { nome: modNome.trim() } }, { onSuccess: () => { ricarica(); setModId(null); }, onError });
  };

  return (
    <div>
      <PageHeader kicker="Configurazione" title="Categorie degli allegati"
        subtitle="Le categorie tra cui l'operatore sceglie quando allega un documento a una pratica (ad esempio Estratto contributivo)." />
      {q.isLoading ? <Skeleton className="h-40 w-full" /> : q.isError ? <ErrorState message={parseApiError(q.error).message} onRetry={() => q.refetch()} /> : (
        <div className="space-y-4">
          {categorie.length === 0 ? (
            <EmptyState icon={<Paperclip className="size-6" />} title="Nessuna categoria" text="Aggiungi la prima categoria: serve agli operatori per allegare documenti alle pratiche." />
          ) : (
            <ul className="rounded-lg border border-border bg-card divide-y divide-border rise" data-testid="elenco-categorie">
              {categorie.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-2.5" data-testid={`categoria-${c.id}`}>
                  {modId === c.id ? (
                    <div className="flex flex-1 items-center gap-2">
                      <Input value={modNome} onChange={(e) => setModNome(e.target.value)} maxLength={60} className="h-8" autoFocus data-testid={`input-nome-categoria-${c.id}`} onKeyDown={(e) => { if (e.key === "Enter") rinomina(c.id); }} />
                      <Button size="icon" variant="ghost" className="size-8" onClick={() => rinomina(c.id)} aria-label="Conferma" data-testid={`button-conferma-nome-categoria-${c.id}`}><Check className="size-4" /></Button>
                      <Button size="icon" variant="ghost" className="size-8" onClick={() => setModId(null)} aria-label="Annulla"><X className="size-4" /></Button>
                    </div>
                  ) : <span className="font-semibold" data-testid={`nome-categoria-${c.id}`}>{c.nome}</span>}
                  {modId !== c.id && (
                    <div className="ml-auto flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="size-8" onClick={() => { setModId(c.id); setModNome(c.nome); setErr(null); }} aria-label={`Rinomina ${c.nome}`} data-testid={`button-rinomina-categoria-${c.id}`}><Pencil className="size-4" /></Button>
                      <Button size="icon" variant="ghost" className="size-8 text-destructive" onClick={() => setDaEliminare(c)} aria-label={`Elimina ${c.nome}`} data-testid={`button-elimina-categoria-${c.id}`}><Trash2 className="size-4" /></Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1 max-w-sm">
              <Label htmlFor="nuova-categoria">Nuova categoria</Label>
              <Input id="nuova-categoria" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} placeholder="Es. Certificato di residenza" data-testid="input-nuova-categoria" onKeyDown={(e) => { if (e.key === "Enter") aggiungi(); }} />
            </div>
            <Button onClick={aggiungi} disabled={create.isPending} data-testid="button-aggiungi-categoria"><Plus className="size-4 mr-2" /> Aggiungi</Button>
          </div>
          <FieldError id="errore-categorie">{err ?? undefined}</FieldError>
        </div>
      )}
      <ConfermaElimina aperto={!!daEliminare} titolo={`Eliminare la categoria "${daEliminare?.nome ?? ""}"?`} testo="Se è già usata da qualche allegato non si può eliminare. L'azione non si può annullare."
        onAnnulla={() => setDaEliminare(null)}
        onConferma={() => { const c = daEliminare!; setDaEliminare(null); setErr(null); del.mutate({ id: c.id }, { onSuccess: () => { ricarica(); toast({ title: "Categoria eliminata" }); }, onError }); }} />
    </div>
  );
}
