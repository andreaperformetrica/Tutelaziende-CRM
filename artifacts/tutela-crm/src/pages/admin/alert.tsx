import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetConfigurazioneAlertQueryKey, getGetConteggioAlertQueryKey, getListAlertCollaboratoriQueryKey,
  useGetConfigurazioneAlert, useListAlertCollaboratori, useListTipiPratica, useUpdateConfigurazioneAlert,
  type AlertConfigurazione,
} from "@workspace/api-client-react";
import { BellRing, CircleCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { useToast } from "@/hooks/use-toast";
import { fmtIstante, parseApiError } from "@/lib/format";

type Stato = "aperto" | "risolto";

function SceltaTipi({ idBase, tipi, scelti, onChange }: { idBase: string; tipi: { id: number; nome: string }[]; scelti: number[]; onChange: (ids: number[]) => void }) {
  if (tipi.length === 0) return <p className="text-sm text-muted-foreground">Non ci sono ancora tipi di pratica.</p>;
  return (
    <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
      {tipi.map((t) => (
        <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer" htmlFor={`${idBase}-${t.id}`}>
          <Checkbox id={`${idBase}-${t.id}`} checked={scelti.includes(t.id)} data-testid={`${idBase}-${t.id}`}
            onCheckedChange={(v) => onChange(v === true ? [...scelti, t.id] : scelti.filter((x) => x !== t.id))} />
          {t.nome}
        </label>
      ))}
    </div>
  );
}

function Impostazioni() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const conf = useGetConfigurazioneAlert({ query: { queryKey: getGetConfigurazioneAlertQueryKey() } });
  const tipiQ = useListTipiPratica();
  const salva = useUpdateConfigurazioneAlert();
  const [mesi, setMesi] = useState("2");
  const [soglia, setSoglia] = useState("3");
  const [periodo, setPeriodo] = useState("30");
  const [attivaI, setAttivaI] = useState(true);
  const [attivaV, setAttivaV] = useState(true);
  const [tipiI, setTipiI] = useState<number[]>([]);
  const [tipiV, setTipiV] = useState<number[]>([]);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    const c = conf.data;
    if (!c) return;
    setMesi(String(c.inattivita.mesi)); setAttivaI(c.inattivita.attiva); setTipiI(c.inattivita.tipiIds);
    setSoglia(String(c.volume.soglia)); setPeriodo(String(c.volume.periodoGiorni)); setAttivaV(c.volume.attiva); setTipiV(c.volume.tipiIds);
  }, [conf.data]);

  if (conf.isLoading || tipiQ.isLoading) return <Skeleton className="h-64" />;
  if (conf.isError) return <ErrorState message={parseApiError(conf.error).message} onRetry={() => conf.refetch()} />;
  const tipi = (tipiQ.data ?? []).filter((t) => t.attivo).map((t) => ({ id: t.id, nome: t.nome }));

  const intero = (v: string, min: number, max: number) => (/^\d+$/.test(v.trim()) && Number(v) >= min && Number(v) <= max ? Number(v) : null);
  const invia = () => {
    setErrore(null);
    const m = intero(mesi, 1, 60), s = intero(soglia, 1, 1000), p = intero(periodo, 1, 365);
    if (m === null) return setErrore("I mesi devono essere un numero da 1 a 60.");
    if (s === null) return setErrore("Il numero di pratiche deve essere da 1 a 1000.");
    if (p === null) return setErrore("Il periodo deve essere da 1 a 365 giorni.");
    const data: AlertConfigurazione = { inattivita: { attiva: attivaI, mesi: m, tipiIds: tipiI }, volume: { attiva: attivaV, soglia: s, periodoGiorni: p, tipiIds: tipiV } };
    salva.mutate({ data }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetConfigurazioneAlertQueryKey() });
        qc.invalidateQueries({ queryKey: getListAlertCollaboratoriQueryKey() });
        qc.invalidateQueries({ queryKey: getGetConteggioAlertQueryKey() });
        toast({ title: "Impostazioni salvate", description: "Gli alert sono stati ricalcolati." });
      },
      onError: (e) => setErrore(parseApiError(e).message),
    });
  };

  return (
    <div className="space-y-4" data-testid="impostazioni-alert">
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-bold">Collaboratore che non carica un tipo di pratica</h3>
          <div className="flex items-center gap-2 text-sm"><Switch checked={attivaI} onCheckedChange={setAttivaI} id="attiva-inattivita" data-testid="switch-inattivita" /><Label htmlFor="attiva-inattivita">Attiva</Label></div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          Avvisami se non ne carica da <Input value={mesi} onChange={(e) => setMesi(e.target.value)} inputMode="numeric" className="w-20 bg-card" aria-label="Mesi senza pratiche" data-testid="input-mesi" /> mesi
        </div>
        <div><div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Tipi di pratica da controllare</div>
          <SceltaTipi idBase="tipo-inattivita" tipi={tipi} scelti={tipiI} onChange={setTipiI} /></div>
      </div>
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-bold">Collaboratore che carica troppe pratiche di un tipo</h3>
          <div className="flex items-center gap-2 text-sm"><Switch checked={attivaV} onCheckedChange={setAttivaV} id="attiva-volume" data-testid="switch-volume" /><Label htmlFor="attiva-volume">Attiva</Label></div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          Avvisami se ne carica più di <Input value={soglia} onChange={(e) => setSoglia(e.target.value)} inputMode="numeric" className="w-20 bg-card" aria-label="Numero di pratiche" data-testid="input-soglia" /> in
          <Input value={periodo} onChange={(e) => setPeriodo(e.target.value)} inputMode="numeric" className="w-20 bg-card" aria-label="Giorni del periodo" data-testid="input-periodo" /> giorni
        </div>
        <div><div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Tipi di pratica da controllare</div>
          <SceltaTipi idBase="tipo-volume" tipi={tipi} scelti={tipiV} onChange={setTipiV} /></div>
      </div>
      {errore && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive font-medium" data-testid="errore-alert">{errore}</div>}
      <Button onClick={invia} disabled={salva.isPending} data-testid="button-salva-alert">{salva.isPending && <Loader2 className="size-4 mr-2 animate-spin" />} Salva impostazioni</Button>
      <p className="text-xs text-muted-foreground">I nuovi alert arrivano anche per email agli admin. Il controllo si ripete ogni ora e ogni volta che salvi. Un alert si chiude da solo quando la situazione rientra.</p>
    </div>
  );
}

export default function AlertPage() {
  const [stato, setStato] = useState<Stato>("aperto");
  const q = useListAlertCollaboratori({ stato }, { query: { queryKey: getListAlertCollaboratoriQueryKey({ stato }), refetchInterval: 60000 } });
  return (
    <div>
      <PageHeader kicker="Collaboratori" title="Alert" subtitle="Segnalazioni automatiche sull'attività dei collaboratori." />
      <section className="mb-8 rise">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-lg font-bold">{stato === "aperto" ? "Alert aperti" : "Alert risolti"}{q.data && stato === "aperto" ? ` (${q.data.aperti})` : ""}</h2>
          <div className="inline-flex rounded-md border border-border overflow-hidden text-sm" role="group" aria-label="Quali alert mostrare">
            {(["aperto", "risolto"] as Stato[]).map((s) => (
              <button key={s} type="button" onClick={() => setStato(s)} aria-pressed={stato === s} data-testid={`filtro-alert-${s}`}
                className={`px-3 py-1.5 ${stato === s ? "bg-primary text-primary-foreground" : "bg-card hover:bg-secondary"}`}>{s === "aperto" ? "Aperti" : "Risolti"}</button>
            ))}
          </div>
        </div>
        {q.isLoading ? <Skeleton className="h-32" />
          : q.isError ? <ErrorState message={parseApiError(q.error).message} onRetry={() => q.refetch()} />
          : !q.data?.elementi.length ? <EmptyState icon={stato === "aperto" ? <CircleCheck className="size-6" /> : <BellRing className="size-6" />} title={stato === "aperto" ? "Nessun alert aperto" : "Nessun alert risolto"} text={stato === "aperto" ? "Scegli i tipi di pratica da controllare qui sotto: gli alert compariranno quando una soglia viene superata." : undefined} />
          : (
            <div className="rounded-lg border border-border bg-card overflow-x-auto">
              <Table className="tabella-schede">
                <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60">
                  {["Collaboratore", "Tipo di pratica", "Motivo", stato === "aperto" ? "Dal" : "Risolto il"].map((h) => <TableHead key={h} className="text-[11px] uppercase tracking-wider font-semibold h-10 whitespace-nowrap">{h}</TableHead>)}
                </TableRow></TableHeader>
                <TableBody>
                  {q.data.elementi.map((a) => (
                    <TableRow key={a.id} className="hover:bg-secondary/50 align-top" data-testid={`row-alert-${a.id}`}>
                      <TableCell data-label="Collaboratore" className="text-sm"><Link href={`/admin/collaboratori/${a.collaboratoreId}`} className="font-medium text-primary hover:underline">{a.collaboratoreNome}</Link><div className="text-xs text-muted-foreground">Sportello {a.sportello}</div></TableCell>
                      <TableCell data-label="Tipo di pratica" className="text-sm">{a.tipoNome}</TableCell>
                      <TableCell data-label="Motivo" className="text-sm"><Badge variant="outline" className="mr-2">{a.regola === "inattivita" ? "Inattività" : "Troppe pratiche"}</Badge>{a.descrizione}{a.ultimaPraticaIl && <div className="text-xs text-muted-foreground mt-0.5">Ultima pratica: {fmtIstante(a.ultimaPraticaIl)}</div>}</TableCell>
                      <TableCell data-label={stato === "aperto" ? "Dal" : "Risolto il"} className="text-xs font-mono whitespace-nowrap">{fmtIstante(stato === "aperto" ? a.creatoIl : a.risoltoIl)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
      </section>
      <section className="rise">
        <h2 className="text-lg font-bold mb-3">Regole e soglie</h2>
        <Impostazioni />
      </section>
    </div>
  );
}
