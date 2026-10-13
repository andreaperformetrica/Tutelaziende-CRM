import { getGetCollaboratoreQueryKey, useGetCollaboratore, useListNews } from "@workspace/api-client-react";
import { Download, Newspaper, Pin, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/common";
import { useSession } from "@/lib/auth";
import { fmtIstante, parseApiError, tipologiaLabel } from "@/lib/format";
import { formatoDimensione, urlAllegatoNews } from "@/lib/upload";

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
