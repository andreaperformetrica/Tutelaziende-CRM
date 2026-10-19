import { useEffect, useState } from "react";
import { Link } from "wouter";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import {
  getGetImpostazioniNotificheQueryKey, getGetStatoNotificheQueryKey, getListNotificheQueryKey, useGetImpostazioniNotifiche, useGetStatoNotifiche, useListNotifiche, useUpdateImpostazioniNotifiche,
  type ListNotificheParams, type Notifica,
} from "@workspace/api-client-react";
import { Bell, ChevronLeft, Link2, Loader2, ChevronRight, Eye, Info, Mail, MessageCircle, Phone, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { fmtCellulare, fmtIstante, parseApiError } from "@/lib/format";

const PER_PAGINA = 50;

function Canale({ c }: { c: Notifica["canale"] }) {
  if (c === "email") return <span className="inline-flex items-center gap-1.5 text-sm"><Mail className="size-4" /> Email</span>;
  if (c === "chiamata") return <span className="inline-flex items-center gap-1.5 text-sm"><Phone className="size-4" /> Chiamata</span>;
  return <span className="inline-flex items-center gap-1.5 text-sm"><MessageCircle className="size-4" /> WhatsApp</span>;
}

function Esito({ n }: { n: Notifica }) {
  const stile = n.esito === "inviata" ? "bg-green-700 text-white hover:bg-green-700"
    : n.esito === "errore" ? "bg-destructive text-destructive-foreground hover:bg-destructive" : "";
  return (
    <div>
      <Badge variant={n.esito === "inviata" || n.esito === "errore" ? "default" : "outline"} className={stile} data-testid={`esito-notifica-${n.id}`}>{n.esitoEtichetta}</Badge>
      {n.dettaglioEsito && <p className="text-xs text-muted-foreground mt-1 max-w-64">{n.dettaglioEsito}</p>}
    </div>
  );
}

const ORIGINE: Record<string, string> = {
  impostazioni: "scritto qui",
  segreto: "dal segreto URL_PIATTAFORMA",
  dominio: "dominio dell'app pubblicata, ricavato in automatico",
  nessuna: "nessun indirizzo pubblico disponibile: nei messaggi comparirà solo il percorso della pagina",
};

/** Indirizzo dell'app usato nei link delle email: se non è scritto qui, si usa quello dell'app pubblicata. */
function IndirizzoApp() {
  const qc = useQueryClient();
  const q = useGetImpostazioniNotifiche({ query: { queryKey: getGetImpostazioniNotificheQueryKey() } });
  const salva = useUpdateImpostazioniNotifiche();
  const [valore, setValore] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [salvato, setSalvato] = useState(false);
  useEffect(() => { if (q.data) setValore(q.data.urlPiattaforma ?? ""); }, [q.data]);
  const invia = () => {
    setErrore(null); setSalvato(false);
    salva.mutate({ data: { urlPiattaforma: valore.trim() || null } }, {
      onSuccess: (n) => { qc.setQueryData(getGetImpostazioniNotificheQueryKey(), n); setSalvato(true); },
      onError: (e) => setErrore(parseApiError(e).message),
    });
  };
  return (
    <div className="rounded-lg border border-border bg-card p-4 mb-4 rise" data-testid="box-indirizzo-app">
      <div className="flex items-center gap-2 font-bold text-sm mb-1"><Link2 className="size-4" /> Indirizzo dell'app nei link delle email</div>
      <p className="text-xs text-muted-foreground mb-3">Tutti i link nelle email e nei messaggi partono da questo indirizzo. Lascia vuoto per usare quello dell'app pubblicata.</p>
      <div className="flex flex-wrap items-start gap-2">
        <Input value={valore} onChange={(e) => { setValore(e.target.value); setSalvato(false); }} placeholder="https://gestionale.tuodominio.it" className="max-w-md bg-card" aria-label="Indirizzo dell'app" data-testid="input-url-piattaforma" />
        <Button onClick={invia} disabled={salva.isPending} data-testid="button-salva-url">{salva.isPending && <Loader2 className="size-4 mr-2 animate-spin" />} Salva</Button>
      </div>
      {errore && <p role="alert" className="text-sm text-destructive font-medium mt-2" data-testid="errore-url">{errore}</p>}
      {salvato && <p className="text-sm text-green-700 font-medium mt-2" data-testid="conferma-url">Indirizzo salvato.</p>}
      {q.data && <p className="text-xs text-muted-foreground mt-2" data-testid="url-effettivo">In uso adesso: <span className="font-mono">{q.data.urlEffettivo ?? "—"}</span> ({ORIGINE[q.data.origine]})</p>}
    </div>
  );
}

export default function NotifichePage() {
  const [canale, setCanale] = useState("all");
  const [esito, setEsito] = useState("all");
  const [evento, setEvento] = useState("all");
  const [da, setDa] = useState("");
  const [a, setA] = useState("");
  const [pagina, setPagina] = useState(1);
  const [aperta, setAperta] = useState<Notifica | null>(null);
  const stato = useGetStatoNotifiche({ query: { queryKey: getGetStatoNotificheQueryKey() } });
  const params: ListNotificheParams = {
    pagina, perPagina: PER_PAGINA,
    ...(canale !== "all" ? { canale: canale as Notifica["canale"] } : {}),
    ...(esito !== "all" ? { esito: esito as Notifica["esito"] } : {}),
    ...(evento !== "all" ? { evento } : {}),
    ...(da ? { da } : {}), ...(a ? { a } : {}),
  };
  const q = useListNotifiche(params, { query: { queryKey: getListNotificheQueryKey(params), placeholderData: keepPreviousData, refetchInterval: 15000 } });
  const filtrato = canale !== "all" || esito !== "all" || evento !== "all" || !!da || !!a;
  const tot = q.data?.totale ?? 0;
  const pagine = Math.max(1, Math.ceil(tot / PER_PAGINA));
  const cambia = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPagina(1); };
  const inattivi = stato.data ? ([["email", "Email", stato.data.email], ["whatsapp", "WhatsApp", stato.data.whatsapp], ["chiamata", "Chiamata", stato.data.chiamata]] as const).filter(([, , s]) => !s.attivo) : [];

  return (
    <div>
      <PageHeader kicker="Amministrazione" title="Registro notifiche" subtitle={q.data ? `${tot.toLocaleString("it-IT")} notifiche registrate, dalla più recente` : undefined} />
      <IndirizzoApp />
      {inattivi.length > 0 && (
        <div className="flex gap-3 rounded-lg border border-amber-500/50 bg-amber-50 text-amber-950 p-4 text-sm mb-4 rise" data-testid="avviso-chiavi-mancanti">
          <Info className="size-5 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <strong className="block">Prova senza invio reale</strong>
            {inattivi.map(([id, nome, s]) => (
              <p key={id} data-testid={`stato-canale-${id}`}>{nome}: i messaggi vengono registrati qui ma non partono. Mancano nei Secrets: <span className="font-mono text-xs">{s.mancanti.join(", ")}</span>.</p>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3 mb-4 rise">
        <div className="space-y-1"><Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Canale</Label>
          <Select value={canale} onValueChange={cambia(setCanale)}>
            <SelectTrigger className="w-40 bg-card" data-testid="filtro-canale"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Tutti i canali</SelectItem><SelectItem value="email">Email</SelectItem><SelectItem value="whatsapp">WhatsApp</SelectItem><SelectItem value="chiamata">Chiamata</SelectItem></SelectContent>
          </Select></div>
        <div className="space-y-1"><Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Esito</Label>
          <Select value={esito} onValueChange={cambia(setEsito)}>
            <SelectTrigger className="w-56 bg-card" data-testid="filtro-esito"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Tutti gli esiti</SelectItem>{stato.data?.esiti.map((x) => <SelectItem key={x.codice} value={x.codice}>{x.etichetta}</SelectItem>)}</SelectContent>
          </Select></div>
        <div className="space-y-1"><Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Evento</Label>
          <Select value={evento} onValueChange={cambia(setEvento)}>
            <SelectTrigger className="w-72 bg-card" data-testid="filtro-evento"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Tutti gli eventi</SelectItem>{stato.data?.eventi.map((x) => <SelectItem key={x.codice} value={x.codice}>{x.etichetta}</SelectItem>)}</SelectContent>
          </Select></div>
        <div className="space-y-1"><Label htmlFor="da" className="text-[11px] uppercase tracking-wider text-muted-foreground">Dal</Label><Input id="da" autoComplete="off" type="date" value={da} max={a || undefined} onChange={(e) => cambia(setDa)(e.target.value)} className="w-40 bg-card" data-testid="filtro-da" /></div>
        <div className="space-y-1"><Label htmlFor="a" className="text-[11px] uppercase tracking-wider text-muted-foreground">Al</Label><Input id="a" autoComplete="off" type="date" value={a} min={da || undefined} onChange={(e) => cambia(setA)(e.target.value)} className="w-40 bg-card" data-testid="filtro-a" /></div>
        {filtrato && <Button variant="ghost" onClick={() => { setCanale("all"); setEsito("all"); setEvento("all"); setDa(""); setA(""); setPagina(1); }} data-testid="button-reset-notifiche"><X className="size-4 mr-1" /> Azzera</Button>}
      </div>
      {q.isLoading ? <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        : q.isError ? <ErrorState message={parseApiError(q.error).message} onRetry={() => q.refetch()} />
        : !q.data?.righe.length ? <EmptyState icon={<Bell className="size-6" />} title={filtrato ? "Nessuna notifica per questi filtri" : "Il registro è ancora vuoto"} text={filtrato ? "Modifica i filtri o il periodo." : "Le notifiche compariranno qui quando una pratica viene inviata o commentata."} />
        : (<>
          <div className={`rounded-lg border border-border bg-card overflow-x-auto transition-opacity ${q.isPlaceholderData ? "opacity-60" : ""}`}>
            <Table className="tabella-schede">
              <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60">
                {["Data e ora", "Destinatario", "Canale", "Evento", "Pratica", "Esito", ""].map((h, i) => <TableHead key={i} className="text-[11px] uppercase tracking-wider font-semibold h-10 whitespace-nowrap">{h}</TableHead>)}
              </TableRow></TableHeader>
              <TableBody>
                {q.data.righe.map((n) => (
                  <TableRow key={n.id} className="hover:bg-secondary/50 transition-colors align-top" data-testid={`row-notifica-${n.id}`}>
                    <TableCell data-label="Data e ora" className="font-mono text-xs whitespace-nowrap">{fmtIstante(n.elaboratoIl ?? n.creatoIl, true)}</TableCell>
                    <TableCell data-label="Destinatario" className="text-sm">
                      <div className="font-medium">{n.destinatarioNome}</div>
                      <div className="text-xs text-muted-foreground break-all">{n.canale !== "email" && n.destinatarioContatto !== "—" ? fmtCellulare(n.destinatarioContatto) : n.destinatarioContatto}</div>
                    </TableCell>
                    <TableCell data-label="Canale"><Canale c={n.canale} /></TableCell>
                    <TableCell data-label="Evento" className="text-sm min-w-48">{n.eventoEtichetta}</TableCell>
                    <TableCell data-label="Pratica" className="text-sm whitespace-nowrap">{n.praticaId && n.numeroPratica ? <Link href={`/admin/pratiche/${n.praticaId}`} className="text-primary hover:underline">n. {n.numeroPratica}</Link> : "—"}</TableCell>
                    <TableCell data-label="Esito"><Esito n={n} /></TableCell>
                    <TableCell><Button variant="ghost" size="sm" onClick={() => setAperta(n)} data-testid={`button-messaggio-${n.id}`}><Eye className="size-4 mr-1.5" /> Messaggio</Button></TableCell>
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
      <Dialog open={!!aperta} onOpenChange={(o) => { if (!o) setAperta(null); }}>
        <DialogContent data-testid="dialog-messaggio-notifica">
          <DialogHeader>
            <DialogTitle>{aperta?.canale === "email" ? "Email" : aperta?.canale === "chiamata" ? "Chiamata automatica" : "Messaggio WhatsApp"}</DialogTitle>
            <DialogDescription>{aperta ? `A ${aperta.destinatarioNome} · ${aperta.eventoEtichetta}` : ""}</DialogDescription>
          </DialogHeader>
          {aperta && (
            <div className="space-y-3 text-sm">
              {aperta.oggetto && <div><div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Oggetto</div><div className="font-medium">{aperta.oggetto}</div></div>}
              <div><div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{aperta.canale === "whatsapp" ? "Testo del template" : aperta.canale === "chiamata" ? "Testo letto al telefono" : "Testo"}</div><p className="whitespace-pre-wrap break-words rounded-md bg-secondary/60 p-3" data-testid="testo-notifica">{aperta.testo}</p></div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
