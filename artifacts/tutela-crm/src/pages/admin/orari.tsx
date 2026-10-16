import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetOrariCaricamentoQueryKey, useGetOrariCaricamento, useUpdateOrariCaricamento, type FasciaBlocco } from "@workspace/api-client-react";
import { CircleCheck, Clock, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorState, FieldError, PageHeader } from "@/components/common";
import { useToast } from "@/hooks/use-toast";
import { fmtIstante, parseApiError } from "@/lib/format";

const GIORNI = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];
type Riga = Omit<FasciaBlocco, "id"> & { chiave: number };
let contatore = 0;
const nuovaRiga = (f?: Partial<FasciaBlocco>): Riga => ({
  chiave: ++contatore, giornoInizio: f?.giornoInizio ?? 5, oraInizio: f?.oraInizio ?? "18:00", giornoFine: f?.giornoFine ?? 1, oraFine: f?.oraFine ?? "09:00", attiva: f?.attiva ?? true,
});
const firma = (r: Omit<FasciaBlocco, "id">[]) => JSON.stringify(r.map((x) => [x.giornoInizio, x.oraInizio, x.giornoFine, x.oraFine, x.attiva]));

function SelezioneGiorno({ valore, onChange, etichetta, testId }: { valore: number; onChange: (n: number) => void; etichetta: string; testId: string }) {
  return (
    <Select value={String(valore)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className="w-36" aria-label={etichetta} data-testid={testId}><SelectValue /></SelectTrigger>
      <SelectContent>{GIORNI.map((g, i) => <SelectItem key={g} value={String(i + 1)}>{g}</SelectItem>)}</SelectContent>
    </Select>
  );
}

export default function OrariPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useGetOrariCaricamento({ query: { queryKey: getGetOrariCaricamentoQueryKey(), refetchInterval: 60000 } });
  const salva = useUpdateOrariCaricamento();
  const [righe, setRighe] = useState<Riga[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const salvate = q.data?.fasce;
  const firmaSalvata = salvate ? firma(salvate) : null;

  useEffect(() => { if (salvate) setRighe(salvate.map((f) => nuovaRiga(f))); }, [firmaSalvata]); // eslint-disable-line react-hooks/exhaustive-deps

  const modificato = firmaSalvata !== null && firma(righe) !== firmaSalvata;
  const set = (chiave: number, p: Partial<Riga>) => setRighe((r) => r.map((x) => (x.chiave === chiave ? { ...x, ...p } : x)));

  const conferma = () => {
    for (const [i, r] of righe.entries()) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.oraInizio) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.oraFine)) return setErr(`Fascia ${i + 1}: inserisci orari validi.`);
      if (r.giornoInizio === r.giornoFine && r.oraInizio === r.oraFine) return setErr(`Fascia ${i + 1}: inizio e fine coincidono.`);
    }
    setErr(null);
    salva.mutate({ data: { fasce: righe.map(({ chiave: _c, ...f }) => f) } }, {
      onSuccess: (r) => { qc.setQueryData(getGetOrariCaricamentoQueryKey(), r); setRighe(r.fasce.map((f) => nuovaRiga(f))); toast({ title: "Orari di caricamento salvati" }); },
      onError: (e) => setErr(parseApiError(e).message),
    });
  };

  const stato = q.data?.stato;
  return (
    <div>
      <PageHeader kicker="Configurazione" title="Orari di caricamento"
        subtitle="Fasce settimanali in cui i collaboratori non possono inviare pratiche. Gli orari sono quelli italiani (Europe/Rome): l'inizio è incluso, la fine è esclusa." />
      {q.isLoading ? <Skeleton className="h-64 w-full" />
        : q.isError || !q.data ? <ErrorState message="Impossibile caricare gli orari." onRetry={() => q.refetch()} />
        : (
          <div className="space-y-5">
            <div className={`rounded-lg border p-4 flex items-start gap-3 rise ${stato?.consentito ? "border-primary/30 bg-primary/5" : "border-destructive/30 bg-destructive/5"}`} data-testid="stato-invio">
              {stato?.consentito ? <CircleCheck className="size-5 text-primary mt-0.5" /> : <Lock className="size-5 text-destructive mt-0.5" />}
              <div>
                <div className="font-semibold" data-testid="testo-stato-invio">
                  {stato?.consentito ? "L'invio delle pratiche è consentito adesso" : "L'invio delle pratiche è bloccato adesso"}
                </div>
                <div className="text-sm text-muted-foreground">
                  {stato?.consentito ? "Con gli orari salvati i collaboratori possono inviare pratiche."
                    : stato?.bloccatoFinoA ? `Tornerà consentito il ${fmtIstante(stato.bloccatoFinoA)}.` : "Con gli orari salvati l'invio non torna mai consentito: controlla le fasce."}
                </div>
              </div>
            </div>

            <section className="rounded-lg border border-border bg-card p-5 space-y-4 rise">
              <h2 className="text-lg font-bold">Fasce di blocco</h2>
              {!righe.length ? <p className="text-sm text-muted-foreground" data-testid="nessuna-fascia">Nessuna fascia: l'invio delle pratiche è sempre consentito.</p> : (
                <ul className="space-y-3">
                  {righe.map((r, i) => (
                    <li key={r.chiave} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3" data-testid={`fascia-${i}`}>
                      <span className="text-sm text-muted-foreground">Da</span>
                      <SelezioneGiorno valore={r.giornoInizio} onChange={(n) => set(r.chiave, { giornoInizio: n })} etichetta="Giorno di inizio" testId={`select-giorno-inizio-${i}`} />
                      <Input type="time" className="w-32 sm:w-28" value={r.oraInizio} onChange={(e) => set(r.chiave, { oraInizio: e.target.value })} aria-label="Ora di inizio" data-testid={`input-ora-inizio-${i}`} />
                      <span className="text-sm text-muted-foreground">a</span>
                      <SelezioneGiorno valore={r.giornoFine} onChange={(n) => set(r.chiave, { giornoFine: n })} etichetta="Giorno di fine" testId={`select-giorno-fine-${i}`} />
                      <Input type="time" className="w-32 sm:w-28" value={r.oraFine} onChange={(e) => set(r.chiave, { oraFine: e.target.value })} aria-label="Ora di fine" data-testid={`input-ora-fine-${i}`} />
                      <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
                        <Switch checked={r.attiva} onCheckedChange={(c) => set(r.chiave, { attiva: c })} data-testid={`switch-attiva-${i}`} /> Attiva
                      </label>
                      <Button size="icon" variant="ghost" className="size-8 text-destructive" onClick={() => setRighe((x) => x.filter((y) => y.chiave !== r.chiave))} aria-label={`Elimina fascia ${i + 1}`} data-testid={`button-elimina-fascia-${i}`}><Trash2 className="size-4" /></Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={() => setRighe((x) => [...x, nuovaRiga()])} disabled={righe.length >= 50} data-testid="button-aggiungi-fascia"><Plus className="size-4 mr-2" /> Aggiungi fascia</Button>
                <Button onClick={conferma} disabled={!modificato || salva.isPending} data-testid="button-salva-orari">
                  {salva.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Clock className="size-4 mr-2" />} Salva orari
                </Button>
                {modificato && <span className="text-sm text-muted-foreground" data-testid="testo-modifiche-non-salvate">Modifiche non salvate</span>}
              </div>
              <FieldError id="errore-orari">{err ?? undefined}</FieldError>
            </section>
          </div>
        )}
    </div>
  );
}
