import { useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCollaboratoreQueryKey, getListCollaboratoriQueryKey, useAggiungiMembriGruppo, useDeleteCollaboratore, useListMandatiCollaboratore, useRimuoviMembroGruppo, useImpostaRuoloCapogruppo, useListCollaboratori, useGetCollaboratore, useImpostaPasswordProvvisoriaCollaboratore, useReinviaCredenzialiCollaboratore, useUpdateCollaboratore,
  type CollaboratoreDettaglio,
} from "@workspace/api-client-react";
import { ArrowLeft, FileText, KeyRound, Mail, Pencil, Plus, Power, ShieldAlert, Trash2, UserMinus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { CollaboratoreForm } from "@/components/collaboratori/collaboratore-form";
import { BannerStraniero } from "@/components/anagrafica/anagrafica-fields";
import { PasswordDialog } from "@/components/password-dialog";
import { ConfermaElimina } from "@/components/pratiche/conferma-elimina";
import { ErrorState, PageHeader, StatoBadge } from "@/components/common";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/lib/auth";
import { fmtCellulare, fmtData, fmtIstante, nomeCollaboratore, parseApiError, tipologiaLabel } from "@/lib/format";

function Dato({ k, children, mono }: { k: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{k}</dt>
      <dd className={`mt-0.5 text-sm font-medium break-words ${mono ? "font-mono" : ""}`}>{children}</dd>
    </div>
  );
}

function AggiungiMembriDialog({ capogruppo, aperto, onClose, onFatto }: { capogruppo: CollaboratoreDettaglio; aperto: boolean; onClose: () => void; onFatto: () => void }) {
  const { toast } = useToast();
  const [scelti, setScelti] = useState<number[]>([]);
  const [errore, setErrore] = useState<string | null>(null);
  const elenco = useListCollaboratori({ stato: "attivi" }, { query: { enabled: aperto, queryKey: ["collaboratori-candidati-gruppo"] } });
  const aggiungi = useAggiungiMembriGruppo();
  const candidati = (elenco.data ?? []).filter((x) => x.id !== capogruppo.id && x.capogruppoId === null && !x.capogruppo);
  const chiudi = () => { setScelti([]); setErrore(null); onClose(); };
  return (
    <Dialog open={aperto} onOpenChange={(o) => { if (!o) chiudi(); }}>
      <DialogContent data-testid="dialog-aggiungi-membri">
        <DialogHeader>
          <DialogTitle>Aggiungi collaboratori al gruppo</DialogTitle>
          <DialogDescription>Gruppo di {nomeCollaboratore(capogruppo)}. Compaiono solo i collaboratori attivi che non appartengono già a un gruppo.</DialogDescription>
        </DialogHeader>
        <div className="max-h-72 overflow-y-auto space-y-1">
          {elenco.isLoading && <Skeleton className="h-20 w-full" />}
          {!elenco.isLoading && candidati.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center" data-testid="nessun-candidato">Nessun collaboratore disponibile.</p>}
          {candidati.map((x) => (
            <label key={x.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-muted/50" data-testid={`candidato-${x.id}`}>
              <Checkbox checked={scelti.includes(x.id)} onCheckedChange={(v) => setScelti((a) => v ? [...a, x.id] : a.filter((i) => i !== x.id))} />
              <span className="text-sm font-medium">{nomeCollaboratore(x)}</span>
              <span className="ml-auto text-xs text-muted-foreground font-mono">Sportello {x.numeroSportello} · {tipologiaLabel(x.tipologia)}</span>
            </label>
          ))}
        </div>
        {errore && <p className="text-sm text-destructive" role="alert">{errore}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={chiudi}>Annulla</Button>
          <Button disabled={scelti.length === 0 || aggiungi.isPending} data-testid="button-conferma-membri"
            onClick={() => aggiungi.mutate({ id: capogruppo.id, data: { collaboratoreIds: scelti } }, {
              onSuccess: () => { toast({ title: scelti.length === 1 ? "Collaboratore aggiunto al gruppo" : "Collaboratori aggiunti al gruppo" }); chiudi(); onFatto(); },
              onError: (e) => setErrore(parseApiError(e).message),
            })}>Aggiungi{scelti.length > 0 ? ` (${scelti.length})` : ""}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CollaboratoreDettaglioPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  
  const [, nav] = useLocation();
  const { session } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [modifica, setModifica] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [confermaInvio, setConfermaInvio] = useState(false);
  const [confermaElimina, setConfermaElimina] = useState(false);
  const [aggiungiAperto, setAggiungiAperto] = useState(false);
  const [daTogliere, setDaTogliere] = useState<{ id: number; nome: string } | null>(null);
  const togli = useRimuoviMembroGruppo();
  const mandati = useListMandatiCollaboratore(id, { query: { enabled: Number.isFinite(id), queryKey: ["collaboratori", id, "mandati"] } });
  const ruolo = useImpostaRuoloCapogruppo();
  const reinvia = useReinviaCredenzialiCollaboratore();
  const elimina = useDeleteCollaboratore();
  const q = useGetCollaboratore(id, { query: { enabled: Number.isFinite(id), queryKey: getGetCollaboratoreQueryKey(id) } });
  const update = useUpdateCollaboratore();
  const imposta = useImpostaPasswordProvvisoriaCollaboratore();
  const puoModificare = session?.ruolo === "super_admin" || session?.ruolo === "admin";
  const eSuperAdmin = session?.ruolo === "super_admin";

  const invalida = () => {
    qc.invalidateQueries({ queryKey: getListCollaboratoriQueryKey() });
    qc.invalidateQueries({ queryKey: getGetCollaboratoreQueryKey(id) });
  };
  const cambiaRuolo = (capogruppo: boolean) => ruolo.mutate({ id, data: { capogruppo } }, {
    onSuccess: () => { invalida(); toast({ title: capogruppo ? "Ora è capogruppo" : "Ruolo di capogruppo rimosso" }); },
    onError: (e) => toast({ variant: "destructive", title: "Operazione non riuscita", description: parseApiError(e).message }),
  });
  const toggleAttivo = (c: CollaboratoreDettaglio) => {
    update.mutate({
      id: c.id, data: {
        nome: c.nome, cognome: c.cognome, sesso: c.sesso, dataNascita: c.dataNascita, luogoNascitaCodice: c.luogoNascitaCodice, nazionalita: c.nazionalita,
        codiceFiscale: c.codiceFiscale, email: c.email, telefono: c.telefono, partitaIva: c.partitaIva, cellulare: c.cellulare, numeroSportello: c.numeroSportello,
        tipologia: c.tipologia, capogruppoId: c.capogruppoId, attivo: !c.attivo,
        denominazione: c.denominazione, ragioneSociale: c.ragioneSociale, tipoSoggetto: c.tipoSoggetto, sedeIndirizzo: c.sedeIndirizzo,
        sedeComuneCodice: c.sedeComuneCodice, sedeCap: c.sedeCap, iban: c.iban, codiceFiscaleAssociazione: c.codiceFiscaleAssociazione,
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
        <PageHeader kicker="Modifica collaboratore" title={nomeCollaboratore(c)} />
        <CollaboratoreForm initial={c} onCancel={() => setModifica(false)} onSaved={() => { setModifica(false); toast({ title: "Modifiche salvate" }); }} />
      </div>
    );
  }

  return (
    <div>
      <Link href="/admin/collaboratori" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3 transition-colors" data-testid="link-indietro"><ArrowLeft className="size-4" /> Collaboratori</Link>
      <PageHeader title={nomeCollaboratore(c)}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StatoBadge attivo={c.attivo} /><Badge variant="outline">{tipologiaLabel(c.tipologia)}</Badge><span className="font-mono">Sportello {c.numeroSportello}</span></span>}
        actions={puoModificare ? (
          <>
            <Button variant="outline" onClick={() => setModifica(true)} data-testid="button-modifica"><Pencil className="size-4 mr-1.5" /> Modifica</Button>
            <Button variant="outline" onClick={() => { setPwErr(null); setPwOpen(true); }} data-testid="button-password-provvisoria"><KeyRound className="size-4 mr-1.5" /> Password provvisoria</Button>
            <Button variant={c.attivo ? "outline" : "default"} disabled={update.isPending} onClick={() => toggleAttivo(c)} data-testid="button-toggle-attivo">
              <Power className="size-4 mr-1.5" /> {c.attivo ? "Disattiva" : "Riattiva"}
            </Button>
            {eSuperAdmin && (
              <>
                <Button variant="outline" disabled={!c.attivo || reinvia.isPending} onClick={() => setConfermaInvio(true)} data-testid="button-reinvia-credenziali"><Mail className="size-4 mr-1.5" /> Reinvia credenziali</Button>
                <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setConfermaElimina(true)} data-testid="button-elimina-collaboratore"><Trash2 className="size-4 mr-1.5" /> Elimina</Button>
              </>
            )}
          </>
        ) : <Badge variant="secondary" data-testid="badge-sola-lettura">Sola lettura</Badge>} />

      <div className="space-y-5">
        {c.straniero && <BannerStraniero nazionalita={c.nazionalitaNome} />}

        <section className="bg-card border border-border rounded-lg p-5 rise">
          <h2 className="text-lg font-bold mb-4 pb-2 border-b border-border">Dati anagrafici</h2>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <Dato k="Cognome">{c.cognome}</Dato><Dato k="Nome">{c.nome}</Dato>
            <Dato k="Sesso">{c.sesso === "M" ? "Maschio" : "Femmina"}</Dato>
            <Dato k="Data di nascita">{fmtData(c.dataNascita)}</Dato>
            <Dato k="Luogo di nascita">{c.luogoNascitaNome}{c.luogoNascitaProvincia ? ` (${c.luogoNascitaProvincia})` : c.luogoNascitaEstero ? " · Stato estero" : ""}</Dato>
            <Dato k="Nazionalità">{c.nazionalitaNome}</Dato>
            <Dato k="Codice fiscale" mono>{c.codiceFiscale}</Dato>
            <Dato k="Partita IVA" mono>{c.partitaIva ?? "—"}</Dato>
            <Dato k="Email">{c.email}</Dato>
            <Dato k="Cellulare" mono>{fmtCellulare(c.cellulare)}</Dato>
            <Dato k="Telefono" mono>{c.telefono ?? "—"}</Dato>
          </dl>
        </section>

        <section className="bg-card border border-border rounded-lg p-5 rise" data-testid="sezione-sede">
          <h2 className="text-lg font-bold mb-4 pb-2 border-b border-border">Dati della sede</h2>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <Dato k="Denominazione">{c.denominazione ?? "—"}</Dato>
            <Dato k="Ragione sociale">{c.ragioneSociale ?? "—"}</Dato>
            <Dato k="Tipo di soggetto">{c.tipoSoggetto === "PARTITA_IVA" ? "Partita IVA" : c.tipoSoggetto === "ASSOCIAZIONE" ? "Associazione" : "—"}</Dato>
            {c.tipoSoggetto === "ASSOCIAZIONE"
              ? <Dato k="Codice fiscale associazione" mono>{c.codiceFiscaleAssociazione ?? "—"}</Dato>
              : <Dato k="Partita IVA" mono>{c.partitaIva ?? "—"}</Dato>}
            <Dato k="Indirizzo della sede">{c.sedeIndirizzo ?? "—"}</Dato>
            <Dato k="Comune">{c.sedeComune ?? "—"}</Dato>
            <Dato k="Provincia" mono>{c.sedeProvincia ?? "—"}</Dato>
            <Dato k="CAP" mono>{c.sedeCap ?? "—"}</Dato>
            <Dato k="IBAN" mono>{c.iban ?? "—"}</Dato>
          </dl>
          <div className="mt-5 pt-3 border-t border-border" data-testid="sezione-mandati-sede">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Mandati della sede{mandati.data?.provincia ? ` · provincia di ${mandati.data.provinciaNome} (${mandati.data.provincia})` : ""}
            </h3>
            {mandati.isLoading ? <Skeleton className="h-10 w-full" /> : !mandati.data?.provincia && !mandati.data?.mandati.length ? (
              <p className="text-sm text-muted-foreground" data-testid="mandati-senza-provincia">Indica il comune della sede: il mandato viene assegnato in automatico in base alla provincia.</p>
            ) : !mandati.data?.mandati.length ? (
              <p className="text-sm text-muted-foreground" data-testid="mandati-nessuno">Per questa provincia non è ancora stato caricato nessun mandato.</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {mandati.data.mandati.map((m) => (
                  <li key={m.mandatoId} className="flex items-center gap-2 px-3 py-1.5 text-sm" data-testid={`mandato-sede-${m.mandatoId}`}>
                    <FileText className="size-4 text-muted-foreground shrink-0" />
                    <span className="font-medium">{m.tipoPraticaNome ?? "Tutti i tipi di pratica"}</span>
                    <span className="ml-auto text-xs text-muted-foreground truncate">{m.fileNome}{m.origine === "precedente" ? " · assegnato in precedenza" : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="bg-card border border-border rounded-lg p-5 rise">
            <h2 className="text-lg font-bold mb-4 pb-2 border-b border-border">Incarico</h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Dato k="Numero di sportello" mono>{c.numeroSportello}</Dato>
              <Dato k="Tipologia">{tipologiaLabel(c.tipologia)}</Dato>
              <Dato k="Ruolo">
                {c.capogruppo ? <span data-testid="ruolo-capogruppo">Capogruppo</span>
                  : c.capogruppoId ? <span>Nel gruppo di <Link href={`/admin/collaboratori/${c.capogruppoId}`} className="text-primary underline underline-offset-2" data-testid="link-capogruppo">{c.capogruppoNome}</Link></span>
                  : "Collaboratore"}
                {puoModificare && !c.capogruppo && c.capogruppoId === null && c.attivo && (
                  <button type="button" disabled={ruolo.isPending} onClick={() => cambiaRuolo(true)} data-testid="button-rendi-capogruppo"
                    className="ml-2 text-xs font-normal text-primary underline underline-offset-2 hover:no-underline">Rendi capogruppo</button>
                )}
                {puoModificare && c.capogruppo && c.numeroCollaboratori === 0 && (
                  <button type="button" disabled={ruolo.isPending} onClick={() => cambiaRuolo(false)} data-testid="button-rimuovi-capogruppo"
                    className="ml-2 text-xs font-normal text-muted-foreground underline underline-offset-2 hover:no-underline">Togli il ruolo</button>
                )}
              </Dato>
            </dl>
            {c.capogruppo && (
              <div className="mt-4 pt-3 border-t border-border" data-testid="sezione-gruppo">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Collaboratori nel gruppo ({c.numeroCollaboratori})</h3>
                  {puoModificare && c.attivo && (
                    <Button size="sm" variant="outline" className="ml-auto h-7 px-2 text-xs" onClick={() => setAggiungiAperto(true)} data-testid="button-aggiungi-membri"><Plus className="size-3.5 mr-1" /> Aggiungi</Button>
                  )}
                </div>
                {c.membri.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="gruppo-vuoto">Nessun collaboratore nel gruppo.</p> : (
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {c.membri.map((m) => (
                      <li key={m.id}>
                        <div className="flex items-center gap-1 pr-1 hover:bg-muted/50 transition-colors">
                          <Link href={`/admin/collaboratori/${m.id}`} data-testid={`link-membro-${m.id}`} className="flex flex-1 items-center justify-between gap-2 px-3 py-1.5 text-sm min-w-0">
                            <span className="font-medium">{nomeCollaboratore(m)}</span>
                            <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">Sportello {m.numeroSportello} · {tipologiaLabel(m.tipologia)}{!m.attivo && " · disattivato"}</span>
                          </Link>
                          {puoModificare && (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive" data-testid={`button-togli-membro-${m.id}`}
                              onClick={() => setDaTogliere({ id: m.id, nome: nomeCollaboratore(m) })}><UserMinus className="size-3.5 mr-1" /> Togli</Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
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

      <AggiungiMembriDialog capogruppo={c} aperto={aggiungiAperto} onClose={() => setAggiungiAperto(false)} onFatto={invalida} />
      <ConfermaElimina aperto={daTogliere !== null} azione="Togli" titolo="Togliere il collaboratore dal gruppo?"
        testo={`${daTogliere?.nome ?? ""} non farà più parte del gruppo di ${nomeCollaboratore(c)}: resta attivo ma senza capogruppo. Le sue pratiche e i suoi assistiti non cambiano.`}
        onAnnulla={() => setDaTogliere(null)}
        onConferma={() => {
          const m = daTogliere;
          setDaTogliere(null);
          if (!m) return;
          togli.mutate({ id: c.id, membroId: m.id }, {
            onSuccess: () => { invalida(); toast({ title: "Collaboratore tolto dal gruppo" }); },
            onError: (e) => toast({ variant: "destructive", title: "Operazione non riuscita", description: parseApiError(e).message }),
          });
        }} />
      <ConfermaElimina aperto={confermaInvio} azione="Invia" titolo="Reinviare le credenziali?"
        testo={`A ${c.cognome} ${c.nome} verrà impostata una nuova password provvisoria e inviata per email a ${c.email}. La password attuale smette di funzionare e le sessioni aperte vengono chiuse.`}
        onAnnulla={() => setConfermaInvio(false)}
        onConferma={() => {
          setConfermaInvio(false);
          reinvia.mutate({ id: c.id }, {
            onSuccess: (r) => {
              invalida();
              if (r.esito === "inviata") toast({ title: "Credenziali inviate", description: `Email inviata a ${c.email}.` });
              else toast({ variant: "destructive", title: "Email non inviata", description: `${r.dettaglio ?? "Invio non riuscito."} La nuova password è stata impostata ma nessuno la conosce: usa Password provvisoria per sceglierne una.` });
            },
            onError: (e) => toast({ variant: "destructive", title: "Operazione non riuscita", description: parseApiError(e).message }),
          });
        }} />
      <ConfermaElimina aperto={confermaElimina} titolo="Eliminare il collaboratore?"
        testo={`${c.cognome} ${c.nome} verrà eliminato definitivamente, insieme al suo accesso. Si può fare solo se non ha assistiti, pratiche o compensi. L'operazione non si può annullare.`}
        onAnnulla={() => setConfermaElimina(false)}
        onConferma={() => {
          setConfermaElimina(false);
          elimina.mutate({ id: c.id }, {
            onSuccess: () => { qc.invalidateQueries({ queryKey: getListCollaboratoriQueryKey() }); toast({ title: "Collaboratore eliminato" }); nav("/admin/collaboratori"); },
            onError: (e) => toast({ variant: "destructive", title: "Eliminazione non riuscita", description: parseApiError(e).message }),
          });
        }} />
      <PasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} nome={`${c.cognome} ${c.nome}`} pending={imposta.isPending} error={pwErr}
        onConfirm={(pw) => imposta.mutate({ id: c.id, data: { passwordProvvisoria: pw } }, {
          onSuccess: () => { invalida(); setPwOpen(false); toast({ title: "Password provvisoria impostata" }); },
          onError: (e) => setPwErr(parseApiError(e).message),
        })} />
    </div>
  );
}
