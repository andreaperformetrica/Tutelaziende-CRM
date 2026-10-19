import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListAssistitiQueryKey, getGetConteggioSegnalazioniQueryKey, getListSegnalazioniDuplicatiQueryKey, useArchiviaSegnalazione, useAssociaSegnalazione,
  useListSegnalazioniDuplicati, type SegnalazioneDuplicato,
} from "@workspace/api-client-react";
import { Archive, CheckCheck, Loader2, TriangleAlert, UserRoundCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DialogCollaboratore } from "@/components/assistiti/dialog-collaboratore";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { useToast } from "@/hooks/use-toast";
import { fmtCellulare, fmtData, fmtIstante, parseApiError, tipologiaLabel, nomeCollaboratore } from "@/lib/format";

const CAMPI: Record<string, string> = { codice_fiscale: "Codice fiscale", cellulare: "Cellulare" };

function Riga({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex gap-2 text-sm"><dt className="w-28 shrink-0 text-muted-foreground">{k}</dt><dd className="font-medium min-w-0 break-words">{children}</dd></div>;
}

function Scheda({ s, onAssocia, onArchivia }: { s: SegnalazioneDuplicato; onAssocia: () => void; onArchivia: () => void }) {
  const aperta = s.stato === "aperta";
  const e = s.esistente;
  const t = s.datiTentati as unknown as Record<string, string | null>;
  const eAssistito = e.tipo === "assistito";
  return (
    <article className="rounded-lg border border-border bg-card p-5 rise" data-testid={`segnalazione-${s.id}`}>
      <header className="flex flex-wrap items-center gap-2 mb-4 pb-3 border-b border-border">
        <TriangleAlert className="size-5 text-accent-foreground" />
        <h2 className="font-bold text-lg">{eAssistito ? "Assistito già presente" : "Dato coincidente con un collaboratore"}</h2>
        {s.campi.map((c) => <Badge key={c} variant="outline">{CAMPI[c] ?? c}</Badge>)}
        <Badge variant="secondary" data-testid={`tentativi-${s.id}`}>{s.tentativi} {s.tentativi === 1 ? "tentativo" : "tentativi"}</Badge>
        {!aperta && <Badge className="bg-primary text-primary-foreground">{s.esito === "associata" ? "Associata" : "Archiviata"}</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">Ultimo tentativo {fmtIstante(s.ultimoTentativoIl)}</span>
      </header>
      <div className="grid gap-5 md:grid-cols-3">
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Persona già registrata</h3>
          <dl className="space-y-1.5">
            <Riga k="Nome">{e.cognome} {e.nome}</Riga>
            <Riga k="Codice fiscale"><span className="font-mono">{e.codiceFiscale}</span></Riga>
            <Riga k="Cellulare"><span className="font-mono">{fmtCellulare(e.cellulare)}</span></Riga>
            <Riga k={eAssistito ? "Appartiene a" : "Collaboratore"}>
              {e.collaboratore ? <>{nomeCollaboratore(e.collaboratore)} <span className="font-mono text-xs text-muted-foreground">· sportello {e.collaboratore.numeroSportello} · {tipologiaLabel(e.collaboratore.tipologia)}</span></> : "—"}
            </Riga>
            {eAssistito && e.assistitoId && <Riga k="Scheda"><Link href={`/admin/assistiti/${e.assistitoId}`} className="underline text-primary" data-testid={`link-scheda-${s.id}`}>Apri assistito</Link></Riga>}
          </dl>
        </section>
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Richiesto da</h3>
          <dl className="space-y-1.5">
            <Riga k="Collaboratore">{nomeCollaboratore(s.richiedente)}</Riga>
            <Riga k="Sportello"><span className="font-mono">{s.richiedente.numeroSportello}</span> · {tipologiaLabel(s.richiedente.tipologia)}</Riga>
            <Riga k="Prima segnalazione">{fmtIstante(s.creataIl)}</Riga>
          </dl>
        </section>
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Dati inseriti</h3>
          <dl className="space-y-1.5">
            <Riga k="Nome">{t.cognome} {t.nome}</Riga>
            <Riga k="Nascita">{fmtData(t.dataNascita)} · {t.luogoNascita}</Riga>
            <Riga k="Codice fiscale"><span className="font-mono">{t.codiceFiscale}</span></Riga>
            <Riga k="Cellulare"><span className="font-mono">{fmtCellulare(t.cellulare)}</span></Riga>
            <Riga k="Città">{t.citta}</Riga>
          </dl>
        </section>
      </div>
      {aperta ? (
        <footer className="flex flex-wrap gap-2 mt-5 pt-4 border-t border-border">
          {eAssistito && <Button onClick={onAssocia} data-testid={`button-associa-${s.id}`}><UserRoundCheck className="size-4 mr-1.5" /> Associa a un collaboratore</Button>}
          <Button variant="outline" onClick={onArchivia} data-testid={`button-archivia-${s.id}`}><Archive className="size-4 mr-1.5" /> Archivia</Button>
          {!eAssistito && <span className="text-xs text-muted-foreground self-center">Il dato coincide con un collaboratore: non c'è nessun assistito da associare.</span>}
        </footer>
      ) : (
        <footer className="mt-5 pt-4 border-t border-border text-sm text-muted-foreground">
          Gestita il {fmtIstante(s.gestitaIl)}{s.gestitaDa ? ` da ${s.gestitaDa}` : ""}{s.nota ? ` · Nota: ${s.nota}` : ""}
        </footer>
      )}
    </article>
  );
}

export default function SegnalazioniPage() {
  const [stato, setStato] = useState<"aperte" | "gestite">("aperte");
  const [daAssociare, setDaAssociare] = useState<SegnalazioneDuplicato | null>(null);
  const [daArchiviare, setDaArchiviare] = useState<SegnalazioneDuplicato | null>(null);
  const [nota, setNota] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();
  const lista = useListSegnalazioniDuplicati({ stato });
  const associa = useAssociaSegnalazione();
  const archivia = useArchiviaSegnalazione();

  const aggiorna = () => {
    qc.invalidateQueries({ queryKey: getListSegnalazioniDuplicatiQueryKey() });
    qc.invalidateQueries({ queryKey: getGetConteggioSegnalazioniQueryKey() });
    qc.invalidateQueries({ queryKey: getListAssistitiQueryKey() });
  };

  return (
    <div>
      <PageHeader kicker="Anagrafica" title="Segnalazioni duplicati"
        subtitle="Tentativi dei collaboratori di registrare un assistito o un dato già presente." />
      <Tabs value={stato} onValueChange={(v) => setStato(v as typeof stato)} className="mb-4">
        <TabsList>
          <TabsTrigger value="aperte" data-testid="tab-aperte">Aperte</TabsTrigger>
          <TabsTrigger value="gestite" data-testid="tab-gestite">Gestite</TabsTrigger>
        </TabsList>
      </Tabs>
      {lista.isLoading ? <div className="space-y-3"><Skeleton className="h-56" /><Skeleton className="h-56" /></div>
        : lista.isError ? <ErrorState message={parseApiError(lista.error).message} onRetry={() => lista.refetch()} />
        : !lista.data?.length ? <EmptyState icon={<CheckCheck className="size-6" />} title={stato === "aperte" ? "Nessuna segnalazione aperta" : "Nessuna segnalazione gestita"}
            text={stato === "aperte" ? "Quando un collaboratore tenta di inserire un dato già presente, la segnalazione comparirà qui." : undefined} />
        : <div className="space-y-4">{lista.data.map((s) => (
            <Scheda key={s.id} s={s} onAssocia={() => { setErrore(null); setDaAssociare(s); }} onArchivia={() => { setErrore(null); setNota(""); setDaArchiviare(s); }} />
          ))}</div>}

      <DialogCollaboratore open={!!daAssociare} onClose={() => setDaAssociare(null)} titolo="Associa l'assistito"
        descrizione={daAssociare ? `Scegli il collaboratore a cui associare ${daAssociare.esistente.cognome} ${daAssociare.esistente.nome}. Per impostazione predefinita è proposto il collaboratore che ha tentato l'inserimento.` : ""}
        etichettaConferma="Associa e chiudi" iniziale={daAssociare?.richiedente.id} conNota pending={associa.isPending} errore={errore}
        onConfirm={(collaboratoreId, n) => daAssociare && associa.mutate({ id: daAssociare.id, data: { collaboratoreId, nota: n.trim() || null } }, {
          onSuccess: () => { aggiorna(); setDaAssociare(null); toast({ title: "Assistito associato, segnalazione chiusa" }); },
          onError: (e) => setErrore(parseApiError(e).message),
        })} />

      <Dialog open={!!daArchiviare} onOpenChange={(o) => !o && setDaArchiviare(null)}>
        <DialogContent data-testid="dialog-archivia">
          <DialogHeader>
            <DialogTitle>Archivia la segnalazione</DialogTitle>
            <DialogDescription>Nessuna associazione verrà modificata. L'operazione viene registrata nel log.</DialogDescription>
          </DialogHeader>
          <Textarea value={nota} onChange={(e) => setNota(e.target.value)} maxLength={1000} placeholder="Nota (facoltativa)" data-testid="input-nota-archivia" />
          {errore && <p className="text-sm font-medium text-destructive" role="alert">{errore}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDaArchiviare(null)}>Annulla</Button>
            <Button disabled={archivia.isPending} data-testid="button-conferma-archivia"
              onClick={() => daArchiviare && archivia.mutate({ id: daArchiviare.id, data: { nota: nota.trim() || null } }, {
                onSuccess: () => { aggiorna(); setDaArchiviare(null); toast({ title: "Segnalazione archiviata" }); },
                onError: (e) => setErrore(parseApiError(e).message),
              })}>
              {archivia.isPending && <Loader2 className="size-4 mr-2 animate-spin" />} Archivia
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
