import type { ReactNode } from "react";
import { Link } from "wouter";
import { getGetDashboardOperatoreQueryKey, useGetDashboardOperatore, type PraticaDaVedere } from "@workspace/api-client-react";
import { AlarmClock, ArrowRight, CircleCheck, Inbox, MessageSquareReply, UserCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, PageHeader } from "@/components/common";
import { cn } from "@/lib/utils";
import { fmtIstante, parseApiError } from "@/lib/format";
import { useSession } from "@/lib/auth";

function Contatore({ href, icona, titolo, valore, nota, attenzione, testId }: { href: string; icona: ReactNode; titolo: string; valore: number; nota: string; attenzione?: boolean; testId: string }) {
  return (
    <Link href={href} data-testid={testId}
      className={cn("group rounded-lg border bg-card p-4 transition-colors hover:border-primary/60 hover:bg-secondary/40 flex flex-col gap-2", attenzione && valore > 0 ? "border-accent" : "border-border")}>
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-[11px] font-semibold uppercase tracking-wider">{titolo}</span>
        {icona}
      </div>
      <div className="text-4xl font-bold leading-none" data-testid={`${testId}-valore`}>{valore}</div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{nota}</span>
        <ArrowRight className="size-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </Link>
  );
}

function Elenco({ titolo, vuoto, href, voci, testId }: { titolo: string; vuoto: string; href: string; voci: { id: number; chiave: string; numero: number; assistito: string; dettaglio: string }[]; testId: string }) {
  return (
    <section className="rounded-lg border border-border bg-card" data-testid={testId}>
      <header className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-bold">{titolo}</h2>
        <Link href={href} className="text-xs text-primary hover:underline">Vedi tutte</Link>
      </header>
      {voci.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground flex items-center gap-2"><CircleCheck className="size-4" /> {vuoto}</p> : (
        <ul className="divide-y divide-border">
          {voci.map((v) => (
            <li key={v.chiave}>
              <Link href={`/admin/pratiche/${v.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 hover:bg-secondary/50 transition-colors" data-testid={`${testId}-${v.id}`}>
                <span className="text-sm"><span className="font-mono text-xs text-muted-foreground mr-2">n. {v.numero}</span><span className="font-medium">{v.assistito}</span></span>
                <span className="text-xs text-muted-foreground">{v.dettaglio}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const daVedere = (p: PraticaDaVedere, prefisso: string) => ({ id: p.id, chiave: `${prefisso}-${p.id}`, numero: p.numero, assistito: p.assistito, dettaglio: `${p.tipoNome} · ${fmtIstante(p.data)}` });

export default function DashboardPage() {
  const { session } = useSession();
  const q = useGetDashboardOperatore({ query: { queryKey: getGetDashboardOperatoreQueryKey(), refetchInterval: 30000 } });
  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-10 w-72" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div></div>;
  if (q.isError || !q.data) return <ErrorState message={q.error ? parseApiError(q.error).message : "Impossibile caricare la dashboard."} onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <div>
      <PageHeader kicker="Il tuo lavoro" title={`Ciao ${session?.nome ?? ""}`.trim()} subtitle="Cosa c'è da fare adesso. Clicca su un numero per aprire l'elenco." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 mb-6 rise">
        <Contatore testId="contatore-in-carico" href="/admin/le-mie-pratiche" icona={<UserCheck className="size-4" />} titolo="Pratiche in carico" valore={d.inCarico} nota="Le tue pratiche aperte" />
        <Contatore testId="contatore-nuove" href="/admin/pratiche?gestitaDa=none" icona={<Inbox className="size-4" />} titolo="Nuove da prendere" valore={d.nuove} nota="Nessuno le ha ancora in carico" attenzione />
        <Contatore testId="contatore-commenti" href="/admin/le-mie-pratiche" icona={<MessageSquareReply className="size-4" />} titolo="Commenti senza risposta" valore={d.commentiSenzaRisposta} nota="Il collaboratore ha scritto per ultimo" attenzione />
        <Contatore testId="contatore-scadenze" href="/admin/le-mie-pratiche" icona={<AlarmClock className="size-4" />} titolo="Scadenze vicine" valore={d.scadenze} nota="In scadenza o già scadute" attenzione />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 rise">
        <Elenco testId="elenco-nuove" titolo="Pratiche nuove, le più vecchie per prime" vuoto="Nessuna pratica da prendere in carico." href="/admin/pratiche?gestitaDa=none" voci={d.nuoveElenco.map((p) => daVedere(p, "n"))} />
        <Elenco testId="elenco-commenti" titolo="Commenti in attesa di risposta" vuoto="Hai risposto a tutti i commenti." href="/admin/le-mie-pratiche" voci={d.commentiElenco.map((p) => daVedere(p, "c"))} />
        <Elenco testId="elenco-scadenze" titolo="Scadenze vicine" vuoto="Nessuna scadenza vicina." href="/admin/le-mie-pratiche"
          voci={d.scadenzeElenco.map((s) => ({ id: s.id, chiave: `s-${s.id}`, numero: s.numero, assistito: s.assistito, dettaglio: `${s.stato === "superata" ? "Scaduta" : "Scade"} il ${fmtIstante(s.scadenzaIl)}` }))} />
      </div>
    </div>
  );
}
