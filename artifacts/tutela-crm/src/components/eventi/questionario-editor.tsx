import { useState } from "react";
import { useSaveQuestionarioEvento, type DomandaQuestionario, type EventoBackoffice } from "@workspace/api-client-react";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const nuovaScelta = (): DomandaQuestionario => ({ testo: "", tipo: "scelta", opzioni: ["", ""], righe: 3 });
const nuovaAperta = (): DomandaQuestionario => ({ testo: "", tipo: "aperta", opzioni: [], righe: 3 });

interface Props {
  id: number;
  iniziali: DomandaQuestionario[];
  onSalva: (d: EventoBackoffice) => void;
  onErrore: (e: unknown) => void;
  onChiudi: () => void;
}

/** Costruisce le domande del questionario (caselle da spuntare o risposta aperta); al salvataggio si genera il PDF da stampare. */
export function QuestionarioEditor({ id, iniziali, onSalva, onErrore, onChiudi }: Props) {
  const { toast } = useToast();
  const salva = useSaveQuestionarioEvento();
  const [domande, setDomande] = useState<DomandaQuestionario[]>(iniziali.length ? iniziali.map((d) => ({ ...d, opzioni: [...d.opzioni] })) : [nuovaScelta()]);
  const [errore, setErrore] = useState<string | null>(null);

  const cambia = (i: number, patch: Partial<DomandaQuestionario>) => setDomande((l) => l.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  const sposta = (i: number, verso: -1 | 1) => setDomande((l) => {
    const j = i + verso;
    if (j < 0 || j >= l.length) return l;
    const copia = [...l];
    [copia[i], copia[j]] = [copia[j]!, copia[i]!];
    return copia;
  });
  const cambiaTipo = (i: number, tipo: "scelta" | "aperta") =>
    setDomande((l) => l.map((d, k) => (k !== i ? d : tipo === "scelta" ? { ...d, tipo, opzioni: d.opzioni.length >= 2 ? d.opzioni : ["", ""] } : { ...d, tipo, opzioni: [] })));

  const invia = () => {
    setErrore(null);
    for (const [i, d] of domande.entries()) {
      if (!d.testo.trim()) return setErrore(`La domanda ${i + 1} è vuota.`);
      if (d.tipo === "scelta" && d.opzioni.filter((o) => o.trim()).length < 2) return setErrore(`La domanda ${i + 1} deve avere almeno due risposte da spuntare.`);
    }
    salva.mutate(
      { id, data: { domande: domande.map((d) => ({ ...d, testo: d.testo.trim(), opzioni: d.tipo === "scelta" ? d.opzioni.map((o) => o.trim()).filter(Boolean) : [] })) } },
      { onSuccess: (r) => { onSalva(r); toast({ title: "Questionario salvato", description: "Il PDF da stampare è pronto." }); onChiudi(); }, onError: onErrore },
    );
  };

  return (
    <div className="space-y-4" data-testid="editor-questionario">
      {domande.map((d, i) => (
        <div key={i} className="rounded-lg border border-border bg-background p-4 space-y-3" data-testid={`domanda-${i}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold">Domanda {i + 1}</span>
            <div className="flex items-center gap-1">
              <Button type="button" size="icon" variant="ghost" disabled={i === 0} onClick={() => sposta(i, -1)} aria-label="Sposta su"><ArrowUp className="size-4" /></Button>
              <Button type="button" size="icon" variant="ghost" disabled={i === domande.length - 1} onClick={() => sposta(i, 1)} aria-label="Sposta giù"><ArrowDown className="size-4" /></Button>
              <Button type="button" size="icon" variant="ghost" disabled={domande.length === 1} onClick={() => setDomande((l) => l.filter((_, k) => k !== i))} aria-label="Elimina la domanda" data-testid={`elimina-domanda-${i}`}><Trash2 className="size-4" /></Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
            <div>
              <Label htmlFor={`testo-${i}`} className="text-xs">Testo della domanda</Label>
              <Textarea id={`testo-${i}`} rows={2} maxLength={500} value={d.testo} onChange={(e) => cambia(i, { testo: e.target.value })} className="mt-1" data-testid={`testo-domanda-${i}`} />
            </div>
            <div>
              <Label className="text-xs">Tipo di risposta</Label>
              <Select value={d.tipo} onValueChange={(v) => cambiaTipo(i, v as "scelta" | "aperta")}>
                <SelectTrigger className="mt-1 bg-card" data-testid={`tipo-domanda-${i}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="scelta">Caselle da spuntare</SelectItem>
                  <SelectItem value="aperta">Risposta aperta</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {d.tipo === "scelta" ? (
            <div className="space-y-2">
              <Label className="text-xs">Risposte tra cui scegliere</Label>
              {d.opzioni.map((o, k) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="size-4 shrink-0 rounded-[3px] border border-foreground/70" aria-hidden />
                  <Input value={o} maxLength={200} placeholder={`Risposta ${k + 1}`} onChange={(e) => cambia(i, { opzioni: d.opzioni.map((x, n) => (n === k ? e.target.value : x)) })} data-testid={`opzione-${i}-${k}`} />
                  <Button type="button" size="icon" variant="ghost" disabled={d.opzioni.length <= 2} onClick={() => cambia(i, { opzioni: d.opzioni.filter((_, n) => n !== k) })} aria-label="Togli la risposta"><X className="size-4" /></Button>
                </div>
              ))}
              <Button type="button" size="sm" variant="outline" disabled={d.opzioni.length >= 15} onClick={() => cambia(i, { opzioni: [...d.opzioni, ""] })} data-testid={`aggiungi-opzione-${i}`}><Plus className="size-3.5 mr-1.5" /> Aggiungi risposta</Button>
            </div>
          ) : (
            <div className="w-40">
              <Label htmlFor={`righe-${i}`} className="text-xs">Righe per rispondere</Label>
              <Input id={`righe-${i}`} type="number" min={1} max={10} value={d.righe} className="mt-1" onChange={(e) => cambia(i, { righe: Math.min(10, Math.max(1, Math.round(Number(e.target.value) || 1))) })} data-testid={`righe-${i}`} />
            </div>
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={domande.length >= 60} onClick={() => setDomande((l) => [...l, nuovaScelta()])} data-testid="aggiungi-domanda-scelta"><Plus className="size-3.5 mr-1.5" /> Domanda con caselle</Button>
        <Button type="button" variant="outline" size="sm" disabled={domande.length >= 60} onClick={() => setDomande((l) => [...l, nuovaAperta()])} data-testid="aggiungi-domanda-aperta"><Plus className="size-3.5 mr-1.5" /> Domanda a risposta aperta</Button>
      </div>
      {errore && <p className="text-sm text-destructive" role="alert" data-testid="errore-questionario">{errore}</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button onClick={invia} disabled={salva.isPending} data-testid="button-salva-questionario">
          {salva.isPending && <Loader2 className="size-4 mr-2 animate-spin" />} Salva e genera il PDF
        </Button>
        <Button variant="ghost" onClick={onChiudi} disabled={salva.isPending}>Annulla</Button>
      </div>
    </div>
  );
}
