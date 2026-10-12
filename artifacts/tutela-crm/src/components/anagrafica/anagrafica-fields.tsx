import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { z } from "zod";
import { Check, ChevronsUpDown, Globe2, Info, RotateCcw, TriangleAlert } from "lucide-react";
import {
  calcolaCodiceFiscale, codiceFiscaleValido, equivalentiOmocodia, normalizzaCodiceFiscale, normalizzaTelefono, partitaIvaValida,
} from "@workspace/anagrafica";
import { getCercaLuoghiQueryKey, useCercaLuoghi, useListNazionalita } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { FieldError } from "@/components/common";
import { fmtCellulare } from "@/lib/format";
import { cn } from "@/lib/utils";

export const anagraficaSchema = z.object({
  nome: z.string().trim().min(1, "Inserisci il nome"),
  cognome: z.string().trim().min(1, "Inserisci il cognome"),
  sesso: z.enum(["M", "F"], { errorMap: () => ({ message: "Seleziona il sesso" }) }),
  dataNascita: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Inserisci la data di nascita"),
  luogoNascitaCodice: z.string().min(1, "Seleziona il luogo di nascita"),
  luogoNascitaEtichetta: z.string().optional(),
  nazionalita: z.string().min(1, "Seleziona la nazionalità"),
  codiceFiscale: z.string().refine((v) => codiceFiscaleValido(v), "Codice fiscale non valido (formato o carattere di controllo)"),
  partitaIva: z.string().optional().refine((v) => !v || !v.trim() || partitaIvaValida(v), "Partita IVA non valida (11 cifre, controllo errato)"),
  email: z.string().trim().email("Indirizzo email non valido"),
  telefono: z.string().optional(),
  cellulare: z.string().trim().min(1, "Il cellulare è obbligatorio").refine((v) => normalizzaTelefono(v) !== null, "Numero di cellulare non valido"),
});
export type AnagraficaValues = z.infer<typeof anagraficaSchema>;

/** Come anagraficaSchema ma con email facoltativa (assistiti): se compilata deve essere valida. */
export const anagraficaEmailFacoltativaSchema = anagraficaSchema.extend({
  email: z.string().trim().refine((v) => v === "" || z.string().email().safeParse(v).success, "Indirizzo email non valido"),
});

export function BannerStraniero({ nazionalita }: { nazionalita: string }) {
  return (
    <div role="status" data-testid="banner-straniero"
      className="rise flex items-center gap-3 rounded-lg border-2 border-accent bg-accent/20 px-4 py-3 text-accent-foreground">
      <Globe2 className="size-6 shrink-0" />
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] opacity-70">Informazione</div>
        <div className="font-semibold">Cittadino straniero: nazionalità {nazionalita}</div>
      </div>
    </div>
  );
}

export function Campo({ label, name, children, hint, err, required }: { label: string; name: string; children: React.ReactNode; hint?: React.ReactNode; err?: string; required?: boolean }) {
  return (
    <div className="space-y-1.5" data-campo={name}>
      <Label htmlFor={`input-${name}`} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}{required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
      {hint}
      <FieldError id={`error-${name}`}>{err}</FieldError>
    </div>
  );
}

function useDebounced(v: string, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

function LuogoCombobox({ value, label, onPick, invalid }: { value: string; label?: string; onPick: (codice: string, etichetta: string) => void; invalid: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const attiva = dq.length >= 2;
  const { data, isFetching, isError } = useCercaLuoghi({ q: dq }, { query: { enabled: attiva, queryKey: getCercaLuoghiQueryKey({ q: dq }) } });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" id="input-luogoNascitaCodice" data-testid="combobox-luogo"
          className={cn("w-full justify-between font-normal", !value && "text-muted-foreground", invalid && "border-destructive")}>
          <span className="truncate">{value ? label || value : "Cerca comune o stato estero"}</span>
          <ChevronsUpDown className="size-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-72" align="start">
        <Command shouldFilter={false}>
          <CommandInput autoComplete="off" placeholder="Digita almeno 2 lettere" value={q} onValueChange={setQ} data-testid="input-cerca-luogo" />
          <CommandList>
            {!attiva && <div className="py-6 text-center text-sm text-muted-foreground">Digita almeno 2 caratteri</div>}
            {attiva && isFetching && <div className="py-6 text-center text-sm text-muted-foreground">Ricerca in corso…</div>}
            {attiva && isError && <div className="py-6 text-center text-sm text-destructive">Ricerca non disponibile</div>}
            {attiva && !isFetching && !isError && <CommandEmpty>Nessun luogo trovato</CommandEmpty>}
            {attiva && !isFetching && data && (
              <CommandGroup>
                {data.map((l) => (
                  <CommandItem key={l.codice} value={l.codice} data-testid={`option-luogo-${l.codice}`}
                    onSelect={() => { onPick(l.codice, l.provincia ? `${l.nome} (${l.provincia})` : l.nome); setOpen(false); setQ(""); }}>
                    <Check className={cn("size-4 mr-2", value === l.codice ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1">{l.nome}</span>
                    {!l.attuale && <span className="text-[10px] uppercase font-semibold text-destructive mr-2">{l.tipo === "comune" ? "soppresso" : "non più esistente"}</span>}
                    <span className="text-xs text-muted-foreground font-mono">{l.tipo === "comune" ? l.provincia : "Stato estero"}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function NazionalitaSelect({ value, onPick, invalid }: { value: string; onPick: (c: string) => void; invalid: boolean }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useListNazionalita();
  const ordinate = useMemo(() => {
    const l = [...(data ?? [])];
    l.sort((a, b) => (a.codice === "IT" ? -1 : b.codice === "IT" ? 1 : a.nome.localeCompare(b.nome, "it")));
    return l;
  }, [data]);
  const sel = ordinate.find((n) => n.codice === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" id="input-nazionalita" data-testid="select-nazionalita" disabled={isLoading}
          className={cn("w-full justify-between font-normal", !value && "text-muted-foreground", invalid && "border-destructive")}>
          <span className="truncate">{sel?.nome ?? (isLoading ? "Caricamento…" : "Seleziona nazionalità")}</span>
          <ChevronsUpDown className="size-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-64" align="start">
        <Command>
          <CommandInput autoComplete="off" placeholder="Cerca nazionalità" />
          <CommandList>
            <CommandEmpty>Nessun risultato</CommandEmpty>
            <CommandGroup>
              {ordinate.map((n) => (
                <CommandItem key={n.codice} value={`${n.nome} ${n.codice}`} onSelect={() => { onPick(n.codice); setOpen(false); }} data-testid={`option-nazionalita-${n.codice}`}>
                  <Check className={cn("size-4 mr-2", value === n.codice ? "opacity-100" : "opacity-0")} />
                  {n.nome}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Riutilizzabile: va usato dentro un <FormProvider> con i campi di AnagraficaValues. */
export function AnagraficaFields({ emailObbligatoria = true, mostraTelefono = true }: { emailObbligatoria?: boolean; mostraTelefono?: boolean } = {}) {
  const { register, control, setValue, formState: { errors } } = useFormContext<AnagraficaValues>();
  const [nome, cognome, sesso, dataNascita, luogo, cf, naz, cell] = useWatch({
    control, name: ["nome", "cognome", "sesso", "dataNascita", "luogoNascitaCodice", "codiceFiscale", "nazionalita", "cellulare"],
  });
  const etichetta = useWatch({ control, name: "luogoNascitaEtichetta" });
  const { data: nazionalita } = useListNazionalita();
  const nazNome = nazionalita?.find((n) => n.codice === naz)?.nome ?? naz;

  const calcolato = useMemo(
    () => calcolaCodiceFiscale({ nome, cognome, sesso, dataNascita, codiceLuogo: luogo }),
    [nome, cognome, sesso, dataNascita, luogo],
  );
  const manuale = useRef<boolean | null>(null);
  useEffect(() => {
    if (manuale.current === null) manuale.current = !!cf && !!calcolato && normalizzaCodiceFiscale(cf) !== calcolato;
    if (!manuale.current && calcolato && calcolato !== cf) setValue("codiceFiscale", calcolato, { shouldValidate: true, shouldDirty: true });
  }, [calcolato, cf, setValue]);

  const cfNorm = normalizzaCodiceFiscale(cf ?? "");
  const differente = !!calcolato && cfNorm.length === 16 && cfNorm !== calcolato;
  const omocodico = differente && equivalentiOmocodia(cfNorm, calcolato!);
  const e = errors;
  const cellFmt = cell && normalizzaTelefono(cell) ? fmtCellulare(normalizzaTelefono(cell)) : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Campo label="Cognome" name="cognome" required err={e.cognome?.message}>
          <Input id="input-cognome" autoComplete="off" {...register("cognome")} aria-invalid={!!e.cognome} className={e.cognome ? "border-destructive" : ""} data-testid="input-cognome" />
        </Campo>
        <Campo label="Nome" name="nome" required err={e.nome?.message}>
          <Input id="input-nome" autoComplete="off" {...register("nome")} aria-invalid={!!e.nome} className={e.nome ? "border-destructive" : ""} data-testid="input-nome" />
        </Campo>
        <Campo label="Sesso" name="sesso" required err={e.sesso?.message}>
          <Controller control={control} name="sesso" render={({ field }) => (
            <div className="grid grid-cols-2 gap-1.5" role="radiogroup" id="input-sesso">
              {(["M", "F"] as const).map((s) => (
                <button key={s} type="button" role="radio" aria-checked={field.value === s} onClick={() => field.onChange(s)} data-testid={`radio-sesso-${s}`}
                  className={cn("h-9 rounded-md border text-sm font-medium transition-colors", field.value === s ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted border-input", e.sesso && "border-destructive")}>
                  {s === "M" ? "Maschio" : "Femmina"}
                </button>
              ))}
            </div>
          )} />
        </Campo>
        <Campo label="Data di nascita" name="dataNascita" required err={e.dataNascita?.message}>
          <Input id="input-dataNascita" autoComplete="off" type="date" {...register("dataNascita")} className={e.dataNascita ? "border-destructive" : ""} data-testid="input-data-nascita" />
        </Campo>
        <Campo label="Luogo di nascita" name="luogoNascitaCodice" required err={e.luogoNascitaCodice?.message}>
          <Controller control={control} name="luogoNascitaCodice" render={({ field }) => (
            <LuogoCombobox value={field.value} label={etichetta} invalid={!!e.luogoNascitaCodice}
              onPick={(c, et) => { field.onChange(c); setValue("luogoNascitaEtichetta", et); }} />
          )} />
        </Campo>
        <Campo label="Nazionalità" name="nazionalita" required err={e.nazionalita?.message}>
          <Controller control={control} name="nazionalita" render={({ field }) => (
            <NazionalitaSelect value={field.value} onPick={field.onChange} invalid={!!e.nazionalita} />
          )} />
        </Campo>
      </div>

      {naz && naz !== "IT" && <BannerStraniero nazionalita={nazNome} />}

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start">
        <Campo label="Codice fiscale" name="codiceFiscale" required err={e.codiceFiscale?.message}
          hint={
            <>
              {!calcolato && !cf && <p className="text-xs text-muted-foreground">Verrà calcolato in automatico quando nome, cognome, sesso, data e luogo di nascita sono compilati.</p>}
              {omocodico && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="note-omocodia"><Info className="size-3.5" /> Codice omocodico, coerente con i dati inseriti</p>
              )}
              {differente && !omocodico && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-accent bg-accent/15 px-3 py-2 text-xs" data-testid="warning-cf-diverso">
                  <TriangleAlert className="size-4 shrink-0" />
                  <span className="flex-1 min-w-48">Il codice fiscale non corrisponde ai dati inseriti (possibile omocodia). Calcolato: <span className="font-mono font-semibold">{calcolato}</span></span>
                  <Button type="button" size="sm" variant="outline" className="h-7" data-testid="button-ripristina-cf"
                    onClick={() => { manuale.current = false; setValue("codiceFiscale", calcolato!, { shouldValidate: true, shouldDirty: true }); }}>
                    <RotateCcw className="size-3 mr-1.5" /> Ripristina calcolato
                  </Button>
                </div>
              )}
            </>
          }>
          <Controller control={control} name="codiceFiscale" render={({ field }) => (
            <Input id="input-codiceFiscale" autoComplete="off" value={field.value} maxLength={16} spellCheck={false} data-testid="input-codice-fiscale"
              className={cn("font-mono tracking-[0.18em] uppercase", e.codiceFiscale && "border-destructive")}
              onBlur={field.onBlur}
              onChange={(ev) => { const v = normalizzaCodiceFiscale(ev.target.value); manuale.current = v.length > 0; field.onChange(v); }} />
          )} />
        </Campo>
        <Campo label="Partita IVA (facoltativa)" name="partitaIva" err={e.partitaIva?.message}>
          <Input id="input-partitaIva" autoComplete="off" inputMode="numeric" maxLength={14} spellCheck={false} data-testid="input-partita-iva" {...register("partitaIva")}
            className={cn("font-mono tracking-[0.12em]", e.partitaIva && "border-destructive")} />
        </Campo>
      </div>

      <div className={cn("grid gap-4", mostraTelefono ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        <Campo label={emailObbligatoria ? "Email" : "Email (facoltativa)"} name="email" required={emailObbligatoria} err={e.email?.message}>
          <Input id="input-email" autoComplete="off" type="email" {...register("email")} className={e.email ? "border-destructive" : ""} data-testid="input-email" />
        </Campo>
        <Campo label="Cellulare" name="cellulare" required err={e.cellulare?.message}
          hint={cellFmt && !e.cellulare ? <p className="text-xs text-muted-foreground font-mono" data-testid="text-cellulare-formattato">{cellFmt}</p> : undefined}>
          <Input id="input-cellulare" autoComplete="off" type="tel" {...register("cellulare")} className={e.cellulare ? "border-destructive" : ""} data-testid="input-cellulare" />
        </Campo>
        {mostraTelefono && (
          <Campo label="Telefono (facoltativo)" name="telefono" err={e.telefono?.message}>
            <Input id="input-telefono" autoComplete="off" type="tel" {...register("telefono")} data-testid="input-telefono" />
          </Campo>
        )}
      </div>
    </div>
  );
}

