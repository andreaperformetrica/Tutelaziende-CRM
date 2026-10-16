import { useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { getGetFiltriLogQueryKey, getListLogOperazioniQueryKey, useGetFiltriLog, useListLogOperazioni, type ListLogOperazioniParams } from "@workspace/api-client-react";
import { ChevronLeft, ChevronRight, ScrollText, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { UtenteChip } from "@/components/utenti/colore-utente";
import { fmtIstante, parseApiError, ruoloLabel } from "@/lib/format";

const PER_PAGINA = 50;

export default function LogPage() {
  const [utente, setUtente] = useState("all");
  const [azione, setAzione] = useState("all");
  const [da, setDa] = useState("");
  const [a, setA] = useState("");
  const [pagina, setPagina] = useState(1);
  const filtri = useGetFiltriLog({ query: { queryKey: getGetFiltriLogQueryKey() } });
  const params: ListLogOperazioniParams = {
    pagina, perPagina: PER_PAGINA,
    ...(utente !== "all" ? { utenteId: Number(utente) } : {}), ...(azione !== "all" ? { azione } : {}),
    ...(da ? { da } : {}), ...(a ? { a } : {}),
  };
  const q = useListLogOperazioni(params, { query: { queryKey: getListLogOperazioniQueryKey(params), placeholderData: keepPreviousData } });
  const filtrato = utente !== "all" || azione !== "all" || !!da || !!a;
  const tot = q.data?.totale ?? 0;
  const pagine = Math.max(1, Math.ceil(tot / PER_PAGINA));
  const cambia = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPagina(1); };

  return (
    <div>
      <PageHeader kicker="Amministrazione" title="Log operazioni" subtitle={q.data ? `${tot.toLocaleString("it-IT")} operazioni registrate, dalla più recente` : undefined} />
      <div className="flex flex-wrap items-end gap-3 mb-4 rise">
        <div className="space-y-1"><Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Utente</Label>
          <Select value={utente} onValueChange={cambia(setUtente)}>
            <SelectTrigger className="w-56 bg-card" data-testid="filtro-utente"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Tutti gli utenti</SelectItem>{filtri.data?.utenti.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.nome} · {ruoloLabel(u.ruolo)}</SelectItem>)}</SelectContent>
          </Select></div>
        <div className="space-y-1"><Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Azione</Label>
          <Select value={azione} onValueChange={cambia(setAzione)}>
            <SelectTrigger className="w-64 bg-card" data-testid="filtro-azione"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Tutte le azioni</SelectItem>{filtri.data?.azioni.map((x) => <SelectItem key={x.codice} value={x.codice}>{x.etichetta}</SelectItem>)}</SelectContent>
          </Select></div>
        <div className="space-y-1"><Label htmlFor="da" className="text-[11px] uppercase tracking-wider text-muted-foreground">Dal</Label><Input id="da" autoComplete="off" type="date" value={da} max={a || undefined} onChange={(e) => cambia(setDa)(e.target.value)} className="w-40 bg-card" data-testid="filtro-da" /></div>
        <div className="space-y-1"><Label htmlFor="a" className="text-[11px] uppercase tracking-wider text-muted-foreground">Al</Label><Input id="a" autoComplete="off" type="date" value={a} min={da || undefined} onChange={(e) => cambia(setA)(e.target.value)} className="w-40 bg-card" data-testid="filtro-a" /></div>
        {filtrato && <Button variant="ghost" onClick={() => { setUtente("all"); setAzione("all"); setDa(""); setA(""); setPagina(1); }} data-testid="button-reset-log"><X className="size-4 mr-1" /> Azzera</Button>}
      </div>
      {q.isLoading ? <div className="space-y-2">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        : q.isError ? <ErrorState message={parseApiError(q.error).message} onRetry={() => q.refetch()} />
        : !q.data?.righe.length ? <EmptyState icon={<ScrollText className="size-6" />} title={filtrato ? "Nessuna operazione per questi filtri" : "Il registro è ancora vuoto"} text={filtrato ? "Modifica il periodo o l'utente selezionato." : "Le operazioni compiute dagli utenti compariranno qui."} />
        : (<>
          <div className={`rounded-lg border border-border bg-card overflow-x-auto transition-opacity ${q.isPlaceholderData ? "opacity-60" : ""}`}>
            <Table className="tabella-schede">
              <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60">
                {["Data e ora", "Utente", "Ruolo", "Azione", "Descrizione", "IP"].map((h) => <TableHead key={h} className="text-[11px] uppercase tracking-wider font-semibold h-10 whitespace-nowrap">{h}</TableHead>)}
              </TableRow></TableHeader>
              <TableBody>
                {q.data.righe.map((r) => (
                  <TableRow key={r.id} className="hover:bg-secondary/50 transition-colors align-top" data-testid={`row-log-${r.id}`}>
                    <TableCell data-label="Data e ora" className="font-mono text-xs whitespace-nowrap">{fmtIstante(r.creatoIl, true)}</TableCell>
                    <TableCell data-label="Utente" className="text-sm font-medium whitespace-nowrap">{r.utenteNome ? (r.utenteId !== null && r.ruolo && r.ruolo !== "collaboratore" ? <UtenteChip id={r.utenteId} colore={r.utenteColore}>{r.utenteNome}</UtenteChip> : r.utenteNome) : <span className="text-muted-foreground">Sistema</span>}</TableCell>
                    <TableCell data-label="Ruolo" className="text-xs whitespace-nowrap">{r.ruolo ? ruoloLabel(r.ruolo) : "—"}</TableCell>
                    <TableCell data-label="Azione" className="text-sm"><span className="inline-block rounded bg-secondary px-1.5 py-0.5 text-xs font-semibold text-secondary-foreground whitespace-nowrap">{r.azioneEtichetta}</span></TableCell>
                    <TableCell data-label="Descrizione" className="text-sm min-w-64">{r.descrizione}</TableCell>
                    <TableCell data-label="IP" className="font-mono text-xs text-muted-foreground">{r.ip ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between mt-3 text-sm">
            <span className="text-muted-foreground" data-testid="text-paginazione">Pagina {q.data.pagina} di {pagine} · righe {(q.data.pagina - 1) * PER_PAGINA + 1}–{(q.data.pagina - 1) * PER_PAGINA + q.data.righe.length}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} data-testid="button-pagina-precedente"><ChevronLeft className="size-4" /> Precedente</Button>
              <Button variant="outline" size="sm" disabled={pagina >= pagine} onClick={() => setPagina((p) => p + 1)} data-testid="button-pagina-successiva">Successiva <ChevronRight className="size-4" /></Button>
            </div>
          </div>
        </>)}
    </div>
  );
}
