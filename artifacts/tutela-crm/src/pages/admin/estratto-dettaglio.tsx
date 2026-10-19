import { useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetEstrattoQueryKey, getListEstrattiQueryKey, getGetResocontoCompensiQueryKey, useDeleteEstratto, useGetEstratto, useInviaEstratto, useRegistraPagamentoEstratto } from "@workspace/api-client-react";
import { ArrowLeft, Banknote, Mail, Paperclip, Printer, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorState, PageHeader } from "@/components/common";
import { ConfermaElimina } from "@/components/pratiche/conferma-elimina";
import { useToast } from "@/hooks/use-toast";
import { fmtData, fmtEuro, fmtIstante, parseApiError } from "@/lib/format";
import { FORMATI_DOCUMENTI, formatoDimensione, inviaFile, messaggioErrore, urlAllegatoPagamentoEstratto, urlEstrattoPdf } from "@/lib/upload";

const METODI = { bonifico: "Bonifico", contanti: "Contanti", assegno: "Assegno", altro: "Altro" } as const;
const oggi = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());

export default function EstrattoDettaglioPage() {
  const id = Number(useParams<{ id: string }>().id);
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useGetEstratto(id);
  const invia = useInviaEstratto();
  const paga = useRegistraPagamentoEstratto();
  const elimina = useDeleteEstratto();
  const [pagamento, setPagamento] = useState<{ data: string; importo: string; metodo: keyof typeof METODI } | null>(null);
  const [fileContabile, setFileContabile] = useState<File | null>(null);
  const [carica, setCarica] = useState(false);
  const inputAllegato = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [conferma, setConferma] = useState(false);

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError || !q.data) return <ErrorState message={parseApiError(q.error).message} onRetry={() => q.refetch()} />;
  const { estratto: e, righe, invii, esclusioni, allegato } = q.data;
  const aggiorna = () => {
    qc.invalidateQueries({ queryKey: getGetEstrattoQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListEstrattiQueryKey() });
  };

  const registra = () => {
    if (!pagamento) return;
    const importoEuro = Number(pagamento.importo.replace(",", "."));
    if (!pagamento.data) return setErr("Inserisci la data del pagamento.");
    if (!Number.isFinite(importoEuro) || importoEuro <= 0) return setErr("Inserisci un importo maggiore di zero.");
    setErr(null);
    paga.mutate({ id, data: { data: pagamento.data, importoEuro, metodo: pagamento.metodo } }, {
      onSuccess: async () => {
        aggiorna();
        setPagamento(null);
        const file = fileContabile;
        setFileContabile(null);
        if (file) {
          // Il pagamento e' gia' registrato: se il documento non parte, si puo' riallegare dal riquadro del pagamento.
          try { await inviaFile("PUT", `/backoffice/compensi/estratti/${id}/pagamento/allegato`, {}, file); aggiorna(); toast({ title: "Pagamento registrato", description: "Documento allegato. Le pratiche sono ora nello stato Pagata." }); }
          catch (x) { toast({ variant: "destructive", title: "Pagamento registrato, documento non allegato", description: messaggioErrore(x) }); }
        } else toast({ title: "Pagamento registrato", description: "Le pratiche dell'estratto sono ora nello stato Pagata." });
      },
      onError: (x) => setErr(parseApiError(x).message),
    });
  };

  const allega = async (file: File | undefined) => {
    if (!file) return;
    setCarica(true);
    try { await inviaFile("PUT", `/backoffice/compensi/estratti/${id}/pagamento/allegato`, {}, file); aggiorna(); toast({ title: "Documento allegato al pagamento" }); }
    catch (x) { toast({ variant: "destructive", title: "Caricamento non riuscito", description: messaggioErrore(x) }); }
    finally { setCarica(false); if (inputAllegato.current) inputAllegato.current.value = ""; }
  };

  return (
    <div>
      <Link href="/admin/compensi?tab=estratti" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-3"><ArrowLeft className="size-4 mr-1" />Compensi</Link>
      <PageHeader title={`Estratto n. ${e.id}`} kicker={`${e.collaboratoreNome} · sportello ${e.numeroSportello}`}
        subtitle={<>del {fmtData(e.dataEstratto)} · Totale pratiche {e.numeroPratiche} · Totale punti {e.totalePunti} · ristorno {fmtEuro(e.totaleEuro)}</>}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild><a href={urlEstrattoPdf(id)} target="_blank" rel="noreferrer" data-testid="button-pdf-estratto"><Printer className="size-4 mr-2" />Stampa PDF</a></Button>
            <Button variant="outline" disabled={invia.isPending} data-testid="button-invia-estratto"
              onClick={() => invia.mutate({ id }, {
                onSuccess: (r) => { aggiorna(); toast({ title: r.esitoEtichetta, description: r.dettaglio ?? undefined }); },
                onError: (x) => toast({ title: "Invio non riuscito", description: parseApiError(x).message, variant: "destructive" }),
              })}><Mail className="size-4 mr-2" />{invia.isPending ? "Invio…" : "Invia per email"}</Button>
            {!e.pagato && <Button onClick={() => { setErr(null); setFileContabile(null); setPagamento({ data: oggi(), importo: String(e.totaleEuro.toFixed(2)).replace(".", ","), metodo: "bonifico" }); }} data-testid="button-registra-pagamento"><Banknote className="size-4 mr-2" />Registra pagamento</Button>}
            {!e.pagato && <Button variant="outline" onClick={() => setConferma(true)} data-testid="button-elimina-estratto"><Trash2 className="size-4 mr-2" />Elimina</Button>}
          </div>
        } />

      <div className="mb-6 rounded-lg border border-border bg-card px-4 py-3 text-sm" data-testid="stato-pagamento">
        {e.pagato ? (
          <><Badge className="bg-primary text-primary-foreground mr-2">Pagato</Badge>il {fmtData(e.pagatoIl)} · {fmtEuro(e.pagamentoEuro ?? 0)} · {METODI[e.pagamentoMetodo as keyof typeof METODI] ?? e.pagamentoMetodo}
            {q.data.pagamentoRegistratoDa && <span className="text-muted-foreground"> · registrato da {q.data.pagamentoRegistratoDa} il {fmtIstante(q.data.pagamentoRegistratoIl)}</span>}
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3" data-testid="allegato-pagamento">
              <Paperclip className="size-4 text-muted-foreground" />
              {allegato ? (
                <span>Documento allegato: <a href={urlAllegatoPagamentoEstratto(id, true)} target="_blank" rel="noreferrer" className="underline font-medium" data-testid="link-allegato-pagamento">{allegato.nome}</a> <span className="text-muted-foreground">({formatoDimensione(allegato.dimensione)}, caricato il {fmtIstante(allegato.caricatoIl)})</span></span>
              ) : <span className="text-muted-foreground">Nessun documento allegato (per esempio la contabile del bonifico).</span>}
              <input ref={inputAllegato} type="file" accept={FORMATI_DOCUMENTI} className="hidden" onChange={(x) => allega(x.target.files?.[0])} data-testid="input-allegato-pagamento" />
              <Button size="sm" variant="outline" disabled={carica} onClick={() => inputAllegato.current?.click()} data-testid="button-allega-pagamento">{carica ? "Caricamento…" : allegato ? "Sostituisci documento" : "Allega documento"}</Button>
            </div></>
        ) : <><Badge variant="outline" className="mr-2">Da pagare</Badge>Le pratiche si possono ancora liberare eliminando l'estratto.</>}
      </div>

      <div className="rounded-lg border border-border bg-card overflow-x-auto mb-8">
        <Table>
          <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60">
            {["Assistito", "Pratica", "Tipo", "Data pratica", "Punti", "Ristorno"].map((h, i) => <TableHead key={h} className={`text-[11px] uppercase tracking-wider font-semibold h-10 ${i >= 4 ? "text-right" : ""}`}>{h}</TableHead>)}
          </TableRow></TableHeader>
          <TableBody>
            {righe.map((r) => (
              <TableRow key={r.praticaId} data-testid={`riga-estratto-${r.praticaId}`}>
                <TableCell>{r.assistito}</TableCell>
                <TableCell className="tabular-nums"><Link href={`/admin/pratiche/${r.praticaId}`} className="underline">{r.numeroPratica}</Link></TableCell>
                <TableCell>{r.tipoPratica}</TableCell>
                <TableCell className="tabular-nums">{fmtData(r.dataPratica)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.punti}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtEuro(r.valoreEuro)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-secondary/40 hover:bg-secondary/40 font-semibold">
              <TableCell colSpan={4}>Totale pratiche {e.numeroPratiche}</TableCell><TableCell className="text-right tabular-nums">{e.totalePunti}</TableCell><TableCell className="text-right tabular-nums">{fmtEuro(e.totaleEuro)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      {esclusioni.length > 0 && (
        <div className="mb-8" data-testid="esclusioni-estratto">
          <h3 className="font-serif text-lg font-semibold mb-1">Pratiche escluse da questo estratto</h3>
          <p className="text-sm text-muted-foreground mb-2">Sono rimaste nel resoconto e si potranno pagare con un estratto futuro.</p>
          <ul className="space-y-1.5 text-sm">
            {esclusioni.map((x) => (
              <li key={x.praticaId} className="rounded-md border border-border bg-card px-3 py-2" data-testid={`esclusione-${x.praticaId}`}>
                <Link href={`/admin/pratiche/${x.praticaId}`} className="underline tabular-nums">Pratica {x.numeroPratica}</Link> · {x.assistito} · {x.tipoPratica} — <strong>Motivo:</strong> {x.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}

      <h3 className="font-serif text-lg font-semibold mb-2">Invii per email</h3>
      <p className="text-sm text-muted-foreground mb-3">Destinatario: {q.data.emailDestinatario ?? "il collaboratore non ha un indirizzo email"}.</p>
      {invii.length === 0 ? <p className="text-sm">Nessun invio registrato.</p> : (
        <ul className="space-y-1.5 text-sm" data-testid="elenco-invii">
          {invii.map((n) => (
            <li key={n.id} className="rounded-md border border-border bg-card px-3 py-2">
              <span className="tabular-nums">{fmtIstante(n.creatoIl)}</span> · {n.destinatarioContatto} · <strong>{n.esitoEtichetta}</strong>
              {n.dettaglioEsito && <span className="text-muted-foreground"> ({n.dettaglioEsito})</span>}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!pagamento} onOpenChange={(o) => { if (!o) setPagamento(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registra il pagamento</DialogTitle></DialogHeader>
          {pagamento && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label htmlFor="p-data">Data</Label><Input id="p-data" type="date" value={pagamento.data} onChange={(x) => setPagamento({ ...pagamento, data: x.target.value })} data-testid="input-pagamento-data" /></div>
                <div className="space-y-1.5"><Label htmlFor="p-imp">Importo (euro)</Label><Input id="p-imp" inputMode="decimal" value={pagamento.importo} onChange={(x) => setPagamento({ ...pagamento, importo: x.target.value })} data-testid="input-pagamento-importo" /></div>
              </div>
              <div className="space-y-1.5"><Label htmlFor="p-file">Documento di pagamento (facoltativo)</Label>
                <Input id="p-file" type="file" accept={FORMATI_DOCUMENTI} onChange={(x) => setFileContabile(x.target.files?.[0] ?? null)} data-testid="input-pagamento-file" />
                <p className="text-xs text-muted-foreground">Per esempio la contabile del bonifico: PDF o immagine.</p>
              </div>
              <div className="space-y-1.5"><Label>Metodo</Label>
                <Select value={pagamento.metodo} onValueChange={(v) => setPagamento({ ...pagamento, metodo: v as keyof typeof METODI })}>
                  <SelectTrigger data-testid="select-pagamento-metodo"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(METODI).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">Dopo la registrazione le pratiche passano a Pagata e non si possono più inserire in un altro estratto. Il pagamento si registra una sola volta.</p>
              {err && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 text-destructive px-3 py-2 text-sm">{err}</div>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPagamento(null)}>Annulla</Button>
            <Button onClick={registra} disabled={paga.isPending} data-testid="button-conferma-pagamento">{paga.isPending ? "Registrazione…" : "Registra"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfermaElimina aperto={conferma} titolo={`Eliminare l'estratto n. ${e.id}?`} testo="Le pratiche tornano disponibili nel resoconto. Si può eliminare solo un estratto non ancora pagato."
        onAnnulla={() => setConferma(false)}
        onConferma={() => elimina.mutate({ id }, {
          onSuccess: () => { qc.invalidateQueries({ queryKey: getListEstrattiQueryKey() }); qc.invalidateQueries({ queryKey: getGetResocontoCompensiQueryKey() }); toast({ title: "Estratto eliminato" }); nav("/admin/compensi?tab=estratti"); },
          onError: (x) => { setConferma(false); toast({ title: "Eliminazione non riuscita", description: parseApiError(x).message, variant: "destructive" }); },
        })} />
    </div>
  );
}
