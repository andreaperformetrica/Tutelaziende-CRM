import { useState } from "react";
import { useDeleteQuizEvento, useInviaQuizEvento, type EventoBackoffice } from "@workspace/api-client-react";
import { CheckCircle2, ClipboardCheck, Loader2, Mail, Pencil, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ConfermaElimina } from "@/components/pratiche/conferma-elimina";
import { QuizEditor } from "@/components/eventi/quiz-editor";
import { useToast } from "@/hooks/use-toast";
import { fmtIstante, parseApiError } from "@/lib/format";

/** Esito del questionario online di un partecipante, in forma breve. */
export function EsitoQuizBadge({ quiz }: { quiz: EventoBackoffice["partecipanti"][number]["quiz"] }) {
  if (!quiz) return <span className="text-muted-foreground">—</span>;
  if (!quiz.compilatoIl) return <Badge variant="outline">Inviato, non compilato</Badge>;
  return quiz.superato
    ? <Badge className="bg-emerald-600 text-white hover:bg-emerald-600"><CheckCircle2 className="size-3 mr-1" />Superato {quiz.punteggio}/{quiz.punteggioMassimo}</Badge>
    : <Badge variant="destructive"><XCircle className="size-3 mr-1" />Non superato {quiz.punteggio}/{quiz.punteggioMassimo}</Badge>;
}

export function QuizOnline({ s, id, onSalva, onErrore, onAggiorna }: { s: EventoBackoffice; id: number; onSalva: (d: EventoBackoffice) => void; onErrore: (e: unknown) => void; onAggiorna: () => void }) {
  const { toast } = useToast();
  const elimina = useDeleteQuizEvento();
  const invia = useInviaQuizEvento();
  const [modifica, setModifica] = useState(false);
  const [conferma, setConferma] = useState(false);
  const [soloPresenti, setSoloPresenti] = useState(true);
  const quiz = s.quiz;
  const bloccato = !!quiz && quiz.inviati > 0;

  return (
    <section className="rounded-lg border border-border bg-card p-5" data-testid="sezione-quiz">
      <h2 className="font-bold text-lg flex items-center gap-2"><ClipboardCheck className="size-5" /> Questionario online</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-4">
        Domande a scelta multipla con una risposta esatta. Ogni partecipante riceve per email un link personale, compila il questionario una sola volta e vede subito l&apos;esito. Chi non passa non può ripetere.
      </p>
      {modifica ? (
        <QuizEditor id={id} iniziale={quiz} onSalva={onSalva} onChiudi={() => setModifica(false)} />
      ) : !quiz ? (
        <Button onClick={() => setModifica(true)} data-testid="button-crea-quiz"><Pencil className="size-4 mr-2" />Crea il questionario online</Button>
      ) : (
        <div className="space-y-4">
          <div className="rounded-md bg-secondary/50 p-3 text-sm" data-testid="riepilogo-quiz">
            <div><strong>{quiz.domande.length}</strong> {quiz.domande.length === 1 ? "domanda" : "domande"} · si passa con almeno <strong>{quiz.punteggioMinimo}</strong> risposte esatte</div>
            <div className="text-xs text-muted-foreground mt-1">Aggiornato il {fmtIstante(quiz.aggiornatoIl)} · inviato a {quiz.inviati} · compilato da {quiz.compilati}</div>
          </div>
          <ol className="list-decimal pl-5 space-y-2 text-sm">
            {quiz.domande.map((d, i) => (
              <li key={i}>
                <div className="font-medium">{d.testo}</div>
                <ul className="mt-0.5 space-y-0.5">
                  {d.opzioni.map((o, j) => <li key={j} className={j === d.corretta ? "text-emerald-700 font-medium" : "text-muted-foreground"}>{j === d.corretta ? "✓ " : "○ "}{o}</li>)}
                </ul>
              </li>
            ))}
          </ol>
          <div className="rounded-md border border-border p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox id="quiz-solo-presenti" checked={soloPresenti} onCheckedChange={(v) => setSoloPresenti(v === true)} data-testid="quiz-solo-presenti" />
              <Label htmlFor="quiz-solo-presenti" className="font-normal">Invia solo a chi ha registrato l&apos;entrata</Label>
            </div>
            <Button disabled={invia.isPending} data-testid="button-invia-quiz"
              onClick={() => invia.mutate({ id, data: { soloPresenti } }, {
                onSuccess: (r) => {
                  toast({ title: "Questionario inviato", description: `${r.inviati} email in invio${r.senzaEmail ? `, ${r.senzaEmail} senza email` : ""}${r.saltati ? `, ${r.saltati} già compilati` : ""}.` });
                  onAggiorna();
                },
                onError: (e) => toast({ variant: "destructive", title: "Invio non riuscito", description: parseApiError(e).message }),
              })}>
              {invia.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Mail className="size-4 mr-2" />}{bloccato ? "Invia di nuovo a chi non ha compilato" : "Invia il link ai partecipanti"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={bloccato} onClick={() => setModifica(true)} title={bloccato ? "Già inviato: non si può più modificare" : undefined} data-testid="button-modifica-quiz"><Pencil className="size-3.5 mr-1.5" />Modifica</Button>
            <Button variant="ghost" size="sm" disabled={bloccato} onClick={() => setConferma(true)} title={bloccato ? "Già inviato: non si può eliminare" : undefined} data-testid="button-elimina-quiz"><Trash2 className="size-3.5" /></Button>
          </div>
          {bloccato && <p className="text-xs text-muted-foreground">Dopo l&apos;invio le domande non si possono più cambiare, perché i partecipanti hanno già ricevuto il link.</p>}
        </div>
      )}
      <ConfermaElimina aperto={conferma} titolo="Eliminare il questionario online?" testo="Le domande vengono eliminate."
        onAnnulla={() => setConferma(false)}
        onConferma={() => { setConferma(false); elimina.mutate({ id }, { onSuccess: (r) => { onSalva(r); toast({ title: "Questionario eliminato" }); }, onError: onErrore }); }} />
    </section>
  );
}
