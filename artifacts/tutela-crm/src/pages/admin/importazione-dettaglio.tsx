import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetDareAvereQueryKey, getGetImportazioneQueryKey, getListImportazioniQueryKey, useConfermaImportazione, useDeleteImportazione, useGetImportazione } from "@workspace/api-client-react";
import { AlertTriangle, ArrowLeft, Check, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorState, PageHeader } from "@/components/common";
import { ConfermaElimina } from "@/components/pratiche/conferma-elimina";
import { useToast } from "@/hooks/use-toast";
import { fmtEuro, fmtIstante, parseApiError } from "@/lib/format";

const ESITO: Record<string, { testo: string; classe: string }> = {
  valida: { testo: "Valida", classe: "" },
  riferimento: { testo: "Nuovo riferimento", classe: "" },
  avviso: { testo: "Non pagata", classe: "bg-amber-50 hover:bg-amber-50" },
  errore: { testo: "Errore", classe: "bg-destructive/5 hover:bg-destructive/5" },
};

export default function ImportazioneDettaglioPage() {
  const id = Number(useParams<{ id: string }>().id);
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useGetImportazione(id);
  const conferma = useConfermaImportazione();
  const elimina = useDeleteImportazione();
  const [soloValide, setSoloValide] = useState(false);
  const [chiediConferma, setChiediConferma] = useState(false);
  const [annulla, setAnnulla] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) return <ErrorState message={parseApiError(q.error).message} onRetry={() => q.refetch()} />;
  const d = q.data;
  const i = d.importazione;
  const anteprima = i.stato === "anteprima";
  const naspi = i.servizio === "naspi";
  const puoConfermare = anteprima && d.righeValide > 0 && (d.righeConErrori === 0 || soloValide);

  const aggiornaElenchi = () => {
    qc.invalidateQueries({ queryKey: getListImportazioniQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDareAvereQueryKey().slice(0, 1) });
  };
  const conferma_ = () => {
    setChiediConferma(false);
    setErr(null);
    conferma.mutate({ id, data: { soloValide } }, {
      onSuccess: (r) => {
        qc.setQueryData(getGetImportazioneQueryKey(id), r);
        aggiornaElenchi();
        toast({ title: "Importazione confermata", description: `${r.righeValide} righe importate, totale da pagare ${fmtEuro(r.totaleEuro)}.` });
      },
      onError: (x) => setErr(parseApiError(x).message),
    });
  };
  const rimuovi = () => {
    elimina.mutate({ id }, {
      onSuccess: () => {
        aggiornaElenchi();
        toast({ title: anteprima ? "Anteprima scartata" : "Importazione annullata" });
        nav("/admin/importa-compensi");
      },
      onError: (x) => { setAnnulla(false); setErr(parseApiError(x).message); },
    });
  };
  const colonne = naspi ? ["Riga", "Sportello", "Sede nel file", "Collaboratore", "Cumulato", "Precedente", "Da pagare", "Esito"] : ["Riga", "Sportello", "Sede nel file", "Collaboratore", "Totale dovuto", "Esito"];
  const numerica = (h: string) => ["Cumulato", "Precedente", "Da pagare", "Totale dovuto"].includes(h);
  const eur = (n: number | null) => (n === null ? "—" : fmtEuro(n));

  return (
    <div>
      <Link href="/admin/importa-compensi" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-3"><ArrowLeft className="size-4 mr-1" />Importa compensi</Link>
      <PageHeader title={`Import ${i.titolo}`} kicker={`Importazione n. ${i.id}`}
        subtitle={<>{i.nomeFile} · caricato il {fmtIstante(i.creatoIl)}{i.creatoDa ? ` da ${i.creatoDa}` : ""}{i.confermatoIl ? ` · confermato il ${fmtIstante(i.confermatoIl)}` : ""} · dare e avere {i.annoDareAvere}</>}
        actions={<Button variant="outline" onClick={() => setAnnulla(true)} data-testid="button-rimuovi-import"><Trash2 className="size-4 mr-2" />{anteprima ? "Scarta anteprima" : "Annulla importazione"}</Button>} />

      <div className="grid gap-3 sm:grid-cols-4 mb-6">
        <div className="rounded-lg border border-border bg-card p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground">Righe lette</div><div className="text-2xl font-semibold tabular-nums" data-testid="righe-lette">{d.righeValide + d.righeConErrori}</div></div>
        <div className="rounded-lg border border-border bg-card p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground">{anteprima ? "Da importare" : "Importate"}</div><div className="text-2xl font-semibold tabular-nums" data-testid="righe-valide">{d.righeValide}</div></div>
        <div className="rounded-lg border border-border bg-card p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground">{anteprima ? "Con errori" : "Scartate"}</div><div className={`text-2xl font-semibold tabular-nums ${d.righeConErrori ? "text-destructive" : ""}`} data-testid="righe-errori">{d.righeConErrori}</div></div>
        <div className="rounded-lg border border-border bg-card p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground">Totale da pagare</div><div className="text-2xl font-semibold tabular-nums" data-testid="totale-import">{fmtEuro(d.totaleEuro)}</div></div>
      </div>

      {d.avvisiFile.map((a) => (
        <div key={a} role="alert" className="mb-4 rounded-md border border-amber-500/50 bg-amber-50 text-amber-900 px-4 py-3 text-sm flex gap-2" data-testid="avviso-file"><AlertTriangle className="size-4 mt-0.5 shrink-0" /><span>{a}</span></div>
      ))}
      {naspi && d.righeAvviso > 0 && (
        <div role="alert" className="mb-4 rounded-md border border-amber-500/50 bg-amber-50 text-amber-900 px-4 py-3 text-sm flex gap-2" data-testid="avviso-negative"><AlertTriangle className="size-4 mt-0.5 shrink-0" /><span>{d.righeAvviso === 1 ? "Una riga ha" : `${d.righeAvviso} righe hanno`} una differenza negativa rispetto al cumulato precedente: non {d.righeAvviso === 1 ? "viene pagata" : "vengono pagate"} e il riferimento non cambia.</span></div>
      )}

      {d.righe.length > 0 && (
        <section className="mb-6">
          <h2 className="font-serif text-lg font-semibold mb-2">{anteprima ? "Anteprima delle righe" : "Righe importate"}</h2>
          <div className="rounded-lg border border-border bg-card overflow-x-auto">
            <Table>
              <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60">
                {colonne.map((h) => <TableHead key={h} className={`text-[11px] uppercase tracking-wider font-semibold h-10 ${numerica(h) ? "text-right" : ""}`}>{h}</TableHead>)}
              </TableRow></TableHeader>
              <TableBody>
                {d.righe.map((r) => (
                  <TableRow key={r.numeroRiga} className={ESITO[r.esito]?.classe} data-testid={`riga-import-${r.numeroRiga}`}>
                    <TableCell className="tabular-nums">{r.numeroRiga}</TableCell>
                    <TableCell className="font-medium">{r.sportello ?? "—"}</TableCell>
                    <TableCell>{r.sedeFile ?? "—"}</TableCell>
                    <TableCell>{r.collaboratoreNome ? <>{r.collaboratoreNome}{r.collaboratoreSede ? <span className="text-muted-foreground text-xs"> · {r.collaboratoreSede}</span> : null}</> : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{eur(r.importoEuro)}</TableCell>
                    {naspi && <TableCell className="text-right tabular-nums">{eur(r.precedenteEuro)}</TableCell>}
                    {naspi && <TableCell className="text-right tabular-nums font-medium">{eur(r.daPagareEuro)}</TableCell>}
                    <TableCell>
                      {r.esito === "errore" ? <span className="text-destructive text-sm">{r.messaggi.join(" ")}</span>
                        : r.esito === "avviso" ? <span className="text-amber-800 text-sm">{r.messaggi.length ? r.messaggi.join(" ") : ESITO.avviso!.testo}</span>
                        : r.esito === "riferimento" ? <Badge variant="outline">Nuovo riferimento</Badge>
                        : <Badge variant="outline"><Check className="size-3 mr-1" />Valida</Badge>}
                    </TableCell>
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
          <Button onClick={() => setChiediConferma(true)} disabled={!puoConfermare || conferma.isPending} data-testid="button-conferma-import"><Check className="size-4 mr-2" />Conferma importazione</Button>
          {d.righeConErrori > 0 && !soloValide && <p className="text-xs text-muted-foreground">Ci sono righe con errori: correggi il file e caricalo di nuovo, oppure scegli di importare solo le righe valide.</p>}
        </div>
      )}
      {!anteprima && err && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 text-destructive px-3 py-2 text-sm" data-testid="errore-annulla">{err}</div>}

      <ConfermaElimina aperto={chiediConferma} azione="Conferma e salva" titolo={`Salvare l'import ${i.titolo}?`}
        testo={`Verranno salvate ${d.righeValide} righe${d.righeConErrori ? ` (le ${d.righeConErrori} con errori vengono scartate)` : ""}, per un totale da pagare di ${fmtEuro(d.totaleEuro)}. Gli importi compaiono nel dare e avere ${i.annoDareAvere} dei collaboratori. Lo stesso file non potrà essere importato di nuovo.`}
        onConferma={conferma_} onAnnulla={() => setChiediConferma(false)} />
      <ConfermaElimina aperto={annulla} azione={anteprima ? "Scarta" : "Annulla importazione"}
        titolo={anteprima ? "Scartare questa anteprima?" : "Annullare questa importazione?"}
        testo={anteprima ? "Il file caricato viene eliminato e non viene salvato nulla." : `I compensi (${fmtEuro(d.totaleEuro)}) vengono tolti dal dare e avere dei collaboratori e il file potrà essere importato di nuovo.`}
        onConferma={rimuovi} onAnnulla={() => setAnnulla(false)} />
    </div>
  );
}
