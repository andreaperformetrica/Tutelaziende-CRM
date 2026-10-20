import { useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetDareAvereQueryKey, getGetRicevutaQueryKey, getListRicevuteQueryKey, useDeleteRicevuta, useGetRicevuta, useRegistraPagamentoRicevuta } from "@workspace/api-client-react";
import { ArrowLeft, Banknote, Paperclip, Printer, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, PageHeader } from "@/components/common";
import { ConfermaElimina } from "@/components/pratiche/conferma-elimina";
import { useToast } from "@/hooks/use-toast";
import { fmtData, fmtEuro, fmtIstante, parseApiError } from "@/lib/format";
import { FORMATI_DOCUMENTI, formatoDimensione, inviaFile, messaggioErrore, urlAllegatoRicevuta, urlRicevutaPdf, apriFile } from "@/lib/upload";

const METODI = { bonifico: "Bonifico", contanti: "Contanti", assegno: "Assegno", altro: "Altro" } as const;
const oggi = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());

export default function RicevutaDettaglioPage() {
  const id = Number(useParams<{ id: string }>().id);
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useGetRicevuta(id);
  const paga = useRegistraPagamentoRicevuta();
  const elimina = useDeleteRicevuta();
  const [pagamento, setPagamento] = useState<{ data: string; metodo: keyof typeof METODI } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [conferma, setConferma] = useState(false);
  const [carica, setCarica] = useState(false);
  const inputAllegato = useRef<HTMLInputElement>(null);

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) return <ErrorState message={parseApiError(q.error).message} onRetry={() => q.refetch()} />;
  const d = q.data;
  const r = d.ricevuta;
  const conIva = r.tipoSoggetto === "PARTITA_IVA";
  const aggiorna = () => {
    qc.invalidateQueries({ queryKey: getGetRicevutaQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListRicevuteQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDareAvereQueryKey({ collaboratoreId: r.collaboratoreId, anno: d.annoDareAvere }) });
  };

  const registra = () => {
    if (!pagamento) return;
    if (!pagamento.data) return setErr("Inserisci la data del pagamento.");
    setErr(null);
    paga.mutate({ id, data: { data: pagamento.data, metodo: pagamento.metodo } }, {
      onSuccess: async () => {
        aggiorna();
        setPagamento(null);
        const f = file;
        setFile(null);
        if (f) {
          try { await inviaFile("PUT", `/backoffice/ricevute/${id}/allegato`, {}, f); aggiorna(); toast({ title: "Pagamento registrato", description: "Bonifico allegato." }); }
          catch (x) { toast({ variant: "destructive", title: "Pagamento registrato, documento non allegato", description: messaggioErrore(x) }); }
        } else toast({ title: "Pagamento registrato" });
      },
      onError: (x) => setErr(parseApiError(x).message),
    });
  };

  const allega = async (f: File | undefined) => {
    if (!f) return;
    setCarica(true);
    try { await inviaFile("PUT", `/backoffice/ricevute/${id}/allegato`, {}, f); aggiorna(); toast({ title: "Bonifico allegato" }); }
    catch (x) { toast({ variant: "destructive", title: "Caricamento non riuscito", description: messaggioErrore(x) }); }
    finally { setCarica(false); if (inputAllegato.current) inputAllegato.current.value = ""; }
  };

  const riga = (k: string, v: React.ReactNode, testid?: string) => (
    <div className="flex flex-wrap justify-between gap-2 py-2 border-b border-border last:border-0"><dt className="text-muted-foreground">{k}</dt><dd className="font-medium text-right" data-testid={testid}>{v}</dd></div>
  );

  return (
    <div>
      <Link href="/admin/pagamenti-fatture" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-3"><ArrowLeft className="size-4 mr-1" />Pagamenti e fatture</Link>
      <PageHeader title={`Ricevuta n. ${r.numero}/${r.anno}`} kicker={r.collaboratoreNome} subtitle={<>del {fmtData(r.dataRicevuta)} · {r.origineDescrizione}</>}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild><a href={urlRicevutaPdf(id)} onClick={(e) => apriFile(e, urlRicevutaPdf(id))} target="_blank" rel="noreferrer" data-testid="button-pdf-ricevuta"><Printer className="size-4 mr-2" />Scarica PDF</a></Button>
            {!r.pagata && <Button onClick={() => { setErr(null); setFile(null); setPagamento({ data: oggi(), metodo: "bonifico" }); }} data-testid="button-registra-pagamento-ricevuta"><Banknote className="size-4 mr-2" />Registra pagamento</Button>}
            {d.eliminabile && <Button variant="outline" onClick={() => setConferma(true)} data-testid="button-elimina-ricevuta"><Trash2 className="size-4 mr-2" />Elimina</Button>}
          </div>
        } />

      <div className="grid gap-6 lg:grid-cols-2 max-w-5xl">
        <dl className="rounded-lg border border-border bg-card px-4 text-sm" data-testid="riepilogo-ricevuta">
          {riga("Collaboratore", r.collaboratoreNome)}
          {riga("Denominazione", r.denominazione ?? "—")}
          {riga(conIva ? "Imponibile" : "Importo", fmtEuro(r.imponibileEuro), "ricevuta-imponibile")}
          {conIva && riga(`IVA${r.aliquotaIva !== null ? ` ${String(r.aliquotaIva).replace(".", ",")}%` : ""}`, fmtEuro(r.ivaEuro), "ricevuta-iva")}
          {!conIva && riga("IVA", "Senza IVA (associazione o soggetto senza partita IVA)")}
          {riga("Totale", fmtEuro(r.totaleEuro), "ricevuta-totale")}
          {riga("Creata", `${fmtIstante(d.creatoIl)}${d.creatoDa ? ` da ${d.creatoDa}` : ""}`)}
        </dl>

        <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm space-y-3" data-testid="stato-pagamento-ricevuta">
          <div>
            {r.pagata
              ? <><Badge className="bg-emerald-600 text-white hover:bg-emerald-600 mr-2">Pagata</Badge>il {fmtData(r.pagatoIl)} · {METODI[d.pagamentoMetodo as keyof typeof METODI] ?? d.pagamentoMetodo}
                {d.pagamentoRegistratoDa && <span className="text-muted-foreground"> · registrato da {d.pagamentoRegistratoDa} il {fmtIstante(d.pagamentoRegistratoIl)}</span>}</>
              : <><Badge variant="outline" className="mr-2">Da pagare</Badge>Registra il pagamento quando il bonifico è stato eseguito.</>}
          </div>
          {r.pagata && (
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3" data-testid="allegato-ricevuta">
              <Paperclip className="size-4 text-muted-foreground" />
              {d.allegato
                ? <span>Bonifico: <a href={urlAllegatoRicevuta(id, true)} onClick={(e) => apriFile(e, urlAllegatoRicevuta(id, true))} target="_blank" rel="noreferrer" className="underline font-medium" data-testid="link-allegato-ricevuta">{d.allegato.nome}</a> <span className="text-muted-foreground">({formatoDimensione(d.allegato.dimensione)}, caricato il {fmtIstante(d.allegato.caricatoIl)})</span></span>
                : <span className="text-muted-foreground">Nessun bonifico allegato.</span>}
              <input ref={inputAllegato} type="file" accept={FORMATI_DOCUMENTI} className="hidden" onChange={(x) => allega(x.target.files?.[0])} data-testid="input-allegato-ricevuta" />
              <Button size="sm" variant="outline" disabled={carica} onClick={() => inputAllegato.current?.click()} data-testid="button-allega-ricevuta">{carica ? "Caricamento…" : d.allegato ? "Sostituisci bonifico" : "Allega bonifico"}</Button>
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!pagamento} onOpenChange={(o) => { if (!o) setPagamento(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registra il pagamento</DialogTitle></DialogHeader>
          {pagamento && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label htmlFor="rp-data">Data</Label><Input id="rp-data" type="date" value={pagamento.data} onChange={(x) => setPagamento({ ...pagamento, data: x.target.value })} data-testid="input-ricevuta-pagamento-data" /></div>
                <div className="space-y-1.5"><Label>Metodo</Label>
                  <Select value={pagamento.metodo} onValueChange={(v) => setPagamento({ ...pagamento, metodo: v as keyof typeof METODI })}>
                    <SelectTrigger data-testid="select-ricevuta-metodo"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(METODI).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5"><Label htmlFor="rp-file">Bonifico eseguito (facoltativo)</Label>
                <Input id="rp-file" type="file" accept={FORMATI_DOCUMENTI} onChange={(x) => setFile(x.target.files?.[0] ?? null)} data-testid="input-ricevuta-pagamento-file" />
                <p className="text-xs text-muted-foreground">PDF o immagine. Si può allegare anche dopo.</p>
              </div>
              <p className="text-xs text-muted-foreground">Il pagamento si registra una sola volta.</p>
              {err && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 text-destructive px-3 py-2 text-sm" data-testid="errore-pagamento-ricevuta">{err}</div>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPagamento(null)}>Annulla</Button>
            <Button onClick={registra} disabled={paga.isPending} data-testid="button-conferma-pagamento-ricevuta">{paga.isPending ? "Registrazione…" : "Registra"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfermaElimina aperto={conferma} titolo={`Eliminare la ricevuta n. ${r.numero}/${r.anno}?`} testo="Si può eliminare solo l'ultima ricevuta dell'anno, se non è stata pagata. La riga del dare e avere torna libera."
        onAnnulla={() => setConferma(false)}
        onConferma={() => elimina.mutate({ id }, {
          onSuccess: () => { aggiorna(); toast({ title: "Ricevuta eliminata" }); nav("/admin/pagamenti-fatture"); },
          onError: (x) => { setConferma(false); toast({ title: "Eliminazione non riuscita", description: parseApiError(x).message, variant: "destructive" }); },
        })} />
    </div>
  );
}
