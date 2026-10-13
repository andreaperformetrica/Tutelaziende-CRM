import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListNewsBackofficeQueryKey, getListNewsQueryKey, useCreateNews, useDeleteNews, useListNewsBackoffice, useUpdateNews, type NewsBackoffice,
} from "@workspace/api-client-react";
import { Newspaper, Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorState, FieldError, PageHeader } from "@/components/common";
import { ConfermaElimina } from "@/components/pratiche/conferma-elimina";
import { useToast } from "@/hooks/use-toast";
import { fmtIstante, parseApiError } from "@/lib/format";

const MAX_TITOLO = 120;
const MAX_TESTO = 5000;

interface Modulo { titolo: string; testo: string; pubblicata: boolean; inEvidenza: boolean }
const VUOTO: Modulo = { titolo: "", testo: "", pubblicata: true, inEvidenza: false };

function DialogNews({ aperto, notizia, onClose, onSalvata }: { aperto: boolean; notizia: NewsBackoffice | null; onClose: () => void; onSalvata: () => void }) {
  const { toast } = useToast();
  const create = useCreateNews();
  const update = useUpdateNews();
  const [m, setM] = useState<Modulo>(VUOTO);
  const [err, setErr] = useState<string | null>(null);
  // Reimposta il modulo ogni volta che il dialogo si apre.
  useEffect(() => {
    if (aperto) { setM(notizia ? { titolo: notizia.titolo, testo: notizia.testo, pubblicata: notizia.pubblicata, inEvidenza: notizia.inEvidenza } : VUOTO); setErr(null); }
  }, [aperto, notizia]);
  const occupato = create.isPending || update.isPending;

  const salva = () => {
    if (!m.titolo.trim()) return setErr("Inserisci il titolo");
    if (!m.testo.trim()) return setErr("Inserisci il testo");
    setErr(null);
    const opzioni = { onSuccess: () => { toast({ title: notizia ? "Notizia aggiornata" : "Notizia creata" }); onSalvata(); onClose(); }, onError: (e: unknown) => setErr(parseApiError(e).message) };
    if (notizia) update.mutate({ id: notizia.id, data: m }, opzioni);
    else create.mutate({ data: m }, opzioni);
  };

  return (
    <Dialog open={aperto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto" data-testid="dialog-news">
        <DialogHeader>
          <DialogTitle>{notizia ? "Modifica notizia" : "Nuova notizia"}</DialogTitle>
          <DialogDescription>La notizia compare nella home dei collaboratori quando è pubblicata.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="news-titolo">Titolo</Label>
            <Input id="news-titolo" value={m.titolo} maxLength={MAX_TITOLO} onChange={(e) => setM({ ...m, titolo: e.target.value })} data-testid="input-news-titolo" />
          </div>
          <div>
            <Label htmlFor="news-testo">Testo</Label>
            <Textarea id="news-testo" rows={8} value={m.testo} maxLength={MAX_TESTO} onChange={(e) => setM({ ...m, testo: e.target.value })} data-testid="input-news-testo" />
            <div className="text-xs text-muted-foreground mt-1 text-right tabular-nums">{m.testo.length} / {MAX_TESTO}</div>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
            <span><span className="font-semibold block">Pubblicata</span><span className="text-muted-foreground">Se spenta resta una bozza, visibile solo al back office.</span></span>
            <Switch checked={m.pubblicata} onCheckedChange={(c) => setM({ ...m, pubblicata: c })} data-testid="switch-news-pubblicata" />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
            <span><span className="font-semibold block">In evidenza</span><span className="text-muted-foreground">Compare in cima alla home, prima delle altre.</span></span>
            <Switch checked={m.inEvidenza} onCheckedChange={(c) => setM({ ...m, inEvidenza: c })} data-testid="switch-news-evidenza" />
          </label>
          <FieldError id="errore-news">{err ?? undefined}</FieldError>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Annulla</Button>
          <Button onClick={salva} disabled={occupato} data-testid="button-salva-news">{notizia ? "Salva modifiche" : "Crea notizia"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function NewsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useListNewsBackoffice();
  const del = useDeleteNews();
  const [dialogo, setDialogo] = useState<{ notizia: NewsBackoffice | null } | null>(null);
  const [daEliminare, setDaEliminare] = useState<NewsBackoffice | null>(null);
  const ricarica = () => { qc.invalidateQueries({ queryKey: getListNewsBackofficeQueryKey() }); qc.invalidateQueries({ queryKey: getListNewsQueryKey() }); };
  const news = q.data ?? [];

  return (
    <div>
      <PageHeader kicker="Contenuti" title="News" subtitle="Le notizie mostrate nella home dei collaboratori."
        actions={<Button onClick={() => setDialogo({ notizia: null })} data-testid="button-nuova-news"><Plus className="size-4 mr-1.5" /> Nuova notizia</Button>} />
      {q.isLoading ? <Skeleton className="h-48 w-full" />
        : q.isError ? <ErrorState message={parseApiError(q.error).message} onRetry={() => q.refetch()} />
        : !news.length ? <EmptyState icon={<Newspaper className="size-6" />} title="Nessuna notizia" text="Scrivi la prima notizia: i collaboratori la vedranno nella loro home."
            action={<Button onClick={() => setDialogo({ notizia: null })}>Nuova notizia</Button>} />
        : (
          <ul className="space-y-3 rise" data-testid="elenco-news">
            {news.map((n) => (
              <li key={n.id} className="rounded-lg border border-border bg-card p-4" data-testid={`riga-news-${n.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-bold text-lg leading-tight">{n.titolo}</h2>
                      {n.inEvidenza && <Badge className="bg-accent text-accent-foreground gap-1"><Pin className="size-3" /> In evidenza</Badge>}
                      {!n.pubblicata && <Badge variant="outline">Bozza</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {fmtIstante(n.creataIl)}{n.autore ? ` · ${n.autore}` : ""}{n.modificataIl !== n.creataIl && fmtIstante(n.modificataIl) !== fmtIstante(n.creataIl) ? ` · modificata il ${fmtIstante(n.modificataIl)}` : ""}
                    </div>
                    <p className="text-sm mt-2 whitespace-pre-line line-clamp-3">{n.testo}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="icon" variant="ghost" className="size-9" onClick={() => setDialogo({ notizia: n })} aria-label={`Modifica ${n.titolo}`} data-testid={`button-modifica-news-${n.id}`}><Pencil className="size-4" /></Button>
                    <Button size="icon" variant="ghost" className="size-9 text-destructive" onClick={() => setDaEliminare(n)} aria-label={`Elimina ${n.titolo}`} data-testid={`button-elimina-news-${n.id}`}><Trash2 className="size-4" /></Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      <DialogNews aperto={!!dialogo} notizia={dialogo?.notizia ?? null} onClose={() => setDialogo(null)} onSalvata={ricarica} />
      <ConfermaElimina aperto={!!daEliminare} titolo={`Eliminare la notizia "${daEliminare?.titolo ?? ""}"?`} testo="La notizia sparirà dalla home dei collaboratori. L'azione non si può annullare."
        onAnnulla={() => setDaEliminare(null)}
        onConferma={() => { const n = daEliminare!; setDaEliminare(null); del.mutate({ id: n.id }, { onSuccess: () => { ricarica(); toast({ title: "Notizia eliminata" }); }, onError: (e) => toast({ title: parseApiError(e).message, variant: "destructive" }) }); }} />
    </div>
  );
}
