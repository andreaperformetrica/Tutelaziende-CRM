import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getListImportazioniQueryKey, useListImportazioni } from "@workspace/api-client-react";
import { FileSpreadsheet, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { useToast } from "@/hooks/use-toast";
import { fmtEuro, fmtIstante, parseApiError } from "@/lib/format";
import { inviaFile, messaggioErrore } from "@/lib/upload";

type Tipo = "mod730" | "isee" | "naspi";

const TIPI: { valore: Tipo; titolo: string; colonne: string; descrizione: string }[] = [
  { valore: "mod730", titolo: "730", colonne: "sportello, sede, totale dovuto", descrizione: "Un import per anno di riferimento. Il totale va nella riga «730/anno Saldo» del dare e avere." },
  { valore: "isee", titolo: "ISEE", colonne: "sportello, sede, totale dovuto", descrizione: "Un import per trimestre e anno. Il totale va nella riga «ISEE trimestre N anno»." },
  { valore: "naspi", titolo: "NASPI", colonne: "sportello, sede, importo cumulato", descrizione: "Import periodico: il primo crea il riferimento, i successivi pagano la differenza dal cumulato precedente." },
];

const annoCorrente = new Date().getFullYear();

export default function ImportaCompensiPage() {
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const lista = useListImportazioni();
  const [tipo, setTipo] = useState<Tipo>("mod730");
  const [anno, setAnno] = useState(String(annoCorrente - 1));
  const [annoDareAvere, setAnnoDareAvere] = useState(String(annoCorrente));
  const [trimestre, setTrimestre] = useState("1");
  const [periodo, setPeriodo] = useState("");
  const [invio, setInvio] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const annoValido = (v: string) => /^\d{4}$/.test(v) && Number(v) >= 2000 && Number(v) <= 2100;
  const info = TIPI.find((t) => t.valore === tipo)!;

  const scegliTipo = (t: Tipo) => {
    setTipo(t);
    setErr(null);
    setAnno(String(t === "mod730" ? annoCorrente - 1 : annoCorrente));
  };

  const carica = async (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    if (!annoValido(anno)) return setErr("Inserisci un anno valido (aaaa).");
    if (tipo === "mod730" && !annoValido(annoDareAvere)) return setErr("Inserisci un anno valido per il dare e avere (aaaa).");
    const query: Record<string, string | number> = { servizio: tipo, anno: Number(anno) };
    if (tipo === "isee") query.trimestre = Number(trimestre);
    if (tipo === "naspi" && periodo.trim()) query.periodo = periodo.trim();
    if (tipo === "mod730") query.annoDareAvere = Number(annoDareAvere);
    setInvio(true);
    try {
      const r = await inviaFile<{ importazione: { id: number } }>("POST", "/backoffice/compensi/importazioni", query, file);
      qc.invalidateQueries({ queryKey: getListImportazioniQueryKey() });
      toast({ title: "File letto", description: "Controlla l'anteprima prima di confermare." });
      nav(`/admin/importa-compensi/${r.importazione.id}`);
    } catch (e) {
      setErr(messaggioErrore(e));
    } finally {
      setInvio(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div>
      <PageHeader title="Importa compensi" subtitle="Carica i file Excel dei compensi 730, ISEE e NASPI. Prima di salvare vedi l'anteprima delle righe lette." />

      <section className="mb-8">
        <h2 className="font-serif text-xl font-semibold mb-3">Nuova importazione</h2>
        <div className="grid gap-3 sm:grid-cols-3 mb-4" role="radiogroup" aria-label="Tipo di import">
          {TIPI.map((t) => (
            <button key={t.valore} type="button" role="radio" aria-checked={tipo === t.valore} onClick={() => scegliTipo(t.valore)} data-testid={`tipo-import-${t.valore}`}
              className={`text-left rounded-lg border p-4 transition-colors ${tipo === t.valore ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card hover:bg-secondary/50"}`}>
              <div className="font-semibold">{t.titolo}</div>
              <div className="text-xs text-muted-foreground mt-1">Colonne: {t.colonne}</div>
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground mb-4 max-w-3xl">{info.descrizione} Il collaboratore si abbina con la colonna «sportello» (maiuscole e minuscole non contano); la colonna «sede» serve solo come controllo visivo.</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5"><Label htmlFor="imp-anno">{tipo === "mod730" ? "Anno di riferimento" : "Anno"}</Label><Input id="imp-anno" inputMode="numeric" maxLength={4} value={anno} onChange={(e) => setAnno(e.target.value)} className="w-28 bg-card" data-testid="input-import-anno" /></div>
          {tipo === "isee" && (
            <div className="space-y-1.5"><Label htmlFor="imp-trimestre">Trimestre</Label>
              <select id="imp-trimestre" value={trimestre} onChange={(e) => setTrimestre(e.target.value)} className="h-10 w-28 rounded-md border border-input bg-card px-3 text-sm" data-testid="select-import-trimestre">
                {["1", "2", "3", "4"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}
          {tipo === "naspi" && (
            <div className="space-y-1.5"><Label htmlFor="imp-periodo">Periodo (facoltativo)</Label><Input id="imp-periodo" maxLength={60} placeholder="es. gen-set" value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="w-44 bg-card" data-testid="input-import-periodo" /></div>
          )}
          {tipo === "mod730" && (
            <div className="space-y-1.5"><Label htmlFor="imp-anno-da">Anno del dare e avere</Label><Input id="imp-anno-da" inputMode="numeric" maxLength={4} value={annoDareAvere} onChange={(e) => setAnnoDareAvere(e.target.value)} className="w-28 bg-card" data-testid="input-import-anno-dare-avere" /></div>
          )}
          <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => carica(e.target.files?.[0])} data-testid="input-import-file" />
          <Button onClick={() => fileRef.current?.click()} disabled={invio} data-testid="button-import-carica"><Upload className="size-4 mr-2" />{invio ? "Lettura in corso…" : "Scegli il file"}</Button>
        </div>
        {err && <div role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 text-destructive px-3 py-2 text-sm max-w-3xl" data-testid="errore-import">{err}</div>}
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
                  {["N.", "Import", "File", "Caricato", "Righe", "Da pagare", "Stato"].map((h, i) => <TableHead key={h} className={`text-[11px] uppercase tracking-wider font-semibold h-10 ${i === 4 || i === 5 ? "text-right" : ""}`}>{h}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.data.map((i) => (
                  <TableRow key={i.id} className="cursor-pointer hover:bg-secondary/50" onClick={() => nav(`/admin/importa-compensi/${i.id}`)} data-testid={`row-importazione-${i.id}`}>
                    <TableCell className="tabular-nums font-semibold">{i.id}</TableCell>
                    <TableCell className="font-medium">{i.titolo}</TableCell>
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
    </div>
  );
}
