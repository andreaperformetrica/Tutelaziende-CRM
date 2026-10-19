import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetEventoBackofficeQueryKey, useDeleteDocumentoEvento, useInviaDocumentiEvento, type EventoBackoffice } from "@workspace/api-client-react";
import { Download, FileText, Loader2, Mail, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SelettoreFile } from "@/components/pratiche/selettore-file";
import { ConfermaElimina } from "@/components/pratiche/conferma-elimina";
import { useToast } from "@/hooks/use-toast";
import { fmtIstante, parseApiError } from "@/lib/format";
import { FORMATI_DOCUMENTI_CORSO, formatoDimensione, inviaFile, messaggioErrore, urlDocumentoEvento } from "@/lib/upload";

/** Documenti del corso (slide, dispense): si caricano dopo il corso e si inviano per email ai soli presenti. */
export function DocumentiCorso({ s, id, onSalva, onErrore }: { s: EventoBackoffice; id: number; onSalva: (d: EventoBackoffice) => void; onErrore: (e: unknown) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const elimina = useDeleteDocumentoEvento();
  const invia = useInviaDocumentiEvento();
  const [occupato, setOccupato] = useState(false);
  const [daTogliere, setDaTogliere] = useState<EventoBackoffice["documenti"][number] | null>(null);
  // Si inviano i documenti non ancora spediti; se sono tutti già partiti, si rispediscono tutti.
  const nuovi = s.documenti.filter((d) => !d.inviatoIl);
  const presenti = s.partecipanti.filter((p) => p.entrataIl).length;
  const presentiConEmail = s.partecipanti.filter((p) => p.entrataIl && p.email).length;

  const carica = async (file: File) => {
    setOccupato(true);
    try {
      onSalva(await inviaFile<EventoBackoffice>("PUT", `/backoffice/eventi/${id}/documenti`, {}, file));
      toast({ title: "Documento caricato" });
    } catch (e) {
      toast({ variant: "destructive", title: "Caricamento non riuscito", description: messaggioErrore(e) });
    } finally { setOccupato(false); }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-5" data-testid="sezione-documenti-corso">
      <h2 className="font-bold text-lg flex items-center gap-2"><FileText className="size-5" /> Documenti del corso</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-4">Carica le slide o le dispense e inviale per email a chi ha partecipato (cioè ha l&apos;entrata registrata). Peso massimo complessivo: 25 MB.</p>
      {s.documenti.length === 0 ? <p className="text-sm mb-3">Nessun documento caricato.</p> : (
        <ul className="space-y-2 mb-3">
          {s.documenti.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-md bg-secondary/50 p-3" data-testid={`documento-corso-${d.id}`}>
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{d.nome}</div>
                <div className="text-xs text-muted-foreground">
                  {formatoDimensione(d.dimensione)} · caricato il {fmtIstante(d.caricatoIl)}
                  {d.inviatoIl && <> · <Badge variant="outline" className="ml-1">Inviato a {d.inviatoA} il {fmtIstante(d.inviatoIl)}</Badge></>}
                </div>
              </div>
              <Button asChild size="sm" variant="outline"><a href={urlDocumentoEvento(id, d.id)} data-testid={`link-scarica-documento-${d.id}`}><Download className="size-3.5 mr-1.5" /> Scarica</a></Button>
              <Button size="sm" variant="ghost" onClick={() => setDaTogliere(d)} aria-label="Elimina" data-testid={`button-elimina-documento-${d.id}`}><Trash2 className="size-3.5" /></Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <SelettoreFile onFile={carica} disabled={occupato} accept={FORMATI_DOCUMENTI_CORSO} testId="button-carica-documento">
          {occupato ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Upload className="size-4 mr-2" />}Carica un documento
        </SelettoreFile>
        <Button size="sm" disabled={s.documenti.length === 0 || presentiConEmail === 0 || invia.isPending} data-testid="button-invia-documenti"
          onClick={() => invia.mutate({ id, data: { documentiIds: (nuovi.length ? nuovi : s.documenti).map((d) => d.id) } }, {
            onSuccess: (r) => {
              toast({ title: "Documenti inviati", description: `${r.inviati} ${r.inviati === 1 ? "presente" : "presenti"}${r.senzaEmail ? `, ${r.senzaEmail} senza email` : ""}.` });
              qc.invalidateQueries({ queryKey: getGetEventoBackofficeQueryKey(id) });
            },
            onError: (e) => toast({ variant: "destructive", title: "Invio non riuscito", description: parseApiError(e).message }),
          })}>
          {invia.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Mail className="size-4 mr-2" />}{nuovi.length === 0 && s.documenti.length > 0 ? "Invia di nuovo ai presenti" : "Invia ai presenti"} ({presentiConEmail})
        </Button>
      </div>
      {s.documenti.length > 0 && presenti === 0 && <p className="text-xs text-muted-foreground mt-2">Nessun partecipante risulta presente: registra prima le entrate.</p>}
      {presenti > presentiConEmail && <p className="text-xs text-muted-foreground mt-2">{presenti - presentiConEmail} {presenti - presentiConEmail === 1 ? "presente non ha" : "presenti non hanno"} un indirizzo email e non riceveranno nulla.</p>}
      <ConfermaElimina aperto={!!daTogliere} titolo={`Eliminare "${daTogliere?.nome ?? ""}"?`} testo="Il file viene cancellato; le email già inviate restano ai destinatari."
        onAnnulla={() => setDaTogliere(null)}
        onConferma={() => { const d = daTogliere!; setDaTogliere(null); elimina.mutate({ id, documentoId: d.id }, { onSuccess: (r) => { onSalva(r); toast({ title: "Documento eliminato" }); }, onError: onErrore }); }} />
    </section>
  );
}
