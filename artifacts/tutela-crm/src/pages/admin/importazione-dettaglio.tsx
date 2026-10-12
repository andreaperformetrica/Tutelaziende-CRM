import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetDareAvereQueryKey, getGetImportazioneQueryKey, getListImportazioniQueryKey, useConfermaImportazione, useDeleteImportazione, useGetImportazione } from "@workspace/api-client-react";
import { AlertTriangle, ArrowLeft, Check, Settings2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorState, PageHeader } from "@/components/common";
import { ConfermaElimina } from "@/components/pratiche/conferma-elimina";
import { RegolaImportForm, TESTO_CHIAVE, TESTO_REGOLA } from "@/components/compensi/regola-import-form";
import { useToast } from "@/hooks/use-toast";
import { fmtDataIstante, fmtEuro, parseApiError } from "@/lib/format";

export default function ImportazioneDettaglioPage() {
  const id = Number(useParams<{ id: string }>().id);
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useGetImportazione(id);
  const conferma = useConfermaImportazione();
  const elimina = useDeleteImportazione();
  const [regola, setRegola] = useState(false);
  const [soloValide, setSoloValide] = useState(false);
  const [annulla, setAnnulla] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) return <ErrorState message={parseApiError(q.error).message} onRetry={() => q.refetch()} />;
  const d = q.data;
  const i = d.importazione;
  const anteprima = i.stato === "anteprima";
  const puoConfermare = anteprima && d.configurazioneCompleta && d.righeValide > 0 && (d.righeConErrori === 0 || soloValide);

  const aggiornaElenchi = () => {
    qc.invalidateQueries({ queryKey: getListImportazioniQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDareAvereQueryKey().slice(0, 1) });
  };
  const conferma_ = () => {
    setErr(null);
    conferma.mutate({ id, data: { soloValide } }, {
      onSuccess: (r) => {
        qc.setQueryData(getGetImportazioneQueryKey(id), r);
        aggiornaElenchi();
        toast({ title: "Importazione confermata", description: `${r.righeValide} righe riportate nel dare e avere, totale ${fmtEuro(r.totaleEuro)}.` });
      },
      onError: (x) => setErr(parseApiError(x).message),
    });
  };
  const rimuovi = () => {
    elimina.mutate({ id }, {
      onSuccess: () => {
        aggiornaElenchi();
        toast({ title: anteprima ? "Anteprima scartata" : "Importazione annullata" });
        nav("/admin/compensi?tab=importazioni");
      },
      onError: (x) => { setAnnulla(false); setErr(parseApiError(x).message); },
    });
  };
  const percentuale = d.configurazione.regola === "percentuale";

  return (
    <div>
      <Link href="/admin/compensi?tab=importazioni" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-3"><ArrowLeft className="size-4 mr-1" />Compensi</Link>
      <PageHeader title={`Import ${i.servizioEtichetta} ${i.anno}`} kicker={`Importazione n. ${i.id}`}
        subtitle={<>{i.nomeFile} · caricato il {fmtDataIstante(i.creatoIl)}{i.creatoDa ? ` da ${i.creatoDa}` : ""}{i.confermatoIl ? ` · confermato il ${fmtDataIstante(i.confermatoIl)}` : ""}</>}
        actions={<Button variant="outline" onClick={() => setAnnulla(true)} data-testid="button-rimuovi-import"><Trash2 className="size-4 mr-2" />{anteprima ? "Scarta anteprima" : "Annulla importazione"}</Button>} />

      <div className="grid gap-3 sm:grid-cols-3 mb-6">
        <div className="rounded-lg border border-border bg-card p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground">Righe valide</div><div className="text-2xl font-semibold tabular-nums" data-testid="righe-valide">{d.righeValide}</div></div>
        <div className="rounded-lg border border-border bg-card p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground">Righe con errori</div><div className={`text-2xl font-semibold tabular-nums ${d.righeConErrori ? "text-destructive" : ""}`} data-testid="righe-errori">{d.righeConErrori}</div></div>
        <div className="rounded-lg border border-border bg-card p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground">Totale compensi</div><div className="text-2xl font-semibold tabular-nums" data-testid="totale-import">{fmtEuro(d.totaleEuro)}</div></div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 mb-6 flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Regola di calcolo</div>
          <div className="text-sm font-medium" data-testid="testo-regola">{TESTO_REGOLA(d.configurazione)}</div>
          {d.configurazione.configurato && <div className="text-xs text-muted-foreground">{TESTO_CHIAVE[d.configurazione.tipoChiave as keyof typeof TESTO_CHIAVE]} dalla colonna «{d.configurazione.colonnaChiave}»</div>}
        </div>
        {anteprima && <Button size="sm" variant="outline" onClick={() => setRegola(true)} data-testid="button-modifica-regola"><Settings2 className="size-4 mr-1.5" />Modifica</Button>}
      </div>

      {anteprima && !d.configurazioneCompleta && (
        <div role="alert" className="mb-6 rounded-md border border-amber-500/50 bg-amber-50 text-amber-900 px-4 py-3 text-sm flex gap-2" data-testid="avviso-configurazione"><AlertTriangle className="size-4 mt-0.5 shrink-0" /><span>{d.messaggioConfigurazione} Colonne trovate nel file: {d.intestazioni.join(", ")}.</span></div>
      )}

      {d.perCollaboratore.length > 0 && (
        <section className="mb-6">
          <h2 className="font-serif text-lg font-semibold mb-2">Totali per collaboratore</h2>
          <div className="rounded-lg border border-border bg-card overflow-x-auto">
            <Table>
              <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60">{["Collaboratore", "Sportello", "Righe", "Compenso"].map((h, k) => <TableHead key={h} className={`text-[11px] uppercase tracking-wider font-semibold h-10 ${k >= 2 ? "text-right" : ""}`}>{h}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {d.perCollaboratore.map((c) => (
                  <TableRow key={c.collaboratoreId} data-testid={`totale-collaboratore-${c.collaboratoreId}`}>
                    <TableCell>{c.collaboratoreNome}</TableCell><TableCell className="tabular-nums">{c.numeroSportello}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.righe}</TableCell><TableCell className="text-right tabular-nums">{fmtEuro(c.compensoEuro)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      {d.righe.length > 0 && (
        <section className="mb-6">
          <h2 className="font-serif text-lg font-semibold mb-2">{anteprima ? "Anteprima delle righe" : "Righe importate"}</h2>
          <div className="rounded-lg border border-border bg-card overflow-x-auto">
            <Table>
              <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60">
                {["Riga", "Valore letto", "Collaboratore", ...(percentuale || d.righe.some((r) => r.baseEuro !== null) ? ["Importo"] : []), "Compenso", "Esito"].map((h) => <TableHead key={h} className="text-[11px] uppercase tracking-wider font-semibold h-10">{h}</TableHead>)}
              </TableRow></TableHeader>
              <TableBody>
                {d.righe.map((r) => (
                  <TableRow key={r.numeroRiga} className={r.errori.length ? "bg-destructive/5 hover:bg-destructive/5" : ""} data-testid={`riga-import-${r.numeroRiga}`}>
                    <TableCell className="tabular-nums">{r.numeroRiga}</TableCell>
                    <TableCell>{r.riferimento ?? "—"}</TableCell>
                    <TableCell>{r.collaboratoreNome ?? "—"}</TableCell>
                    {(percentuale || d.righe.some((x) => x.baseEuro !== null)) && <TableCell className="tabular-nums">{r.baseEuro === null ? "—" : fmtEuro(r.baseEuro)}</TableCell>}
                    <TableCell className="tabular-nums">{r.compensoEuro === null ? "—" : fmtEuro(r.compensoEuro)}</TableCell>
                    <TableCell>{r.errori.length ? <span className="text-destructive text-sm">{r.errori.join(" ")}</span> : <Badge variant="outline"><Check className="size-3 mr-1" />Valida</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      {anteprima && (
        <div className="space-y-3">
          {d.righeConErrori > 0 && d.righeValide > 0 && (
            <div className="flex items-center gap-2"><Checkbox id="solo-valide" checked={soloValide} onCheckedChange={(v) => setSoloValide(v === true)} data-testid="checkbox-solo-valide" /><Label htmlFor="solo-valide">Importa solo le {d.righeValide} righe valide e scarta le {d.righeConErrori} con errori</Label></div>
          )}
          {err && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 text-destructive px-3 py-2 text-sm" data-testid="errore-conferma">{err}</div>}
          <Button onClick={conferma_} disabled={!puoConfermare || conferma.isPending} data-testid="button-conferma-import"><Check className="size-4 mr-2" />Conferma importazione</Button>
          {d.righeConErrori > 0 && !soloValide && <p className="text-xs text-muted-foreground">Ci sono righe con errori: correggi il file e caricalo di nuovo, oppure scegli di importare solo le righe valide.</p>}
        </div>
      )}
      {!anteprima && err && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 text-destructive px-3 py-2 text-sm">{err}</div>}

      <RegolaImportForm servizio={d.configurazione} intestazioni={d.intestazioni} aperto={regola} onChiudi={() => setRegola(false)} importazioneId={id} />
      <ConfermaElimina aperto={annulla} azione={anteprima ? "Scarta" : "Annulla importazione"}
        titolo={anteprima ? "Scartare questa anteprima?" : "Annullare questa importazione?"}
        testo={anteprima ? "Il file caricato viene eliminato e non viene salvato nulla." : `I compensi (${fmtEuro(d.totaleEuro)}) vengono tolti dal dare e avere dei collaboratori e il file potrà essere importato di nuovo.`}
        onConferma={rimuovi} onAnnulla={() => setAnnulla(false)} />
    </div>
  );
}
