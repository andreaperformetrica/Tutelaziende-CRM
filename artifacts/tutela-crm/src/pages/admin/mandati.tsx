import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListMandatiQueryKey, useListCollaboratori, useListMandati, useListTipiPratica, type Mandato } from "@workspace/api-client-react";
import { Download, FileSignature, Loader2, RefreshCw, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, FieldError, PageHeader } from "@/components/common";
import { SelettoreFile } from "@/components/pratiche/selettore-file";
import { useToast } from "@/hooks/use-toast";
import { fmtIstante } from "@/lib/format";
import { formatoDimensione, inviaFile, messaggioErrore, urlMandato } from "@/lib/upload";

export default function MandatiPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const tipiQ = useListTipiPratica();
  const collQ = useListCollaboratori({ stato: "attivi" });
  const mandatiQ = useListMandati();
  const [tipoSel, setTipoSel] = useState<string>("");
  const [cerca, setCerca] = useState("");
  const [occupato, setOccupato] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const tipi = tipiQ.data ?? [];
  const tipoId = tipoSel ? Number(tipoSel) : tipi.find((t) => t.attivo)?.id ?? tipi[0]?.id;
  const tipo = tipi.find((t) => t.id === tipoId);
  const mandati = useMemo(() => {
    const m = new Map<number, Mandato>();
    for (const x of mandatiQ.data ?? []) if (x.tipoPraticaId === tipoId) m.set(x.collaboratoreId, x);
    return m;
  }, [mandatiQ.data, tipoId]);
  const collaboratori = useMemo(() => {
    const t = cerca.trim().toLowerCase();
    return (collQ.data ?? [])
      .filter((c) => !t || `${c.cognome} ${c.nome} ${c.numeroSportello}`.toLowerCase().includes(t))
      .sort((a, b) => a.cognome.localeCompare(b.cognome, "it") || a.nome.localeCompare(b.nome, "it"));
  }, [collQ.data, cerca]);

  const carica = async (collaboratoreId: number, f: File) => {
    if (!tipo) return;
    setErr(null);
    setOccupato(collaboratoreId);
    try {
      await inviaFile<Mandato>("PUT", "/mandati/file", { collaboratoreId, tipoPraticaId: tipo.id }, f);
      await qc.invalidateQueries({ queryKey: getListMandatiQueryKey() });
      toast({ title: "Mandato salvato" });
    } catch (e) { setErr(messaggioErrore(e)); } finally { setOccupato(null); }
  };

  const caricamento = tipiQ.isLoading || collQ.isLoading || mandatiQ.isLoading;
  const errore = tipiQ.isError || collQ.isError || mandatiQ.isError;
  const conMandato = collaboratori.filter((c) => mandati.has(c.id)).length;

  return (
    <div>
      <PageHeader kicker="Configurazione" title="Mandati"
        subtitle="Per ogni collaboratore e tipo di pratica, il documento di mandato. Sostituire il mandato di un collaboratore non modifica quello degli altri." />
      {caricamento ? <Skeleton className="h-64 w-full" />
        : errore ? <ErrorState message="Impossibile caricare i mandati." onRetry={() => { tipiQ.refetch(); collQ.refetch(); mandatiQ.refetch(); }} />
        : !tipi.length ? <EmptyState icon={<FileSignature className="size-6" />} title="Nessun tipo di pratica" text="Crea prima un tipo di pratica per caricare i mandati." />
        : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="w-72">
                <Label htmlFor="sel-tipo">Tipo di pratica</Label>
                <Select value={String(tipoId)} onValueChange={setTipoSel}>
                  <SelectTrigger id="sel-tipo" data-testid="select-tipo-mandato"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {tipi.map((t) => <SelectItem key={t.id} value={String(t.id)} data-testid={`opzione-tipo-${t.id}`}>{t.nome}{t.attivo ? "" : " (disattivato)"}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="relative w-64">
                <Label htmlFor="cerca-coll">Cerca collaboratore</Label>
                <Search className="absolute left-2.5 bottom-2.5 size-4 text-muted-foreground" />
                <Input id="cerca-coll" className="pl-8" value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Nome o sportello" data-testid="input-cerca-collaboratore" />
              </div>
              <div className="text-sm text-muted-foreground pb-2" data-testid="text-riepilogo-mandati">{conMandato} di {collaboratori.length} collaboratori con mandato</div>
            </div>
            <FieldError id="errore-mandati">{err ?? undefined}</FieldError>
            {!collaboratori.length ? <EmptyState icon={<Search className="size-6" />} title="Nessun collaboratore trovato" />
              : (
                <div className="rounded-lg border border-border bg-card overflow-x-auto rise">
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Collaboratore</TableHead><TableHead>Sportello</TableHead><TableHead>Mandato</TableHead><TableHead className="text-right">Azioni</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {collaboratori.map((c) => {
                        const m = mandati.get(c.id);
                        return (
                          <TableRow key={c.id} data-testid={`riga-mandato-${c.id}`}>
                            <TableCell className="font-semibold">{c.cognome} {c.nome}</TableCell>
                            <TableCell className="tabular-nums">{c.numeroSportello}</TableCell>
                            <TableCell>
                              {m ? (
                                <div>
                                  <div className="text-sm" data-testid={`file-mandato-${c.id}`}>{m.fileNome}</div>
                                  <div className="text-xs text-muted-foreground">{formatoDimensione(m.dimensione)} · caricato il {fmtIstante(m.caricatoIl)}{m.caricatoDa ? ` da ${m.caricatoDa}` : ""}</div>
                                </div>
                              ) : <Badge variant="outline" className="text-muted-foreground" data-testid={`mancante-mandato-${c.id}`}>Non caricato</Badge>}
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-1.5">
                                {m && <Button asChild size="sm" variant="outline"><a href={urlMandato(m.id)} download data-testid={`link-scarica-mandato-${c.id}`}><Download className="size-4 mr-1.5" /> Scarica</a></Button>}
                                <SelettoreFile onFile={(f) => carica(c.id, f)} disabled={occupato !== null} testId={`button-carica-mandato-${c.id}`} variant={m ? "outline" : "default"}>
                                  {occupato === c.id ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : m ? <RefreshCw className="size-4 mr-1.5" /> : <Upload className="size-4 mr-1.5" />}
                                  {m ? "Sostituisci" : "Carica"}
                                </SelettoreFile>
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
        )}
    </div>
  );
}
