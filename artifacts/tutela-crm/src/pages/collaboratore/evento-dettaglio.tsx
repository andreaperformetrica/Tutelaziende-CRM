import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetEventoQueryKey, getListEventiQueryKey, useAddPartecipanteEvento, useConfermaPartecipazioneEvento, useDeletePartecipanteEvento,
  useGetEvento, useUpdatePartecipanteEvento, type EventoDati, type EventoSede, type PartecipanteEventoSede,
} from "@workspace/api-client-react";
import { ArrowLeft, CheckCircle2, Download, FileText, Loader2, Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorState, FieldError } from "@/components/common";
import { ConfermaElimina } from "@/components/pratiche/conferma-elimina";
import { useToast } from "@/hooks/use-toast";
import { fmtData, fmtIstante, fmtOrarioEvento, parseApiError } from "@/lib/format";
import { cartellinoPng, qrDataUrl, scaricaBlob } from "@/lib/qr";
import { formatoDimensione, urlQuestionarioSede } from "@/lib/upload";

export default function EventoDettaglioCollaboratore() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useGetEvento(id);
  const conferma = useConfermaPartecipazioneEvento();
  const aggiungi = useAddPartecipanteEvento();
  const modifica = useUpdatePartecipanteEvento();
  const elimina = useDeletePartecipanteEvento();

  const [nome, setNome] = useState("");
  const [cognome, setCognome] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [mod, setMod] = useState<PartecipanteEventoSede | null>(null);
  const [modNome, setModNome] = useState("");
  const [modCognome, setModCognome] = useState("");
  const [modErr, setModErr] = useState<string | null>(null);
  const [daTogliere, setDaTogliere] = useState<PartecipanteEventoSede | null>(null);

  const salva = (d: EventoSede) => {
    qc.setQueryData(getGetEventoQueryKey(id), d);
    qc.invalidateQueries({ queryKey: getListEventiQueryKey() });
  };
  const errore = (e: unknown) => toast({ variant: "destructive", title: "Operazione non riuscita", description: parseApiError(e).message });

  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-10 w-72" /><Skeleton className="h-48 w-full" /></div>;
  if (q.isError || !q.data) return <ErrorState message={parseApiError(q.error).message} onRetry={() => q.refetch()} />;
  const s = q.data;
  const e = s.evento;

  return (
    <div className="space-y-5">
      <Link href="/collaboratore/eventi" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Tutti gli eventi</Link>
      <header className="border-b border-border pb-4">
        <h1 className="text-3xl font-bold leading-tight" data-testid="text-page-title">{e.titolo}</h1>
        <p className="text-sm text-muted-foreground mt-2">{fmtData(e.data)} · {fmtOrarioEvento(e.oraInizio, e.oraFine)} · {e.luogo}{e.passato && <Badge variant="outline" className="ml-2">Concluso</Badge>}</p>
        {e.descrizione && <p className="text-sm whitespace-pre-line mt-3 max-w-2xl">{e.descrizione}</p>}
      </header>

      {!s.confermatoIl ? (
        <section className="rounded-lg border-2 border-accent bg-card p-5" data-testid="box-conferma">
          <h2 className="font-bold text-lg">Confermi la partecipazione della tua sede?</h2>
          <p className="text-sm text-muted-foreground mt-1 mb-4">Dopo la conferma potrai inserire i partecipanti e ottenere il loro QR code personale.</p>
          <Button disabled={conferma.isPending} onClick={() => conferma.mutate({ id }, { onSuccess: (r) => { salva(r); toast({ title: "Partecipazione confermata" }); }, onError: errore })} data-testid="button-conferma-partecipazione">
            {conferma.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <CheckCircle2 className="size-4 mr-2" />}Conferma partecipazione
          </Button>
        </section>
      ) : (
        <p className="text-sm flex items-center gap-2" data-testid="text-confermata"><CheckCircle2 className="size-4 text-primary" /> Partecipazione confermata il {fmtIstante(s.confermatoIl)}</p>
      )}

      {s.questionario && (
        <section className="rounded-lg border border-border bg-card p-4 flex flex-wrap items-center gap-3" data-testid="card-questionario">
          <FileText className="size-5 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="font-medium truncate">Questionario: {s.questionario.nome}</div>
            <div className="text-xs text-muted-foreground">{formatoDimensione(s.questionario.dimensione)} · da stampare per i partecipanti</div>
          </div>
          <Button asChild variant="outline" size="sm"><a href={urlQuestionarioSede(id)} data-testid="link-scarica-questionario"><Download className="size-3.5 mr-1.5" /> Scarica</a></Button>
        </section>
      )}

      {s.confermatoIl && (
        <section className="space-y-4">
          <h2 className="font-bold text-xl">Partecipanti ({s.partecipanti.length})</h2>
          <form className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4"
            onSubmit={(ev) => {
              ev.preventDefault();
              setErr(null);
              if (!nome.trim() || !cognome.trim()) return setErr("Inserisci nome e cognome.");
              aggiungi.mutate({ id, data: { nome: nome.trim(), cognome: cognome.trim() } }, {
                onSuccess: (r) => { salva(r); setNome(""); setCognome(""); toast({ title: "Partecipante aggiunto" }); },
                onError: (x) => setErr(parseApiError(x).message),
              });
            }}>
            <div className="flex-1 min-w-40"><Label htmlFor="p-nome">Nome</Label><Input id="p-nome" value={nome} maxLength={80} autoComplete="off" onChange={(x) => setNome(x.target.value)} data-testid="input-partecipante-nome" /></div>
            <div className="flex-1 min-w-40"><Label htmlFor="p-cognome">Cognome</Label><Input id="p-cognome" value={cognome} maxLength={80} autoComplete="off" onChange={(x) => setCognome(x.target.value)} data-testid="input-partecipante-cognome" /></div>
            <Button type="submit" disabled={aggiungi.isPending} data-testid="button-aggiungi-partecipante">{aggiungi.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Plus className="size-4 mr-2" />}Aggiungi</Button>
            <div className="basis-full"><FieldError id="errore-partecipante">{err}</FieldError></div>
          </form>

          {s.partecipanti.length === 0 ? (
            <div className="rounded-lg border border-dashed border-input p-8 text-center text-sm text-muted-foreground"><UserPlus className="size-6 mx-auto mb-2" />Nessun partecipante inserito.</div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {s.partecipanti.map((p) => (
                <SchedaPartecipante key={p.id} p={p} evento={e}
                  onModifica={() => { setMod(p); setModNome(p.nome); setModCognome(p.cognome); setModErr(null); }}
                  onElimina={() => setDaTogliere(p)} />
              ))}
            </ul>
          )}
        </section>
      )}

      <Dialog open={!!mod} onOpenChange={(o) => { if (!o) setMod(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Correggi il partecipante</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label htmlFor="m-nome">Nome</Label><Input id="m-nome" value={modNome} onChange={(x) => setModNome(x.target.value)} data-testid="input-modifica-nome" /></div>
            <div><Label htmlFor="m-cognome">Cognome</Label><Input id="m-cognome" value={modCognome} onChange={(x) => setModCognome(x.target.value)} data-testid="input-modifica-cognome" /></div>
            <FieldError>{modErr}</FieldError>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setMod(null)}>Annulla</Button>
              <Button disabled={modifica.isPending} data-testid="button-salva-partecipante"
                onClick={() => mod && modifica.mutate({ id, partecipanteId: mod.id, data: { nome: modNome.trim(), cognome: modCognome.trim() } }, {
                  onSuccess: (r) => { salva(r); setMod(null); toast({ title: "Partecipante aggiornato" }); },
                  onError: (x) => setModErr(parseApiError(x).message),
                })}>Salva</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfermaElimina aperto={!!daTogliere} azione="Togli" titolo={`Togliere ${daTogliere?.cognome ?? ""} ${daTogliere?.nome ?? ""} dall'elenco?`} testo="Il suo QR code non sarà più valido."
        onAnnulla={() => setDaTogliere(null)}
        onConferma={() => { const p = daTogliere!; setDaTogliere(null); elimina.mutate({ id, partecipanteId: p.id }, { onSuccess: (r) => { salva(r); toast({ title: "Partecipante tolto" }); }, onError: errore }); }} />
    </div>
  );
}

function SchedaPartecipante({ p, evento, onModifica, onElimina }: { p: PartecipanteEventoSede; evento: EventoDati; onModifica: () => void; onElimina: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [scarico, setScarico] = useState(false);
  useEffect(() => { let vivo = true; qrDataUrl(p.codiceQr, 320).then((u) => { if (vivo) setQr(u); }).catch(() => undefined); return () => { vivo = false; }; }, [p.codiceQr]);
  const nomeCompleto = `${p.nome} ${p.cognome}`;
  const scarica = async () => {
    setScarico(true);
    try {
      scaricaBlob(await cartellinoPng(p.codiceQr, evento.titolo, `${fmtData(evento.data)} · ${evento.luogo}`, nomeCompleto), `QR-${p.cognome}-${p.nome}.png`.replace(/\s+/g, "-"));
    } finally { setScarico(false); }
  };
  return (
    <li className="rounded-lg border border-border bg-card p-4 flex flex-col items-center text-center" data-testid={`card-partecipante-${p.id}`}>
      <div className="size-40 grid place-items-center">{qr ? <img src={qr} alt={`QR code di ${nomeCompleto}`} className="size-40" data-testid={`qr-partecipante-${p.id}`} /> : <Skeleton className="size-40" />}</div>
      <div className="font-bold mt-2">{p.cognome} {p.nome}</div>
      <div className="text-xs text-muted-foreground h-4 mt-0.5">
        {p.entrataIl ? `Entrata ${fmtIstante(p.entrataIl)}` : ""}{p.uscitaIl ? ` · uscita ${fmtIstante(p.uscitaIl)}` : ""}
      </div>
      <div className="flex gap-1.5 mt-3">
        <Button size="sm" variant="outline" onClick={scarica} disabled={!qr || scarico} data-testid={`button-scarica-qr-${p.id}`}><Download className="size-3.5 mr-1.5" /> Scarica QR</Button>
        {p.modificabile && <>
          <Button size="sm" variant="ghost" onClick={onModifica} aria-label="Correggi" data-testid={`button-modifica-partecipante-${p.id}`}><Pencil className="size-3.5" /></Button>
          <Button size="sm" variant="ghost" onClick={onElimina} aria-label="Togli" data-testid={`button-elimina-partecipante-${p.id}`}><Trash2 className="size-3.5" /></Button>
        </>}
      </div>
    </li>
  );
}
