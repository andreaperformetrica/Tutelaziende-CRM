import { useMemo, useState } from "react";
import { useListCollaboratori } from "@workspace/api-client-react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common";
import { parseApiError, tipologiaLabel, nomeCollaboratore } from "@/lib/format";

const TUTTE = "tutte";
const confronta = (a: string, b: string) => a.localeCompare(b, "it");

/** Elenco delle sedi attive con caselle di selezione, ricerca per nome, filtri per provincia e città e "seleziona tutte". */
export function SelettoreSedi({ selezionate, onChange, escludi = [] }: { selezionate: number[]; onChange: (ids: number[]) => void; escludi?: number[] }) {
  const q = useListCollaboratori({ stato: "attivi" });
  const [cerca, setCerca] = useState("");
  const [provincia, setProvincia] = useState(TUTTE);
  const [citta, setCitta] = useState(TUTTE);
  const disponibili = useMemo(() => (q.data ?? []).filter((c) => !escludi.includes(c.id)), [q.data, escludi]);
  const province = useMemo(() => [...new Set(disponibili.map((c) => c.sedeProvincia?.trim()).filter((x): x is string => !!x))].sort(confronta), [disponibili]);
  // Le città proposte sono solo quelle della provincia scelta.
  const citta_ = useMemo(
    () => [...new Set(disponibili.filter((c) => provincia === TUTTE || c.sedeProvincia === provincia).map((c) => c.sedeComune?.trim()).filter((x): x is string => !!x))].sort(confronta),
    [disponibili, provincia],
  );
  const visibili = useMemo(() => {
    const t = cerca.trim().toLowerCase();
    return disponibili
      .filter((c) => provincia === TUTTE || c.sedeProvincia === provincia)
      .filter((c) => citta === TUTTE || c.sedeComune === citta)
      .filter((c) => !t || `${c.cognome} ${c.nome} ${c.numeroSportello}`.toLowerCase().includes(t));
  }, [disponibili, cerca, provincia, citta]);
  const tuttiSelezionati = visibili.length > 0 && visibili.every((c) => selezionate.includes(c.id));
  const alterna = (id: number) => onChange(selezionate.includes(id) ? selezionate.filter((x) => x !== id) : [...selezionate, id]);
  const alternaTutti = () => {
    const ids = visibili.map((c) => c.id);
    onChange(tuttiSelezionati ? selezionate.filter((x) => !ids.includes(x)) : [...new Set([...selezionate, ...ids])]);
  };

  if (q.isLoading) return <Skeleton className="h-40 w-full" />;
  if (q.isError) return <ErrorState message={parseApiError(q.error).message} onRetry={() => q.refetch()} />;
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input autoComplete="off" value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Cerca una sede" className="pl-9" data-testid="input-cerca-sedi" />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={alternaTutti} disabled={visibili.length === 0} data-testid="button-seleziona-tutte">
          {tuttiSelezionati ? "Deseleziona tutte" : "Seleziona tutte"}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select value={provincia} onValueChange={(v) => { setProvincia(v); setCitta(TUTTE); }}>
          <SelectTrigger aria-label="Provincia della sede" data-testid="select-filtro-provincia"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TUTTE}>Tutte le province</SelectItem>
            {province.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={citta} onValueChange={setCitta}>
          <SelectTrigger aria-label="Città della sede" data-testid="select-filtro-citta"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TUTTE}>Tutte le città</SelectItem>
            {citta_.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border bg-card">
        {visibili.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground text-center">Nessuna sede disponibile.</p>
        ) : visibili.map((c) => (
          <label key={c.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-secondary/50" data-testid={`sede-${c.id}`}>
            <Checkbox checked={selezionate.includes(c.id)} onCheckedChange={() => alterna(c.id)} />
            <span className="text-sm font-medium">{nomeCollaboratore(c)}</span>
            <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">{c.sedeComune ? `${c.sedeComune}${c.sedeProvincia ? ` (${c.sedeProvincia})` : ""} · ` : ""}sportello {c.numeroSportello} · {tipologiaLabel(c.tipologia)}</span>
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{selezionate.length} {selezionate.length === 1 ? "sede selezionata" : "sedi selezionate"}</p>
    </div>
  );
}
