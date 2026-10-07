import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetPraticaQueryKey, getListPraticheQueryKey, useCreateCommentoPratica, useDeleteDocumentoPratica, useDeletePratica,
  useGetPratica, useInviaPratica, useSalvaMessaggioPratica, type PraticaDettaglio,
} from "@workspace/api-client-react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileText, Loader2, Lock, Paperclip, Send, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState, FieldError, PageHeader } from "@/components/common";
import { ConfermaElimina } from "@/components/pratiche/conferma-elimina";
import { SelettoreFile } from "@/components/pratiche/selettore-file";
import { useToast } from "@/hooks/use-toast";
import { fmtCellulare, fmtData, fmtIstante, parseApiError } from "@/lib/format";
import { ErroreUpload, FORMATI_DOCUMENTI, formatoDimensione, inviaFile, urlDocumentoPratica, urlMandatoPratica, urlModulo } from "@/lib/upload";

type Doc = PraticaDettaglio["documenti"][number];

function Sezione({ titolo, children, nota, testId }: { titolo: string; children: ReactNode; nota?: ReactNode; testId?: string }) {
  return (
    <section className="bg-card border border-border rounded-lg p-5 rise" data-testid={testId}>
      <h2 className="text-lg font-bold pb-2 mb-4 border-b border-border">{titolo}</h2>
      {nota && <p className="text-sm text-muted-foreground mb-4">{nota}</p>}
      {children}
    </section>
  );
}

function Dato({ k, children, mono }: { k: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{k}</dt>
      <dd className={`mt-0.5 text-sm font-medium break-words ${mono ? "font-mono" : ""}`}>{children}</dd>
    </div>
  );
}

function LinkFile({ href, nome, dimensione, testId }: { href: string; nome: string; dimensione: number; testId?: string }) {
  return (
    <a href={href} download className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline break-all" data-testid={testId}>
      <Download className="size-4 shrink-0" /> {nome} <span className="text-xs text-muted-foreground font-normal whitespace-nowrap">({formatoDimensione(dimensione)})</span>
    </a>
  );
}

export default function PraticaDettaglioCollaboratore() {
  const id = Number(useParams<{ id: string }>().id);
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useGetPratica(id, { query: { enabled: Number.isInteger(id) && id > 0, queryKey: getGetPraticaQueryKey(id) } });
  const salvaMsg = useSalvaMessaggioPratica();
  const invia = useInviaPratica();
  const elimina = useDeletePratica();
  const eliminaDoc = useDeleteDocumentoPratica();
  const commenta = useCreateCommentoPratica();
  const [messaggio, setMessaggio] = useState("");
  const [sporco, setSporco] = useState(false);
  const [risposta, setRisposta] = useState("");
  const [caricando, setCaricando] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [daEliminare, setDaEliminare] = useState<Doc | null>(null);
  const [eliminaBozza, setEliminaBozza] = useState(false);

  const p = q.data;
  useEffect(() => { if (p && !sporco) setMessaggio(p.messaggio); }, [p, sporco]);

  const aggiorna = (nuova: PraticaDettaglio) => {
    qc.setQueryData(getGetPraticaQueryKey(id), nuova);
    qc.invalidateQueries({ queryKey: getListPraticheQueryKey() });
  };
  // Dopo un errore ricarica la pratica: potrebbe essere cambiata (ad esempio gia' inviata da un'altra scheda).
  const fallita = (e: unknown) => { setErrore(e instanceof ErroreUpload ? e.message : parseApiError(e).message); qc.invalidateQueries({ queryKey: getGetPraticaQueryKey(id) }); };

  if (!Number.isInteger(id) || id <= 0) return <ErrorState message="Pratica non trovata." />;
  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-10 w-72" /><Skeleton className="h-64 w-full" /></div>;
  if (q.isError || !p) return <ErrorState message={q.error ? parseApiError(q.error).message : "Pratica non trovata."} onRetry={() => q.refetch()} />;

  const a = p.assistito;
  const carica = async (chiave: string, query: Record<string, string | number>, file: File) => {
    setErrore(null); setCaricando(chiave);
    try { aggiorna(await inviaFile<PraticaDettaglio>("POST", `/pratiche/${id}/documenti/file`, query, file)); }
    catch (e) { fallita(e); }
    finally { setCaricando(null); }
  };
  const docDi = (tipoId: number) => p.documenti.find((d) => d.documentoTipoId === tipoId);
  const allegati = p.documenti.filter((d) => d.documentoTipoId === null);
  const bloccato = p.modificabile && !p.invio.consentito;
  const puoInviare = p.modificabile && p.mancanti.length === 0 && p.invio.consentito;

  const salva = () => salvaMsg.mutate({ id, data: { messaggio } }, {
    onSuccess: (n) => { aggiorna(n); setSporco(false); toast({ title: "Bozza salvata" }); }, onError: fallita,
  });
  const invio = () => { setErrore(null); invia.mutate({ id, data: { messaggio } }, {
    onSuccess: (n) => { aggiorna(n); setSporco(false); toast({ title: `Pratica n. ${n.numero} inviata` }); }, onError: fallita,
  }); };

  return (
    <div className="space-y-5">
      <div>
        <Link href="/collaboratore/pratiche" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3 transition-colors" data-testid="link-indietro-pratiche"><ArrowLeft className="size-4" /> Le mie pratiche</Link>
        <PageHeader kicker={p.bozza ? "Pratica in bozza" : "Pratica inviata"} title={p.numero ? `Pratica n. ${p.numero}` : p.tipo.nome}
          subtitle={<span>{p.numero ? `${p.tipo.nome} · ` : ""}{a.cognome} {a.nome} · {p.inviataIl ? `inviata il ${fmtIstante(p.inviataIl)}` : `creata il ${fmtIstante(p.creataIl)}`}</span>}
          actions={<Badge className={p.bozza ? "" : "bg-primary text-primary-foreground"} variant={p.bozza ? "outline" : "default"} data-testid="badge-stato-pratica">{p.stato}</Badge>} />
      </div>

      {bloccato && (
        <div role="alert" className="flex gap-3 rounded-lg border border-amber-500/50 bg-amber-50 text-amber-950 p-4 text-sm" data-testid="banner-invio-bloccato">
          <Lock className="size-5 shrink-0 mt-0.5" /><div><strong className="block">Invio sospeso</strong>{p.invio.messaggio}</div>
        </div>
      )}
      {!p.modificabile && !p.puoAllegare && (
        <div className="flex gap-3 rounded-lg border border-border bg-secondary/60 p-4 text-sm" data-testid="banner-sola-lettura">
          <Lock className="size-5 shrink-0 mt-0.5" /><div>Pratica di {p.collaboratore.cognome} {p.collaboratore.nome} (sportello {p.collaboratore.numeroSportello}): puoi consultarla ma non modificarla.</div>
        </div>
      )}
      {errore && <div role="alert" className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/10 text-destructive p-4 text-sm" data-testid="errore-pratica"><AlertTriangle className="size-5 shrink-0 mt-0.5" /><div>{errore}</div></div>}

      <Sezione titolo="Assistito" nota="I dati dell'assistito sono in sola lettura nella pratica." testId="sezione-assistito">
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Dato k="Cognome e nome">{a.cognome} {a.nome}</Dato>
          <Dato k="Codice fiscale" mono>{a.codiceFiscale}</Dato>
          <Dato k="Data di nascita">{fmtData(a.dataNascita)}</Dato>
          <Dato k="Luogo di nascita">{a.luogoNascitaNome}{a.luogoNascitaProvincia ? ` (${a.luogoNascitaProvincia})` : ""}</Dato>
          <Dato k="Nazionalità">{a.nazionalitaNome}</Dato>
          <Dato k="Cellulare" mono>{fmtCellulare(a.cellulare)}</Dato>
          <Dato k="Email">{a.email ?? "—"}</Dato>
          <Dato k="Residenza">{a.citta}{a.indirizzo ? `, ${a.indirizzo}` : ""}</Dato>
        </dl>
      </Sezione>

      <div className="grid gap-5 lg:grid-cols-2">
        <Sezione titolo="Moduli da scaricare" testId="sezione-moduli">
          {p.moduli.length === 0 ? <p className="text-sm text-muted-foreground">Questo tipo di pratica non ha moduli da compilare.</p> : (
            <ul className="space-y-2">{p.moduli.map((m) => <li key={m.id} className="text-sm"><div className="font-semibold">{m.nome}</div><LinkFile href={urlModulo(m.id)} nome={m.fileNome} dimensione={m.dimensione} testId={`download-modulo-${m.id}`} /></li>)}</ul>
          )}
        </Sezione>
        <Sezione titolo="Mandato del tuo sportello" testId="sezione-mandato">
          {p.mandato ? (
            <div className="text-sm"><div className="font-semibold">{p.mandato.nome}</div><LinkFile href={urlMandatoPratica(id)} nome={p.mandato.fileNome} dimensione={p.mandato.dimensione} testId="download-mandato" /></div>
          ) : p.mandatoMancante ? (
            <p className="text-sm text-destructive" data-testid="mandato-mancante">Per questo tipo di pratica serve il mandato, ma al tuo sportello non ne è stato assegnato uno. Contatta l'amministrazione.</p>
          ) : <p className="text-sm text-muted-foreground">Nessun mandato assegnato al tuo sportello per questo tipo di pratica.</p>}
        </Sezione>
      </div>

      <Sezione titolo="Documenti" testId="sezione-documenti"
        nota={p.modificabile ? "Carica un file per ogni documento richiesto (PDF, PNG o JPG, fino a 15 MB). L'invio è possibile solo con tutti i documenti caricati." : undefined}>
        {p.modificabile ? (
          <ul className="divide-y divide-border">
            {p.richiesti.length === 0 && <li className="py-2 text-sm text-muted-foreground">Nessun documento obbligatorio per questo tipo di pratica.</li>}
            {p.richiesti.map((r) => {
              const d = docDi(r.id);
              return (
                <li key={r.id} className="py-3 flex flex-wrap items-center justify-between gap-3" data-testid={`documento-richiesto-${r.id}`}>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm flex items-center gap-2">{r.nome}{d ? <CheckCircle2 className="size-4 text-green-700" aria-label="Caricato" /> : <Badge variant="outline">Da caricare</Badge>}</div>
                    {d && <LinkFile href={urlDocumentoPratica(id, d.id)} nome={d.fileNome} dimensione={d.dimensione} testId={`download-documento-${d.id}`} />}
                  </div>
                  <div className="flex gap-2">
                    <SelettoreFile accept={FORMATI_DOCUMENTI} testId={`carica-documento-${r.id}`} disabled={caricando !== null} onFile={(f) => carica(`r${r.id}`, { documentoTipoId: r.id }, f)}>
                      {caricando === `r${r.id}` ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Upload className="size-4 mr-1.5" />} {d ? "Sostituisci" : "Carica"}
                    </SelettoreFile>
                    {d && <Button size="sm" variant="ghost" onClick={() => setDaEliminare(d)} aria-label={`Togli ${r.nome}`} data-testid={`elimina-documento-${d.id}`}><Trash2 className="size-4" /></Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className="divide-y divide-border">
            {p.documenti.filter((d) => d.documentoTipoId !== null).length === 0 && <li className="py-2 text-sm text-muted-foreground">Nessun documento.</li>}
            {p.documenti.filter((d) => d.documentoTipoId !== null).map((d) => (
              <li key={d.id} className="py-3" data-testid={`documento-inviato-${d.id}`}>
                <div className="font-semibold text-sm">{d.nome}</div>
                <LinkFile href={urlDocumentoPratica(id, d.id)} nome={d.fileNome} dimensione={d.dimensione} />
                <div className="text-xs text-muted-foreground">Caricato il {fmtIstante(d.caricatoIl)} da {d.caricatoDa}</div>
              </li>
            ))}
          </ul>
        )}
        {(p.modificabile || p.puoAllegare || allegati.length > 0) && (
          <div className="mt-5 pt-4 border-t border-border" data-testid="sezione-allegati">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h3 className="font-bold flex items-center gap-2"><Paperclip className="size-4" /> Allegati aggiuntivi</h3>
              {(p.modificabile || p.puoAllegare) && (
                <SelettoreFile accept={FORMATI_DOCUMENTI} testId="aggiungi-allegato" disabled={caricando !== null} onFile={(f) => carica("allegato", {}, f)}>
                  {caricando === "allegato" ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Upload className="size-4 mr-1.5" />} Aggiungi allegato
                </SelettoreFile>
              )}
            </div>
            {p.puoAllegare && <p className="text-xs text-muted-foreground mb-2">Gli allegati si possono aggiungere ma non togliere né sostituire, perché la pratica è già stata inviata.</p>}
            {allegati.length === 0 ? <p className="text-sm text-muted-foreground">Nessun allegato aggiuntivo.</p> : (
              <ul className="divide-y divide-border">
                {allegati.map((d) => (
                  <li key={d.id} className="py-2 flex items-start justify-between gap-3" data-testid={`allegato-${d.id}`}>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{d.nome}{d.dopoInvio && <Badge variant="secondary" className="ml-2">Aggiunto dopo l'invio</Badge>}</div>
                      <LinkFile href={urlDocumentoPratica(id, d.id)} nome={d.fileNome} dimensione={d.dimensione} />
                      <div className="text-xs text-muted-foreground">Caricato il {fmtIstante(d.caricatoIl)} da {d.caricatoDa}</div>
                    </div>
                    {p.modificabile && <Button size="sm" variant="ghost" onClick={() => setDaEliminare(d)} aria-label={`Togli ${d.nome}`} data-testid={`elimina-allegato-${d.id}`}><Trash2 className="size-4" /></Button>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Sezione>

      {p.bozza ? (
        <Sezione titolo="Messaggio" nota={p.modificabile ? "Scrivi un messaggio per l'ufficio: sarà il primo commento della pratica." : undefined} testId="sezione-messaggio">
          {p.modificabile ? (
            <>
              <Textarea value={messaggio} maxLength={4000} rows={4} onChange={(e) => { setMessaggio(e.target.value); setSporco(true); }} placeholder="Scrivi qui il messaggio per l'ufficio" data-testid="input-messaggio-pratica" />
              <div className="mt-3 flex justify-end"><Button variant="outline" size="sm" onClick={salva} disabled={salvaMsg.isPending || !sporco} data-testid="button-salva-bozza">{salvaMsg.isPending && <Loader2 className="size-4 mr-2 animate-spin" />} Salva bozza</Button></div>
            </>
          ) : <p className="text-sm whitespace-pre-wrap">{p.messaggio || "Nessun messaggio."}</p>}
        </Sezione>
      ) : (
        <Sezione titolo="Commenti" testId="sezione-commenti">
          {p.commenti.length === 0 ? <p className="text-sm text-muted-foreground mb-4">Nessun commento.</p> : (
            <ul className="space-y-3 mb-4">
              {p.commenti.map((c) => (
                <li key={c.id} className={`rounded-lg border p-3 text-sm max-w-[85%] ${c.mio ? "ml-auto bg-secondary/60 border-border" : "bg-card border-accent"}`} data-testid={`commento-${c.id}`}>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mb-1"><strong className="text-foreground">{c.autore}</strong>{c.ruolo === "backoffice" && <Badge variant="outline">Ufficio</Badge>}<span>{fmtIstante(c.creatoIl)}</span></div>
                  <p className="whitespace-pre-wrap">{c.testo}</p>
                </li>
              ))}
            </ul>
          )}
          {p.puoCommentare && (
            <div>
              <Textarea value={risposta} maxLength={4000} rows={3} onChange={(e) => setRisposta(e.target.value)} placeholder="Scrivi una risposta" data-testid="input-commento" />
              <div className="mt-3 flex justify-end">
                <Button size="sm" disabled={!risposta.trim() || commenta.isPending} data-testid="button-invia-commento"
                  onClick={() => { setErrore(null); commenta.mutate({ id, data: { testo: risposta } }, { onSuccess: (n) => { aggiorna(n); setRisposta(""); }, onError: fallita }); }}>
                  {commenta.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Send className="size-4 mr-2" />} Rispondi
                </Button>
              </div>
            </div>
          )}
        </Sezione>
      )}

      {p.modificabile && (
        <section className="bg-card border-2 border-accent rounded-lg p-5 rise" data-testid="sezione-invio">
          <h2 className="text-lg font-bold mb-2 flex items-center gap-2"><FileText className="size-5" /> Invio della pratica</h2>
          {p.mancanti.length > 0 ? (
            <ul className="text-sm list-disc pl-5 space-y-1 mb-3" data-testid="elenco-mancanti">{p.mancanti.map((m) => <li key={m}>{m}</li>)}</ul>
          ) : <p className="text-sm mb-3">Tutti i documenti sono stati caricati.</p>}
          {bloccato && <FieldError>{p.invio.messaggio}</FieldError>}
          <p className="text-xs text-muted-foreground mb-3">Dopo l'invio la pratica riceve un numero progressivo e non si potrà più cancellare né sostituire i documenti inviati.</p>
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="outline" onClick={() => setEliminaBozza(true)} data-testid="button-elimina-bozza"><Trash2 className="size-4 mr-1.5" /> Cancella bozza</Button>
            <Button onClick={invio} disabled={!puoInviare || invia.isPending} data-testid="button-invia-pratica">
              {invia.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Send className="size-4 mr-2" />} Invia pratica
            </Button>
          </div>
        </section>
      )}

      <ConfermaElimina aperto={!!daEliminare} titolo="Togliere il documento?" testo={daEliminare ? `Il file "${daEliminare.fileNome}" verrà tolto dalla bozza.` : ""}
        onAnnulla={() => setDaEliminare(null)}
        onConferma={() => { const d = daEliminare; setDaEliminare(null); if (d) { setErrore(null); eliminaDoc.mutate({ id, docId: d.id }, { onSuccess: aggiorna, onError: fallita }); } }} />
      <ConfermaElimina aperto={eliminaBozza} titolo="Cancellare la bozza?" testo="La bozza e i documenti caricati verranno eliminati. L'operazione non si può annullare."
        onAnnulla={() => setEliminaBozza(false)}
        onConferma={() => { setEliminaBozza(false); elimina.mutate({ id }, {
          onSuccess: () => { qc.removeQueries({ queryKey: getGetPraticaQueryKey(id) }); qc.invalidateQueries({ queryKey: getListPraticheQueryKey() }); toast({ title: "Bozza cancellata" }); nav("/collaboratore/pratiche"); },
          onError: fallita,
        }); }} />
    </div>
  );
}
