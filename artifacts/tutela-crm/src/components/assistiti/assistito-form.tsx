import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Link } from "wouter";
import {
  getGetAssistitoQueryKey, getListAssistitiQueryKey, useCreateAssistito, useUpdateAssistito, type Assistito,
} from "@workspace/api-client-react";
import { normalizzaCodiceFiscale } from "@workspace/anagrafica";
import { Info, Loader2, OctagonAlert, Save } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AnagraficaFields, anagraficaEmailFacoltativaSchema, Campo, type AnagraficaValues } from "@/components/anagrafica/anagrafica-fields";
import { parseApiError, type ParsedError } from "@/lib/format";

const schema = anagraficaEmailFacoltativaSchema.extend({
  citta: z.string().trim().min(1, "La città è obbligatoria"),
  indirizzo: z.string().optional(),
});
type Values = z.infer<typeof schema>;

const CODICI_DUPLICATO = ["ASSISTITO_GIA_PRESENTE", "ASSISTITO_GIA_NEI_TUOI_ELENCHI"];

function Sezione({ t, children }: { t: string; children: React.ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-lg p-5">
      <h2 className="text-lg font-bold mb-4 pb-2 border-b border-border">{t}</h2>{children}
    </section>
  );
}

export function AssistitoForm({ initial, base, onSaved, onCancel }: { initial?: Assistito; base: string; onSaved: (id: number) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const create = useCreateAssistito();
  const update = useUpdateAssistito();
  const [srv, setSrv] = useState<(ParsedError & { assistitoId?: number }) | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: initial ? {
      nome: initial.nome, cognome: initial.cognome, sesso: initial.sesso, dataNascita: initial.dataNascita,
      luogoNascitaCodice: initial.luogoNascitaCodice,
      luogoNascitaEtichetta: initial.luogoNascitaProvincia ? `${initial.luogoNascitaNome} (${initial.luogoNascitaProvincia})` : initial.luogoNascitaNome,
      nazionalita: initial.nazionalita, codiceFiscale: initial.codiceFiscale, email: initial.email ?? "", telefono: "",
      cellulare: initial.cellulare, citta: initial.citta, indirizzo: initial.indirizzo ?? "",
    } : {
      nome: "", cognome: "", sesso: undefined as unknown as "M", dataNascita: "", luogoNascitaCodice: "", luogoNascitaEtichetta: "",
      nazionalita: "IT", codiceFiscale: "", email: "", telefono: "", cellulare: "", citta: "", indirizzo: "",
    },
  });
  const { errors } = form.formState;

  const salva = form.handleSubmit((v) => {
    setSrv(null);
    const data = {
      nome: v.nome.trim(), cognome: v.cognome.trim(), sesso: v.sesso, dataNascita: v.dataNascita,
      luogoNascitaCodice: v.luogoNascitaCodice, nazionalita: v.nazionalita, codiceFiscale: normalizzaCodiceFiscale(v.codiceFiscale),
      cellulare: v.cellulare.trim(), citta: v.citta.trim(),
      indirizzo: v.indirizzo?.trim() || null, email: v.email.trim() || null,
    };
    const onError = (err: unknown) => {
      const p = parseApiError(err);
      const extra = (err as { data?: { assistitoId?: number } }).data;
      setSrv({ ...p, assistitoId: extra?.assistitoId });
      // Nei messaggi di duplicato non compare mai chi sia la persona gia presente: si evidenzia solo il campo.
      if (p.campo && p.campo in v) form.setError(p.campo as keyof Values, { message: CODICI_DUPLICATO.includes(p.code ?? "") ? "Valore già presente" : p.message });
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    const fatto = (id: number) => {
      qc.invalidateQueries({ queryKey: getListAssistitiQueryKey() });
      qc.invalidateQueries({ queryKey: getGetAssistitoQueryKey(id) });
      onSaved(id);
    };
    if (initial) update.mutate({ id: initial.id, data }, { onSuccess: (a) => fatto(a.id), onError });
    else create.mutate({ data }, { onSuccess: (a) => fatto(a.id), onError });
  });
  const pending = create.isPending || update.isPending;
  const presente = srv?.code === "ASSISTITO_GIA_PRESENTE";
  const nei = srv?.code === "ASSISTITO_GIA_NEI_TUOI_ELENCHI";

  return (
    <FormProvider {...(form as unknown as ReturnType<typeof useForm<AnagraficaValues>>)}>
      <form onSubmit={salva} className="space-y-5 rise" data-testid="form-assistito" noValidate>
        {srv && (
          <div role="alert" data-testid="errore-server"
            className={presente || nei ? "flex gap-3 rounded-lg border-2 border-destructive bg-destructive/10 p-4" : "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive font-medium"}>
            {(presente || nei) && <OctagonAlert className="size-6 text-destructive shrink-0" />}
            <div>
              {presente && <div className="font-bold text-destructive mb-0.5">Assistito già presente</div>}
              {nei && <div className="font-bold text-destructive mb-0.5">Assistito già nei tuoi elenchi</div>}
              <div className={presente || nei ? "text-sm" : ""} data-testid="testo-errore-server">{srv.message}</div>
              {nei && srv.assistitoId && (
                <Link href={`${base}/${srv.assistitoId}`} className="text-sm font-semibold underline mt-1 inline-block" data-testid="link-assistito-esistente">Apri la scheda dell'assistito</Link>
              )}
            </div>
          </div>
        )}
        <Sezione t="Dati anagrafici"><AnagraficaFields emailObbligatoria={false} mostraTelefono={false} /></Sezione>
        <Sezione t="Residenza">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Città" name="citta" required err={errors.citta?.message}>
              <Input id="input-citta" autoComplete="off" {...form.register("citta")} className={errors.citta ? "border-destructive" : ""} data-testid="input-citta" />
            </Campo>
            <Campo label="Indirizzo (facoltativo)" name="indirizzo" err={errors.indirizzo?.message}>
              <Input id="input-indirizzo" autoComplete="off" {...form.register("indirizzo")} data-testid="input-indirizzo" />
            </Campo>
          </div>
        </Sezione>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Info className="size-3.5" /> Codice fiscale e cellulare devono essere univoci in tutta la piattaforma.</p>
        <div className="flex gap-2 sticky bottom-0 py-3 bg-background/90 backdrop-blur border-t border-border -mx-1 px-1">
          <Button type="submit" disabled={pending} data-testid="button-salva-assistito">
            {pending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Save className="size-4 mr-2" />} {initial ? "Salva modifiche" : "Crea assistito"}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} data-testid="button-annulla">Annulla</Button>
        </div>
      </form>
    </FormProvider>
  );
}

