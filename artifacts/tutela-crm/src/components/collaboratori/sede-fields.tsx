import { useEffect, useRef, useState } from "react";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { z } from "zod";
import { Loader2, MapPin } from "lucide-react";
import { partitaIvaValida } from "@workspace/anagrafica";
import { getCercaLuoghiQueryKey, useCercaLuoghi, type Luogo } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Campo } from "@/components/anagrafica/anagrafica-fields";
import { cn } from "@/lib/utils";

/** Controllo dell'IBAN con la cifra di controllo (mod 97), come sul server. */
export function ibanValido(valore: string): boolean {
  const iban = valore.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith("IT") && iban.length !== 27) return false;
  let resto = 0;
  for (const c of iban.slice(4) + iban.slice(0, 4)) {
    const v = c >= "A" ? String(c.charCodeAt(0) - 55) : c;
    for (const d of v) resto = (resto * 10 + Number(d)) % 97;
  }
  return resto === 1;
}

export const sedeSchema = z.object({
  denominazione: z.string().optional(),
  ragioneSociale: z.string().optional(),
  tipoSoggetto: z.enum(["none", "PARTITA_IVA", "ASSOCIAZIONE"]),
  codiceFiscaleAssociazione: z.string().optional(),
  sedeIndirizzo: z.string().optional(),
  sedeComune: z.string().optional(),
  sedeComuneCodice: z.string().optional(),
  sedeProvincia: z.string().optional(),
  sedeCap: z.string().optional().refine((v) => !v || /^\d{5}$/.test(v.trim()), "Il CAP deve essere di 5 cifre"),
  iban: z.string().optional().refine((v) => !v || !v.trim() || ibanValido(v), "IBAN non valido (controlla le cifre)"),
});
export type SedeValues = z.infer<typeof sedeSchema>;

/** Regole che dipendono da più campi: comune scelto dall'elenco, codice fiscale associazione, partita IVA. */
export function controllaSede(v: SedeValues & { partitaIva?: string }, setError: (campo: keyof SedeValues | "partitaIva", messaggio: string) => void): boolean {
  let ok = true;
  const err = (c: keyof SedeValues | "partitaIva", m: string) => { setError(c, m); ok = false; };
  if (v.sedeComune?.trim() && !v.sedeComuneCodice) err("sedeComune", "Scegli il comune dall'elenco dei suggerimenti");
  if (v.tipoSoggetto === "ASSOCIAZIONE") {
    const cf = (v.codiceFiscaleAssociazione ?? "").replace(/\s+/g, "");
    if (!cf) err("codiceFiscaleAssociazione", "Inserisci il codice fiscale dell'associazione");
    else if (!partitaIvaValida(cf)) err("codiceFiscaleAssociazione", "Codice fiscale associazione non valido (11 cifre, controllo errato)");
  }
  if (v.tipoSoggetto === "PARTITA_IVA" && !v.partitaIva?.trim()) err("partitaIva", "Per un soggetto con partita IVA indica la partita IVA");
  return ok;
}

function useDebounced(v: string, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export function SedeFields() {
  const { register, setValue, control, formState: { errors } } = useFormContext<SedeValues>();
  const comune = useWatch({ control, name: "sedeComune" }) ?? "";
  const tipoSoggetto = useWatch({ control, name: "tipoSoggetto" });
  const provincia = useWatch({ control, name: "sedeProvincia" }) ?? "";
  const [aperto, setAperto] = useState(false);
  const [attivo, setAttivo] = useState(0);
  const [capCandidati, setCapCandidati] = useState<string[]>([]);
  const [cerca, setCerca] = useState(false);
  const q = useDebounced(comune.trim());
  const attiva = cerca && q.length >= 2;
  const { data, isFetching } = useCercaLuoghi({ q, tipo: "comune" }, { query: { enabled: attiva, queryKey: getCercaLuoghiQueryKey({ q, tipo: "comune" }) } });
  const suggerimenti = (data ?? []).filter((l) => l.attuale).slice(0, 8);
  const contenitore = useRef<HTMLDivElement>(null);
  const campoComune = register("sedeComune");

  const scegli = (l: Luogo) => {
    const opts = { shouldValidate: true, shouldDirty: true } as const;
    setValue("sedeComune", l.nome, opts);
    setValue("sedeComuneCodice", l.codice, opts);
    setValue("sedeProvincia", l.provincia ?? "", opts);
    setValue("sedeCap", l.cap.length === 1 ? l.cap[0]! : "", opts);
    setCapCandidati(l.cap.length > 1 ? l.cap : []);
    setCerca(false);
    setAperto(false);
  };
  const mostra = aperto && attiva && (isFetching || suggerimenti.length > 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="Denominazione sede" name="denominazione" hint={<p className="text-xs text-muted-foreground">Compare tra parentesi accanto al nome del collaboratore.</p>}>
          <Input id="input-denominazione" autoComplete="off" {...register("denominazione")} data-testid="input-denominazione" />
        </Campo>
        <Campo label="Ragione sociale" name="ragioneSociale">
          <Input id="input-ragioneSociale" autoComplete="off" {...register("ragioneSociale")} data-testid="input-ragione-sociale" />
        </Campo>
        <Campo label="Tipo di soggetto" name="tipoSoggetto">
          <Controller control={control} name="tipoSoggetto" render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger data-testid="select-tipo-soggetto"><SelectValue placeholder="Seleziona" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Non indicato</SelectItem>
                <SelectItem value="PARTITA_IVA">Partita IVA</SelectItem>
                <SelectItem value="ASSOCIAZIONE">Associazione</SelectItem>
              </SelectContent>
            </Select>
          )} />
        </Campo>
        {tipoSoggetto === "ASSOCIAZIONE" ? (
          <Campo label="Codice fiscale associazione" name="codiceFiscaleAssociazione" required err={errors.codiceFiscaleAssociazione?.message}>
            <Input id="input-codiceFiscaleAssociazione" autoComplete="off" inputMode="numeric" maxLength={11} placeholder="11 cifre"
              className={cn(errors.codiceFiscaleAssociazione && "border-destructive")} {...register("codiceFiscaleAssociazione")} data-testid="input-cf-associazione" />
          </Campo>
        ) : tipoSoggetto === "PARTITA_IVA" ? (
          <p className="text-xs text-muted-foreground self-end pb-2">La partita IVA si indica nei dati anagrafici, qui sopra.</p>
        ) : <div />}
        <Campo label="IBAN" name="iban" err={errors.iban?.message}>
          <Input id="input-iban" autoComplete="off" placeholder="IT00 X000 0000 0000 0000 0000 000" className={cn("uppercase", errors.iban && "border-destructive")} {...register("iban")} data-testid="input-iban" />
        </Campo>
      </div>
      <div className="grid gap-4 sm:grid-cols-6">
        <div className="sm:col-span-6">
          <Campo label="Indirizzo della sede (via e numero civico)" name="sedeIndirizzo">
            <Input id="input-sedeIndirizzo" autoComplete="off" placeholder="Via Roma 10" {...register("sedeIndirizzo")} data-testid="input-sede-indirizzo" />
          </Campo>
        </div>
        <div className="sm:col-span-3 relative" ref={contenitore}>
          <Campo label="Comune" name="sedeComune" err={errors.sedeComune?.message}
            hint={<p className="text-xs text-muted-foreground">Scrivi il nome e scegli il comune: provincia e CAP si compilano da soli.</p>}>
            <div className="relative">
              <Input id="input-sedeComune" autoComplete="off" role="combobox" aria-expanded={mostra} aria-controls="elenco-sede-comune" aria-autocomplete="list"
                {...campoComune}
                onChange={(e) => {
                  campoComune.onChange(e);
                  setValue("sedeComuneCodice", "");
                  setValue("sedeProvincia", "");
                  setCerca(true); setAperto(true); setAttivo(0);
                }}
                onBlur={(e) => { campoComune.onBlur(e); setAperto(false); }}
                onFocus={() => setAperto(true)}
                onKeyDown={(e) => {
                  if (!mostra || !suggerimenti.length) return;
                  if (e.key === "ArrowDown") { e.preventDefault(); setAttivo((a) => Math.min(a + 1, suggerimenti.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setAttivo((a) => Math.max(a - 1, 0)); }
                  else if (e.key === "Enter") { e.preventDefault(); scegli(suggerimenti[attivo]!); }
                  else if (e.key === "Escape") setAperto(false);
                }}
                className={cn(errors.sedeComune && "border-destructive")} data-testid="input-sede-comune" />
              {isFetching && attiva && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted-foreground" />}
            </div>
          </Campo>
          {mostra && (
            <ul id="elenco-sede-comune" role="listbox" className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-auto rounded-md border border-border bg-popover shadow-md" data-testid="suggerimenti-sede-comune">
              {suggerimenti.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Ricerca in corso…</li>}
              {suggerimenti.map((l, i) => (
                <li key={l.codice} role="option" aria-selected={i === attivo}
                  onMouseDown={(e) => { e.preventDefault(); scegli(l); }} onMouseEnter={() => setAttivo(i)}
                  className={cn("flex items-center gap-2 px-3 py-2 text-sm cursor-pointer", i === attivo && "bg-secondary")} data-testid={`suggerimento-sede-${l.codice}`}>
                  <MapPin className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{l.nome}</span>
                  <span className="text-xs font-mono text-muted-foreground">{l.provincia}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="sm:col-span-1">
          <Campo label="Provincia" name="sedeProvincia">
            <Input id="input-sedeProvincia" readOnly tabIndex={-1} value={provincia} className="uppercase bg-muted" data-testid="input-sede-provincia" />
          </Campo>
        </div>
        <div className="sm:col-span-2">
          <Campo label="CAP" name="sedeCap" err={errors.sedeCap?.message}
            hint={capCandidati.length > 1 ? <p className="text-xs text-muted-foreground">Questo comune ha più CAP: scegli dall&apos;elenco.</p> : undefined}>
            <Input id="input-sedeCap" autoComplete="off" inputMode="numeric" maxLength={5} placeholder="00100" list={capCandidati.length > 1 ? "elenco-sede-cap" : undefined}
              className={cn(errors.sedeCap && "border-destructive")} {...register("sedeCap")} data-testid="input-sede-cap" />
            {capCandidati.length > 1 && <datalist id="elenco-sede-cap">{capCandidati.map((c) => <option key={c} value={c} />)}</datalist>}
          </Campo>
        </div>
      </div>
    </div>
  );
}
