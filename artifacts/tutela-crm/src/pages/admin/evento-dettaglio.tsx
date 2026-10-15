import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetEventoBackofficeQueryKey, getListEventiBackofficeQueryKey, useAddInvitiEvento, useDeleteEvento,
  useDeleteQuestionarioEvento, useGetEventoBackoffice, useRemoveInvitoEvento, useUpdateEvento, useUpdateOrariPartecipante,
  type EventoBackoffice, type PartecipanteEventoBackoffice,
} from "@workspace/api-client-react";
import { ArrowLeft, Award, Download, FileText, Loader2, Pencil, Printer, QrCode, Trash2, Upload, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, FieldError, PageHeader } from "@/components/common";
import { ConfermaElimina } from "@/components/pratiche/conferma-elimina";
import { SelettoreFile } from "@/components/pratiche/selettore-file";
import { FormEvento } from "@/components/eventi/form-evento";
import { SelettoreSedi } from "@/components/eventi/selettore-sedi";
import { QuestionarioEditor } from "@/components/eventi/questionario-editor";
import { useToast } from "@/hooks/use-toast";
import { fmtData, fmtIstante, fmtOrarioEvento, oraDaIstante, parseApiError, tipologiaLabel } from "@/lib/format";
import {
  formatoDimensione, inviaFile, messaggioErrore, urlAnteprimaAttestato, urlAttestatiPresenti, urlAttestatoPartecipante, urlQuestionarioBackoffice,
} from "@/lib/upload";

export default function EventoDettaglioBackoffice() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useGetEventoBackoffice(id);
  const aggiorna = useUpdateEvento();
  const elimina = useDeleteEvento();

  const [modifica, setModifica] = useState(false);
  const [eliminaOk, setEliminaOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const salva = (d: EventoBackoffice) => {
    qc.setQueryData(getGetEventoBackofficeQueryKey(id), d);
    qc.invalidateQueries({ queryKey: getListEventiBackofficeQueryKey() });
  };
  const errore = (e: unknown) => toast({ variant: "destructive", title: "Operazione non riuscita", description: parseApiError(e).message });

  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-10 w-72" /><Skeleton className="h-64 w-full" /></div>;
  if (q.isError || !q.data) return <ErrorState message={parseApiError(q.error).message} onRetry={() => q.refetch()} />;
  const s = q.data;
  const e = s.evento;
  const presenti = s.partecipanti.filter((p) => p.entrataIl).length;

  return (
    <div>
      <Link href="/admin/eventi" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-3"><ArrowLeft className="size-4" /> Tutti gli eventi</Link>
      <PageHeader title={e.titolo}
        subtitle={<>{fmtData(e.data)} · {fmtOrarioEvento(e.oraInizio, e.oraFine)} · {e.luogo}{e.passato && <Badge variant="outline" className="ml-2">Concluso</Badge>}</>}
        actions={
          <>
            <Button onClick={() => nav(`/admin/eventi/${id}/check-in`)} data-testid="button-apri-check-in"><QrCode className="size-4 mr-2" /> Check-in</Button>
            <Button variant="outline" onClick={() => { setErr(null); setModifica(true); }} data-testid="button-modifica-evento"><Pencil className="size-4 mr-2" /> Modifica</Button>
            <Button variant="outline" onClick={() => setEliminaOk(true)} data-testid="button-elimina-evento"><Trash2 className="size-4" /></Button>
          </>
        } />
      {e.descrizione && <p className="text-sm whitespace-pre-line mb-5 max-w-3xl">{e.descrizione}</p>}

      <Tabs defaultValue="iscritti">
        <TabsList>
          <TabsTrigger value="iscritti" data-testid="tab-iscritti">Iscritti ({s.partecipanti.length})</TabsTrigger>
          <TabsTrigger value="sedi" data-testid="tab-sedi">Sedi invitate ({s.inviti.length})</TabsTrigger>
          <TabsTrigger value="documenti" data-testid="tab-documenti">Questionario e attestato</TabsTrigger>
        </TabsList>
        <TabsContent value="iscritti" className="mt-4">
          <Iscritti s={s} id={id} presenti={presenti} onSalva={salva} onErrore={errore} />
        </TabsContent>
        <TabsContent value="sedi" className="mt-4">
          <Sedi s={s} id={id} onSalva={salva} onErrore={errore} />
        </TabsContent>
        <TabsContent value="documenti" className="mt-4 grid gap-4 lg:grid-cols-2">
          <Questionario s={s} id={id} onSalva={salva} onErrore={errore} />
          <Attestato s={s} id={id} onSalva={salva} onErrore={errore} />
        </TabsContent>
      </Tabs>

      <Dialog open={modifica} onOpenChange={setModifica}>
        <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>Modifica evento</DialogTitle></DialogHeader>
          <FormEvento iniziale={e} etichetta="Salva modifiche" invio={aggiorna.isPending} errore={err} onAnnulla={() => setModifica(false)}
            onSubmit={(d) => { setErr(null); aggiorna.mutate({ id, data: d }, { onSuccess: (r) => { salva(r); setModifica(false); toast({ title: "Evento aggiornato" }); }, onError: (x) => setErr(parseApiError(x).message) }); }} />
        </DialogContent>
      </Dialog>

      <ConfermaElimina aperto={eliminaOk} titolo={`Eliminare l'evento "${e.titolo}"?`}
        testo="Verranno eliminati inviti, iscritti e questionario. Non si può eliminare un evento con entrate o uscite già registrate."
        onAnnulla={() => setEliminaOk(false)}
        onConferma={() => { setEliminaOk(false); elimina.mutate({ id }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListEventiBackofficeQueryKey() }); toast({ title: "Evento eliminato" }); nav("/admin/eventi"); }, onError: errore }); }} />
    </div>
  );
}

type Comune = { s: EventoBackoffice; id: number; onSalva: (d: EventoBackoffice) => void; onErrore: (e: unknown) => void };

function Iscritti({ s, id, presenti, onSalva }: Comune & { presenti: number }) {
  const { toast } = useToast();
  const orari = useUpdateOrariPartecipante();
  const [mod, setMod] = useState<PartecipanteEventoBackoffice | null>(null);
  const [entrata, setEntrata] = useState("");
  const [uscita, setUscita] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const apri = (p: PartecipanteEventoBackoffice) => { setMod(p); setEntrata(oraDaIstante(p.entrataIl)); setUscita(oraDaIstante(p.uscitaIl)); setErr(null); };
  const haLayout = attestatoPronto(s);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <p className="text-sm text-muted-foreground" data-testid="text-conteggio-presenti"><strong className="text-foreground">{presenti}</strong> presenti su {s.partecipanti.length} iscritti</p>
        {haLayout && presenti > 0 ? (
          <Button asChild variant="outline"><a href={urlAttestatiPresenti(id)} target="_blank" rel="noreferrer" data-testid="link-attestati-presenti"><Printer className="size-4 mr-2" /> Attestati di tutti i presenti</a></Button>
        ) : (
          <Button variant="outline" disabled title={haLayout ? "Nessun presente" : "Indica prima tipo di corso e argomento nell'evento"}><Printer className="size-4 mr-2" /> Attestati di tutti i presenti</Button>
        )}
      </div>
      {s.partecipanti.length === 0 ? (
        <EmptyState icon={<UserPlus className="size-6" />} title="Nessun iscritto" text="Le sedi inseriscono i partecipanti dopo aver confermato l'invito." />
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60 hover:bg-muted/60">
                {["Partecipante", "Sede", "Entrata", "Uscita", ""].map((h) => <TableHead key={h} className="text-[11px] uppercase tracking-wider font-semibold h-10">{h}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.partecipanti.map((p) => (
                <TableRow key={p.id} data-testid={`row-iscritto-${p.id}`}>
                  <TableCell className="font-semibold whitespace-nowrap">{p.cognome} {p.nome}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{p.sedeNome} <span className="font-mono text-xs text-muted-foreground">· {p.numeroSportello}</span></TableCell>
                  <TableCell className="tabular-nums text-sm whitespace-nowrap">{p.entrataIl ? fmtIstante(p.entrataIl) : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="tabular-nums text-sm whitespace-nowrap">{p.uscitaIl ? fmtIstante(p.uscitaIl) : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => apri(p)} data-testid={`button-orari-${p.id}`}><Pencil className="size-3.5 mr-1.5" /> Orari</Button>
                    {haLayout && <Button asChild size="sm" variant="ghost"><a href={urlAttestatoPartecipante(id, p.id)} target="_blank" rel="noreferrer" data-testid={`link-attestato-${p.id}`}><Award className="size-3.5 mr-1.5" /> Attestato</a></Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!mod} onOpenChange={(o) => { if (!o) setMod(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Orari di {mod?.cognome} {mod?.nome}</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">Gli orari valgono per il giorno dell'evento ({fmtData(s.evento.data)}). Lascia vuoto per cancellare.</p>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="o-entrata">Entrata</Label><Input id="o-entrata" type="time" value={entrata} onChange={(e) => setEntrata(e.target.value)} data-testid="input-orario-entrata" /></div>
            <div><Label htmlFor="o-uscita">Uscita</Label><Input id="o-uscita" type="time" value={uscita} onChange={(e) => setUscita(e.target.value)} data-testid="input-orario-uscita" /></div>
          </div>
          <FieldError>{err}</FieldError>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setMod(null)}>Annulla</Button>
            <Button disabled={orari.isPending} data-testid="button-salva-orari"
              onClick={() => mod && orari.mutate({ id, partecipanteId: mod.id, data: { entrata: entrata || null, uscita: uscita || null } }, {
                onSuccess: (r) => { onSalva(r); setMod(null); toast({ title: "Orari aggiornati" }); },
                onError: (e) => setErr(parseApiError(e).message),
              })}>
              {orari.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}Salva
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Sedi({ s, id, onSalva, onErrore }: Comune) {
  const { toast } = useToast();
  const aggiungi = useAddInvitiEvento();
  const rimuovi = useRemoveInvitoEvento();
  const [apri, setApri] = useState(false);
  const [sel, setSel] = useState<number[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [daTogliere, setDaTogliere] = useState<EventoBackoffice["inviti"][number] | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => { setSel([]); setErr(null); setApri(true); }} data-testid="button-invita-sedi"><UserPlus className="size-4 mr-2" /> Invita altre sedi</Button>
      </div>
      {s.inviti.length === 0 ? (
        <EmptyState icon={<UserPlus className="size-6" />} title="Nessuna sede invitata" />
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60 hover:bg-muted/60">
                {["Sede", "Sportello", "Invitata il", "Partecipazione", "Iscritti", ""].map((h) => <TableHead key={h} className="text-[11px] uppercase tracking-wider font-semibold h-10">{h}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.inviti.map((i) => (
                <TableRow key={i.collaboratoreId} data-testid={`row-invito-${i.collaboratoreId}`}>
                  <TableCell className="font-semibold whitespace-nowrap">{i.nome}{!i.attivo && <Badge variant="outline" className="ml-2">Disattivata</Badge>}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap"><span className="font-mono">{i.numeroSportello}</span> · {tipologiaLabel(i.tipologia)}</TableCell>
                  <TableCell className="tabular-nums text-sm whitespace-nowrap">{fmtIstante(i.invitatoIl)}</TableCell>
                  <TableCell>{i.confermatoIl ? <Badge className="bg-primary text-primary-foreground">Confermata {fmtIstante(i.confermatoIl)}</Badge> : <Badge variant="outline">In attesa</Badge>}</TableCell>
                  <TableCell className="tabular-nums">{i.partecipanti}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" disabled={i.partecipanti > 0} title={i.partecipanti > 0 ? "La sede ha già inserito dei partecipanti" : "Togli l'invito"} onClick={() => setDaTogliere(i)} data-testid={`button-togli-invito-${i.collaboratoreId}`}><Trash2 className="size-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={apri} onOpenChange={setApri}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Invita altre sedi</DialogTitle></DialogHeader>
          <SelettoreSedi selezionate={sel} onChange={setSel} escludi={s.inviti.map((i) => i.collaboratoreId)} />
          <FieldError>{err}</FieldError>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setApri(false)}>Annulla</Button>
            <Button disabled={sel.length === 0 || aggiungi.isPending} data-testid="button-conferma-inviti"
              onClick={() => aggiungi.mutate({ id, data: { collaboratoriIds: sel } }, {
                onSuccess: (r) => { onSalva(r); setApri(false); toast({ title: "Inviti inviati", description: `${sel.length} ${sel.length === 1 ? "sede invitata" : "sedi invitate"}.` }); },
                onError: (e) => setErr(parseApiError(e).message),
              })}>
              {aggiungi.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}Invita
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfermaElimina aperto={!!daTogliere} azione="Togli invito" titolo={`Togliere l'invito a ${daTogliere?.nome ?? ""}?`} testo="La sede non vedrà più l'evento. Si può togliere solo a sedi senza partecipanti."
        onAnnulla={() => setDaTogliere(null)}
        onConferma={() => { const i = daTogliere!; setDaTogliere(null); rimuovi.mutate({ id, collaboratoreId: i.collaboratoreId }, { onSuccess: (r) => { onSalva(r); toast({ title: "Invito tolto" }); }, onError: onErrore }); }} />
    </div>
  );
}

function Questionario({ s, id, onSalva, onErrore }: Comune) {
  const { toast } = useToast();
  const elimina = useDeleteQuestionarioEvento();
  const [occupato, setOccupato] = useState(false);
  const [conferma, setConferma] = useState(false);
  const [modifica, setModifica] = useState(false);
  const f = s.questionario;
  const creato = s.domande.length > 0;
  const carica = async (file: File) => {
    setOccupato(true);
    try {
      onSalva(await inviaFile<EventoBackoffice>("PUT", `/backoffice/eventi/${id}/questionario/file`, {}, file));
      toast({ title: f ? "Questionario sostituito" : "Questionario caricato" });
    } catch (e) { toast({ variant: "destructive", title: "Caricamento non riuscito", description: messaggioErrore(e) }); } finally { setOccupato(false); }
  };
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="font-bold text-lg flex items-center gap-2"><FileText className="size-5" /> Questionario</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-4">Crealo qui con le tue domande oppure carica un file già pronto. Le sedi invitate lo scaricano e lo stampano per i partecipanti.</p>
      {f ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-secondary/50 p-3 mb-3" data-testid="card-questionario">
          <div className="min-w-0 flex-1">
            <div className="font-medium truncate">{f.nome}</div>
            <div className="text-xs text-muted-foreground">{creato ? `${s.domande.length} ${s.domande.length === 1 ? "domanda" : "domande"} · ` : ""}{formatoDimensione(f.dimensione)} · {creato ? "creato" : "caricato"} il {fmtIstante(f.caricatoIl)}</div>
          </div>
          <Button asChild size="sm" variant="outline"><a href={urlQuestionarioBackoffice(id)} data-testid="link-scarica-questionario"><Download className="size-3.5 mr-1.5" /> Scarica</a></Button>
          <Button size="sm" variant="ghost" onClick={() => setConferma(true)} data-testid="button-elimina-questionario"><Trash2 className="size-3.5" /></Button>
        </div>
      ) : <p className="text-sm mb-3">Nessun questionario caricato.</p>}
      {modifica ? (
        <QuestionarioEditor id={id} iniziali={s.domande} onSalva={onSalva} onErrore={onErrore} onChiudi={() => setModifica(false)} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setModifica(true)} data-testid="button-crea-questionario"><Pencil className="size-4 mr-2" />{creato ? "Modifica le domande" : "Crea il questionario"}</Button>
          <SelettoreFile onFile={carica} disabled={occupato} testId="button-carica-questionario">
            {occupato ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Upload className="size-4 mr-2" />}{f ? "Sostituisci con un file" : "Carica un file"}
          </SelettoreFile>
        </div>
      )}
      {!modifica && f && <p className="text-xs text-muted-foreground mt-2">Caricare un file toglie le domande create qui.</p>}
      <ConfermaElimina aperto={conferma} titolo="Eliminare il questionario?" testo="Le sedi non potranno più scaricarlo." onAnnulla={() => setConferma(false)}
        onConferma={() => { setConferma(false); elimina.mutate({ id }, { onSuccess: (r) => { onSalva(r); toast({ title: "Questionario eliminato" }); }, onError: onErrore }); }} />
    </section>
  );
}

const tipoCorsoLabel = (t: string | null) => (t === "CAF" ? "CAF" : t === "PATRONATO" ? "Patronato" : "—");

function Attestato({ s }: Comune) {
  const e = s.evento;
  const pronto = attestatoPronto(s);
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="font-bold text-lg flex items-center gap-2"><Award className="size-5" /> Attestato</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-4">Il modello Tutelaziende è fisso: su ogni copia cambiano solo questi dati, presi dall&apos;evento.</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm rounded-md bg-secondary/50 p-3 mb-4" data-testid="dati-attestato">
        <dt className="text-muted-foreground">Nome e cognome</dt><dd>Quello di ogni partecipante</dd>
        <dt className="text-muted-foreground">Tipo di corso</dt><dd className="font-medium">{tipoCorsoLabel(e.tipoCorso)}</dd>
        <dt className="text-muted-foreground">Argomento</dt><dd className="font-medium">{e.argomento || "—"}</dd>
        <dt className="text-muted-foreground">Data del corso</dt><dd className="font-medium">{fmtData(e.data)}</dd>
      </dl>
      {pronto ? (
        <iframe title="Anteprima attestato" className="w-full h-[360px] rounded-md border border-border bg-white"
          src={`${urlAnteprimaAttestato(s.evento.id, `${e.tipoCorso}|${e.argomento}|${e.data}`)}#toolbar=0&navpanes=0`} data-testid="iframe-anteprima-attestato" />
      ) : (
        <p className="text-sm text-destructive" data-testid="attestato-incompleto">Per stampare gli attestati modifica l&apos;evento e indica il tipo di corso e l&apos;argomento.</p>
      )}
    </section>
  );
}

/** Gli attestati si possono stampare solo se l'evento ha tipo di corso e argomento. */
const attestatoPronto = (s: EventoBackoffice) => !!s.evento.tipoCorso && !!s.evento.argomento?.trim();
