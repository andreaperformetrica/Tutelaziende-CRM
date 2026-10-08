import { useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetPraticaBackofficeQueryKey, useCambiaStatoPratica, useCreateCommentoPraticaBackoffice, useDeletePraticaBackoffice,
  useGetFiltriPraticheBackoffice, useGetPraticaBackoffice, useListCategorieAllegato, usePrendiInCaricoPratica,
  type DocumentoPratica, type PraticaBackoffice,
} from "@workspace/api-client-react";
import { AlertTriangle, ArrowLeft, Download, Eye, FileText, HandHelping, Loader2, Mail, MessageCircle, Paperclip, Send, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorState, PageHeader } from "@/components/common";
import { ConfermaElimina } from "@/components/pratiche/conferma-elimina";
import { SelettoreFile } from "@/components/pratiche/selettore-file";
import { useToast } from "@/hooks/use-toast";
import { fmtCellulare, fmtData, fmtIstante, parseApiError, ruoloLabel } from "@/lib/format";
import {
  ErroreUpload, FORMATI_DOCUMENTI, formatoDimensione, inviaFile, urlDocumentoBackoffice, urlMandatoBackoffice,
} from "@/lib/upload";

type Canale = "email" | "whatsapp" | "entrambi";
const CANALI: { value: Canale; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "entrambi", label: "Email e WhatsApp" },
];
const etichettaCanale = (c: string | null | undefined) => CANALI.find((x) => x.value === c)?.label ?? "";

function Sezione({ titolo, children, nota, testId, azioni }: { titolo: string; children: ReactNode; nota?: ReactNode; testId?: string; azioni?: ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-lg p-5 rise" data-testid={testId}>
      <div className="flex items-center justify-between gap-3 pb-2 mb-4 border-b border-border">
        <h2 className="text-lg font-bold">{titolo}</h2>{azioni}
      </div>
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

interface Anteprima { titolo: string; url: string; scarica: string; immagine: boolean }
const eImmagine = (tipoOnome: string) => /^image\//.test(tipoOnome) || /\.(png|jpe?g)$/i.test(tipoOnome);

function RigaFile({ d, praticaId, onAnteprima, testId }: { d: DocumentoPratica; praticaId: number; onAnteprima: (a: Anteprima) => void; testId: string }) {
  return (
    <li className="py-3 flex flex-wrap items-start justify-between gap-3" data-testid={testId}>
      <div className="min-w-0">
        <div className="font-semibold text-sm">
          {d.nome}
          {d.daUfficio && <Badge variant="outline" className="ml-2">Ufficio</Badge>}
          {d.categoria && <Badge variant="secondary" className="ml-1">{d.categoria}</Badge>}
          {d.dopoInvio && !d.daUfficio && <Badge variant="secondary" className="ml-1">Aggiunto dopo l'invio</Badge>}
        </div>
        <div className="text-xs text-muted-foreground break-all">{d.fileNome} ({formatoDimensione(d.dimensione)}) · caricato il {fmtIstante(d.caricatoIl)} da {d.caricatoDa}</div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => onAnteprima({ titolo: d.nome, url: urlDocumentoBackoffice(praticaId, d.id, true), scarica: urlDocumentoBackoffice(praticaId, d.id), immagine: eImmagine(d.fileTipo) })} data-testid={`anteprima-${testId}`}><Eye className="size-4 mr-1.5" /> Anteprima</Button>
        <Button size="sm" variant="ghost" asChild><a href={urlDocumentoBackoffice(praticaId, d.id)} download aria-label={`Scarica ${d.fileNome}`} data-testid={`scarica-${testId}`}><Download className="size-4" /></a></Button>
      </div>
    </li>
  );
}

export default function PraticaDettaglioBackoffice() {
  const id = Number(useParams<{ id: string }>().id);
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const valido = Number.isInteger(id) && id > 0;
  const q = useGetPraticaBackoffice(id, { query: { enabled: valido, queryKey: getGetPraticaBackofficeQueryKey(id) } });
  const filtri = useGetFiltriPraticheBackoffice();
  const categorie = useListCategorieAllegato();
  const presa = usePrendiInCaricoPratica();
  const cambiaStato = useCambiaStatoPratica();
  const commenta = useCreateCommentoPraticaBackoffice();
  const elimina = useDeletePraticaBackoffice();
  const [errore, setErrore] = useState<string | null>(null);
  const [anteprima, setAnteprima] = useState<Anteprima | null>(null);
  const [confermaPresa, setConfermaPresa] = useState(false);
  const [eliminaAperto, setEliminaAperto] = useState(false);
  const [statoScelto, setStatoScelto] = useState<string>("");
  const [testo, setTesto] = useState("");
  const [canale, setCanale] = useState<Canale>("email");
  const [descrizione, setDescrizione] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [caricando, setCaricando] = useState(false);

  const p = q.data;
  const aggiorna = (n: PraticaBackoffice) => {
    qc.setQueryData(getGetPraticaBackofficeQueryKey(id), n);
    qc.invalidateQueries({ queryKey: ["pratiche-backoffice"] });
  };
  const fallita = (e: unknown) => { setErrore(e instanceof ErroreUpload ? e.message : parseApiError(e).message); qc.invalidateQueries({ queryKey: getGetPraticaBackofficeQueryKey(id) }); };

  if (!valido) return <ErrorState message="Pratica non trovata." />;
  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-10 w-72" /><Skeleton className="h-64 w-full" /></div>;
  if (q.isError || !p) return <ErrorState message={q.error ? parseApiError(q.error).message : "Pratica non trovata."} onRetry={() => q.refetch()} />;

  const a = p.assistito;
  const stati = filtri.data?.stati ?? [];
  const statoCorrente = String(p.stato.id);
  const sceltoEffettivo = statoScelto || statoCorrente;
  const prendi = () => { setConfermaPresa(false); setErrore(null); presa.mutate({ id }, { onSuccess: (n) => { aggiorna(n); toast({ title: "Pratica presa in carico" }); }, onError: fallita }); };

  const allega = async () => {
    setErrore(null);
    if (!descrizione.trim()) return setErrore("Inserisci la descrizione dell'allegato.");
    if (!categoriaId) return setErrore("Scegli la categoria dell'allegato.");
    if (!file) return setErrore("Scegli il file da allegare.");
    setCaricando(true);
    try {
      aggiorna(await inviaFile<PraticaBackoffice>("POST", `/backoffice/pratiche/${id}/allegati/file`, { descrizione: descrizione.trim(), categoriaId }, file));
      setDescrizione(""); setCategoriaId(""); setFile(null);
      toast({ title: "Allegato aggiunto" });
    } catch (e) { fallita(e); } finally { setCaricando(false); }
  };

  return (
    <div className="space-y-5">
      <div>
        <Link href="/admin/pratiche" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3 transition-colors" data-testid="link-indietro-pratiche"><ArrowLeft className="size-4" /> Elenco pratiche</Link>
        <PageHeader kicker="Pratica" title={`Pratica n. ${p.numero}`}
          subtitle={<span>{p.tipo.nome} · {a.cognome} {a.nome} · richiesta il {fmtIstante(p.inviataIl)}</span>}
          actions={<>
            {p.aggiornata && <Badge className="bg-primary text-primary-foreground" data-testid="badge-aggiornata">Aggiornata</Badge>}
            <Badge variant={p.stato.chiuso ? "secondary" : "outline"} data-testid="badge-stato-pratica">{p.stato.nome}</Badge>
          </>} />
      </div>

      {errore && <div role="alert" className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/10 text-destructive p-4 text-sm" data-testid="errore-pratica"><AlertTriangle className="size-5 shrink-0 mt-0.5" /><div className="flex-1">{errore}</div><button type="button" onClick={() => setErrore(null)} aria-label="Chiudi"><X className="size-4" /></button></div>}

      <Sezione titolo="Gestione" testId="sezione-gestione">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Gestita da</div>
            <div className="mt-1 text-sm font-semibold" data-testid="text-gestita-da">{p.gestitaDa ? `${p.gestitaDa.cognome} ${p.gestitaDa.nome}` : "Non assegnata"}{p.mieInCarico && <Badge variant="secondary" className="ml-2">Tu</Badge>}</div>
          </div>
          {!p.mieInCarico && (
            <Button onClick={() => (p.gestitaDa ? setConfermaPresa(true) : prendi())} disabled={presa.isPending} data-testid="button-prendi-in-carico">
              {presa.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <HandHelping className="size-4 mr-2" />} Prendi in carico
            </Button>
          )}
          <div className="flex items-end gap-2 ml-auto">
            <div>
              <Label htmlFor="cambia-stato" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Stato</Label>
              <Select value={sceltoEffettivo} onValueChange={setStatoScelto}>
                <SelectTrigger id="cambia-stato" className="mt-1 w-56 bg-card" data-testid="select-stato"><SelectValue /></SelectTrigger>
                <SelectContent>{stati.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button variant="outline" disabled={sceltoEffettivo === statoCorrente || cambiaStato.isPending} data-testid="button-cambia-stato"
              onClick={() => { setErrore(null); cambiaStato.mutate({ id, data: { statoId: Number(sceltoEffettivo) } }, { onSuccess: (n) => { aggiorna(n); setStatoScelto(""); toast({ title: "Stato aggiornato" }); }, onError: fallita }); }}>
              {cambiaStato.isPending && <Loader2 className="size-4 mr-2 animate-spin" />} Cambia stato
            </Button>
          </div>
        </div>
      </Sezione>

      <Sezione titolo="Assistito" testId="sezione-assistito">
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

      <Sezione titolo="Collaboratore" testId="sezione-collaboratore">
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Dato k="Cognome e nome">{p.collaboratore.cognome} {p.collaboratore.nome}</Dato>
          <Dato k="Sportello" mono>{p.collaboratore.numeroSportello}</Dato>
          <Dato k="Cellulare" mono>{fmtCellulare(p.collaboratore.cellulare)}</Dato>
          <Dato k="Email">{p.collaboratore.email ?? "—"}</Dato>
        </dl>
      </Sezione>

      <Sezione titolo="Messaggio iniziale" testId="sezione-messaggio">
        <p className="text-sm whitespace-pre-wrap" data-testid="text-messaggio">{p.messaggio || "Il collaboratore non ha scritto nessun messaggio."}</p>
      </Sezione>

      <Sezione titolo="Documenti del collaboratore" testId="sezione-documenti">
        {p.mandato && (
          <div className="mb-3 pb-3 border-b border-border flex flex-wrap items-center justify-between gap-3" data-testid="riga-mandato">
            <div className="text-sm"><span className="font-semibold">{p.mandato.nome}</span> <Badge variant="outline" className="ml-1">Mandato</Badge><div className="text-xs text-muted-foreground">{p.mandato.fileNome} ({formatoDimensione(p.mandato.dimensione)})</div></div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setAnteprima({ titolo: p.mandato!.nome, url: urlMandatoBackoffice(id, true), scarica: urlMandatoBackoffice(id), immagine: eImmagine(p.mandato!.fileNome) })} data-testid="anteprima-mandato"><Eye className="size-4 mr-1.5" /> Anteprima</Button>
              <Button size="sm" variant="ghost" asChild><a href={urlMandatoBackoffice(id)} download aria-label="Scarica il mandato"><Download className="size-4" /></a></Button>
            </div>
          </div>
        )}
        {p.documenti.length === 0 ? <p className="text-sm text-muted-foreground">Nessun documento caricato.</p> : (
          <ul className="divide-y divide-border">{p.documenti.map((d) => <RigaFile key={d.id} d={d} praticaId={id} onAnteprima={setAnteprima} testId={`documento-${d.id}`} />)}</ul>
        )}
      </Sezione>

      <Sezione titolo="Allegati dell'ufficio" testId="sezione-allegati-ufficio" nota="Documenti che l'ufficio aggiunge alla pratica: il collaboratore li vede nella sua scheda.">
        {p.allegatiUfficio.length === 0 ? <p className="text-sm text-muted-foreground mb-4">Nessun allegato dell'ufficio.</p> : (
          <ul className="divide-y divide-border mb-4">{p.allegatiUfficio.map((d) => <RigaFile key={d.id} d={d} praticaId={id} onAnteprima={setAnteprima} testId={`allegato-ufficio-${d.id}`} />)}</ul>
        )}
        <div className="rounded-md border border-dashed border-input p-4 space-y-3" data-testid="form-allegato">
          <h3 className="font-bold flex items-center gap-2 text-sm"><Paperclip className="size-4" /> Aggiungi un allegato</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="allegato-descrizione">Descrizione</Label>
              <Input id="allegato-descrizione" value={descrizione} maxLength={200} onChange={(e) => setDescrizione(e.target.value)} placeholder="Es. Estratto contributivo aggiornato" data-testid="input-allegato-descrizione" />
            </div>
            <div>
              <Label htmlFor="allegato-categoria">Categoria</Label>
              <Select value={categoriaId} onValueChange={setCategoriaId}>
                <SelectTrigger id="allegato-categoria" className="bg-card w-full" data-testid="select-allegato-categoria"><SelectValue placeholder="Scegli la categoria" /></SelectTrigger>
                <SelectContent>{(categorie.data ?? []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SelettoreFile accept={FORMATI_DOCUMENTI} testId="scegli-allegato" onFile={setFile}><Upload className="size-4 mr-1.5" /> Scegli file</SelettoreFile>
            <span className="text-sm text-muted-foreground break-all" data-testid="nome-file-scelto">{file ? `${file.name} (${formatoDimensione(file.size)})` : "Nessun file scelto (PDF, PNG o JPG, fino a 15 MB)"}</span>
            <Button className="ml-auto" onClick={allega} disabled={caricando} data-testid="button-allega">
              {caricando ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Paperclip className="size-4 mr-2" />} Allega
            </Button>
          </div>
        </div>
      </Sezione>

      <Sezione titolo="Commenti" testId="sezione-commenti" nota="È la chat con il collaboratore: i commenti sono visibili a entrambi.">
        {p.commenti.length === 0 ? <p className="text-sm text-muted-foreground mb-4">Nessun commento.</p> : (
          <ul className="space-y-3 mb-4">
            {p.commenti.map((c) => (
              <li key={c.id} className={`rounded-lg border p-3 text-sm max-w-[85%] ${c.mio ? "ml-auto bg-secondary/60 border-border" : c.ruolo === "collaboratore" ? "bg-card border-accent" : "bg-card border-border"}`} data-testid={`commento-${c.id}`}>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mb-1">
                  <strong className="text-foreground">{c.autore}</strong><Badge variant="outline">{ruoloLabel(c.ruolo)}</Badge><span>{fmtIstante(c.creatoIl)}</span>
                </div>
                <p className="whitespace-pre-wrap">{c.testo}</p>
                {c.canaleAvviso && <p className="text-xs text-muted-foreground mt-2">Avviso alla sede: {etichettaCanale(c.canaleAvviso)}</p>}
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-3">
          <Textarea value={testo} maxLength={4000} rows={3} onChange={(e) => setTesto(e.target.value)} placeholder="Scrivi un commento per il collaboratore" data-testid="input-commento" />
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <Label htmlFor="canale-avviso" className="text-xs">Avvisa la sede tramite</Label>
              <Select value={canale} onValueChange={(v) => setCanale(v as Canale)}>
                <SelectTrigger id="canale-avviso" className="mt-1 w-52 bg-card" data-testid="select-canale"><SelectValue /></SelectTrigger>
                <SelectContent>{CANALI.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">{canale !== "whatsapp" && <Mail className="size-3" />}{canale !== "email" && <MessageCircle className="size-3" />} La sede riceve un avviso con il numero della pratica e il link, senza il testo del commento.</p>
            </div>
            <Button disabled={!testo.trim() || commenta.isPending} data-testid="button-invia-commento"
              onClick={() => { setErrore(null); commenta.mutate({ id, data: { testo, canale } }, { onSuccess: (n) => { aggiorna(n); setTesto(""); }, onError: fallita }); }}>
              {commenta.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Send className="size-4 mr-2" />} Invia commento
            </Button>
          </div>
        </div>
      </Sezione>

      <Sezione titolo="Cronologia" testId="sezione-cronologia">
        <ol className="space-y-3">
          {p.cronologia.map((e) => (
            <li key={e.id} className="flex gap-3 text-sm" data-testid={`evento-${e.id}`}>
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
              <div><div>{e.descrizione}</div><div className="text-xs text-muted-foreground">{fmtIstante(e.creatoIl)} · {e.autore}</div></div>
            </li>
          ))}
        </ol>
      </Sezione>

      {p.puoEliminare && (
        <section className="border border-destructive/40 rounded-lg p-5 flex flex-wrap items-center justify-between gap-3" data-testid="sezione-elimina">
          <div><h2 className="font-bold text-destructive flex items-center gap-2"><FileText className="size-4" /> Cancella pratica</h2><p className="text-sm text-muted-foreground">Elimina la pratica con documenti, commenti e cronologia. L'operazione viene registrata nel log e non si può annullare.</p></div>
          <Button variant="destructive" onClick={() => setEliminaAperto(true)} data-testid="button-elimina-pratica"><Trash2 className="size-4 mr-2" /> Cancella pratica</Button>
        </section>
      )}

      <Dialog open={!!anteprima} onOpenChange={(o) => { if (!o) setAnteprima(null); }}>
        <DialogContent className="max-w-4xl h-[85dvh] flex flex-col" data-testid="dialog-anteprima">
          <DialogHeader><DialogTitle>{anteprima?.titolo}</DialogTitle><DialogDescription>Anteprima del file.</DialogDescription></DialogHeader>
          {anteprima && (anteprima.immagine
            ? <div className="flex-1 min-h-0 overflow-auto grid place-items-center bg-muted/40 rounded"><img src={anteprima.url} alt={anteprima.titolo} className="max-w-full max-h-full object-contain" data-testid="anteprima-immagine" /></div>
            : <iframe src={anteprima.url} title={anteprima.titolo} className="flex-1 min-h-0 w-full rounded border border-border bg-white" data-testid="anteprima-pdf" />)}
          {anteprima && <div className="flex justify-end"><Button variant="outline" size="sm" asChild><a href={anteprima.scarica} download><Download className="size-4 mr-1.5" /> Scarica</a></Button></div>}
        </DialogContent>
      </Dialog>

      <ConfermaElimina aperto={confermaPresa} azione="Prendi in carico" titolo="Prendere in carico la pratica?"
        testo={p.gestitaDa ? `La pratica è già in carico a ${p.gestitaDa.cognome} ${p.gestitaDa.nome}. Se la prendi in carico tu, passerà a te e il cambio resterà nella cronologia.` : ""}
        onAnnulla={() => setConfermaPresa(false)} onConferma={prendi} />
      <ConfermaElimina aperto={eliminaAperto} titolo={`Cancellare la pratica n. ${p.numero}?`}
        testo="Verranno eliminati anche i documenti, gli allegati, i commenti e la cronologia. L'operazione non si può annullare."
        onAnnulla={() => setEliminaAperto(false)}
        onConferma={() => { setEliminaAperto(false); elimina.mutate({ id }, {
          onSuccess: () => { qc.removeQueries({ queryKey: getGetPraticaBackofficeQueryKey(id) }); qc.invalidateQueries({ queryKey: ["pratiche-backoffice"] }); toast({ title: "Pratica cancellata" }); nav("/admin/pratiche"); },
          onError: fallita,
        }); }} />
    </div>
  );
}
