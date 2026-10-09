import { useLocation } from "wouter";
import { useListEventi } from "@workspace/api-client-react";
import { CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { fmtData, fmtOrarioEvento, parseApiError } from "@/lib/format";

export default function EventiCollaboratore() {
  const [, nav] = useLocation();
  const lista = useListEventi();
  return (
    <div>
      <PageHeader title="Eventi e corsi" subtitle="Gli eventi a cui la tua sede è invitata." />
      {lista.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : lista.isError ? (
        <ErrorState message={parseApiError(lista.error).message} onRetry={() => lista.refetch()} />
      ) : !lista.data?.length ? (
        <EmptyState icon={<CalendarDays className="size-6" />} title="Nessun evento" text="Quando la tua sede verrà invitata a un evento, lo troverai qui." />
      ) : (
        <ul className="space-y-3 rise">
          {lista.data.map((r) => (
            <li key={r.evento.id}>
              <button onClick={() => nav(`/collaboratore/eventi/${r.evento.id}`)} data-testid={`card-evento-${r.evento.id}`}
                className="w-full text-left rounded-lg border border-border bg-card p-4 hover:bg-secondary/50 transition-colors">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-lg leading-tight">{r.evento.titolo}</div>
                    <div className="text-sm text-muted-foreground mt-1">{fmtData(r.evento.data)} · {fmtOrarioEvento(r.evento.oraInizio, r.evento.oraFine)} · {r.evento.luogo}</div>
                  </div>
                  <div className="flex gap-2">
                    {r.evento.passato && <Badge variant="outline">Concluso</Badge>}
                    {r.confermatoIl ? <Badge className="bg-primary text-primary-foreground">Confermato · {r.partecipanti} {r.partecipanti === 1 ? "partecipante" : "partecipanti"}</Badge> : <Badge className="bg-accent text-accent-foreground">Da confermare</Badge>}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
