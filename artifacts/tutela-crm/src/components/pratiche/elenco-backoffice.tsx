import { StatoBadge } from "@/components/pratiche/stato-badge";
import { useState } from "react";
import { useLocation } from "wouter";
import {
  useGetFiltriPraticheBackoffice, useListPraticheBackoffice,
  type ListPraticheBackofficeOrdina, type ListPraticheBackofficeParams,
} from "@workspace/api-client-react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, FileText, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { UtenteChip } from "@/components/utenti/colore-utente";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, FieldError, PageHeader } from "@/components/common";
import { useSession } from "@/lib/auth";
import { fmtDataIstante, parseApiError, ruoloLabel } from "@/lib/format";

const PER_PAGINA = 25;
const TUTTI = "all";
const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const etichettaMese = (m: string) => `${MESI[Number(m.slice(5, 7)) - 1] ?? m} ${m.slice(0, 4)}`;

interface Filtri {
  collaboratore: string; tipo: string; stato: string; gestitaDa: string; mese: string; dal: string; al: string;
  aggiornatePrima: boolean; soloAggiornate: boolean; soloLavorate: boolean;
}
const VUOTI: Filtri = { collaboratore: TUTTI, tipo: TUTTI, stato: TUTTI, gestitaDa: TUTTI, mese: TUTTI, dal: "", al: "", aggiornatePrima: false, soloAggiornate: false, soloLavorate: false };

/** Costruisce i parametri dell'API: i booleani si inviano solo quando sono veri. */
function parametri(f: Filtri, mieId: number | null, ordina: ListPraticheBackofficeOrdina, direzione: "asc" | "desc", pagina: number): ListPraticheBackofficeParams {
  const p: ListPraticheBackofficeParams = { ordina, direzione, pagina, perPagina: PER_PAGINA };
  if (f.collaboratore !== TUTTI) p.collaboratoreId = Number(f.collaboratore);
  if (f.tipo !== TUTTI) p.tipoPraticaId = Number(f.tipo);
  if (f.stato !== TUTTI) p.statoId = Number(f.stato);
  if (mieId !== null) p.gestitaDaUtenteId = mieId;
  else if (f.gestitaDa === "none") p.nonAssegnate = true;
  else if (f.gestitaDa !== TUTTI) p.gestitaDaUtenteId = Number(f.gestitaDa);
  if (f.mese !== TUTTI) p.mese = f.mese;
  if (f.dal) p.dal = f.dal;
  if (f.al) p.al = f.al;
  if (f.aggiornatePrima) p.aggiornatePrima = true;
  if (f.soloAggiornate) p.soloAggiornate = true;
  if (f.soloLavorate && mieId === null) p.soloLavorate = true;
  return p;
}

function Campo({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return <div className="min-w-40 flex-1"><Label htmlFor={id} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</Label><div className="mt-1">{children}</div></div>;
}

function Scelta({ id, valore, onChange, tutti, opzioni, testId }: {
  id: string; valore: string; onChange: (v: string) => void; tutti: string; opzioni: { value: string; label: string }[]; testId: string;
}) {
  return (
    <Select value={valore} onValueChange={onChange}>
      <SelectTrigger id={id} className="bg-card w-full" data-testid={testId}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={TUTTI}>{tutti}</SelectItem>
        {opzioni.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function ElencoPraticheBackoffice({ soloMie }: { soloMie?: boolean }) {
  const [, nav] = useLocation();
  const { session } = useSession();
  const mieId = soloMie ? (session?.id ?? null) : null;
  const filtri = useGetFiltriPraticheBackoffice();
  const [bozza, setBozza] = useState<Filtri>(VUOTI);
  const [applicati, setApplicati] = useState<Filtri>(VUOTI);
  const [ordina, setOrdina] = useState<ListPraticheBackofficeOrdina>("data");
  const [direzione, setDirezione] = useState<"asc" | "desc">("desc");
  const [pagina, setPagina] = useState(1);
  const [errDate, setErrDate] = useState<string | null>(null);

  const lista = useListPraticheBackoffice(parametri(applicati, mieId, ordina, direzione, pagina), { query: { enabled: !soloMie || mieId !== null, queryKey: ["pratiche-backoffice", soloMie ?? false, mieId, applicati, ordina, direzione, pagina] } });
  const f = filtri.data;
  const imposta = (k: keyof Filtri) => (v: string) => setBozza((b) => ({ ...b, [k]: v }));
  const spunta = (k: "aggiornatePrima" | "soloAggiornate" | "soloLavorate") => (v: boolean | "indeterminate") => setBozza((b) => ({ ...b, [k]: v === true }));

  const cerca = () => {
    if (bozza.dal && bozza.al && bozza.dal > bozza.al) return setErrDate("La data iniziale è successiva a quella finale.");
    setErrDate(null); setApplicati(bozza); setPagina(1);
  };
  const azzera = () => { setBozza(VUOTI); setApplicati(VUOTI); setErrDate(null); setPagina(1); };
  const ordinaPer = (c: ListPraticheBackofficeOrdina) => {
    if (c === ordina) setDirezione(direzione === "asc" ? "desc" : "asc");
    else { setOrdina(c); setDirezione(c === "data" || c === "numero" ? "desc" : "asc"); }
    setPagina(1);
  };

  const totale = lista.data?.totale ?? 0;
  const pagine = Math.max(1, Math.ceil(totale / PER_PAGINA));
  const filtrato = JSON.stringify(applicati) !== JSON.stringify(VUOTI);
  const Intestazione = ({ c, label }: { c: ListPraticheBackofficeOrdina; label: string }) => (
    <TableHead className="h-10 whitespace-nowrap" aria-sort={ordina === c ? (direzione === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => ordinaPer(c)} className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider font-semibold hover:text-foreground" data-testid={`ordina-${c}`}>
        {label}
        {ordina === c ? (direzione === "asc" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />) : <ArrowUpDown className="size-3.5 opacity-40" />}
      </button>
    </TableHead>
  );
  const Semplice = ({ label }: { label: string }) => <TableHead className="h-10 text-[11px] uppercase tracking-wider font-semibold whitespace-nowrap">{label}</TableHead>;

  return (
    <div>
      <PageHeader kicker="Back office" title={soloMie ? "Le mie pratiche" : "Elenco pratiche"}
        subtitle={soloMie ? "Le pratiche che hai preso in carico." : "Tutte le pratiche inviate dai collaboratori."} />

      <form className="rounded-lg border border-border bg-card p-4 mb-4 space-y-4 rise" onSubmit={(e) => { e.preventDefault(); cerca(); }} data-testid="filtri-pratiche">
        <div className="flex flex-wrap gap-3">
          <Campo id="f-collaboratore" label="Collaboratore">
            <Scelta id="f-collaboratore" valore={bozza.collaboratore} onChange={imposta("collaboratore")} tutti="Tutti" testId="filtro-collaboratore"
              opzioni={(f?.collaboratori ?? []).map((c) => ({ value: String(c.id), label: `${c.cognome} ${c.nome} · ${c.numeroSportello}` }))} />
          </Campo>
          <Campo id="f-tipo" label="Tipo di pratica">
            <Scelta id="f-tipo" valore={bozza.tipo} onChange={imposta("tipo")} tutti="Tutti" testId="filtro-tipo" opzioni={(f?.tipi ?? []).map((t) => ({ value: String(t.id), label: t.nome }))} />
          </Campo>
          <Campo id="f-stato" label="Stato">
            <Scelta id="f-stato" valore={bozza.stato} onChange={imposta("stato")} tutti="Tutti" testId="filtro-stato" opzioni={(f?.stati ?? []).map((s) => ({ value: String(s.id), label: s.nome }))} />
          </Campo>
          {!soloMie && (
            <Campo id="f-gestita" label="Gestita da">
              <Select value={bozza.gestitaDa} onValueChange={imposta("gestitaDa")}>
                <SelectTrigger id="f-gestita" className="bg-card w-full" data-testid="filtro-gestita-da"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={TUTTI}>Tutti</SelectItem>
                  <SelectItem value="none">Non assegnate</SelectItem>
                  {(f?.operatori ?? []).map((o) => <SelectItem key={o.id} value={String(o.id)}><UtenteChip id={o.id} colore={o.colore}>{o.cognome} {o.nome} ({ruoloLabel(o.ruolo)})</UtenteChip></SelectItem>)}
                </SelectContent>
              </Select>
            </Campo>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <Campo id="f-mese" label="Mese">
            <Scelta id="f-mese" valore={bozza.mese} onChange={imposta("mese")} tutti="Tutti" testId="filtro-mese" opzioni={(f?.mesi ?? []).map((m) => ({ value: m, label: etichettaMese(m) }))} />
          </Campo>
          <Campo id="f-dal" label="Dal"><Input id="f-dal" type="date" value={bozza.dal} onChange={(e) => imposta("dal")(e.target.value)} className="bg-card" data-testid="filtro-dal" /></Campo>
          <Campo id="f-al" label="Al"><Input id="f-al" type="date" value={bozza.al} onChange={(e) => imposta("al")(e.target.value)} className="bg-card" data-testid="filtro-al" /></Campo>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={bozza.aggiornatePrima} onCheckedChange={spunta("aggiornatePrima")} data-testid="check-aggiornate-prima" /> Visualizza prima le pratiche aggiornate</label>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={bozza.soloAggiornate} onCheckedChange={spunta("soloAggiornate")} data-testid="check-solo-aggiornate" /> Visualizza solo le pratiche aggiornate</label>
          {!soloMie && <label className="flex items-center gap-2 text-sm"><Checkbox checked={bozza.soloLavorate} onCheckedChange={spunta("soloLavorate")} data-testid="check-solo-lavorate" /> Solo pratiche lavorate</label>}
        </div>
        <FieldError id="errore-date">{errDate ?? undefined}</FieldError>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <Button type="submit" data-testid="button-cerca"><Search className="size-4 mr-2" /> Cerca</Button>
            {filtrato || JSON.stringify(bozza) !== JSON.stringify(VUOTI) ? <Button type="button" variant="ghost" onClick={azzera} data-testid="button-azzera-filtri">Azzera</Button> : null}
          </div>
          <div className="text-sm" data-testid="text-pratiche-trovate">Pratiche trovate: <strong className="tabular-nums">{lista.data ? totale : "…"}</strong></div>
        </div>
      </form>

      {lista.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>
      ) : lista.isError ? (
        <ErrorState message={parseApiError(lista.error).message} onRetry={() => lista.refetch()} />
      ) : !lista.data?.elementi.length ? (
        <EmptyState icon={<FileText className="size-6" />} title={filtrato ? "Nessuna pratica corrisponde ai filtri" : soloMie ? "Non hai ancora preso in carico nessuna pratica" : "Nessuna pratica inviata"}
          text={filtrato ? "Cambia i filtri e cerca di nuovo." : soloMie ? "Apri una pratica dall'elenco e premi \"Prendi in carico\"." : "Le pratiche compariranno qui quando i collaboratori le invieranno."}
          action={filtrato ? <Button variant="outline" onClick={azzera}>Azzera filtri</Button> : undefined} />
      ) : (
        <>
          <div className="rounded-lg border border-border bg-card overflow-x-auto rise">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <Semplice label="Assistito" />
                  <Intestazione c="numero" label="Numero" />
                  <Semplice label="Collaboratore" />
                  <Intestazione c="citta" label="Città" />
                  <Intestazione c="data" label="Richiesta pratica" />
                  <Intestazione c="stato" label="Stato" />
                  <Intestazione c="tipo" label="Tipo" />
                  <Semplice label="Gestita da" />
                  <TableHead className="h-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.data.elementi.map((p) => (
                  <TableRow key={p.id} className={`transition-colors hover:bg-secondary/50 ${p.aggiornata ? "bg-accent/10" : ""}`} data-testid={`row-pratica-${p.id}`}>
                    <TableCell className="font-semibold whitespace-nowrap">
                      {p.assistito.cognome} {p.assistito.nome}
                      {p.aggiornata && <Badge className="ml-2 bg-primary text-primary-foreground" data-testid={`badge-aggiornata-${p.id}`}>Aggiornata</Badge>}
                    </TableCell>
                    <TableCell className="font-mono text-sm font-semibold">{p.numero}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{p.collaboratore.cognome} {p.collaboratore.nome}</TableCell>
                    <TableCell className="text-sm">{p.citta}</TableCell>
                    <TableCell className="text-sm tabular-nums whitespace-nowrap">{fmtDataIstante(p.dataRichiesta)}</TableCell>
                    <TableCell><StatoBadge stato={p.stato} /></TableCell>
                    <TableCell className="text-sm">{p.tipo.nome}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{p.gestitaDa ? <UtenteChip id={p.gestitaDa.id} colore={p.gestitaDa.colore}>{p.gestitaDa.cognome} {p.gestitaDa.nome}</UtenteChip> : <span className="text-muted-foreground">Non assegnata</span>}</TableCell>
                    <TableCell><Button size="sm" className="bg-green-700 hover:bg-green-800 text-white" onClick={() => nav(`/admin/pratiche/${p.id}`)} data-testid={`button-apri-${p.id}`}>Apri</Button></TableCell>
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
