import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetTipoPraticaQueryKey, getListTipiPraticaQueryKey, useCreateDocumentoTipo, useDeleteDocumentoTipo, useDeleteModuloTipo, useGetTipoPratica,
  useOrdinaDocumentiTipo, useRenameModuloTipo, useUpdateDocumentoTipo, useUpdateTipoPratica, type TipoPratica,
} from "@workspace/api-client-react";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Download, FileSignature, Loader2, Pencil, Plus, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, FieldError, PageHeader } from "@/components/common";
import { CampiTipo, leggiTipo, type ValoriTipo } from "@/components/pratiche/campi-tipo";
import { AllegatiOperatoreTipo, CompensiCollaboratoreTipo, NormativeTipo } from "@/components/pratiche/sezioni-tipo";
import { SelettoreDocumento } from "@/components/pratiche/selettore-documento";
import { ConfermaElimina } from "@/components/pratiche/conferma-elimina";
import { SelettoreFile } from "@/components/pratiche/selettore-file";
import { useToast } from "@/hooks/use-toast";
import { fmtIstante, parseApiError } from "@/lib/format";
import { formatoDimensione, inviaFile, messaggioErrore, urlModulo } from "@/lib/upload";

function useAggiorna(id: number) {
  const qc = useQueryClient();
  return (t: TipoPratica) => {
    qc.setQueryData(getGetTipoPraticaQueryKey(id), t);
    qc.invalidateQueries({ queryKey: getListTipiPraticaQueryKey() });
  };
}

function DatiTipo({ tipo }: { tipo: TipoPratica }) {
  const { toast } = useToast();
  const aggiorna = useAggiorna(tipo.id);
  const update = useUpdateTipoPratica();
  const partenza = (t: TipoPratica): ValoriTipo => ({ nome: t.nome, attivo: t.attivo, pagabile: t.pagabile, punti: String(t.punti), valore: t.valoreEuro.toFixed(2).replace(".", ",") });
  const [v, setV] = useState<ValoriTipo>(partenza(tipo));
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [srv, setSrv] = useState<string | null>(null);
  useEffect(() => setV(partenza(tipo)), [tipo]);

  const salva = () => {
    const r = leggiTipo(v);
    setSrv(null);
    if ("errori" in r) return setErrs(r.errori);
    setErrs({});
    update.mutate({ id: tipo.id, data: r.dati }, {
      onSuccess: (t) => { aggiorna(t); toast({ title: "Tipo di pratica salvato" }); },
      onError: (e) => { const p = parseApiError(e); setSrv(p.message); if (p.campo) setErrs({ [p.campo]: p.message }); },
    });
  };
  return (
    <section className="rounded-lg border border-border bg-card p-5 space-y-4 rise" data-testid="sezione-dati">
      <h2 className="text-lg font-bold">Dati del tipo</h2>
      <CampiTipo v={v} onChange={setV} errs={errs} mostraAttivo />
      {srv && !Object.keys(errs).length && <p className="text-sm font-medium text-destructive" data-testid="errore-form">{srv}</p>}
      <Button onClick={salva} disabled={update.isPending} data-testid="button-salva-tipo">
        {update.isPending && <Loader2 className="size-4 mr-2 animate-spin" />} Salva modifiche
      </Button>
    </section>
  );
}

function DocumentiTipo({ tipo }: { tipo: TipoPratica }) {
  const { toast } = useToast();
  const aggiorna = useAggiorna(tipo.id);
  const create = useCreateDocumentoTipo();
  const update = useUpdateDocumentoTipo();
  const del = useDeleteDocumentoTipo();
  const ordina = useOrdinaDocumentiTipo();
  const [nome, setNome] = useState("");
  const [mandato, setMandato] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [modId, setModId] = useState<number | null>(null);
  const [modNome, setModNome] = useState("");
  const [daEliminare, setDaEliminare] = useState<number | null>(null);
  const onError = (e: unknown) => setErr(parseApiError(e).message);

  const aggiungi = () => {
    if (!nome.trim()) return setErr("Scegli il documento");
    setErr(null);
    create.mutate({ id: tipo.id, data: { nome: nome.trim(), mandato } }, {
      onSuccess: (t) => { aggiorna(t); setNome(""); setMandato(false); toast({ title: "Documento aggiunto" }); }, onError,
    });
  };
  const sposta = (i: number, d: -1 | 1) => {
    const ids = tipo.documenti.map((x) => x.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    setErr(null);
    ordina.mutate({ id: tipo.id, data: { ids } }, { onSuccess: aggiorna, onError });
  };
  const salvaNome = (id: number, mand: boolean) => {
    if (!modNome.trim()) return setErr("Inserisci il nome del documento");
    setErr(null);
    update.mutate({ id, data: { nome: modNome.trim(), mandato: mand } }, { onSuccess: (t) => { aggiorna(t); setModId(null); }, onError });
  };

  return (
    <section className="rounded-lg border border-border bg-card p-5 space-y-4 rise" data-testid="sezione-documenti">
      <div>
        <h2 className="text-lg font-bold">Documenti obbligatori</h2>
        <p className="text-sm text-muted-foreground">Scegli i documenti dall'elenco di quelli già noti; se manca, puoi crearlo dalla stessa tendina. Il documento segnato come mandato viene preso dal mandato assegnato al collaboratore (pagina Mandati).</p>
      </div>
      {!tipo.documenti.length ? <p className="text-sm text-muted-foreground" data-testid="nessun-documento">Nessun documento obbligatorio.</p> : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {tipo.documenti.map((d, i) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 p-2.5" data-testid={`riga-documento-${d.id}`}>
              <div className="flex">
                <Button size="icon" variant="ghost" className="size-8" disabled={i === 0 || ordina.isPending} onClick={() => sposta(i, -1)} aria-label={`Sposta in alto ${d.nome}`} data-testid={`button-su-doc-${d.id}`}><ArrowUp className="size-4" /></Button>
                <Button size="icon" variant="ghost" className="size-8" disabled={i === tipo.documenti.length - 1 || ordina.isPending} onClick={() => sposta(i, 1)} aria-label={`Sposta in basso ${d.nome}`} data-testid={`button-giu-doc-${d.id}`}><ArrowDown className="size-4" /></Button>
              </div>
              {modId === d.id ? (
                <>
                  <Input className="h-8 max-w-xs" value={modNome} onChange={(e) => setModNome(e.target.value)} maxLength={100} data-testid={`input-nome-doc-${d.id}`} autoFocus />
                  <Button size="icon" variant="ghost" className="size-8" onClick={() => salvaNome(d.id, d.mandato)} aria-label="Conferma" data-testid={`button-conferma-nome-doc-${d.id}`}><Check className="size-4" /></Button>
                  <Button size="icon" variant="ghost" className="size-8" onClick={() => setModId(null)} aria-label="Annulla"><X className="size-4" /></Button>
                </>
              ) : (
                <>
                  <span className="font-medium" data-testid={`nome-doc-${d.id}`}>{d.nome}</span>
                  {d.mandato && <Badge variant="outline" className="gap-1 border-primary/30 bg-primary/10 text-primary"><FileSignature className="size-3" /> Mandato</Badge>}
                </>
              )}
              <div className="ml-auto flex items-center gap-1">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground mr-2">
                  <Checkbox checked={d.mandato} disabled={update.isPending} onCheckedChange={(c) => update.mutate({ id: d.id, data: { nome: d.nome, mandato: c === true } }, { onSuccess: aggiorna, onError })} data-testid={`check-mandato-doc-${d.id}`} />
                  È il mandato
                </label>
                <Button size="icon" variant="ghost" className="size-8" onClick={() => { setModId(d.id); setModNome(d.nome); setErr(null); }} aria-label={`Rinomina ${d.nome}`} data-testid={`button-rinomina-doc-${d.id}`}><Pencil className="size-4" /></Button>
                <Button size="icon" variant="ghost" className="size-8 text-destructive" onClick={() => setDaEliminare(d.id)} aria-label={`Elimina ${d.nome}`} data-testid={`button-elimina-doc-${d.id}`}><Trash2 className="size-4" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <SelettoreDocumento id="nuovo-doc" etichetta="Aggiungi un documento" valore={nome} onChange={setNome} esclusi={tipo.documenti.map((d) => d.nome)} testId="documento" />
        <label className="flex items-center gap-2 text-sm pb-2"><Checkbox checked={mandato} onCheckedChange={(c) => setMandato(c === true)} data-testid="check-nuovo-mandato" /> È il mandato</label>
        <Button onClick={aggiungi} disabled={create.isPending} data-testid="button-aggiungi-documento"><Plus className="size-4 mr-2" /> Aggiungi</Button>
      </div>
      <FieldError id="errore-documenti">{err ?? undefined}</FieldError>
      <ConfermaElimina aperto={daEliminare !== null} titolo="Eliminare il documento?" testo="Il documento non sarà più richiesto per questo tipo di pratica."
        onAnnulla={() => setDaEliminare(null)}
        onConferma={() => { const id = daEliminare!; setDaEliminare(null); del.mutate({ id }, { onSuccess: (t) => { aggiorna(t); toast({ title: "Documento eliminato" }); }, onError }); }} />
    </section>
  );
}

function ModuliTipo({ tipo }: { tipo: TipoPratica }) {
  const { toast } = useToast();
  const aggiorna = useAggiorna(tipo.id);
  const rename = useRenameModuloTipo();
  const del = useDeleteModuloTipo();
  const [nome, setNome] = useState("");
  const [occupato, setOccupato] = useState<number | "nuovo" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [modId, setModId] = useState<number | null>(null);
  const [modNome, setModNome] = useState("");
  const [daEliminare, setDaEliminare] = useState<number | null>(null);
  const onError = (e: unknown) => setErr(parseApiError(e).message);

  const carica = async (f: File) => {
    setErr(null);
    setOccupato("nuovo");
    try {
      const t = await inviaFile<TipoPratica>("POST", `/tipi-pratica/${tipo.id}/moduli/file`, { nome: nome.trim() || f.name.replace(/\.[^.]+$/, "") }, f);
      aggiorna(t); setNome(""); toast({ title: "Modulo caricato" });
    } catch (e) { setErr(messaggioErrore(e)); } finally { setOccupato(null); }
  };
  const sostituisci = async (id: number, f: File) => {
    setErr(null);
    setOccupato(id);
    try {
      aggiorna(await inviaFile<TipoPratica>("PUT", `/moduli-tipo/${id}/file`, {}, f));
      toast({ title: "File del modulo sostituito" });
    } catch (e) { setErr(messaggioErrore(e)); } finally { setOccupato(null); }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-5 space-y-4 rise" data-testid="sezione-moduli">
      <div>
        <h2 className="text-lg font-bold">Moduli scaricabili</h2>
        <p className="text-sm text-muted-foreground">File che i collaboratori possono scaricare, compilare e allegare. Formati: PDF, Word, Excel, OpenDocument, RTF, TXT, PNG, JPG. Massimo 15 MB. Con «Compila in automatico» il modulo (Word con campi come @cliente.cognome, oppure PDF con campi modulo dello stesso nome) viene scaricato dal collaboratore già compilato con i dati dell'assistito, in PDF.</p>
      </div>
      {!tipo.moduli.length ? <p className="text-sm text-muted-foreground" data-testid="nessun-modulo">Nessun modulo caricato.</p> : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {tipo.moduli.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 p-2.5" data-testid={`riga-modulo-${m.id}`}>
              <div className="min-w-0 flex-1">
                {modId === m.id ? (
                  <div className="flex items-center gap-1">
                    <Input className="h-8 max-w-xs" value={modNome} onChange={(e) => setModNome(e.target.value)} maxLength={100} autoFocus data-testid={`input-nome-modulo-${m.id}`} />
                    <Button size="icon" variant="ghost" className="size-8" aria-label="Conferma" data-testid={`button-conferma-nome-modulo-${m.id}`}
                      onClick={() => { if (!modNome.trim()) return setErr("Inserisci il nome del modulo"); setErr(null); rename.mutate({ id: m.id, data: { nome: modNome.trim(), compilazioneAutomatica: m.compilazioneAutomatica } }, { onSuccess: (t) => { aggiorna(t); setModId(null); }, onError }); }}><Check className="size-4" /></Button>
                    <Button size="icon" variant="ghost" className="size-8" onClick={() => setModId(null)} aria-label="Annulla"><X className="size-4" /></Button>
                  </div>
                ) : <div className="font-medium" data-testid={`nome-modulo-${m.id}`}>{m.nome}</div>}
                <div className="text-xs text-muted-foreground truncate" data-testid={`file-modulo-${m.id}`}>{m.fileNome} · {formatoDimensione(m.dimensione)} · caricato il {fmtIstante(m.caricatoIl)}</div>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground mr-2" title="Il collaboratore scarica il modulo già compilato con i dati dell'assistito (file Word con campi @cliente.cognome, @cliente.nome... oppure PDF con campi modulo dello stesso nome)">
                  <Checkbox checked={m.compilazioneAutomatica} disabled={rename.isPending}
                    onCheckedChange={(c) => { setErr(null); rename.mutate({ id: m.id, data: { nome: m.nome, compilazioneAutomatica: c === true } }, { onSuccess: aggiorna, onError }); }}
                    data-testid={`check-compilazione-modulo-${m.id}`} />
                  Compila in automatico con i dati dell&apos;assistito
                </label>
                <Button asChild size="sm" variant="outline"><a href={urlModulo(m.id)} download data-testid={`link-scarica-modulo-${m.id}`}><Download className="size-4 mr-1.5" /> Scarica</a></Button>
                <SelettoreFile onFile={(f) => sostituisci(m.id, f)} disabled={occupato !== null} testId={`button-sostituisci-modulo-${m.id}`}>
                  {occupato === m.id ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <RefreshCw className="size-4 mr-1.5" />} Sostituisci file
                </SelettoreFile>
                <Button size="icon" variant="ghost" className="size-8" onClick={() => { setModId(m.id); setModNome(m.nome); setErr(null); }} aria-label={`Rinomina ${m.nome}`} data-testid={`button-rinomina-modulo-${m.id}`}><Pencil className="size-4" /></Button>
                <Button size="icon" variant="ghost" className="size-8 text-destructive" onClick={() => setDaEliminare(m.id)} aria-label={`Elimina ${m.nome}`} data-testid={`button-elimina-modulo-${m.id}`}><Trash2 className="size-4" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 max-w-sm">
          <Label htmlFor="nuovo-modulo">Nome del nuovo modulo (facoltativo)</Label>
          <Input id="nuovo-modulo" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} placeholder="Se vuoto, usa il nome del file" data-testid="input-nuovo-modulo" />
        </div>
        <SelettoreFile onFile={carica} disabled={occupato !== null} testId="button-carica-modulo" variant="default" size="default">
          {occupato === "nuovo" ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Upload className="size-4 mr-2" />} Scegli file e carica
        </SelettoreFile>
      </div>
      <FieldError id="errore-moduli">{err ?? undefined}</FieldError>
      <ConfermaElimina aperto={daEliminare !== null} titolo="Eliminare il modulo?" testo="Il modulo e il suo file saranno eliminati e i collaboratori non potranno più scaricarlo."
        onAnnulla={() => setDaEliminare(null)}
        onConferma={() => { const id = daEliminare!; setDaEliminare(null); del.mutate({ id }, { onSuccess: (t) => { aggiorna(t); toast({ title: "Modulo eliminato" }); }, onError }); }} />
    </section>
  );
}

export default function TipoPraticaDettaglioPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const q = useGetTipoPratica(id, { query: { enabled: Number.isInteger(id) && id > 0, queryKey: getGetTipoPraticaQueryKey(id) } });
  const tipo = q.data;
  return (
    <div className="space-y-5">
      <Link href="/admin/tipi-pratica" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-indietro"><ArrowLeft className="size-4" /> Tipi di pratica</Link>
      {q.isLoading ? <Skeleton className="h-64 w-full" />
        : q.isError || !tipo ? <ErrorState message={parseApiError(q.error).status === 404 ? "Tipo di pratica non trovato." : "Impossibile caricare il tipo di pratica."} onRetry={() => q.refetch()} />
        : (
          <>
            <PageHeader kicker="Tipo di pratica" title={tipo.nome} />
            <div className="grid gap-5 xl:grid-cols-[minmax(0,26rem)_1fr] items-start">
              <DatiTipo tipo={tipo} />
              <div className="space-y-5">
                <DocumentiTipo tipo={tipo} />
                <ModuliTipo tipo={tipo} />
                <AllegatiOperatoreTipo tipo={tipo} />
                <CompensiCollaboratoreTipo tipo={tipo} />
                <NormativeTipo tipo={tipo} />
              </div>
            </div>
          </>
        )}
    </div>
  );
}
