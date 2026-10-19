import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListMandatiQueryKey, getListProvinceQueryKey, useCollegaMandatoProvincia, useDeleteMandato, useListMandati, useListProvince, useListTipiPratica,
  type Mandato,
} from "@workspace/api-client-react";
import { Check, ChevronsUpDown, Download, Link2, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorState, FieldError, PageHeader } from "@/components/common";
import { ConfermaElimina } from "@/components/pratiche/conferma-elimina";
import { SelettoreFile } from "@/components/pratiche/selettore-file";
import { useToast } from "@/hooks/use-toast";
import { fmtIstante, parseApiError } from "@/lib/format";
import { formatoDimensione, inviaFile, messaggioErrore, urlMandato } from "@/lib/upload";

const TUTTI = "tutti";

/** Menu con ricerca per scegliere la provincia. */
function SelettoreProvincia({ valore, onChange, province, testId }: {
  valore: string; onChange: (sigla: string) => void; province: { sigla: string; nome: string; sedi: number }[]; testId: string;
}) {
  const [aperto, setAperto] = useState(false);
  const scelta = province.find((p) => p.sigla === valore);
  return (
    <Popover open={aperto} onOpenChange={setAperto}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={aperto} data-testid={testId} className="w-72 justify-between font-normal">
          <span className="truncate">{scelta ? `${scelta.nome} (${scelta.sigla})` : "Scegli la provincia"}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-80" align="start">
        <Command>
          <CommandInput autoComplete="off" placeholder="Cerca provincia" data-testid={`${testId}-cerca`} />
          <CommandList>
            <CommandEmpty>Nessuna provincia trovata</CommandEmpty>
            <CommandGroup>
              {province.map((p) => (
                <CommandItem key={p.sigla} value={`${p.nome} ${p.sigla}`} onSelect={() => { setAperto(false); onChange(p.sigla); }} data-testid={`opzione-provincia-${p.sigla}`}>
                  <Check className={`size-4 mr-2 ${valore === p.sigla ? "opacity-100" : "opacity-0"}`} />
                  <span className="flex-1">{p.nome} ({p.sigla})</span>
                  {p.sedi > 0 && <span className="text-xs text-muted-foreground">{p.sedi} {p.sedi === 1 ? "sede" : "sedi"}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function useRicarica() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: getListMandatiQueryKey() }), qc.invalidateQueries({ queryKey: getListProvinceQueryKey() })]);
}

/** Un mandato per provincia e per tipo di pratica ("Tutti i tipi" vale quando non c'è un mandato specifico). */
function MandatiProvincia({ provincia, mandati, tipi }: { provincia: string; mandati: Mandato[]; tipi: { id: number | null; nome: string }[] }) {
  const { toast } = useToast();
  const ricarica = useRicarica();
  const elimina = useDeleteMandato();
  const [occupato, setOccupato] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [daEliminare, setDaEliminare] = useState<Mandato | null>(null);

  const carica = async (tipoId: number | null, esistente: Mandato | undefined, f: File) => {
    setErr(null);
    setOccupato(String(tipoId ?? TUTTI));
    try {
      if (esistente) await inviaFile<Mandato>("PUT", `/mandati/${esistente.id}/file`, {}, f);
      else await inviaFile<Mandato>("POST", "/mandati/file", { provincia, ...(tipoId !== null ? { tipoPraticaId: tipoId } : {}) }, f);
      await ricarica();
      toast({ title: esistente ? "Mandato sostituito" : "Mandato caricato" });
    } catch (e) { setErr(messaggioErrore(e)); } finally { setOccupato(null); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Tipo di pratica</TableHead><TableHead>Mandato caricato</TableHead><TableHead className="text-right">Azioni</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {tipi.map((t) => {
              const m = mandati.find((x) => x.provincia === provincia && x.tipoPraticaId === t.id);
              const chiave = String(t.id ?? TUTTI);
              return (
                <TableRow key={chiave} data-testid={`riga-mandato-tipo-${chiave}`}>
                  <TableCell className="font-semibold">{t.nome}</TableCell>
                  <TableCell>
                    {m ? (
                      <>
                        <div className="text-sm" data-testid={`file-mandato-${m.id}`}>{m.fileNome}</div>
                        <div className="text-xs text-muted-foreground">{formatoDimensione(m.dimensione)} · caricato il {fmtIstante(m.caricatoIl)}{m.caricatoDa ? ` da ${m.caricatoDa}` : ""}</div>
                      </>
                    ) : <span className="text-sm text-muted-foreground">{t.id === null ? "Nessun mandato" : "Usa il mandato valido per tutti i tipi, se presente"}</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {m && <Button asChild size="sm" variant="outline"><a href={urlMandato(m.id)} download data-testid={`link-scarica-mandato-${m.id}`}><Download className="size-4 mr-1.5" /> Scarica</a></Button>}
                      <SelettoreFile onFile={(f) => carica(t.id, m, f)} disabled={occupato !== null} testId={`button-carica-mandato-${chiave}`}>
                        {occupato === chiave ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : m ? <RefreshCw className="size-4 mr-1.5" /> : <Upload className="size-4 mr-1.5" />}
                        {m ? "Sostituisci file" : "Carica file"}
                      </SelettoreFile>
                      {m && <Button size="icon" variant="ghost" className="size-8 text-destructive" aria-label={`Elimina il mandato ${t.nome}`} onClick={() => setDaEliminare(m)} data-testid={`button-elimina-mandato-${m.id}`}><Trash2 className="size-4" /></Button>}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <FieldError id="errore-mandati">{err ?? undefined}</FieldError>
      <ConfermaElimina aperto={!!daEliminare} titolo="Eliminare il mandato?" testo={"Il modello viene eliminato: le sedi della provincia useranno il mandato valido per tutti i tipi di pratica, se esiste. Le pratiche già inviate conservano il mandato che avevano."}
        onAnnulla={() => setDaEliminare(null)}
        onConferma={() => {
          const m = daEliminare!; setDaEliminare(null); setErr(null);
          elimina.mutate({ id: m.id }, { onSuccess: () => { ricarica(); toast({ title: "Mandato eliminato" }); }, onError: (e) => setErr(parseApiError(e).message) });
        }} />
    </div>
  );
}

/** Mandati caricati prima dell'introduzione delle province: vanno collegati a una provincia e a un tipo di pratica. */
function MandatiPrecedenti({ mandati, province, tipi }: { mandati: Mandato[]; province: { sigla: string; nome: string; sedi: number }[]; tipi: { id: number | null; nome: string }[] }) {
  const { toast } = useToast();
  const ricarica = useRicarica();
  const collega = useCollegaMandatoProvincia();
  const elimina = useDeleteMandato();
  const [scelte, setScelte] = useState<Record<number, { provincia: string; tipo: string }>>({});
  const [err, setErr] = useState<string | null>(null);
  const [daEliminare, setDaEliminare] = useState<Mandato | null>(null);
  if (!mandati.length) return null;
  return (
    <section className="space-y-3" data-testid="sezione-mandati-precedenti">
      <h2 className="text-lg font-bold">Mandati precedenti</h2>
      <p className="text-sm text-muted-foreground">
        Questi mandati erano assegnati ai collaboratori uno per uno. Finché non li colleghi a una provincia restano in uso come prima per le sedi senza provincia; dopo il collegamento valgono per tutte le sedi di quella provincia.
      </p>
      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Mandato</TableHead><TableHead>Provincia</TableHead><TableHead>Tipo di pratica</TableHead><TableHead className="text-right">Azioni</TableHead></TableRow></TableHeader>
          <TableBody>
            {mandati.map((m) => {
              const s = scelte[m.id] ?? { provincia: "", tipo: TUTTI };
              const imposta = (p: Partial<typeof s>) => setScelte((x) => ({ ...x, [m.id]: { ...s, ...p } }));
              return (
                <TableRow key={m.id} data-testid={`riga-mandato-precedente-${m.id}`}>
                  <TableCell>
                    <div className="font-semibold">{m.nome}</div>
                    <div className="text-xs text-muted-foreground">{m.fileNome} · {m.collaboratoriAssegnati} {m.collaboratoriAssegnati === 1 ? "collaboratore" : "collaboratori"}</div>
                  </TableCell>
                  <TableCell><SelettoreProvincia valore={s.provincia} onChange={(sigla) => imposta({ provincia: sigla })} province={province} testId={`select-provincia-mandato-${m.id}`} /></TableCell>
                  <TableCell>
                    <Select value={s.tipo} onValueChange={(v) => imposta({ tipo: v })}>
                      <SelectTrigger className="w-52" data-testid={`select-tipo-mandato-${m.id}`}><SelectValue /></SelectTrigger>
                      <SelectContent>{tipi.map((t) => <SelectItem key={t.id ?? TUTTI} value={String(t.id ?? TUTTI)}>{t.nome}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button asChild size="sm" variant="outline"><a href={urlMandato(m.id)} download><Download className="size-4 mr-1.5" /> Scarica</a></Button>
                      <Button size="sm" disabled={!s.provincia || collega.isPending} data-testid={`button-collega-mandato-${m.id}`}
                        onClick={() => {
                          setErr(null);
                          collega.mutate({ id: m.id, data: { provincia: s.provincia, tipoPraticaId: s.tipo === TUTTI ? null : Number(s.tipo) } }, {
                            onSuccess: () => { ricarica(); toast({ title: "Mandato collegato alla provincia" }); },
                            onError: (e) => setErr(parseApiError(e).message),
                          });
                        }}><Link2 className="size-4 mr-1.5" /> Collega</Button>
                      <Button size="icon" variant="ghost" className="size-8 text-destructive" aria-label={`Elimina ${m.nome}`} onClick={() => setDaEliminare(m)}><Trash2 className="size-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <FieldError id="errore-precedenti">{err ?? undefined}</FieldError>
      <ConfermaElimina aperto={!!daEliminare} titolo={`Eliminare il mandato "${daEliminare?.nome ?? ""}"?`} testo="Il mandato e il suo file saranno eliminati. Si può fare solo se nessun collaboratore lo usa e nessuna pratica inviata lo ha usato."
        onAnnulla={() => setDaEliminare(null)}
        onConferma={() => {
          const m = daEliminare!; setDaEliminare(null); setErr(null);
          elimina.mutate({ id: m.id }, { onSuccess: () => { ricarica(); toast({ title: "Mandato eliminato" }); }, onError: (e) => setErr(parseApiError(e).message) });
        }} />
    </section>
  );
}

export default function MandatiPage() {
  const mandatiQ = useListMandati();
  const provinceQ = useListProvince();
  const tipiQ = useListTipiPratica();
  const [provincia, setProvincia] = useState("");

  const tipi = useMemo(
    () => [{ id: null as number | null, nome: "Tutti i tipi di pratica" }, ...(tipiQ.data ?? []).filter((t) => t.attivo).map((t) => ({ id: t.id as number | null, nome: t.nome }))],
    [tipiQ.data],
  );
  const mandati = mandatiQ.data ?? [];
  const precedenti = mandati.filter((m) => m.provincia === null);
  const province = provinceQ.data ?? [];
  const conMandato = useMemo(() => new Set(mandati.filter((m) => m.provincia).map((m) => m.provincia)).size, [mandati]);
  const sedeProv = province.find((p) => p.sigla === provincia);

  return (
    <div>
      <PageHeader kicker="Configurazione" title="Mandati"
        subtitle="Il mandato è un modello Word per provincia e per tipo di pratica. Ogni collaboratore riceve in automatico quello della provincia della sua sede." />
      {mandatiQ.isLoading || provinceQ.isLoading || tipiQ.isLoading ? <Skeleton className="h-48 w-full" />
        : mandatiQ.isError || provinceQ.isError || tipiQ.isError ? <ErrorState message="Impossibile caricare i mandati." onRetry={() => { mandatiQ.refetch(); provinceQ.refetch(); tipiQ.refetch(); }} />
        : (
          <div className="space-y-8">
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm space-y-1" data-testid="campi-mandato">
              <div className="font-semibold">Campi da inserire nel modello</div>
              <p className="text-muted-foreground">Scrivi nel documento Word questi campi: il sistema li sostituisce con i dati dell'assistito quando il collaboratore scarica o firma il mandato.</p>
              <p className="font-mono text-xs break-words">
                @cliente.cognome @cliente.nome @cliente.nascita @cliente.sesso @cliente.luogoNascita @cliente.cf @cliente.tel @cliente.cell @cliente.email @cliente.indirizzo @cliente.civico @cliente.cap @cliente.citta @cliente.provincia @cliente.nazione @richiesta.tipo @polizza.tipo
              </p>
              <p className="text-muted-foreground">Un mandato specifico per un tipo di pratica ha la precedenza su quello valido per tutti i tipi. Caricando un file dove esiste già un mandato, il file viene sostituito.</p>
            </div>

            <section className="space-y-3">
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <Label className="mb-1.5 block">Provincia</Label>
                  <SelettoreProvincia valore={provincia} onChange={setProvincia} province={province} testId="select-provincia" />
                </div>
                <div className="text-sm text-muted-foreground pb-2" data-testid="text-riepilogo-mandati">
                  {sedeProv ? `${sedeProv.sedi} ${sedeProv.sedi === 1 ? "sede attiva" : "sedi attive"} in questa provincia` : `${conMandato} ${conMandato === 1 ? "provincia con mandati" : "province con mandati"}`}
                </div>
                {sedeProv && sedeProv.sedi > 0 && !mandati.some((m) => m.provincia === provincia) && <Badge variant="outline" className="mb-2 text-destructive border-destructive/40">Nessun mandato per questa provincia</Badge>}
              </div>
              {provincia ? <MandatiProvincia provincia={provincia} mandati={mandati} tipi={tipi} />
                : <p className="text-sm text-muted-foreground" data-testid="scegli-provincia">Scegli una provincia per caricare o sostituire i suoi mandati.</p>}
            </section>

            <MandatiPrecedenti mandati={precedenti} province={province} tipi={tipi} />
          </div>
        )}
    </div>
  );
}
