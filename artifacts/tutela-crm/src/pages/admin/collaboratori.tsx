import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useListCollaboratori, type ListCollaboratoriParams } from "@workspace/api-client-react";
import { Plus, Search, UsersRound, X, Globe2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, PageHeader, StatoBadge } from "@/components/common";
import { useSession } from "@/lib/auth";
import { fmtCellulare, nomeCollaboratore, parseApiError, tipologiaLabel } from "@/lib/format";

export default function CollaboratoriPage() {
  const { session } = useSession();
  const [, nav] = useLocation();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [tip, setTip] = useState("all");
  const [stato, setStato] = useState<"attivi" | "disattivati" | "tutti">("attivi");
  const [cap, setCap] = useState("all");
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);

  const params: ListCollaboratoriParams = { stato, ...(dq ? { q: dq } : {}), ...(tip !== "all" ? { tipologia: tip as "CAF" | "PATRONATO" | "ENTRAMBI" } : {}), ...(cap !== "all" ? { capogruppoId: Number(cap) } : {}) };
  const lista = useListCollaboratori(params);
  const tutti = useListCollaboratori({ stato: "tutti" });
  const capigruppo = useMemo(() => (tutti.data ?? []).filter((c) => c.numeroCollaboratori > 0), [tutti.data]);
  const puoCreare = session?.ruolo === "super_admin" || session?.ruolo === "admin";
  const filtrato = dq !== "" || tip !== "all" || cap !== "all" || stato !== "attivi";
  const reset = () => { setQ(""); setTip("all"); setCap("all"); setStato("attivi"); };

  return (
    <div>
      <PageHeader kicker="Anagrafica" title="Collaboratori"
        subtitle={lista.data ? `${lista.data.length} ${lista.data.length === 1 ? "risultato" : "risultati"}` : "Caricamento elenco"}
        actions={puoCreare ? <Button onClick={() => nav("/admin/collaboratori/nuovo")} data-testid="button-nuovo-collaboratore"><Plus className="size-4 mr-1.5" /> Nuovo collaboratore</Button> : undefined} />
      <div className="flex flex-wrap gap-2 mb-4 rise">
        <div className="relative flex-1 min-w-56">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca per nome, denominazione, codice fiscale, cellulare, email, sportello" className="pl-9 bg-card" data-testid="input-ricerca" />
        </div>
        <Select value={tip} onValueChange={setTip}>
          <SelectTrigger className="w-40 bg-card" data-testid="filtro-tipologia"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Ogni tipologia</SelectItem><SelectItem value="CAF">CAF</SelectItem><SelectItem value="PATRONATO">Patronato</SelectItem><SelectItem value="ENTRAMBI">Entrambi</SelectItem></SelectContent>
        </Select>
        <Select value={stato} onValueChange={(v) => setStato(v as typeof stato)}>
          <SelectTrigger className="w-40 bg-card" data-testid="filtro-stato"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="attivi">Attivi</SelectItem><SelectItem value="disattivati">Disattivati</SelectItem><SelectItem value="tutti">Tutti</SelectItem></SelectContent>
        </Select>
        <Select value={cap} onValueChange={setCap}>
          <SelectTrigger className="w-52 bg-card" data-testid="filtro-capogruppo"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Ogni capogruppo</SelectItem>
            {capigruppo.map((c) => <SelectItem key={c.id} value={String(c.id)}>{nomeCollaboratore(c)}</SelectItem>)}
          </SelectContent>
        </Select>
        {filtrato && <Button variant="ghost" onClick={reset} data-testid="button-reset-filtri"><X className="size-4 mr-1" /> Azzera</Button>}
      </div>

      {lista.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>
      ) : lista.isError ? (
        <ErrorState message={parseApiError(lista.error).message} onRetry={() => lista.refetch()} />
      ) : !lista.data?.length ? (
        <EmptyState icon={<UsersRound className="size-6" />} title={filtrato ? "Nessun collaboratore corrisponde ai filtri" : "Nessun collaboratore registrato"}
          text={filtrato ? "Prova ad allargare la ricerca o ad azzerare i filtri." : "Quando verrà registrato il primo collaboratore comparirà qui."}
          action={filtrato ? <Button variant="outline" onClick={reset}>Azzera filtri</Button> : puoCreare ? <Button onClick={() => nav("/admin/collaboratori/nuovo")}>Nuovo collaboratore</Button> : undefined} />
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-x-auto rise">
          <Table className="tabella-schede">
            <TableHeader>
              <TableRow className="bg-muted/60 hover:bg-muted/60">
                {["Collaboratore", "Sportello", "Tipologia", "Capogruppo", "Gruppo", "Cellulare", "Email", "Stato"].map((h) => (
                  <TableHead key={h} className="text-[11px] uppercase tracking-wider font-semibold h-10 whitespace-nowrap">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.data.map((c) => (
                <TableRow key={c.id} className="cursor-pointer transition-colors hover:bg-secondary/50" onClick={() => nav(`/admin/collaboratori/${c.id}`)} data-testid={`row-collaboratore-${c.id}`}>
                  <TableCell className="font-semibold whitespace-nowrap">
                    <Link href={`/admin/collaboratori/${c.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline" data-testid={`link-collaboratore-${c.id}`}>{nomeCollaboratore(c)}</Link>
                    {c.straniero && <Globe2 className="inline size-3.5 ml-1.5 text-accent-foreground/70" aria-label="Cittadino straniero" />}
                  </TableCell>
                  <TableCell data-label="Sportello" className="font-mono text-sm">{c.numeroSportello}</TableCell>
                  <TableCell data-label="Tipologia"><Badge variant="outline" className={c.tipologia === "CAF" ? "border-chart-4/40 text-chart-4" : c.tipologia === "ENTRAMBI" ? "border-accent text-accent-foreground" : "border-primary/40 text-primary"}>{tipologiaLabel(c.tipologia)}</Badge></TableCell>
                  <TableCell data-label="Capogruppo" className="whitespace-nowrap text-sm">{c.capogruppoNome ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell data-label="Gruppo" className="text-sm tabular-nums">{c.numeroCollaboratori > 0 ? <Badge className="bg-accent text-accent-foreground">{c.numeroCollaboratori}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell data-label="Cellulare" className="font-mono text-xs whitespace-nowrap">{fmtCellulare(c.cellulare)}</TableCell>
                  <TableCell data-label="Email" className="text-sm">{c.email}</TableCell>
                  <TableCell data-label="Stato"><StatoBadge attivo={c.attivo} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
