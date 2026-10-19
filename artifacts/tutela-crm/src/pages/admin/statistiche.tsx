import { useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { getGetStatisticheOperatoriQueryKey, useGetStatisticheOperatori } from "@workspace/api-client-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartColumn, FileSpreadsheet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { useToast } from "@/hooks/use-toast";
import { fmtData, parseApiError, ruoloLabel } from "@/lib/format";
import { urlEsportaStatisticheOperatori } from "@/lib/upload";

const fmtOre = (o: number | null) => {
  if (o === null) return "—";
  if (o < 48) return `${o.toLocaleString("it-IT", { maximumFractionDigits: 1 })} ore`;
  return `${(o / 24).toLocaleString("it-IT", { maximumFractionDigits: 1 })} giorni`;
};

export default function StatisticheOperatoriPage() {
  const { toast } = useToast();
  const [dal, setDal] = useState("");
  const [al, setAl] = useState("");
  const [esportando, setEsportando] = useState(false);
  const params = { ...(dal ? { dal } : {}), ...(al ? { al } : {}) };
  const q = useGetStatisticheOperatori(params, { query: { queryKey: getGetStatisticheOperatoriQueryKey(params), placeholderData: keepPreviousData } });
  const righe = q.data?.righe ?? [];
  const tot = (k: "preseInCarico" | "lavorate" | "chiuse" | "commentiInviati") => righe.reduce((a, r) => a + r[k], 0);
  const grafico = righe.map((r) => ({ nome: `${r.nome} ${r.cognome}`, "Prese in carico": r.preseInCarico, Lavorate: r.lavorate, Chiuse: r.chiuse, "Commenti inviati": r.commentiInviati }));

  const esporta = async () => {
    if (!q.data) return;
    setEsportando(true);
    try {
      const res = await fetch(urlEsportaStatisticheOperatori(q.data.dal, q.data.al), { credentials: "include" });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Impossibile creare il file Excel.");
      const nome = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get("Content-Disposition") ?? "")?.[1];
      const link = document.createElement("a");
      link.href = URL.createObjectURL(await res.blob());
      link.download = nome ? decodeURIComponent(nome) : "Statistiche operatori.xlsx";
      document.body.appendChild(link); link.click(); link.remove();
      URL.revokeObjectURL(link.href);
    } catch (e) {
      toast({ variant: "destructive", title: "Esportazione non riuscita", description: e instanceof Error ? e.message : "Riprova." });
    } finally { setEsportando(false); }
  };

  return (
    <div>
      <PageHeader kicker="Amministrazione" title="Statistiche operatori"
        subtitle={q.data ? `Periodo dal ${fmtData(q.data.dal)} al ${fmtData(q.data.al)}` : undefined}
        actions={<Button variant="outline" onClick={esporta} disabled={!q.data || esportando} data-testid="button-esporta-statistiche">{esportando ? <Loader2 className="size-4 mr-2 animate-spin" /> : <FileSpreadsheet className="size-4 mr-2" />} Esporta in Excel</Button>} />
      <div className="flex flex-wrap items-end gap-3 mb-5 rise">
        <div className="space-y-1"><Label htmlFor="dal" className="text-[11px] uppercase tracking-wider text-muted-foreground">Dal</Label><Input id="dal" type="date" autoComplete="off" value={dal} max={al || undefined} onChange={(e) => setDal(e.target.value)} className="w-40 bg-card" data-testid="filtro-dal" /></div>
        <div className="space-y-1"><Label htmlFor="al" className="text-[11px] uppercase tracking-wider text-muted-foreground">Al</Label><Input id="al" type="date" autoComplete="off" value={al} min={dal || undefined} onChange={(e) => setAl(e.target.value)} className="w-40 bg-card" data-testid="filtro-al" /></div>
        {(dal || al) && <Button variant="ghost" onClick={() => { setDal(""); setAl(""); }} data-testid="button-ultimi-30">Ultimi 30 giorni</Button>}
        {!dal && !al && <span className="text-sm text-muted-foreground pb-2">Senza date vengono mostrati gli ultimi 30 giorni.</span>}
      </div>
      {q.isLoading ? <Skeleton className="h-64" />
        : q.isError ? <ErrorState message={parseApiError(q.error).message} onRetry={() => q.refetch()} />
        : righe.length === 0 ? <EmptyState icon={<ChartColumn className="size-6" />} title="Nessun operatore" text="Non ci sono utenti interni da mostrare." />
        : (
          <div className={`space-y-6 transition-opacity ${q.isPlaceholderData ? "opacity-60" : ""}`}>
            <div className="rounded-lg border border-border bg-card overflow-x-auto rise">
              <Table className="tabella-schede" data-testid="tabella-statistiche">
                <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60">
                  {["Operatore", "Prese in carico", "Lavorate", "Chiuse", "Tempo medio di lavorazione", "Commenti inviati"].map((h, i) => <TableHead key={h} className={`text-[11px] uppercase tracking-wider font-semibold h-10 ${i > 0 ? "text-right" : ""}`}>{h}</TableHead>)}
                </TableRow></TableHeader>
                <TableBody>
                  {righe.map((r) => (
                    <TableRow key={r.utenteId} data-testid={`row-statistica-${r.utenteId}`}>
                      <TableCell data-label="Operatore" className="text-sm"><div className="font-medium">{r.cognome} {r.nome}</div><div className="text-xs text-muted-foreground">{ruoloLabel(r.ruolo)}</div></TableCell>
                      <TableCell data-label="Prese in carico" className="text-right tabular-nums">{r.preseInCarico}</TableCell>
                      <TableCell data-label="Lavorate" className="text-right tabular-nums">{r.lavorate}</TableCell>
                      <TableCell data-label="Chiuse" className="text-right tabular-nums">{r.chiuse}</TableCell>
                      <TableCell data-label="Tempo medio" className="text-right tabular-nums">{fmtOre(r.tempoMedioOre)}</TableCell>
                      <TableCell data-label="Commenti inviati" className="text-right tabular-nums">{r.commentiInviati}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="font-bold">
                    <TableCell data-label="Totale">Totale</TableCell>
                    <TableCell data-label="Prese in carico" className="text-right tabular-nums">{tot("preseInCarico")}</TableCell>
                    <TableCell data-label="Lavorate" className="text-right tabular-nums">{tot("lavorate")}</TableCell>
                    <TableCell data-label="Chiuse" className="text-right tabular-nums">{tot("chiuse")}</TableCell>
                    <TableCell data-label="Tempo medio" />
                    <TableCell data-label="Commenti inviati" className="text-right tabular-nums">{tot("commentiInviati")}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
            <div className="rounded-lg border border-border bg-card p-4 rise" data-testid="grafico-statistiche">
              <h2 className="text-sm font-bold mb-3">Lavoro per operatore</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={grafico} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="nome" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Bar isAnimationActive={false} dataKey="Prese in carico" fill="#2f5d8c" radius={[3, 3, 0, 0]} />
                    <Bar isAnimationActive={false} dataKey="Lavorate" fill="#6f9bc7" radius={[3, 3, 0, 0]} />
                    <Bar isAnimationActive={false} dataKey="Chiuse" fill="#2f8f6b" radius={[3, 3, 0, 0]} />
                    <Bar isAnimationActive={false} dataKey="Commenti inviati" fill="#c9923a" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      <p className="text-xs text-muted-foreground mt-4 max-w-3xl">
        Lavorate: pratiche diverse su cui l'operatore ha cambiato stato, scritto un commento o aggiunto un allegato. Chiuse: pratiche portate in uno stato di tipo chiuso.
        Tempo medio: dalla prima presa in carico alla chiusura, sulle pratiche chiuse nel periodo.
      </p>
    </div>
  );
}
