import { useState } from "react";
import { useSaveQuizEvento, type DomandaQuiz, type EventoBackoffice, type QuizEvento } from "@workspace/api-client-react";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/common";
import { useToast } from "@/hooks/use-toast";
import { parseApiError } from "@/lib/format";

const nuova = (): DomandaQuiz => ({ testo: "", opzioni: ["", "", ""], corretta: 0 });

/** Costruisce il questionario online: domande a scelta multipla con una risposta esatta (1 punto) e punteggio minimo per passare. */
export function QuizEditor({ id, iniziale, onSalva, onChiudi }: { id: number; iniziale: QuizEvento | null; onSalva: (d: EventoBackoffice) => void; onChiudi: () => void }) {
  const { toast } = useToast();
  const salva = useSaveQuizEvento();
  const [domande, setDomande] = useState<DomandaQuiz[]>(iniziale?.domande.length ? iniziale.domande.map((d) => ({ ...d, opzioni: [...d.opzioni] })) : [nuova()]);
  const [minimo, setMinimo] = useState(String(iniziale?.punteggioMinimo ?? 1));
  const [errore, setErrore] = useState<string | null>(null);

  const cambia = (i: number, patch: Partial<DomandaQuiz>) => setDomande((l) => l.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  const cambiaOpzione = (i: number, j: number, testo: string) => setDomande((l) => l.map((d, k) => (k === i ? { ...d, opzioni: d.opzioni.map((o, n) => (n === j ? testo : o)) } : d)));
  const togliOpzione = (i: number, j: number) =>
    setDomande((l) => l.map((d, k) => (k !== i ? d : { ...d, opzioni: d.opzioni.filter((_, n) => n !== j), corretta: d.corretta === j ? 0 : d.corretta > j ? d.corretta - 1 : d.corretta })));
  const sposta = (i: number, verso: -1 | 1) => setDomande((l) => {
    const j = i + verso;
    if (j < 0 || j >= l.length) return l;
    const copia = [...l];
    [copia[i], copia[j]] = [copia[j]!, copia[i]!];
    return copia;
  });

  const invia = () => {
    setErrore(null);
    for (const [i, d] of domande.entries()) {
      if (!d.testo.trim()) return setErrore(`La domanda ${i + 1} è vuota.`);
      if (d.opzioni.some((o) => !o.trim())) return setErrore(`La domanda ${i + 1} ha una risposta vuota: compilala o eliminala.`);
      if (new Set(d.opzioni.map((o) => o.trim().toLowerCase())).size !== d.opzioni.length) return setErrore(`La domanda ${i + 1} ha due risposte uguali.`);
    }
    const n = Number(minimo);
    if (!Number.isInteger(n) || n < 1) return setErrore("Il punteggio minimo deve essere un numero intero, almeno 1.");
    if (n > domande.length) return setErrore(`Il punteggio minimo non può superare il numero di domande (${domande.length}).`);
    salva.mutate(
      { id, data: { punteggioMinimo: n, domande: domande.map((d) => ({ testo: d.testo.trim(), opzioni: d.opzioni.map((o) => o.trim()), corretta: d.corretta })) } },
      { onSuccess: (r) => { onSalva(r); toast({ title: "Questionario online salvato" }); onChiudi(); }, onError: (e) => setErrore(parseApiError(e).message) },
    );
  };

  return (
    <div className="space-y-4" data-testid="editor-quiz">
      {domande.map((d, i) => (
        <div key={i} className="rounded-lg border border-border bg-background p-4 space-y-3" data-testid={`quiz-domanda-${i}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold">Domanda {i + 1}</span>
            <div className="flex items-center gap-1">
              <Button type="button" size="icon" variant="ghost" disabled={i === 0} onClick={() => sposta(i, -1)} aria-label="Sposta su"><ArrowUp className="size-4" /></Button>
              <Button type="button" size="icon" variant="ghost" disabled={i === domande.length - 1} onClick={() => sposta(i, 1)} aria-label="Sposta giù"><ArrowDown className="size-4" /></Button>
              <Button type="button" size="icon" variant="ghost" disabled={domande.length === 1} onClick={() => setDomande((l) => l.filter((_, k) => k !== i))} aria-label="Elimina la domanda" data-testid={`quiz-elimina-domanda-${i}`}><Trash2 className="size-4" /></Button>
            </div>
          </div>
          <div>
            <Label htmlFor={`quiz-testo-${i}`} className="text-xs">Testo della domanda</Label>
            <Textarea id={`quiz-testo-${i}`} rows={2} maxLength={500} value={d.testo} onChange={(e) => cambia(i, { testo: e.target.value })} className="mt-1" data-testid={`quiz-testo-${i}`} />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium mb-1">Risposte: scegli con il pallino quella esatta</legend>
            {d.opzioni.map((o, j) => (
              <div key={j} className="flex items-center gap-2">
                <input type="radio" name={`quiz-corretta-${i}`} checked={d.corretta === j} onChange={() => cambia(i, { corretta: j })} className="size-4 accent-[hsl(var(--primary))]" aria-label={`Risposta esatta: ${j + 1}`} data-testid={`quiz-corretta-${i}-${j}`} />
                <Input value={o} maxLength={200} placeholder={`Risposta ${j + 1}`} onChange={(e) => cambiaOpzione(i, j, e.target.value)} data-testid={`quiz-opzione-${i}-${j}`} />
                <Button type="button" size="icon" variant="ghost" disabled={d.opzioni.length <= 2} onClick={() => togliOpzione(i, j)} aria-label="Togli la risposta"><X className="size-4" /></Button>
              </div>
            ))}
            {d.opzioni.length < 8 && (
              <Button type="button" size="sm" variant="ghost" onClick={() => cambia(i, { opzioni: [...d.opzioni, ""] })} data-testid={`quiz-aggiungi-opzione-${i}`}><Plus className="size-3.5 mr-1.5" /> Aggiungi una risposta</Button>
            )}
          </fieldset>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={() => setDomande((l) => [...l, nuova()])} data-testid="quiz-aggiungi-domanda"><Plus className="size-4 mr-2" /> Aggiungi una domanda</Button>
      <div className="rounded-lg border border-border bg-background p-4">
        <Label htmlFor="quiz-minimo">Punteggio minimo per passare</Label>
        <div className="flex items-center gap-2 mt-1">
          <Input id="quiz-minimo" type="number" min={1} max={domande.length} value={minimo} onChange={(e) => setMinimo(e.target.value)} className="w-24" data-testid="quiz-minimo" />
          <span className="text-sm text-muted-foreground">su {domande.length} (ogni risposta esatta vale 1 punto)</span>
        </div>
      </div>
      <FieldError id="errore-quiz">{errore}</FieldError>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onChiudi}>Annulla</Button>
        <Button type="button" onClick={invia} disabled={salva.isPending} data-testid="quiz-salva">{salva.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}Salva il questionario</Button>
      </div>
    </div>
  );
}
