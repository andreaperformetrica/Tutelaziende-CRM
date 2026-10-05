import { useMemo, useState } from "react";
import { FormProvider, useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCollaboratoreQueryKey, getListCollaboratoriQueryKey, useCreateCollaboratore, useListCollaboratori, useUpdateCollaboratore,
  type CollaboratoreDettaglio,
} from "@workspace/api-client-react";
import { normalizzaCodiceFiscale } from "@workspace/anagrafica";
import { Loader2, OctagonAlert, Save } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AnagraficaFields, anagraficaSchema, type AnagraficaValues } from "@/components/anagrafica/anagrafica-fields";
import { PasswordProvvisoria } from "@/components/password-provvisoria";
import { FieldError } from "@/components/common";
import { parseApiError, type ParsedError } from "@/lib/format";

const schema = anagraficaSchema.extend({
  numeroSportello: z.string().trim().min(1, "Inserisci il numero di sportello"),
  tipologia: z.enum(["CAF", "PATRONATO"], { errorMap: () => ({ message: "Seleziona la tipologia" }) }),
  capogruppoId: z.string(),
  attivo: z.boolean(),
  passwordProvvisoria: z.string(),
});
type Values = z.infer<typeof schema>;

export function CollaboratoreForm({ initial, onSaved, onCancel }: { initial?: CollaboratoreDettaglio; onSaved: (id: number) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const create = useCreateCollaboratore();
  const update = useUpdateCollaboratore();
  const [srv, setSrv] = useState<ParsedError | null>(null);
  const { data: attivi } = useListCollaboratori({ stato: "attivi" });

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: initial ? {
      nome: initial.nome, cognome: initial.cognome, sesso: initial.sesso, dataNascita: initial.dataNascita,
      luogoNascitaCodice: initial.luogoNascitaCodice,
      luogoNascitaEtichetta: initial.luogoNascitaProvincia ? `${initial.luogoNascitaNome} (${initial.luogoNascitaProvincia})` : initial.luogoNascitaNome,
      nazionalita: initial.nazionalita, codiceFiscale: initial.codiceFiscale, email: initial.email, telefono: initial.telefono ?? "",
      cellulare: initial.cellulare, numeroSportello: initial.numeroSportello, tipologia: initial.tipologia,
      capogruppoId: initial.capogruppoId ? String(initial.capogruppoId) : "none", attivo: initial.attivo, passwordProvvisoria: "",
    } : {
      nome: "", cognome: "", sesso: undefined as unknown as "M", dataNascita: "", luogoNascitaCodice: "", luogoNascitaEtichetta: "",
      nazionalita: "IT", codiceFiscale: "", email: "", telefono: "", cellulare: "", numeroSportello: "",
      tipologia: undefined as unknown as "CAF", capogruppoId: "none", attivo: true, passwordProvvisoria: "",
    },
  });
  const { errors } = form.formState;
  const haMembri = (initial?.numeroCollaboratori ?? 0) > 0;

  const opzioni = useMemo(() => {
    const l = (attivi ?? []).filter((c) => c.attivo && c.capogruppoId === null && c.id !== initial?.id)
      .map((c) => ({ id: c.id, label: `${c.cognome} ${c.nome} · sportello ${c.numeroSportello}` }));
    if (initial?.capogruppoId && !l.some((o) => o.id === initial.capogruppoId)) l.push({ id: initial.capogruppoId, label: initial.capogruppoNome ?? `Collaboratore ${initial.capogruppoId}` });
    return l.sort((a, b) => a.label.localeCompare(b.label, "it"));
  }, [attivi, initial]);

  const salva = form.handleSubmit((v) => {
    setSrv(null);
    if (!initial && v.passwordProvvisoria.length < 8) {
      form.setError("passwordProvvisoria", { message: "La password provvisoria deve avere almeno 8 caratteri" });
      return;
    }
    const base = {
      nome: v.nome.trim(), cognome: v.cognome.trim(), sesso: v.sesso, dataNascita: v.dataNascita,
      luogoNascitaCodice: v.luogoNascitaCodice, nazionalita: v.nazionalita, codiceFiscale: normalizzaCodiceFiscale(v.codiceFiscale),
      email: v.email.trim(), telefono: v.telefono?.trim() || null, cellulare: v.cellulare.trim(),
      numeroSportello: v.numeroSportello.trim(), tipologia: v.tipologia,
      capogruppoId: v.capogruppoId === "none" ? null : Number(v.capogruppoId),
    };
    const onError = (err: unknown) => {
      const p = parseApiError(err);
      setSrv(p);
      const campo = p.code === "CODICE_FISCALE_DUPLICATO" ? "codiceFiscale" : p.code === "CELLULARE_DUPLICATO" ? "cellulare"
        : p.code === "EMAIL_DUPLICATA" ? "email" : p.code === "SPORTELLO_DUPLICATO" ? "numeroSportello" : p.campo;
      if (campo && campo in v) form.setError(campo as keyof Values, { message: p.message });
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    const fatto = (id: number) => {
      qc.invalidateQueries({ queryKey: getListCollaboratoriQueryKey() });
      qc.invalidateQueries({ queryKey: getGetCollaboratoreQueryKey(id) });
      onSaved(id);
    };
    if (initial) update.mutate({ id: initial.id, data: { ...base, attivo: v.attivo } }, { onSuccess: (c) => fatto(c.id), onError });
    else create.mutate({ data: { ...base, passwordProvvisoria: v.passwordProvvisoria } }, { onSuccess: (c) => fatto(c.id), onError });
  });
  const pending = create.isPending || update.isPending;
  const duplicato = srv?.code === "CODICE_FISCALE_DUPLICATO" || srv?.code === "CELLULARE_DUPLICATO";

  const Sezione = ({ t, children }: { t: string; children: React.ReactNode }) => (
    <section className="bg-card border border-border rounded-lg p-5">
      <h2 className="text-lg font-bold mb-4 pb-2 border-b border-border">{t}</h2>{children}
    </section>
  );

  return (
    <FormProvider {...(form as unknown as ReturnType<typeof useForm<AnagraficaValues>>)}>
      <form onSubmit={salva} className="space-y-5 rise" data-testid="form-collaboratore" noValidate>
        {srv && (
          <div role="alert" data-testid="errore-server"
            className={duplicato ? "flex gap-3 rounded-lg border-2 border-destructive bg-destructive/10 p-4" : "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive font-medium"}>
            {duplicato && <OctagonAlert className="size-6 text-destructive shrink-0" />}
            <div>
              {duplicato && <div className="font-bold text-destructive mb-0.5">Salvataggio bloccato: dato già presente in archivio</div>}
              <div className={duplicato ? "text-sm" : ""}>{srv.message}</div>
            </div>
          </div>
        )}
        <Sezione t="Dati anagrafici"><AnagraficaFields /></Sezione>
        <Sezione t="Incarico">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="input-numeroSportello" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Numero di sportello *</Label>
              <Input id="input-numeroSportello" {...form.register("numeroSportello")} className={errors.numeroSportello ? "border-destructive" : ""} data-testid="input-numero-sportello" />
              <FieldError id="error-numeroSportello">{errors.numeroSportello?.message}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tipologia *</Label>
              <Controller control={form.control} name="tipologia" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className={errors.tipologia ? "border-destructive" : ""} data-testid="select-tipologia"><SelectValue placeholder="Seleziona" /></SelectTrigger>
                  <SelectContent><SelectItem value="CAF">CAF</SelectItem><SelectItem value="PATRONATO">Patronato</SelectItem></SelectContent>
                </Select>
              )} />
              <FieldError>{errors.tipologia?.message}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Capogruppo</Label>
              <Controller control={form.control} name="capogruppoId" render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={haMembri}>
                  <SelectTrigger data-testid="select-capogruppo"><SelectValue placeholder="Nessuno" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nessun capogruppo</SelectItem>
                    {opzioni.map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              )} />
              {haMembri
                ? <p className="text-xs text-muted-foreground" data-testid="nota-capogruppo">Questo collaboratore è capogruppo di {initial?.numeroCollaboratori} {initial?.numeroCollaboratori === 1 ? "collaboratore" : "collaboratori"}: non può a sua volta avere un capogruppo.</p>
                : <p className="text-xs text-muted-foreground">Solo collaboratori attivi che non appartengono già a un gruppo.</p>}
            </div>
          </div>
          {initial && (
            <label className="mt-5 flex items-center gap-3 text-sm font-medium">
              <Controller control={form.control} name="attivo" render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-attivo" />} />
              Collaboratore attivo (può accedere al Web Collaboratore)
            </label>
          )}
        </Sezione>
        {!initial && (
          <Sezione t="Accesso">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block">Password provvisoria *</Label>
            <Controller control={form.control} name="passwordProvvisoria" render={({ field }) => (
              <PasswordProvvisoria value={field.value} onChange={field.onChange} invalid={!!errors.passwordProvvisoria} />
            )} />
            <FieldError id="error-passwordProvvisoria">{errors.passwordProvvisoria?.message}</FieldError>
          </Sezione>
        )}
        <div className="flex gap-2 sticky bottom-0 py-3 bg-background/90 backdrop-blur border-t border-border -mx-1 px-1">
          <Button type="submit" disabled={pending} data-testid="button-salva-collaboratore">
            {pending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Save className="size-4 mr-2" />} {initial ? "Salva modifiche" : "Crea collaboratore"}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} data-testid="button-annulla">Annulla</Button>
        </div>
      </form>
    </FormProvider>
  );
}
