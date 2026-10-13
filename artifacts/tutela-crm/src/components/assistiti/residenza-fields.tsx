import { useEffect, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Loader2, MapPin } from "lucide-react";
import { getCercaLuoghiQueryKey, useCercaLuoghi, type Luogo } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Campo } from "@/components/anagrafica/anagrafica-fields";
import { cn } from "@/lib/utils";

/** Campi della residenza dell'assistito (da usare dentro un FormProvider con citta, provincia, cap, indirizzo). */
export interface ResidenzaValues { citta: string; provincia: string; cap: string; indirizzo: string }

function useDebounced(v: string, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export function ResidenzaFields() {
  const { register, setValue, control, formState: { errors } } = useFormContext<ResidenzaValues>();
  const citta = useWatch({ control, name: "citta" }) ?? "";
  const [aperto, setAperto] = useState(false);
  const [attivo, setAttivo] = useState(0);
  const [capCandidati, setCapCandidati] = useState<string[]>([]);
  // La ricerca parte solo mentre l'utente scrive nel campo, non dopo aver scelto un suggerimento.
  const [cerca, setCerca] = useState(false);
  const q = useDebounced(citta.trim());
  const attiva = cerca && q.length >= 2;
  const { data, isFetching } = useCercaLuoghi({ q, tipo: "comune" }, { query: { enabled: attiva, queryKey: getCercaLuoghiQueryKey({ q, tipo: "comune" }) } });
  const suggerimenti = (data ?? []).filter((l) => l.attuale).slice(0, 8);
  const contenitore = useRef<HTMLDivElement>(null);
  const campoCitta = register("citta");

  const scegli = (l: Luogo) => {
    const opts = { shouldValidate: true, shouldDirty: true } as const;
    setValue("citta", l.nome, opts);
    setValue("provincia", l.provincia ?? "", opts);
    setValue("cap", l.cap.length === 1 ? l.cap[0]! : "", opts);
    setCapCandidati(l.cap.length > 1 ? l.cap : []);
    setCerca(false);
    setAperto(false);
  };

  const mostra = aperto && attiva && (isFetching || suggerimenti.length > 0);

  return (
    <div className="grid gap-4 sm:grid-cols-6">
      <div className="sm:col-span-3 relative" ref={contenitore}>
        <Campo label="Città" name="citta" required err={errors.citta?.message}
          hint={<p className="text-xs text-muted-foreground">Scrivi il nome e scegli il comune: provincia e CAP si compilano da soli.</p>}>
          <div className="relative">
            <Input id="input-citta" autoComplete="off" role="combobox" aria-expanded={mostra} aria-controls="elenco-citta" aria-autocomplete="list"
              {...campoCitta}
              onChange={(e) => { campoCitta.onChange(e); setCerca(true); setAperto(true); setAttivo(0); }}
              onBlur={(e) => { campoCitta.onBlur(e); setAperto(false); }}
              onFocus={() => setAperto(true)}
              onKeyDown={(e) => {
                if (!mostra || !suggerimenti.length) return;
                if (e.key === "ArrowDown") { e.preventDefault(); setAttivo((a) => Math.min(a + 1, suggerimenti.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setAttivo((a) => Math.max(a - 1, 0)); }
                else if (e.key === "Enter") { e.preventDefault(); scegli(suggerimenti[attivo]!); }
                else if (e.key === "Escape") setAperto(false);
              }}
              className={cn(errors.citta && "border-destructive")} data-testid="input-citta" />
            {isFetching && attiva && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted-foreground" />}
          </div>
        </Campo>
        {mostra && (
          <ul id="elenco-citta" role="listbox" className="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-auto rounded-md border border-border bg-popover shadow-md" data-testid="suggerimenti-citta">
            {suggerimenti.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Ricerca in corso…</li>}
            {suggerimenti.map((l, i) => (
              <li key={l.codice} role="option" aria-selected={i === attivo}
                onMouseDown={(e) => { e.preventDefault(); scegli(l); }} onMouseEnter={() => setAttivo(i)}
                className={cn("flex items-center gap-2 px-3 py-2 text-sm cursor-pointer", i === attivo && "bg-secondary")} data-testid={`suggerimento-citta-${l.codice}`}>
                <MapPin className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{l.nome}</span>
                <span className="text-xs font-mono text-muted-foreground">{l.provincia}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="sm:col-span-1">
        <Campo label="Provincia" name="provincia" required err={errors.provincia?.message}>
          <Input id="input-provincia" autoComplete="off" maxLength={2} placeholder="RM" className={cn("uppercase", errors.provincia && "border-destructive")}
            {...register("provincia", { setValueAs: (v: string) => (v ?? "").toUpperCase() })} data-testid="input-provincia" />
        </Campo>
      </div>
      <div className="sm:col-span-2">
        <Campo label="CAP" name="cap" required err={errors.cap?.message}
          hint={capCandidati.length > 1 ? <p className="text-xs text-muted-foreground" data-testid="hint-cap">Questo comune ha più CAP: scegli dall&apos;elenco.</p> : undefined}>
          <Input id="input-cap" autoComplete="off" inputMode="numeric" maxLength={5} placeholder="00100" list={capCandidati.length > 1 ? "elenco-cap" : undefined}
            className={cn(errors.cap && "border-destructive")} {...register("cap")} data-testid="input-cap" />
          {capCandidati.length > 1 && <datalist id="elenco-cap">{capCandidati.map((c) => <option key={c} value={c} />)}</datalist>}
        </Campo>
      </div>
      <div className="sm:col-span-6">
        <Campo label="Indirizzo (via e numero civico)" name="indirizzo" required err={errors.indirizzo?.message}>
          <Input id="input-indirizzo" autoComplete="off" placeholder="Via Roma 10" className={cn(errors.indirizzo && "border-destructive")} {...register("indirizzo")} data-testid="input-indirizzo" />
        </Campo>
      </div>
    </div>
  );
}
