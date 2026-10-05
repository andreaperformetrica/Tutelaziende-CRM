import { getGetCollaboratoreQueryKey, useGetCollaboratore } from "@workspace/api-client-react";
import { Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/common";
import { useSession } from "@/lib/auth";
import { parseApiError, tipologiaLabel } from "@/lib/format";

export default function HomeCollaboratore() {
  const { session } = useSession();
  const col = session?.collaboratore;
  const capogruppo = !!col?.capogruppo;
  const q = useGetCollaboratore(col?.id ?? 0, { query: { enabled: !!col && capogruppo, queryKey: getGetCollaboratoreQueryKey(col?.id ?? 0) } });
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
