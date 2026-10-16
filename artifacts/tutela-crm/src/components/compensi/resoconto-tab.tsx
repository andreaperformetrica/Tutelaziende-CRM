import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getListEstrattiQueryKey, getGetResocontoCompensiQueryKey, useCreateEstratti, useGetResocontoCompensi, type GetResocontoCompensiParams } from "@workspace/api-client-react";
import { FileCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/common";
import { useToast } from "@/hooks/use-toast";
import { fmtData, fmtEuro, fmtIstante, parseApiError } from "@/lib/format";
import { SceltaCollaboratore } from "./scelta-collaboratore";

export function ResocontoTab() {
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [coll, setColl] = useState("all");
  const [dal, setDal] = useState("");
  const [al, setAl] = useState("");
  const [giorni, setGiorni] = useState("60");
  const [scelte, setScelte] = useState<Set<number>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  const params: GetResocontoCompensiParams = {
    ...(coll !== "all" ? { collaboratoreId: Number(coll) } : {}),
    ...(dal ? { dal } : {}),
    ...(al ? { al } : {}),
    ...(giorni && Number(giorni) > 0 ? { giorni: Number(giorni) } : {}),
  };
  const dati = useGetResocontoCompensi(params);
  const crea = useCreateEstratti();
  const righe = dati.data?.righe ?? [];
  const selezionate = useMemo(() => righe.filter((r) => scelte.has(r.praticaId)), [righe, scelte]);
  const totPunti = selezionate.reduce((t, r) => t + r.punti, 0);
  const totEuro = selezionate.reduce((t, r) => t + r.valoreEuro, 0);
  const tutte = righe.length > 0 && selezionate.length === righe.length;

  const alternaRiga = (id: number, v: boolean) => setScelte((s) => { const n = new Set(s); if (v) n.add(id); else n.delete(id); return n; });

  const conferma = () => {
    setErr(null);
    crea.mutate({ data: { praticaIds: selezionate.map((r) => r.praticaId) } }, {
      onSuccess: (estratti) => {
        qc.invalidateQueries({ queryKey: getGetResocontoCompensiQueryKey() });
        qc.invalidateQueries({ queryKey: getListEstrattiQueryKey() });
        setScelte(new Set());
        toast({ title: estratti.length === 1 ? "Estratto creato" : `${estratti.length} estratti creati`, description: "Le pratiche scelte non compaiono più nel resoconto." });
        if (estratti.length === 1) nav(`/admin/compensi/estratti/${estratti[0]!.id}`);
        else nav("/admin/compensi?tab=estratti");
      },
      onError: (e) => { setErr(parseApiError(e).message); dati.refetch(); setScelte(new Set()); },
    });
  };

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4 max-w-3xl">
        Pratiche chiuse di tipo pagabile, non ancora in un estratto. Punti e ristorno sono quelli del tipo di pratica al momento della chiusura. Spunta le righe da confermare.
      </p>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="space-y-1.5"><Label>Collaboratore</Label><div><SceltaCollaboratore valore={coll} onChange={(v) => { setColl(v); setScelte(new Set()); }} conTutti testid="filtro-collaboratore" /></div></div>
        <div className="space-y-1.5"><Label htmlFor="f-dal">Chiuse dal</Label><Input id="f-dal" type="date" value={dal} onChange={(e) => { setDal(e.target.value); setScelte(new Set()); }} className="w-40 bg-card" data-testid="filtro-dal" /></div>
        <div className="space-y-1.5"><Label htmlFor="f-al">Chiuse fino al</Label><Input id="f-al" type="date" value={al} onChange={(e) => { setAl(e.target.value); setScelte(new Set()); }} className="w-40 bg-card" data-testid="filtro-al" /></div>
        <div className="space-y-1.5"><Label htmlFor="f-giorni">Chiuse da almeno (giorni)</Label><Input id="f-giorni" type="number" min={0} value={giorni} onChange={(e) => { setGiorni(e.target.value); setScelte(new Set()); }} className="w-40 bg-card" data-testid="filtro-giorni" /></div>
      </div>

      {err && <div role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 text-destructive px-3 py-2 text-sm" data-testid="errore-estratti">{err}</div>}

      {dati.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : dati.isError ? (
        <ErrorState message={parseApiError(dati.error).message} onRetry={() => dati.refetch()} />
      ) : righe.length === 0 ? (
        <EmptyState icon={<FileCheck2 className="size-6" />} title="Nessuna pratica da confermare" text="Non ci sono pratiche chiuse e non ancora pagate con questi filtri." />
      ) : (
        <>
          <div className="rounded-lg border border-border bg-card overflow-x-auto rise">
            <Table className="tabella-schede">
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead className="w-10"><Checkbox checked={tutte} onCheckedChange={(v) => setScelte(v ? new Set(righe.map((r) => r.praticaId)) : new Set())} aria-label="Seleziona tutte" data-testid="seleziona-tutte" /></TableHead>
                  {["Collaboratore", "Assistito", "Pratica", "Tipo", "Data pratica", "Chiusa il", "Giorni", "Punti", "Ristorno"].map((h, i) => (
                    <TableHead key={h} className={`text-[11px] uppercase tracking-wider font-semibold h-10 whitespace-nowrap ${i >= 7 ? "text-right" : ""}`}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {righe.map((r) => (
                  <TableRow key={r.praticaId} data-testid={`row-resoconto-${r.praticaId}`}>
                    <TableCell><Checkbox checked={scelte.has(r.praticaId)} onCheckedChange={(v) => alternaRiga(r.praticaId, v === true)} aria-label={`Seleziona la pratica ${r.numero}`} data-testid={`check-pratica-${r.praticaId}`} /></TableCell>
                    <TableCell data-label="Collaboratore" className="whitespace-nowrap">{r.collaboratoreNome} <span className="text-muted-foreground text-xs">({r.numeroSportello})</span></TableCell>
                    <TableCell data-label="Assistito">{r.assistito}</TableCell>
                    <TableCell data-label="Pratica" className="tabular-nums">{r.numero}</TableCell>
                    <TableCell data-label="Tipo">{r.tipoNome}</TableCell>
                    <TableCell data-label="Data pratica" className="tabular-nums">{fmtData(r.dataPratica)}</TableCell>
                    <TableCell data-label="Chiusa il" className="tabular-nums whitespace-nowrap">{fmtIstante(r.chiusaIl)}</TableCell>
                    <TableCell data-label="Giorni" className="tabular-nums">{r.giorniDallaChiusura}</TableCell>
                    <TableCell data-label="Punti" className="text-right tabular-nums">{r.punti}</TableCell>
                    <TableCell data-label="Ristorno" className="text-right tabular-nums">{fmtEuro(r.valoreEuro)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
            <div className="text-sm" data-testid="riepilogo-selezione">
              {selezionate.length === 0 ? "Nessuna pratica selezionata." : <><strong>{selezionate.length}</strong> {selezionate.length === 1 ? "pratica" : "pratiche"} · <strong>{totPunti}</strong> punti · ristorno <strong>{fmtEuro(totEuro)}</strong></>}
            </div>
            <Button disabled={selezionate.length === 0 || crea.isPending} onClick={conferma} data-testid="button-crea-estratti">
              {crea.isPending ? "Creazione…" : "Conferma e crea estratto"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Se scegli pratiche di più collaboratori, viene creato un estratto per ciascuno.</p>
        </>
      )}
    </div>
  );
}
