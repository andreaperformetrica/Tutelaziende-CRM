import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useListCollaboratori, useListPratiche } from "@workspace/api-client-react";
import { ChevronLeft, ChevronRight, FileText, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { useSession } from "@/lib/auth";
import { fmtDataIstante, parseApiError } from "@/lib/format";

const PER_PAGINA = 25;

export default function PraticheCollaboratore() {
  const [, nav] = useLocation();
  const { session } = useSession();
  const capogruppo = !!session?.collaboratore?.capogruppo;
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [coll, setColl] = useState("all");
  const [pagina, setPagina] = useState(1);
  useEffect(() => { const t = setTimeout(() => { setDq(q.trim()); setPagina(1); }, 250); return () => clearTimeout(t); }, [q]);

  const lista = useListPratiche({ ...(dq ? { q: dq } : {}), ...(coll !== "all" ? { collaboratoreId: Number(coll) } : {}), pagina, perPagina: PER_PAGINA });
  const collaboratori = useListCollaboratori({ stato: "tutti" }, { query: { enabled: capogruppo, queryKey: ["collaboratori-filtro-pratiche"] } });
  const filtrato = dq !== "" || coll !== "all";
  const totale = lista.data?.totale ?? 0;
  const pagine = Math.max(1, Math.ceil(totale / PER_PAGINA));
  const intestazioni = ["N.", "Assistito", "Tipo", "Data richiesta", "Stato", "Gestita da", ...(capogruppo ? ["Collaboratore"] : [])];

  return (
    <div>
      <PageHeader kicker="Pratiche" title="Le mie pratiche"
        subtitle={lista.data ? `${totale} ${totale === 1 ? "pratica" : "pratiche"}${capogruppo ? " tue e del tuo gruppo" : ""}` : "Caricamento elenco"} />
      <div className="flex flex-wrap gap-2 mb-4 rise">
        <div className="relative flex-1 min-w-56">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca per assistito, codice fiscale o numero pratica" className="pl-9 bg-card" data-testid="input-ricerca-pratiche" />
        </div>
        {capogruppo && (
          <Select value={coll} onValueChange={(v) => { setColl(v); setPagina(1); }}>
            <SelectTrigger className="w-60 bg-card" data-testid="filtro-collaboratore-pratiche"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Ogni collaboratore</SelectItem>
              {session?.collaboratore && <SelectItem value={String(session.collaboratore.id)}>Le mie pratiche</SelectItem>}
              {(collaboratori.data ?? []).filter((c) => c.id !== session?.collaboratore?.id).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.cognome} {c.nome} · sportello {c.numeroSportello}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {lista.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>
      ) : lista.isError ? (
        <ErrorState message={parseApiError(lista.error).message} onRetry={() => lista.refetch()} />
      ) : !lista.data?.elementi.length ? (
        <EmptyState icon={<FileText className="size-6" />} title={filtrato ? "Nessuna pratica corrisponde alla ricerca" : "Nessuna pratica"}
          text={filtrato ? "Prova con meno parole o cambia il filtro." : "Apri una pratica dall'elenco degli assistiti: comparirà qui."}
          action={filtrato ? <Button variant="outline" onClick={() => { setQ(""); setColl("all"); }}>Azzera ricerca</Button> : <Button onClick={() => nav("/collaboratore/assistiti")}>Vai agli assistiti</Button>} />
      ) : (
        <>
          <div className="rounded-lg border border-border bg-card overflow-x-auto rise">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  {intestazioni.map((h) => <TableHead key={h} className="text-[11px] uppercase tracking-wider font-semibold h-10 whitespace-nowrap">{h}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.data.elementi.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer transition-colors hover:bg-secondary/50" onClick={() => nav(`/collaboratore/pratiche/${p.id}`)} data-testid={`row-pratica-${p.id}`}>
                    <TableCell className="font-mono text-sm font-semibold">{p.numero ?? "—"}</TableCell>
                    <TableCell className="font-semibold whitespace-nowrap">{p.assistito.cognome} {p.assistito.nome}</TableCell>
                    <TableCell className="text-sm">{p.tipo.nome}</TableCell>
                    <TableCell className="text-sm tabular-nums whitespace-nowrap">{p.dataRichiesta ? fmtDataIstante(p.dataRichiesta) : <span className="text-muted-foreground">Non inviata</span>}</TableCell>
                    <TableCell>{p.bozza ? <Badge variant="outline">Bozza</Badge> : <Badge className="bg-primary text-primary-foreground">{p.stato}</Badge>}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{p.gestitaDa ?? <span className="text-muted-foreground">{p.bozza ? "—" : "Non ancora assegnata"}</span>}</TableCell>
                    {capogruppo && (
                      <TableCell className="text-sm whitespace-nowrap">
                        {p.collaboratore.cognome} {p.collaboratore.nome} <span className="font-mono text-xs text-muted-foreground">· {p.collaboratore.numeroSportello}</span>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {pagine > 1 && (
            <div className="flex items-center justify-between mt-3 text-sm" data-testid="paginazione-pratiche">
              <span className="text-muted-foreground">Pagina {pagina} di {pagine}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}><ChevronLeft className="size-4 mr-1" /> Precedente</Button>
                <Button variant="outline" size="sm" disabled={pagina >= pagine} onClick={() => setPagina(pagina + 1)}>Successiva <ChevronRight className="size-4 ml-1" /></Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
