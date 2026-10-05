import { useState, type ReactNode } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCollaboratoreQueryKey, getListCollaboratoriQueryKey, useGetCollaboratore, useImpostaPasswordProvvisoriaCollaboratore, useUpdateCollaboratore,
  type CollaboratoreDettaglio,
} from "@workspace/api-client-react";
import { ArrowLeft, ChevronRight, KeyRound, Pencil, Power, ShieldAlert, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CollaboratoreForm } from "@/components/collaboratori/collaboratore-form";
import { BannerStraniero } from "@/components/anagrafica/anagrafica-fields";
import { PasswordDialog } from "@/components/password-dialog";
import { ErrorState, PageHeader, StatoBadge } from "@/components/common";
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

export default function CollaboratoreDettaglioPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  
  const { session } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [modifica, setModifica] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const q = useGetCollaboratore(id, { query: { enabled: Number.isFinite(id), queryKey: getGetCollaboratoreQueryKey(id) } });
  const update = useUpdateCollaboratore();
  const imposta = useImpostaPasswordProvvisoriaCollaboratore();
  const puoModificare = session?.ruolo === "super_admin" || session?.ruolo === "admin";

  const invalida = () => {
    qc.invalidateQueries({ queryKey: getListCollaboratoriQueryKey() });
    qc.invalidateQueries({ queryKey: getGetCollaboratoreQueryKey(id) });
  };
  const toggleAttivo = (c: CollaboratoreDettaglio) => {
    update.mutate({
      id: c.id, data: {
        nome: c.nome, cognome: c.cognome, sesso: c.sesso, dataNascita: c.dataNascita, luogoNascitaCodice: c.luogoNascitaCodice, nazionalita: c.nazionalita,
        codiceFiscale: c.codiceFiscale, email: c.email, telefono: c.telefono, cellulare: c.cellulare, numeroSportello: c.numeroSportello,
        tipologia: c.tipologia, capogruppoId: c.capogruppoId, attivo: !c.attivo,
      },
    }, {
      onSuccess: () => { invalida(); toast({ title: c.attivo ? "Collaboratore disattivato" : "Collaboratore riattivato" }); },
      onError: (e) => toast({ variant: "destructive", title: "Operazione non riuscita", description: parseApiError(e).message }),
    });
  };

  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-10 w-72" /><Skeleton className="h-40 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (q.isError || !q.data) return <ErrorState message={q.error ? parseApiError(q.error).message : "Collaboratore non trovato."} onRetry={() => q.refetch()} />;
  const c = q.data;

  if (modifica) {
    return (
      <div>
        <PageHeader kicker="Modifica collaboratore" title={`${c.cognome} ${c.nome}`} />
        <CollaboratoreForm initial={c} onCancel={() => setModifica(false)} onSaved={() => { setModifica(false); toast({ title: "Modifiche salvate" }); }} />
      </div>
    );
  }

  return (
    <div>
      <Link href="/admin/collaboratori" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3 transition-colors" data-testid="link-indietro"><ArrowLeft className="size-4" /> Collaboratori</Link>
      <PageHeader title={`${c.cognome} ${c.nome}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StatoBadge attivo={c.attivo} /><Badge variant="outline">{tipologiaLabel(c.tipologia)}</Badge><span className="font-mono">Sportello {c.numeroSportello}</span></span>}
        actions={puoModificare ? (
          <>
            <Button variant="outline" onClick={() => setModifica(true)} data-testid="button-modifica"><Pencil className="size-4 mr-1.5" /> Modifica</Button>
            <Button variant="outline" onClick={() => { setPwErr(null); setPwOpen(true); }} data-testid="button-password-provvisoria"><KeyRound className="size-4 mr-1.5" /> Password provvisoria</Button>
            <Button variant={c.attivo ? "outline" : "default"} disabled={update.isPending} onClick={() => toggleAttivo(c)} data-testid="button-toggle-attivo">
              <Power className="size-4 mr-1.5" /> {c.attivo ? "Disattiva" : "Riattiva"}
            </Button>
          </>
        ) : <Badge variant="secondary" data-testid="badge-sola-lettura">Sola lettura</Badge>} />

      <div className="space-y-5">
        {c.straniero && <BannerStraniero nazionalita={c.nazionalitaNome} />}

        {c.numeroCollaboratori > 0 && (
          <section className="rounded-lg border-2 border-accent bg-accent/15 p-5 rise" data-testid="sezione-gruppo">
            <h2 className="flex items-center gap-2 text-xl font-bold mb-3"><Users className="size-5" /> Gruppo di {c.cognome} {c.nome}
              <Badge className="bg-accent-foreground text-accent">{c.numeroCollaboratori}</Badge></h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {c.membri.map((m) => (
                <li key={m.id}>
                  <Link href={`/admin/collaboratori/${m.id}`} data-testid={`link-membro-${m.id}`}
                    className="group flex items-center justify-between rounded-md bg-card border border-border px-3 py-2.5 hover:border-primary hover:shadow-sm transition-all">
                    <div>
                      <div className="font-semibold text-sm">{m.cognome} {m.nome}</div>
                      <div className="text-xs text-muted-foreground font-mono">Sportello {m.numeroSportello} · {tipologiaLabel(m.tipologia)}{!m.attivo && " · disattivato"}</div>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="bg-card border border-border rounded-lg p-5 rise">
          <h2 className="text-lg font-bold mb-4 pb-2 border-b border-border">Dati anagrafici</h2>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <Dato k="Cognome">{c.cognome}</Dato><Dato k="Nome">{c.nome}</Dato>
            <Dato k="Sesso">{c.sesso === "M" ? "Maschio" : "Femmina"}</Dato>
            <Dato k="Data di nascita">{fmtData(c.dataNascita)}</Dato>
            <Dato k="Luogo di nascita">{c.luogoNascitaNome}{c.luogoNascitaProvincia ? ` (${c.luogoNascitaProvincia})` : c.luogoNascitaEstero ? " · Stato estero" : ""}</Dato>
            <Dato k="Nazionalità">{c.nazionalitaNome}</Dato>
            <Dato k="Codice fiscale" mono>{c.codiceFiscale}</Dato>
            <Dato k="Email">{c.email}</Dato>
            <Dato k="Cellulare" mono>{fmtCellulare(c.cellulare)}</Dato>
            <Dato k="Telefono" mono>{c.telefono ?? "—"}</Dato>
          </dl>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="bg-card border border-border rounded-lg p-5 rise">
            <h2 className="text-lg font-bold mb-4 pb-2 border-b border-border">Incarico</h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Dato k="Numero di sportello" mono>{c.numeroSportello}</Dato>
              <Dato k="Tipologia">{tipologiaLabel(c.tipologia)}</Dato>
              <Dato k="Capogruppo">{c.capogruppoId ? <Link href={`/admin/collaboratori/${c.capogruppoId}`} className="text-primary underline underline-offset-2" data-testid="link-capogruppo">{c.capogruppoNome}</Link> : "Nessuno"}</Dato>
              <Dato k="Collaboratori nel gruppo">{c.numeroCollaboratori}</Dato>
            </dl>
          </section>
          <section className="bg-card border border-border rounded-lg p-5 rise">
            <h2 className="text-lg font-bold mb-4 pb-2 border-b border-border">Accesso</h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Dato k="Ultimo accesso">{c.ultimoAccesso ? fmtIstante(c.ultimoAccesso) : "Mai effettuato"}</Dato>
              <Dato k="Creato il">{fmtIstante(c.creatoIl)}</Dato>
            </dl>
            {c.deveCambiarePassword ? (
              <div className="mt-4 flex items-center gap-2 rounded-md bg-accent/20 border border-accent px-3 py-2 text-sm font-medium" data-testid="avviso-cambio-password"><ShieldAlert className="size-4" /> Cambio password in attesa: sarà richiesto al prossimo accesso.</div>
            ) : <p className="mt-4 text-sm text-muted-foreground" data-testid="nessun-cambio-password">Nessun cambio password in sospeso.</p>}
          </section>
        </div>
      </div>

      <PasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} nome={`${c.cognome} ${c.nome}`} pending={imposta.isPending} error={pwErr}
        onConfirm={(pw) => imposta.mutate({ id: c.id, data: { passwordProvvisoria: pw } }, {
          onSuccess: () => { invalida(); setPwOpen(false); toast({ title: "Password provvisoria impostata" }); },
          onError: (e) => setPwErr(parseApiError(e).message),
        })} />
    </div>
  );
}
