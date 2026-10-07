import { useState, type ReactNode } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAssistitoQueryKey, getListAssistitiQueryKey, useAssociaAssistitoACollaboratore, useGetAssistito,
} from "@workspace/api-client-react";
import { ArrowLeft, FilePlus2, Pencil, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BannerStraniero } from "@/components/anagrafica/anagrafica-fields";
import { AssistitoForm } from "@/components/assistiti/assistito-form";
import { DialogCollaboratore } from "@/components/assistiti/dialog-collaboratore";
import { DialogApriPratica } from "@/components/pratiche/dialog-apri-pratica";
import { ErrorState, PageHeader } from "@/components/common";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/lib/auth";
import { fmtCellulare, fmtData, fmtIstante, parseApiError, tipologiaLabel } from "@/lib/format";

function Dato({ k, children, mono }: { k: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{k}</dt>
      <dd className={`mt-0.5 text-sm font-medium break-words ${mono ? "font-mono" : ""}`}>{children}</dd>
    </div>
  );
}

/** Scheda di un assistito: modificabile solo dal collaboratore proprietario; il back office puo cambiare collaboratore. */
export function AssistitoScheda({ base, etichettaIndietro }: { base: string; etichettaIndietro: string }) {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { session } = useSession();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [modifica, setModifica] = useState(false);
  const [cambio, setCambio] = useState(false);
  const [apriPratica, setApriPratica] = useState(false);
  const [errCambio, setErrCambio] = useState<string | null>(null);
  const q = useGetAssistito(id, { query: { enabled: Number.isInteger(id) && id > 0, queryKey: getGetAssistitoQueryKey(id) } });
  const associa = useAssociaAssistitoACollaboratore();
  const puoCambiare = session?.ruolo === "super_admin" || session?.ruolo === "admin";

  if (!Number.isInteger(id) || id <= 0) return <ErrorState message="Assistito non trovato." />;
  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-10 w-72" /><Skeleton className="h-64 w-full" /></div>;
  if (q.isError || !q.data) return <ErrorState message={q.error ? parseApiError(q.error).message : "Assistito non trovato."} onRetry={() => q.refetch()} />;
  const a = q.data;

  if (modifica && a.modificabile) {
    return (
      <div>
        <PageHeader kicker="Modifica assistito" title={`${a.cognome} ${a.nome}`} />
        <AssistitoForm initial={a} base={base} onCancel={() => setModifica(false)}
          onSaved={() => { setModifica(false); toast({ title: "Modifiche salvate" }); }} />
      </div>
    );
  }

  return (
    <div>
      <Link href={base} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3 transition-colors" data-testid="link-indietro"><ArrowLeft className="size-4" /> {etichettaIndietro}</Link>
      <PageHeader title={`${a.cognome} ${a.nome}`}
        subtitle={<span className="font-mono">{a.codiceFiscale}</span>}
        actions={
          <>
            {a.modificabile && <Button onClick={() => setApriPratica(true)} data-testid="button-apri-pratica"><FilePlus2 className="size-4 mr-1.5" /> Apri pratica</Button>}
            {a.modificabile && <Button variant="outline" onClick={() => setModifica(true)} data-testid="button-modifica"><Pencil className="size-4 mr-1.5" /> Modifica</Button>}
            {puoCambiare && <Button variant="outline" onClick={() => { setErrCambio(null); setCambio(true); }} data-testid="button-cambia-collaboratore"><Repeat className="size-4 mr-1.5" /> Cambia collaboratore</Button>}
            {!a.modificabile && !puoCambiare && <Badge variant="secondary" data-testid="badge-sola-lettura">Sola lettura</Badge>}
          </>
        } />
      <div className="space-y-5">
        {a.straniero && <BannerStraniero nazionalita={a.nazionalitaNome} />}
        <section className="bg-card border border-border rounded-lg p-5 rise">
          <h2 className="text-lg font-bold mb-4 pb-2 border-b border-border">Dati anagrafici</h2>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <Dato k="Cognome">{a.cognome}</Dato><Dato k="Nome">{a.nome}</Dato>
            <Dato k="Sesso">{a.sesso === "M" ? "Maschio" : "Femmina"}</Dato>
            <Dato k="Data di nascita">{fmtData(a.dataNascita)}</Dato>
            <Dato k="Luogo di nascita">{a.luogoNascitaNome}{a.luogoNascitaProvincia ? ` (${a.luogoNascitaProvincia})` : a.luogoNascitaEstero ? " · Stato estero" : ""}</Dato>
            <Dato k="Nazionalità">{a.nazionalitaNome}</Dato>
            <Dato k="Codice fiscale" mono>{a.codiceFiscale}</Dato>
          </dl>
        </section>
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="bg-card border border-border rounded-lg p-5 rise">
            <h2 className="text-lg font-bold mb-4 pb-2 border-b border-border">Recapiti</h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Dato k="Cellulare" mono>{fmtCellulare(a.cellulare)}</Dato>
              <Dato k="Email">{a.email ?? "—"}</Dato>
              <Dato k="Città">{a.citta}</Dato>
              <Dato k="Indirizzo">{a.indirizzo ?? "—"}</Dato>
            </dl>
          </section>
          <section className="bg-card border border-border rounded-lg p-5 rise">
            <h2 className="text-lg font-bold mb-4 pb-2 border-b border-border">Collaboratore</h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Dato k="Collaboratore" ><span data-testid="text-collaboratore">{a.collaboratore.cognome} {a.collaboratore.nome}</span></Dato>
              <Dato k="Sportello" mono>{a.collaboratore.numeroSportello}</Dato>
              <Dato k="Tipologia">{tipologiaLabel(a.collaboratore.tipologia)}</Dato>
              <Dato k="Registrato il">{fmtIstante(a.creatoIl)}</Dato>
            </dl>
          </section>
        </div>
      </div>
      <DialogCollaboratore open={cambio} onClose={() => setCambio(false)} titolo="Cambia collaboratore"
        descrizione={`Scegli il collaboratore a cui associare ${a.cognome} ${a.nome}. L'operazione viene registrata nel log.`}
        etichettaConferma="Associa" escludiId={a.collaboratore.id} pending={associa.isPending} errore={errCambio}
        onConfirm={(collaboratoreId) => associa.mutate({ id: a.id, data: { collaboratoreId } }, {
          onSuccess: () => {
            qc.invalidateQueries({ queryKey: getGetAssistitoQueryKey(a.id) });
            qc.invalidateQueries({ queryKey: getListAssistitiQueryKey() });
            setCambio(false);
            toast({ title: "Collaboratore cambiato" });
          },
          onError: (e) => setErrCambio(parseApiError(e).message),
        })} />
      <DialogApriPratica assistito={apriPratica ? { id: a.id, nome: `${a.cognome} ${a.nome}` } : null} onClose={() => setApriPratica(false)} />
    </div>
  );
}
