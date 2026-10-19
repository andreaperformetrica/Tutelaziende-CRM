import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getListImportazioniQueryKey, useListImportazioni, useListServiziImport, type ServizioImport } from "@workspace/api-client-react";
import { FileSpreadsheet, Settings2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/common";
import { useToast } from "@/hooks/use-toast";
import { fmtIstante, fmtEuro, parseApiError } from "@/lib/format";
import { inviaFile, messaggioErrore } from "@/lib/upload";
import { RegolaImportForm, TESTO_CHIAVE, TESTO_REGOLA } from "./regola-import-form";

const SEZIONE: Record<string, string> = { naspi: "Naspi", pensionati: "Pensionati", caf: "CAF" };

export function ImportazioniTab() {
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const servizi = useListServiziImport();
  const lista = useListImportazioni();
  const [servizio, setServizio] = useState("");
  const [anno, setAnno] = useState(String(new Date().getFullYear()));
  const [invio, setInvio] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [regola, setRegola] = useState<ServizioImport | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const annoOk = /^\d{4}$/.test(anno) && Number(anno) >= 2000 && Number(anno) <= 2100;

  const carica = async (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    if (!servizio) return setErr("Scegli prima il servizio.");
    if (!annoOk) return setErr("Inserisci un anno valido (aaaa).");
    setInvio(true);
    try {
      const r = await inviaFile<{ importazione: { id: number } }>("POST", "/backoffice/compensi/importazioni", { servizio, anno: Number(anno) }, file);
      qc.invalidateQueries({ queryKey: getListImportazioniQueryKey() });
      toast({ title: "File letto", description: "Controlla l'anteprima prima di confermare." });
      nav(`/admin/compensi/importazioni/${r.importazione.id}`);
    } catch (e) {
      setErr(messaggioErrore(e));
    } finally {
      setInvio(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-serif text-xl font-semibold mb-1">Regole di calcolo</h2>
        <p className="text-sm text-muted-foreground mb-3">Per ogni servizio: quanto spetta al collaboratore e in quale colonna del file si trova.</p>
        {servizi.isLoading ? <Skeleton className="h-32 w-full" /> : servizi.isError ? <ErrorState message={parseApiError(servizi.error).message} onRetry={() => servizi.refetch()} /> : (
          <div className="grid gap-3 sm:grid-cols-2">
            {servizi.data?.map((s) => (
              <div key={s.servizio} className="rounded-lg border border-border bg-card p-4 flex items-start justify-between gap-3" data-testid={`card-servizio-${s.servizio}`}>
                <div className="space-y-1 min-w-0">
                  <div className="font-semibold">{s.etichetta} <span className="font-normal text-xs text-muted-foreground">· dare/avere: {SEZIONE[s.sezione] ?? s.sezione}</span></div>
                  <div className="text-sm">{TESTO_REGOLA(s)}</div>
                  {s.configurato && <div className="text-xs text-muted-foreground">{TESTO_CHIAVE[s.tipoChiave as keyof typeof TESTO_CHIAVE]} dalla colonna «{s.colonnaChiave}»</div>}
                </div>
                <Button size="sm" variant="outline" onClick={() => setRegola(s)} data-testid={`button-regola-${s.servizio}`}><Settings2 className="size-4 mr-1.5" />Imposta</Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-serif text-xl font-semibold mb-1">Nuova importazione</h2>
        <p className="text-sm text-muted-foreground mb-3">Carica un file Excel (.xlsx) o CSV. Prima di salvare vedrai l'anteprima con gli eventuali errori.</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5"><Label htmlFor="imp-servizio">Servizio</Label>
            <Select value={servizio} onValueChange={setServizio}>
              <SelectTrigger id="imp-servizio" className="w-44 bg-card" data-testid="select-import-servizio"><SelectValue placeholder="Scegli" /></SelectTrigger>
              <SelectContent>{servizi.data?.map((s) => <SelectItem key={s.servizio} value={s.servizio}>{s.etichetta}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="imp-anno">Anno di competenza</Label><Input id="imp-anno" inputMode="numeric" maxLength={4} value={anno} onChange={(e) => setAnno(e.target.value)} className="w-28 bg-card" data-testid="input-import-anno" /></div>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => carica(e.target.files?.[0])} data-testid="input-import-file" />
          <Button onClick={() => fileRef.current?.click()} disabled={invio} data-testid="button-import-carica"><Upload className="size-4 mr-2" />{invio ? "Lettura in corso…" : "Scegli il file"}</Button>
        </div>
        {err && <div role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 text-destructive px-3 py-2 text-sm max-w-2xl" data-testid="errore-import">{err}</div>}
      </section>

      <section>
        <h2 className="font-serif text-xl font-semibold mb-3">Importazioni</h2>
        {lista.isLoading ? <Skeleton className="h-32 w-full" /> : lista.isError ? <ErrorState message={parseApiError(lista.error).message} onRetry={() => lista.refetch()} /> : !lista.data?.length ? (
          <EmptyState icon={<FileSpreadsheet className="size-6" />} title="Nessuna importazione" text="I file caricati compaiono qui, con il totale dei compensi riportato nel dare e avere." />
        ) : (
          <div className="rounded-lg border border-border bg-card overflow-x-auto rise">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  {["N.", "Servizio", "Anno", "File", "Caricato", "Righe", "Totale", "Stato"].map((h, i) => <TableHead key={h} className={`text-[11px] uppercase tracking-wider font-semibold h-10 ${i >= 5 && i < 7 ? "text-right" : ""}`}>{h}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.data.map((i) => (
                  <TableRow key={i.id} className="cursor-pointer hover:bg-secondary/50" onClick={() => nav(`/admin/compensi/importazioni/${i.id}`)} data-testid={`row-importazione-${i.id}`}>
                    <TableCell className="tabular-nums font-semibold">{i.id}</TableCell>
                    <TableCell>{i.servizioEtichetta}</TableCell>
                    <TableCell className="tabular-nums">{i.anno}</TableCell>
                    <TableCell className="max-w-[16rem] truncate">{i.nomeFile}</TableCell>
                    <TableCell className="tabular-nums">{fmtIstante(i.creatoIl)}{i.creatoDa ? <span className="text-muted-foreground text-xs"> · {i.creatoDa}</span> : null}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.stato === "confermata" ? `${i.righeImportate} / ${i.righeLette}` : i.righeLette}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.stato === "confermata" ? fmtEuro(i.totaleEuro) : "—"}</TableCell>
                    <TableCell>{i.stato === "confermata" ? <Badge className="bg-primary text-primary-foreground">Confermata</Badge> : <Badge variant="outline">In anteprima</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
      <RegolaImportForm servizio={regola} aperto={!!regola} onChiudi={() => setRegola(null)} />
    </div>
  );
}
