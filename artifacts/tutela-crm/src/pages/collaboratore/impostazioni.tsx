import type { ReactNode } from "react";
import { getGetCollaboratoreQueryKey, useGetCollaboratore } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ErrorState, PageHeader } from "@/components/common";
import CambiaPasswordPage from "@/pages/cambia-password";
import { useSession } from "@/lib/auth";
import { fmtCellulare, fmtData, parseApiError, tipologiaLabel } from "@/lib/format";

function Dato({ k, children, mono }: { k: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{k}</dt>
      <dd className={`mt-0.5 text-sm font-medium break-words ${mono ? "font-mono" : ""}`}>{children}</dd>
    </div>
  );
}

/** Dati del collaboratore (sola lettura) e cambio password: l'unica cosa che può modificare da solo. */
export default function ImpostazioniCollaboratore() {
  const { session } = useSession();
  const idCollaboratore = session?.collaboratore?.id ?? 0;
  const q = useGetCollaboratore(idCollaboratore, { query: { enabled: idCollaboratore > 0, queryKey: getGetCollaboratoreQueryKey(idCollaboratore) } });

  if (q.isLoading || !session) return <div className="space-y-3"><Skeleton className="h-10 w-72" /><Skeleton className="h-64 w-full" /></div>;
  if (q.isError || !q.data) return <ErrorState message={q.error ? parseApiError(q.error).message : "Dati non disponibili."} onRetry={() => q.refetch()} />;
  const c = q.data;
  return (
    <div>
      <PageHeader title="Impostazioni" subtitle="I tuoi dati. Per modificarli, rivolgiti all'ufficio: da qui puoi cambiare solo la password." />
      <div className="space-y-5">
        <section className="bg-card border border-border rounded-lg p-5 rise" data-testid="sezione-dati">
          <h2 className="text-lg font-bold mb-4 pb-2 border-b border-border">Dati anagrafici</h2>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Dato k="Cognome">{c.cognome}</Dato>
            <Dato k="Nome">{c.nome}</Dato>
            <Dato k="Sesso">{c.sesso === "M" ? "Maschio" : "Femmina"}</Dato>
            <Dato k="Data di nascita">{fmtData(c.dataNascita)}</Dato>
            <Dato k="Luogo di nascita">{c.luogoNascitaNome}{c.luogoNascitaProvincia ? ` (${c.luogoNascitaProvincia})` : c.luogoNascitaEstero ? " · Stato estero" : ""}</Dato>
            <Dato k="Nazionalità">{c.nazionalitaNome}</Dato>
            <Dato k="Codice fiscale" mono>{c.codiceFiscale}</Dato>
            <Dato k="Partita IVA" mono>{c.partitaIva ?? "—"}</Dato>
            <Dato k="Email (username di accesso)">{c.email}</Dato>
            <Dato k="Cellulare" mono>{fmtCellulare(c.cellulare)}</Dato>
            <Dato k="Telefono" mono>{c.telefono ?? "—"}</Dato>
          </dl>
        </section>
        <section className="bg-card border border-border rounded-lg p-5 rise" data-testid="sezione-incarico">
          <h2 className="text-lg font-bold mb-4 pb-2 border-b border-border">Incarico</h2>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Dato k="Numero di sportello" mono>{c.numeroSportello}</Dato>
            <Dato k="Tipologia"><Badge variant="outline">{tipologiaLabel(c.tipologia)}</Badge></Dato>
            <Dato k="Capogruppo">{c.capogruppoId ? c.capogruppoNome : "Nessuno"}</Dato>
          </dl>
        </section>
        <div className="max-w-lg"><CambiaPasswordPage incorporata /></div>
      </div>
    </div>
  );
}
