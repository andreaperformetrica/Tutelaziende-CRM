import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListAssegnazioniMandatoQueryKey, getListMandatiQueryKey, useAssegnaMandato, useDeleteMandato, useListAssegnazioniMandato, useListCollaboratori,
  useListMandati, useRimuoviAssegnazioneMandato, useRinominaMandato, type Mandato,
} from "@workspace/api-client-react";
import { Check, Download, FileSignature, Loader2, Pencil, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, FieldError, PageHeader } from "@/components/common";
import { ConfermaElimina } from "@/components/pratiche/conferma-elimina";
import { SelettoreFile } from "@/components/pratiche/selettore-file";
import { useToast } from "@/hooks/use-toast";
import { fmtIstante, parseApiError } from "@/lib/format";
import { formatoDimensione, inviaFile, messaggioErrore, urlMandato } from "@/lib/upload";

const NESSUNO = "nessuno";

function useRicarica() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: getListMandatiQueryKey() }), qc.invalidateQueries({ queryKey: getListAssegnazioniMandatoQueryKey() })]);
}

function Raccolta({ mandati }: { mandati: Mandato[] }) {
  const { toast } = useToast();
  const ricarica = useRicarica();
  const rinomina = useRinominaMandato();
  const elimina = useDeleteMandato();
  const [nome, setNome] = useState("");
  const [occupato, setOccupato] = useState<number | "nuovo" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [modId, setModId] = useState<number | null>(null);
  const [modNome, setModNome] = useState("");
  const [daEliminare, setDaEliminare] = useState<Mandato | null>(null);
  const onError = (e: unknown) => setErr(parseApiError(e).message);

  const carica = async (f: File) => {
    setErr(null);
    setOccupato("nuovo");
    try {
      await inviaFile<Mandato>("POST", "/mandati/file", { nome: nome.trim() || f.name.replace(/\.[^.]+$/, "") }, f);
      await ricarica();
      setNome("");
      toast({ title: "Mandato aggiunto alla raccolta" });
    } catch (e) { setErr(messaggioErrore(e)); } finally { setOccupato(null); }
  };
  const sostituisci = async (m: Mandato, f: File) => {
    setErr(null);
    setOccupato(m.id);
    try {
      await inviaFile<Mandato>("PUT", `/mandati/${m.id}/file`, {}, f);
      await ricarica();
      toast({ title: "File del mandato sostituito" });
    } catch (e) { setErr(messaggioErrore(e)); } finally { setOccupato(null); }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Carica qui il modello Word di ogni sede, con un nome riconoscibile (per esempio "Mandato Napoli"). Poi assegni a ogni collaboratore il mandato della sua sede nell'altra scheda.
        Sostituendo il file di un mandato, il cambio vale per tutti i collaboratori che lo usano.
      </p>
      <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm space-y-1" data-testid="campi-mandato">
        <div className="font-semibold">Campi da inserire nel modello</div>
        <p className="text-muted-foreground">
          Scrivi nel documento Word questi campi e il sistema li sostituirà con i dati dell'assistito quando il collaboratore scarica il mandato in PDF dalla pratica.
        </p>
        <p className="font-mono text-xs break-words">
          @cliente.cognome @cliente.nome @cliente.nascita @cliente.sesso @cliente.luogoNascita @cliente.cf @cliente.tel @cliente.cell @cliente.email @cliente.indirizzo @cliente.civico @cliente.cap @cliente.citta @cliente.provincia @cliente.nazione @richiesta.tipo @polizza.tipo
        </p>
        <p className="text-muted-foreground">
          I campi @cliente.cap e @cliente.provincia, e @polizza.tipo, restano vuoti perché questi dati non sono registrati. @richiesta.tipo riporta il tipo di pratica.
        </p>
      </div>
      {!mandati.length ? <p className="text-sm text-muted-foreground" data-testid="nessun-mandato">Nessun mandato caricato.</p> : (
        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Nome</TableHead><TableHead>File</TableHead><TableHead className="text-right">Collaboratori</TableHead><TableHead className="text-right">Azioni</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {mandati.map((m) => (
                <TableRow key={m.id} data-testid={`riga-mandato-${m.id}`}>
                  <TableCell className="font-semibold">
                    {modId === m.id ? (
                      <div className="flex items-center gap-1">
                        <Input className="h-8 w-56" value={modNome} maxLength={100} autoFocus onChange={(e) => setModNome(e.target.value)} data-testid={`input-nome-mandato-${m.id}`} />
                        <Button size="icon" variant="ghost" className="size-8" aria-label="Conferma" data-testid={`button-conferma-nome-mandato-${m.id}`}
                          onClick={() => { if (!modNome.trim()) return setErr("Inserisci il nome del mandato"); setErr(null); rinomina.mutate({ id: m.id, data: { nome: modNome.trim() } }, { onSuccess: () => { ricarica(); setModId(null); }, onError }); }}><Check className="size-4" /></Button>
                        <Button size="icon" variant="ghost" className="size-8" aria-label="Annulla" onClick={() => setModId(null)}><X className="size-4" /></Button>
                      </div>
                    ) : <span data-testid={`nome-mandato-${m.id}`}>{m.nome}</span>}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm" data-testid={`file-mandato-${m.id}`}>{m.fileNome}</div>
                    <div className="text-xs text-muted-foreground">{formatoDimensione(m.dimensione)} · caricato il {fmtIstante(m.caricatoIl)}{m.caricatoDa ? ` da ${m.caricatoDa}` : ""}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums" data-testid={`conteggio-mandato-${m.id}`}>{m.collaboratoriAssegnati}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button asChild size="sm" variant="outline"><a href={urlMandato(m.id)} download data-testid={`link-scarica-mandato-${m.id}`}><Download className="size-4 mr-1.5" /> Scarica</a></Button>
                      <SelettoreFile onFile={(f) => sostituisci(m, f)} disabled={occupato !== null} testId={`button-sostituisci-mandato-${m.id}`}>
                        {occupato === m.id ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <RefreshCw className="size-4 mr-1.5" />} Sostituisci file
                      </SelettoreFile>
                      <Button size="icon" variant="ghost" className="size-8" aria-label={`Rinomina ${m.nome}`} onClick={() => { setModId(m.id); setModNome(m.nome); setErr(null); }} data-testid={`button-rinomina-mandato-${m.id}`}><Pencil className="size-4" /></Button>
                      <Button size="icon" variant="ghost" className="size-8 text-destructive" aria-label={`Elimina ${m.nome}`} onClick={() => setDaEliminare(m)} data-testid={`button-elimina-mandato-${m.id}`}><Trash2 className="size-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 max-w-sm">
          <Label htmlFor="nuovo-mandato">Nome del nuovo mandato</Label>
          <Input id="nuovo-mandato" value={nome} maxLength={100} onChange={(e) => setNome(e.target.value)} placeholder="Es. Mandato Roma" data-testid="input-nuovo-mandato" />
        </div>
        <SelettoreFile onFile={carica} disabled={occupato !== null} testId="button-carica-mandato" variant="default" size="default">
          {occupato === "nuovo" ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Upload className="size-4 mr-2" />} Scegli file e carica
        </SelettoreFile>
      </div>
      <FieldError id="errore-raccolta">{err ?? undefined}</FieldError>
      <ConfermaElimina aperto={!!daEliminare} titolo={`Eliminare il mandato "${daEliminare?.nome ?? ""}"?`} testo="Il mandato e il suo file saranno eliminati. Si può eliminare solo un mandato che non è assegnato a nessun collaboratore."
        onAnnulla={() => setDaEliminare(null)}
        onConferma={() => { const m = daEliminare!; setDaEliminare(null); setErr(null); elimina.mutate({ id: m.id }, { onSuccess: () => { ricarica(); toast({ title: "Mandato eliminato" }); }, onError }); }} />
    </div>
  );
}

function Assegnazioni({ mandati }: { mandati: Mandato[] }) {
  const { toast } = useToast();
  const ricarica = useRicarica();
  const collQ = useListCollaboratori({ stato: "attivi" });
  const assQ = useListAssegnazioniMandato();
  const assegna = useAssegnaMandato();
  const rimuovi = useRimuoviAssegnazioneMandato();
  const [cerca, setCerca] = useState("");
  const [occupato, setOccupato] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const perColl = useMemo(() => new Map((assQ.data ?? []).map((a) => [a.collaboratoreId, a.mandatoId])), [assQ.data]);
  const collaboratori = useMemo(() => {
    const t = cerca.trim().toLowerCase();
    return (collQ.data ?? [])
      .filter((c) => !t || `${c.cognome} ${c.nome} ${c.numeroSportello}`.toLowerCase().includes(t))
      .sort((a, b) => a.cognome.localeCompare(b.cognome, "it") || a.nome.localeCompare(b.nome, "it"));
  }, [collQ.data, cerca]);
  const conMandato = collaboratori.filter((c) => perColl.has(c.id)).length;

  const scegli = (collaboratoreId: number, valore: string) => {
    setErr(null);
    setOccupato(collaboratoreId);
    const fine = { onSettled: () => setOccupato(null), onError: (e: unknown) => setErr(parseApiError(e).message) };
    if (valore === NESSUNO) rimuovi.mutate({ params: { collaboratoreId } }, { ...fine, onSuccess: () => { ricarica(); toast({ title: "Mandato tolto" }); } });
    else assegna.mutate({ data: { collaboratoreId, mandatoId: Number(valore) } }, { ...fine, onSuccess: () => { ricarica(); toast({ title: "Mandato assegnato" }); } });
  };

  if (collQ.isLoading || assQ.isLoading) return <Skeleton className="h-48 w-full" />;
  if (collQ.isError || assQ.isError) return <ErrorState message="Impossibile caricare le assegnazioni." onRetry={() => { collQ.refetch(); assQ.refetch(); }} />;
  if (!mandati.length) return <EmptyState icon={<FileSignature className="size-6" />} title="Nessun mandato nella raccolta" text="Carica prima almeno un mandato, nella scheda Raccolta mandati." />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="relative w-64">
          <Label htmlFor="cerca-coll">Cerca collaboratore</Label>
          <Search className="absolute left-2.5 bottom-2.5 size-4 text-muted-foreground" />
          <Input id="cerca-coll" className="pl-8" value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Nome o sportello" data-testid="input-cerca-collaboratore" />
        </div>
        <div className="text-sm text-muted-foreground pb-2" data-testid="text-riepilogo-mandati">{conMandato} di {collaboratori.length} collaboratori con mandato</div>
      </div>
      <FieldError id="errore-assegnazioni">{err ?? undefined}</FieldError>
      {!collaboratori.length ? <EmptyState icon={<Search className="size-6" />} title="Nessun collaboratore trovato" /> : (
        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Collaboratore</TableHead><TableHead>Sportello</TableHead><TableHead>Mandato assegnato</TableHead></TableRow></TableHeader>
            <TableBody>
              {collaboratori.map((c) => {
                const mId = perColl.get(c.id);
                return (
                  <TableRow key={c.id} data-testid={`riga-assegnazione-${c.id}`}>
                    <TableCell className="font-semibold">{c.cognome} {c.nome}</TableCell>
                    <TableCell className="tabular-nums">{c.numeroSportello}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Select value={mId ? String(mId) : NESSUNO} onValueChange={(v) => scegli(c.id, v)} disabled={occupato !== null}>
                          <SelectTrigger className="w-64" aria-label={`Mandato di ${c.cognome} ${c.nome}`} data-testid={`select-mandato-${c.id}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NESSUNO}>Nessun mandato</SelectItem>
                            {mandati.map((m) => <SelectItem key={m.id} value={String(m.id)} data-testid={`opzione-mandato-${m.id}`}>{m.nome}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {occupato === c.id ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : !mId && <Badge variant="outline" className="text-muted-foreground">Non assegnato</Badge>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export default function MandatiPage() {
  const mandatiQ = useListMandati();

  return (
    <div>
      <PageHeader kicker="Configurazione" title="Mandati"
        subtitle="Il mandato è un modello Word per sede. Si caricano i modelli, poi si assegna a ogni collaboratore quello da usare: vale per tutti i tipi di pratica e si scarica compilato dentro la pratica." />
      {mandatiQ.isLoading ? <Skeleton className="h-48 w-full" />
        : mandatiQ.isError ? <ErrorState message="Impossibile caricare i mandati." onRetry={() => mandatiQ.refetch()} />
        : (
          <Tabs defaultValue="raccolta">
            <TabsList>
              <TabsTrigger value="raccolta" data-testid="tab-raccolta">Raccolta mandati ({mandatiQ.data?.length ?? 0})</TabsTrigger>
              <TabsTrigger value="assegnazioni" data-testid="tab-assegnazioni">Assegnazione ai collaboratori</TabsTrigger>
            </TabsList>
            <TabsContent value="raccolta" className="mt-4"><Raccolta mandati={mandatiQ.data ?? []} /></TabsContent>
            <TabsContent value="assegnazioni" className="mt-4"><Assegnazioni mandati={mandatiQ.data ?? []} /></TabsContent>
          </Tabs>
        )}
    </div>
  );
}
