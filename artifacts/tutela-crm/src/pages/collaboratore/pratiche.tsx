import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useListCollaboratori, useListPratiche } from "@workspace/api-client-react";
import { ChevronLeft, ChevronRight, FilePlus2, FileText, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { StatoBadge, coloreStato } from "@/components/pratiche/stato-badge";
import { DialogNuovaPratica } from "@/components/pratiche/dialog-nuova-pratica";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth";
import { fmtDataIstante, parseApiError } from "@/lib/format";

const PER_PAGINA = 25;

type Gruppo = "tutte" | "in_lavorazione" | "chiuse" | "bozze";
const GRUPPI: { valore: Gruppo; etichetta: string; chiave: "tutte" | "inLavorazione" | "chiuse" | "bozze" }[] = [
  { valore: "tutte", etichetta: "Tutte", chiave: "tutte" },
  { valore: "in_lavorazione", etichetta: "In lavorazione", chiave: "inLavorazione" },
  { valore: "chiuse", etichetta: "Chiuse", chiave: "chiuse" },
  { valore: "bozze", etichetta: "Bozze", chiave: "bozze" },
];

export default function PraticheCollaboratore() {
  const [, nav] = useLocation();
  const { session } = useSession();
  const capogruppo = !!session?.collaboratore?.capogruppo;
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [coll, setColl] = useState("all");
  const [pagina, setPagina] = useState(1);
  const [gruppo, setGruppo] = useState<Gruppo>("tutte");
  const [nuova, setNuova] = useState(false);
  const [statoSel, setStatoSel] = useState<number | null>(null);
  useEffect(() => { const t = setTimeout(() => { setDq(q.trim()); setPagina(1); }, 250); return () => clearTimeout(t); }, [q]);

  const lista = useListPratiche({ ...(dq ? { q: dq } : {}), ...(coll !== "all" ? { collaboratoreId: Number(coll) } : {}), ...(gruppo !== "tutte" ? { gruppo } : {}), ...(statoSel ? { statoId: statoSel } : {}), pagina, perPagina: PER_PAGINA });
  const collaboratori = useListCollaboratori({ stato: "tutti" }, { query: { enabled: capogruppo, queryKey: ["collaboratori-filtro-pratiche"] } });
  const filtrato = dq !== "" || coll !== "all" || gruppo !== "tutte" || statoSel !== null;
  const totale = lista.data?.totale ?? 0;
  const pagine = Math.max(1, Math.ceil(totale / PER_PAGINA));
  const intestazioni = ["N.", "Assistito", "Tipo", "Data richiesta", "Stato", "Gestita da", ...(capogruppo ? ["Collaboratore"] : [])];

  return (
    <div>
      <PageHeader kicker="Pratiche" title="Le mie pratiche"
        subtitle={lista.data ? `${totale} ${totale === 1 ? "pratica" : "pratiche"}${capogruppo ? " tue e del tuo gruppo" : ""}` : "Caricamento elenco"}
        actions={<Button onClick={() => setNuova(true)} data-testid="button-nuova-pratica"><FilePlus2 className="size-4 mr-1.5" /> Nuova pratica</Button>} />
      <div className="-mx-4 px-4 mb-4 overflow-x-auto rise [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Stato delle pratiche" data-testid="tabs-gruppi-pratiche">
        <div className="flex gap-1.5 w-max">
          {GRUPPI.map((g) => {
            const attivo = gruppo === g.valore;
            return (
              <button key={g.valore} role="tab" aria-selected={attivo} onClick={() => { setGruppo(g.valore); setStatoSel(null); setPagina(1); }} data-testid={`tab-gruppo-${g.valore}`}
                className={cn("flex items-center gap-2 rounded-full border px-3 min-h-10 text-sm font-semibold whitespace-nowrap transition-colors",
                  attivo ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground hover:bg-secondary/60")}>
                {g.etichetta}
                <span className={cn("rounded-full px-2 text-xs tabular-nums", attivo ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground")} data-testid={`conteggio-${g.valore}`}>{lista.data ? lista.data.conteggi[g.chiave] : "–"}</span>
              </button>
            );
          })}
        </div>
      </div>
      {lista.data && (
        <section className="mb-4 rounded-lg border border-border bg-card px-4 py-3 rise" aria-label="Riepilogo pratiche" data-testid="riepilogo-stati">
          <h2 className="text-sm font-bold flex items-center gap-2 mb-2"><FileText className="size-4 text-muted-foreground" /> Riepilogo pratiche</h2>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-3 sm:flex sm:flex-wrap sm:gap-0 sm:divide-x sm:divide-border">
            {[
              ...(lista.data.conteggi.bozze > 0 ? [{ chiave: "bozze", nome: "Bozze", totale: lista.data.conteggi.bozze, colore: coloreStato({ nome: "Bozza" }), statoId: null as number | null }] : []),
              ...lista.data.conteggi.perStato.map((s) => ({ chiave: `s${s.statoId}`, nome: s.nome, totale: s.totale, colore: coloreStato({ id: s.statoId, nome: s.nome, chiuso: s.chiuso, colore: s.colore }), statoId: s.statoId as number | null })),
            ].map((x) => {
              const attivo = x.statoId === null ? gruppo === "bozze" : statoSel === x.statoId;
              return (
                <li key={x.chiave} className="sm:px-5 sm:first:pl-0 sm:last:pr-0">
                  <button type="button" onClick={() => { setPagina(1); if (attivo) { setGruppo("tutte"); setStatoSel(null); } else if (x.statoId === null) { setGruppo("bozze"); setStatoSel(null); } else { setGruppo("tutte"); setStatoSel(x.statoId); } }}
                    aria-pressed={attivo} data-testid={`riepilogo-${x.chiave}`}
                    className={cn("flex items-baseline gap-2 rounded-md px-1 min-h-9 text-left transition-colors hover:bg-secondary/60", attivo && "bg-secondary")}>
                    <span className="text-xl font-bold tabular-nums">{x.totale}</span>
                    <span className="text-sm font-semibold" style={{ color: x.colore }}>{x.nome}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <div className="flex flex-wrap gap-2 mb-4 rise">
        <div className="relative flex-1 min-w-full sm:min-w-56">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca assistito, codice fiscale o numero" className="pl-9 bg-card" data-testid="input-ricerca-pratiche" />
        </div>
        {capogruppo && (
          <Select value={coll} onValueChange={(v) => { setColl(v); setPagina(1); }}>
            <SelectTrigger className="w-full sm:w-60 bg-card" data-testid="filtro-collaboratore-pratiche"><SelectValue /></SelectTrigger>
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
          text={filtrato ? "Prova con meno parole o cambia il filtro." : "Apri la tua prima pratica: comparirà qui."}
          action={filtrato ? <Button variant="outline" onClick={() => { setQ(""); setColl("all"); setGruppo("tutte"); setStatoSel(null); }}>Azzera ricerca</Button> : <Button onClick={() => setNuova(true)}>Nuova pratica</Button>} />
      ) : (
        <>
          <ul className="md:hidden space-y-2.5 rise" data-testid="lista-pratiche-mobile">
            {lista.data.elementi.map((p) => (
              <li key={p.id}>
                <button onClick={() => nav(`/collaboratore/pratiche/${p.id}`)} data-testid={`card-pratica-${p.id}`}
                  className="w-full text-left rounded-lg border border-border bg-card p-4 active:bg-secondary/60 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-base leading-tight">{p.assistito.cognome} {p.assistito.nome}</div>
                      <div className="text-sm text-muted-foreground mt-0.5">{p.tipo.nome}</div>
                    </div>
                    <StatoBadge stato={{ id: p.statoId, nome: p.stato, chiuso: p.statoChiuso, colore: p.statoColore }} />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="font-mono font-semibold text-foreground">{p.numero ? `N. ${p.numero}` : "Senza numero"}</span>
                    <span className="tabular-nums">{p.dataRichiesta ? fmtDataIstante(p.dataRichiesta) : "Non inviata"}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">Gestita da: {p.gestitaDa ?? (p.bozza ? "—" : "non ancora assegnata")}</div>
                  {capogruppo && <div className="mt-1 text-xs text-muted-foreground">Collaboratore: {p.collaboratore.cognome} {p.collaboratore.nome} · {p.collaboratore.numeroSportello}</div>}
                </button>
              </li>
            ))}
          </ul>
          <div className="hidden md:block rounded-lg border border-border bg-card overflow-x-auto rise">
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
                    <TableCell><StatoBadge stato={{ id: p.statoId, nome: p.stato, chiuso: p.statoChiuso, colore: p.statoColore }} /></TableCell>
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
      <DialogNuovaPratica aperto={nuova} onClose={() => setNuova(false)} />
    </div>
  );
}
