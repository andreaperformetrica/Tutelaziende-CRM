import { Link } from "wouter";
import { getGetCollaboratoreQueryKey, useGetAvvisi, useGetCollaboratore, useListNews, type AvvisoPratica, type Promemoria as PromemoriaDati } from "@workspace/api-client-react";
import { Bell, CalendarCheck, CalendarClock, CalendarDays, ChevronRight, ClipboardList, Download, FilePen, FileText, Newspaper, Pin, PauseCircle, Users, Users2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/common";
import { useSession } from "@/lib/auth";
import { fmtData, fmtIstante, fmtOrarioEvento, parseApiError, tipologiaLabel } from "@/lib/format";
import { formatoDimensione, urlAllegatoNews } from "@/lib/upload";

function testoAggiornamento(a: AvvisoPratica): string {
  switch (a.aggiornamento) {
    case "stato": return `Nuovo stato: ${a.stato ?? "aggiornato"}`;
    case "messaggio": return "Nuovo messaggio dall'ufficio";
    case "allegato": return "Nuovo allegato dall'ufficio";
    case "presa_in_carico": return "Pratica presa in carico";
    default: return "Pratica aggiornata";
  }
}

const ICONE_PROMEMORIA: Record<PromemoriaDati["tipo"], typeof CalendarCheck> = {
  evento: CalendarCheck, partecipanti: Users2, questionario: ClipboardList, bozza: FilePen, invio_sospeso: PauseCircle,
};

function Promemoria() {
  const q = useGetAvvisi();
  const elementi = q.data?.promemoria ?? [];
  if (!elementi.length) return null;
  return (
    <section className="rounded-xl border border-border bg-card p-5 rise" aria-labelledby="titolo-promemoria" data-testid="sezione-promemoria">
      <h2 id="titolo-promemoria" className="flex items-center gap-2 text-xl font-bold mb-3"><CalendarClock className="size-5" /> Promemoria</h2>
      <ul className="space-y-2">
        {elementi.map((p) => {
          const Icona = ICONE_PROMEMORIA[p.tipo];
          return (
            <li key={p.chiave}>
              <Link href={p.link} data-testid={`promemoria-${p.chiave}`}
                className={cn("flex items-center gap-3 rounded-lg border bg-background px-3 py-2.5 min-h-12 hover:bg-secondary/60 transition-colors", p.urgente ? "border-accent border-2" : "border-border")}>
                <Icona className="size-5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{p.titolo}</span>
                  <span className="block text-xs text-muted-foreground">{p.dettaglio}</span>
                </span>
                {p.urgente && <Badge className="bg-accent text-accent-foreground shrink-0">Urgente</Badge>}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Novita() {
  const q = useGetAvvisi();
  const eventi = q.data?.eventi ?? [];
  const pratiche = q.data?.pratiche ?? [];
  if (!eventi.length && !pratiche.length) return null;
  const riga = "flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 min-h-12 hover:bg-secondary/60 transition-colors";
  return (
    <section className="rounded-xl border-2 border-accent bg-card p-5 rise" aria-labelledby="titolo-novita" data-testid="sezione-novita">
      <h2 id="titolo-novita" className="flex items-center gap-2 text-xl font-bold mb-3"><Bell className="size-5" /> Novità per te</h2>
      <ul className="space-y-2">
        {eventi.map((e) => (
          <li key={`e${e.eventoId}`}>
            <Link href={`/collaboratore/eventi/${e.eventoId}`} className={riga} data-testid={`avviso-evento-${e.eventoId}`}>
              <CalendarDays className="size-5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold truncate">Invito all&apos;evento: {e.titolo}</span>
                <span className="block text-xs text-muted-foreground">{fmtData(e.data)} · {fmtOrarioEvento(e.oraInizio)} · {e.luogo} · da confermare</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
        {pratiche.map((p) => (
          <li key={`p${p.praticaId}`}>
            <Link href={`/collaboratore/pratiche/${p.praticaId}`} className={riga} data-testid={`avviso-pratica-${p.praticaId}`}>
              <FileText className="size-5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold truncate">{testoAggiornamento(p)}</span>
                <span className="block text-xs text-muted-foreground truncate">Pratica {p.numero ? `n. ${p.numero} · ` : ""}{p.tipo} · {p.assistito} · {fmtIstante(p.quando)}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function HomeCollaboratore() {
  const { session } = useSession();
  const col = session?.collaboratore;
  const capogruppo = !!col?.capogruppo;
  const q = useGetCollaboratore(col?.id ?? 0, { query: { enabled: !!col && capogruppo, queryKey: getGetCollaboratoreQueryKey(col?.id ?? 0) } });
  const news = useListNews();
  if (!session) return null;
  return (
    <div className="space-y-6">
      <div className="rise">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Web Collaboratore</div>
        <h1 className="text-4xl font-bold mt-1" data-testid="text-saluto">Buongiorno, {session.nome}</h1>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 rise">
        <div className="rounded-xl bg-card border-2 border-primary p-5 shadow-[6px_6px_0_hsl(var(--accent))]">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Il tuo sportello</div>
          <div className="font-mono text-5xl font-medium mt-1" data-testid="text-sportello">{col?.numeroSportello ?? "—"}</div>
        </div>
        <div className="rounded-xl bg-card border border-border p-5">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Tipologia</div>
          <div className="text-3xl font-serif font-bold mt-2" data-testid="text-tipologia">{tipologiaLabel(col?.tipologia)}</div>
          {capogruppo && <Badge className="mt-3 bg-accent text-accent-foreground">Capogruppo</Badge>}
        </div>
      </div>
      <Promemoria />
      <Novita />
      <section className="rounded-xl border border-border bg-card p-5 rise" aria-labelledby="titolo-news" data-testid="sezione-news">
        <h2 id="titolo-news" className="flex items-center gap-2 text-xl font-bold mb-3"><Newspaper className="size-5" /> News</h2>
        {news.isLoading ? <Skeleton className="h-24" /> : news.isError ? <ErrorState message={parseApiError(news.error).message} onRetry={() => news.refetch()} />
          : !news.data?.length ? <p className="text-sm text-muted-foreground" data-testid="news-vuote">Non ci sono notizie al momento.</p>
          : (
            <ul className="divide-y divide-border">
              {news.data.map((n) => (
                <li key={n.id} className="py-3 first:pt-0 last:pb-0" data-testid={`news-${n.id}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold leading-tight">{n.titolo}</h3>
                    {n.inEvidenza && <Badge className="bg-accent text-accent-foreground gap-1"><Pin className="size-3" /> In evidenza</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{fmtIstante(n.pubblicataIl).slice(0, 10)}</div>
                  <p className="text-sm mt-2 whitespace-pre-line">{n.testo}</p>
                  {n.allegati.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-2" aria-label="Documenti da scaricare">
                      {n.allegati.map((a) => (
                        <li key={a.id}>
                          <a href={urlAllegatoNews(n.id, a.id)} download data-testid={`allegato-news-${a.id}`}
                            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 min-h-10 text-sm font-medium hover:bg-secondary/60 transition-colors">
                            <Download className="size-4 shrink-0 text-primary" />
                            <span className="max-w-[16rem] truncate">{a.nome}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">{formatoDimensione(a.dimensione)}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
      </section>
      {capogruppo && (
        <section className="rounded-xl border-2 border-accent bg-card p-5 rise" data-testid="sezione-gruppo">
          <h2 className="flex items-center gap-2 text-xl font-bold mb-3"><Users className="size-5" /> Il tuo gruppo</h2>
          {q.isLoading ? <Skeleton className="h-24" /> : q.isError ? <ErrorState message={parseApiError(q.error).message} onRetry={() => q.refetch()} />
            : !q.data?.membri.length ? <p className="text-sm text-muted-foreground">Nessun collaboratore nel tuo gruppo.</p>
            : (
              <ul className="divide-y divide-border">
                {q.data.membri.map((m) => (
                  <li key={m.id} className="flex items-center justify-between py-2.5" data-testid={`membro-${m.id}`}>
                    <span className="font-semibold text-sm">{m.cognome} {m.nome}</span>
                    <span className="flex items-center gap-3 text-xs text-muted-foreground"><span className="font-mono">Sportello {m.numeroSportello}</span>{tipologiaLabel(m.tipologia)}{!m.attivo && <Badge variant="outline">Disattivato</Badge>}</span>
                  </li>
                ))}
              </ul>
            )}
        </section>
      )}
    </div>
  );
}
