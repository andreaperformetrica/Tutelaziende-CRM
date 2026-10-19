import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useListAssistiti, useListCollaboratori } from "@workspace/api-client-react";
import { ChevronLeft, ChevronRight, FilePlus2, Globe2, Plus, Search, UserRound, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { DialogApriPratica } from "@/components/pratiche/dialog-apri-pratica";
import { fmtCellulare, fmtData, parseApiError, nomeCollaboratore } from "@/lib/format";

const PER_PAGINA = 25;

/**
 * Elenco assistiti con ricerca su nome, cognome e codice fiscale.
 * `base` e' il percorso delle schede (area collaboratore o back office); il server filtra comunque
 * l'elenco in base ai permessi dell'utente.
 */
export function AssistitiLista({ base, backoffice, capogruppo, puoCreare }: { base: string; backoffice?: boolean; capogruppo?: boolean; puoCreare?: boolean }) {
  const [, nav] = useLocation();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [coll, setColl] = useState("all");
  const [pagina, setPagina] = useState(1);
  const [apriPer, setApriPer] = useState<{ id: number; nome: string } | null>(null);
  useEffect(() => { const t = setTimeout(() => { setDq(q.trim()); setPagina(1); }, 250); return () => clearTimeout(t); }, [q]);

  const lista = useListAssistiti({
    ...(dq ? { q: dq } : {}), ...(coll !== "all" ? { collaboratoreId: Number(coll) } : {}), pagina, perPagina: PER_PAGINA,
  });
  const collaboratori = useListCollaboratori({ stato: "tutti" }, { query: { enabled: !!backoffice || !!capogruppo, queryKey: ["collaboratori-filtro-assistiti"] } });
  const mostraCollaboratore = !!backoffice || !!capogruppo;
  const filtrato = dq !== "" || coll !== "all";
  const totale = lista.data?.totale ?? 0;
  const pagine = Math.max(1, Math.ceil(totale / PER_PAGINA));
  const reset = () => { setQ(""); setColl("all"); setPagina(1); };

  const intestazioni = ["Cognome e nome", "Codice fiscale", "Nascita", "Cellulare", "Città", ...(mostraCollaboratore ? ["Collaboratore"] : []), ...(puoCreare ? [""] : [])];

  return (
    <div>
      <PageHeader kicker="Anagrafica" title="Assistiti"
        subtitle={lista.data ? `${totale} ${totale === 1 ? "risultato" : "risultati"}` : "Caricamento elenco"}
        actions={puoCreare ? <Button onClick={() => nav(`${base}/nuovo`)} data-testid="button-nuovo-assistito"><Plus className="size-4 mr-1.5" /> Nuovo assistito</Button> : undefined} />
      <div className="flex flex-wrap gap-2 mb-4 rise">
        <div className="relative flex-1 min-w-full sm:min-w-56">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca nome, cognome o codice fiscale" className="pl-9 bg-card" data-testid="input-ricerca" />
        </div>
        {mostraCollaboratore && (
          <Select value={coll} onValueChange={(v) => { setColl(v); setPagina(1); }}>
            <SelectTrigger className="w-full sm:w-60 bg-card" data-testid="filtro-collaboratore"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Ogni collaboratore</SelectItem>
              {(collaboratori.data ?? []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{nomeCollaboratore(c)} · {c.numeroSportello}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {filtrato && <Button variant="ghost" onClick={reset} data-testid="button-reset-filtri"><X className="size-4 mr-1" /> Azzera</Button>}
      </div>

      {lista.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>
      ) : lista.isError ? (
        <ErrorState message={parseApiError(lista.error).message} onRetry={() => lista.refetch()} />
      ) : !lista.data?.elementi.length ? (
        <EmptyState icon={<UserRound className="size-6" />} title={filtrato ? "Nessun assistito corrisponde alla ricerca" : "Nessun assistito registrato"}
          text={filtrato ? "Controlla l'ortografia o prova con meno parole." : puoCreare ? "Registra il primo assistito per vederlo qui." : "Quando verrà registrato il primo assistito comparirà qui."}
          action={filtrato ? <Button variant="outline" onClick={reset}>Azzera ricerca</Button> : puoCreare ? <Button onClick={() => nav(`${base}/nuovo`)}>Nuovo assistito</Button> : undefined} />
      ) : (
        <>
          <ul className="md:hidden space-y-2.5 rise" data-testid="lista-assistiti-mobile">
            {lista.data.elementi.map((a) => (
              <li key={a.id} className="rounded-lg border border-border bg-card" data-testid={`card-assistito-${a.id}`}>
                <Link href={`${base}/${a.id}`} className="block p-4 active:bg-secondary/60 rounded-lg transition-colors">
                  <div className="font-bold text-base leading-tight">
                    {a.cognome} {a.nome}
                    {a.straniero && <Globe2 className="inline size-3.5 ml-1.5 text-accent-foreground/70" aria-label="Cittadino straniero" />}
                  </div>
                  <div className="font-mono text-xs tracking-wider text-muted-foreground mt-1">{a.codiceFiscale}</div>
                  <div className="mt-2 text-xs text-muted-foreground">Nato il {fmtData(a.dataNascita)} · {a.citta}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground font-mono">{fmtCellulare(a.cellulare)}</div>
                  {mostraCollaboratore && <div className="mt-1 text-xs text-muted-foreground">Collaboratore: {nomeCollaboratore(a.collaboratore)} · {a.collaboratore.numeroSportello}</div>}
                </Link>
                {puoCreare && a.modificabile && (
                  <div className="px-4 pb-4 -mt-1">
                    <Button className="w-full h-11" variant="outline" onClick={() => setApriPer({ id: a.id, nome: `${a.cognome} ${a.nome}` })} data-testid={`button-apri-pratica-mobile-${a.id}`}>
                      <FilePlus2 className="size-4 mr-1.5" /> Apri pratica
                    </Button>
                  </div>
                )}
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
                {lista.data.elementi.map((a) => (
                  <TableRow key={a.id} className="cursor-pointer transition-colors hover:bg-secondary/50" onClick={() => nav(`${base}/${a.id}`)} data-testid={`row-assistito-${a.id}`}>
                    <TableCell className="font-semibold whitespace-nowrap">
                      <Link href={`${base}/${a.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline" data-testid={`link-assistito-${a.id}`}>{a.cognome} {a.nome}</Link>
                      {a.straniero && <Globe2 className="inline size-3.5 ml-1.5 text-accent-foreground/70" aria-label="Cittadino straniero" />}
                    </TableCell>
                    <TableCell className="font-mono text-xs tracking-wider">{a.codiceFiscale}</TableCell>
                    <TableCell className="text-sm tabular-nums whitespace-nowrap">{fmtData(a.dataNascita)}</TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">{fmtCellulare(a.cellulare)}</TableCell>
                    <TableCell className="text-sm">{a.citta}</TableCell>
                    {mostraCollaboratore && (
                      <TableCell className="text-sm whitespace-nowrap">
                        {nomeCollaboratore(a.collaboratore)} <span className="font-mono text-xs text-muted-foreground">· {a.collaboratore.numeroSportello}</span>
                      </TableCell>
                    )}
                    {puoCreare && (
                      <TableCell className="text-right whitespace-nowrap">
                        {a.modificabile && (
                          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setApriPer({ id: a.id, nome: `${a.cognome} ${a.nome}` }); }} data-testid={`button-apri-pratica-${a.id}`}>
                            <FilePlus2 className="size-4 mr-1.5" /> Apri pratica
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {pagine > 1 && (
            <div className="flex items-center justify-between mt-3 text-sm" data-testid="paginazione">
              <span className="text-muted-foreground">Pagina {pagina} di {pagine}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)} data-testid="button-pagina-precedente"><ChevronLeft className="size-4 mr-1" /> Precedente</Button>
                <Button variant="outline" size="sm" disabled={pagina >= pagine} onClick={() => setPagina(pagina + 1)} data-testid="button-pagina-successiva">Successiva <ChevronRight className="size-4 ml-1" /></Button>
              </div>
            </div>
          )}
        </>
      )}
      <DialogApriPratica assistito={apriPer} onClose={() => setApriPer(null)} />
    </div>
  );
}
