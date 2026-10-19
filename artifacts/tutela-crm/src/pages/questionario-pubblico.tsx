import { useState } from "react";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetQuestionarioPubblicoQueryKey, useGetQuestionarioPubblico, useInviaRisposteQuestionario, type QuizPubblico } from "@workspace/api-client-react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FieldError } from "@/components/common";
import { cn } from "@/lib/utils";
import { fmtData, parseApiError } from "@/lib/format";

/** Questionario del corso, aperto dal link personale ricevuto per email (senza accesso). Si compila una sola volta. */
export default function QuestionarioPubblico() {
  const { token = "" } = useParams<{ token: string }>();
  const qc = useQueryClient();
  const q = useGetQuestionarioPubblico(token, { query: { retry: false, queryKey: getGetQuestionarioPubblicoQueryKey(token) } });
  const invia = useInviaRisposteQuestionario();
  const [risposte, setRisposte] = useState<Record<number, number>>({});
  const [err, setErr] = useState<string | null>(null);

  const d: QuizPubblico | undefined = q.data;
  const invio = () => {
    if (!d) return;
    setErr(null);
    const n = d.domande.length;
    if (d.domande.some((_, i) => risposte[i] === undefined)) return setErr(`Rispondi a tutte le domande (${Object.keys(risposte).length} su ${n}).`);
    invia.mutate({ token, data: { risposte: d.domande.map((_, i) => risposte[i]!) } }, {
      onSuccess: (r) => qc.setQueryData(getGetQuestionarioPubblicoQueryKey(token), r),
      onError: (e) => { setErr(parseApiError(e).message); qc.invalidateQueries({ queryKey: getGetQuestionarioPubblicoQueryKey(token) }); },
    });
  };

  return (
    <div className="min-h-dvh bg-secondary/40">
      <header className="bg-primary px-4 py-4">
        <div className="max-w-2xl mx-auto"><img src={`${import.meta.env.BASE_URL}logo-bianco.png`} alt="Tutelaziende" className="h-9 w-auto" /></div>
      </header>
      <main className="max-w-2xl mx-auto p-4 sm:p-6 space-y-5">
        {q.isLoading && <Skeleton className="h-64 w-full" />}
        {q.isError && (
          <div className="rounded-lg border border-destructive/40 bg-card p-6 text-center" role="alert" data-testid="questionario-errore">
            <h1 className="text-xl font-bold mb-2">Link non valido</h1>
            <p className="text-sm text-muted-foreground">{parseApiError(q.error).message} Controlla di aver aperto il link ricevuto per email.</p>
          </div>
        )}
        {d && (
          <>
            <div>
              <h1 className="text-2xl font-bold leading-tight" data-testid="text-titolo-questionario">Questionario: {d.titolo}</h1>
              <p className="text-sm text-muted-foreground mt-1">Corso del {fmtData(d.data)} · {d.partecipante}</p>
            </div>
            {d.stato === "compilato" && d.esito ? (
              <section className={cn("rounded-lg border-2 p-6 text-center", d.esito.superato ? "border-emerald-600/50 bg-emerald-50 text-emerald-950" : "border-destructive/40 bg-destructive/5 text-destructive")} role="status" data-testid="esito-questionario">
                {d.esito.superato ? <CheckCircle2 className="size-12 mx-auto mb-2" /> : <XCircle className="size-12 mx-auto mb-2" />}
                <h2 className="text-2xl font-bold" data-testid="testo-esito">{d.esito.superato ? "Questionario superato" : "Questionario non superato"}</h2>
                <p className="mt-2 text-lg tabular-nums" data-testid="testo-punteggio">Punteggio: <strong>{d.esito.punteggio}</strong> su {d.esito.punteggioMassimo} (minimo richiesto: {d.esito.punteggioMinimo})</p>
                <p className="mt-3 text-sm opacity-80">Il questionario si può compilare una sola volta: questo link non permette di ripeterlo.</p>
              </section>
            ) : (
              <form className="space-y-4" onSubmit={(ev) => { ev.preventDefault(); invio(); }} data-testid="form-questionario">
                <p className="text-sm rounded-md bg-card border border-border p-3">
                  Scegli una risposta per ogni domanda. Per superare il questionario servono almeno <strong>{d.punteggioMinimo}</strong> risposte esatte su {d.domande.length}.
                  <strong> Puoi inviarlo una sola volta</strong>: dopo l&apos;invio non sarà possibile ripeterlo.
                </p>
                {d.domande.map((dom, i) => (
                  <fieldset key={i} className="rounded-lg border border-border bg-card p-4 space-y-2" data-testid={`domanda-pubblica-${i}`}>
                    <legend className="font-semibold px-1">{i + 1}. {dom.testo}</legend>
                    {dom.opzioni.map((o, j) => (
                      <label key={j} className={cn("flex items-start gap-3 rounded-md border p-3 cursor-pointer min-h-11", risposte[i] === j ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/50")}>
                        <input type="radio" name={`d-${i}`} className="mt-1 size-4 accent-[hsl(var(--primary))]" checked={risposte[i] === j} onChange={() => setRisposte((r) => ({ ...r, [i]: j }))} data-testid={`risposta-${i}-${j}`} />
                        <span className="text-sm">{o}</span>
                      </label>
                    ))}
                  </fieldset>
                ))}
                <FieldError id="errore-questionario">{err}</FieldError>
                <Button type="submit" size="lg" className="w-full" disabled={invia.isPending} data-testid="button-invia-risposte">
                  {invia.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}Invia le risposte
                </Button>
              </form>
            )}
          </>
        )}
      </main>
    </div>
  );
}
