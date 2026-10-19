import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetImpostazioniRicevuteQueryKey, useGetImpostazioniRicevute, useListRicevute, useUpdateImpostazioniRicevute, type ListRicevuteParams } from "@workspace/api-client-react";
import { Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { SceltaCollaboratore } from "@/components/compensi/scelta-collaboratore";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/lib/auth";
import { fmtData, fmtEuro, parseApiError } from "@/lib/format";

export default function PagamentiFatturePage() {
  const [, nav] = useLocation();
  const { session } = useSession();
  const eAdmin = session?.ruolo === "super_admin" || session?.ruolo === "admin";
  const [dal, setDal] = useState("");
  const [al, setAl] = useState("");
  const [numero, setNumero] = useState("");
  const [coll, setColl] = useState("all");
  const [stato, setStato] = useState("all");
  const params: ListRicevuteParams = {
    ...(dal ? { dal } : {}),
    ...(al ? { al } : {}),
    ...(/^\d+$/.test(numero) && Number(numero) > 0 ? { numero: Number(numero) } : {}),
    ...(coll !== "all" ? { collaboratoreId: Number(coll) } : {}),
    ...(stato !== "all" ? { stato: stato as "da_pagare" | "pagata" } : {}),
  };
  const lista = useListRicevute(params);
  const righe = lista.data?.righe ?? [];

  return (
    <div>
      <PageHeader title="Pagamenti e fatture" subtitle="Ricevute dei collaboratori e relativi pagamenti. Le ricevute si creano dal dare e avere." />
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="space-y-1.5"><Label htmlFor="rf-dal">Dal</Label><Input id="rf-dal" type="date" value={dal} onChange={(e) => setDal(e.target.value)} className="w-40 bg-card" data-testid="filtro-ricevute-dal" /></div>
        <div className="space-y-1.5"><Label htmlFor="rf-al">Al</Label><Input id="rf-al" type="date" value={al} onChange={(e) => setAl(e.target.value)} className="w-40 bg-card" data-testid="filtro-ricevute-al" /></div>
        <div className="space-y-1.5"><Label htmlFor="rf-num">Numero</Label><Input id="rf-num" inputMode="numeric" placeholder="es. 12" value={numero} onChange={(e) => setNumero(e.target.value)} className="w-28 bg-card" data-testid="filtro-ricevute-numero" /></div>
        <div className="space-y-1.5"><Label>Collaboratore</Label><div><SceltaCollaboratore valore={coll} onChange={setColl} conTutti testid="filtro-ricevute-collaboratore" /></div></div>
        <div className="space-y-1.5"><Label>Stato</Label>
          <Select value={stato} onValueChange={setStato}>
            <SelectTrigger className="w-40 bg-card" data-testid="filtro-ricevute-stato"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Tutti</SelectItem><SelectItem value="da_pagare">Da pagare</SelectItem><SelectItem value="pagata">Pagate</SelectItem></SelectContent>
          </Select>
        </div>
      </div>

      {lista.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : lista.isError ? (
        <ErrorState message={parseApiError(lista.error).message} onRetry={() => lista.refetch()} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm" data-testid="contatore-ricevute">
            <span><strong data-testid="numero-documenti">{lista.data!.totale}</strong> {lista.data!.totale === 1 ? "documento" : "documenti"}</span>
            <span className="text-muted-foreground">{lista.data!.daPagare} da pagare · {lista.data!.pagate} pagati · totale {fmtEuro(lista.data!.totaleEuro)}</span>
          </div>
          {righe.length === 0 ? (
            <EmptyState icon={<Receipt className="size-6" />} title="Nessun documento" text="Non ci sono ricevute con questi filtri. Le ricevute si creano dal dare e avere di un collaboratore." />
          ) : (
            <div className="rounded-lg border border-border bg-card overflow-x-auto rise">
              <Table className="tabella-schede">
                <TableHeader>
                  <TableRow className="bg-muted/60 hover:bg-muted/60">
                    {["Numero", "Data", "Collaboratore", "Imponibile", "IVA", "Totale", "Stato"].map((h, i) => <TableHead key={h} className={`text-[11px] uppercase tracking-wider font-semibold h-10 ${i >= 3 && i < 6 ? "text-right" : ""}`}>{h}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {righe.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-secondary/50" onClick={() => nav(`/admin/pagamenti-fatture/${r.id}`)} data-testid={`row-ricevuta-${r.id}`}>
                      <TableCell data-label="Numero" className="tabular-nums font-semibold">{r.numero}/{r.anno}</TableCell>
                      <TableCell data-label="Data" className="tabular-nums">{fmtData(r.dataRicevuta)}</TableCell>
                      <TableCell data-label="Collaboratore">{r.collaboratoreNome}{r.denominazione && <span className="block text-xs text-muted-foreground">{r.denominazione}</span>}</TableCell>
                      <TableCell data-label="Imponibile" className="text-right tabular-nums">{fmtEuro(r.imponibileEuro)}</TableCell>
                      <TableCell data-label="IVA" className="text-right tabular-nums">{r.tipoSoggetto === "PARTITA_IVA" ? fmtEuro(r.ivaEuro) : <span className="text-muted-foreground">Senza IVA</span>}</TableCell>
                      <TableCell data-label="Totale" className="text-right tabular-nums font-semibold">{fmtEuro(r.totaleEuro)}</TableCell>
                      <TableCell data-label="Stato">{r.pagata
                        ? <Badge className="bg-emerald-600 text-white hover:bg-emerald-600" data-testid={`stato-ricevuta-${r.id}`}>Pagata il {fmtData(r.pagatoIl)}</Badge>
                        : <Badge variant="outline" data-testid={`stato-ricevuta-${r.id}`}>Da pagare</Badge>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      {eAdmin && <ImpostazioniRicevute />}
    </div>
  );
}

function ImpostazioniRicevute() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useGetImpostazioniRicevute();
  const salva = useUpdateImpostazioniRicevute();
  const [v, setV] = useState({ patronatoNome: "", patronatoIndirizzo: "", patronatoCapCitta: "", patronatoCodiceFiscale: "", causale: "", fraseBonifico: "", aliquotaIva: "22" });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (q.data) setV({ ...q.data, aliquotaIva: String(q.data.aliquotaIva).replace(".", ",") });
  }, [q.data]);
  const campo = (k: keyof typeof v, label: string, extra?: { multiline?: boolean; max?: number }) => (
    <div className="space-y-1.5">
      <Label htmlFor={`imp-${k}`}>{label}</Label>
      {extra?.multiline
        ? <Textarea id={`imp-${k}`} rows={2} maxLength={extra.max} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} data-testid={`input-impostazione-${k}`} />
        : <Input id={`imp-${k}`} maxLength={extra?.max} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} data-testid={`input-impostazione-${k}`} />}
    </div>
  );
  const conferma = () => {
    const aliquotaIva = Number(v.aliquotaIva.replace(",", "."));
    if (!Number.isFinite(aliquotaIva) || aliquotaIva < 0 || aliquotaIva > 100) return setErr("L'aliquota IVA deve essere tra 0 e 100.");
    setErr(null);
    salva.mutate({ data: { ...v, aliquotaIva } }, {
      onSuccess: (d) => { qc.setQueryData(getGetImpostazioniRicevuteQueryKey(), d); toast({ title: "Impostazioni delle ricevute salvate", description: "Valgono per le nuove ricevute; quelle già create restano come sono." }); },
      onError: (e) => setErr(parseApiError(e).message),
    });
  };
  return (
    <section className="mt-10 max-w-3xl" data-testid="impostazioni-ricevute">
      <h2 className="font-serif text-xl font-semibold mb-1">Dati stampati sulle ricevute</h2>
      <p className="text-sm text-muted-foreground mb-4">Blocco del patronato, causale e frase del bonifico sono uguali per tutte le ricevute. Una modifica vale per le ricevute create da quel momento.</p>
      {q.isLoading ? <Skeleton className="h-48 w-full" /> : q.isError ? <ErrorState message={parseApiError(q.error).message} onRetry={() => q.refetch()} /> : (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("patronatoNome", "Denominazione del patronato", { max: 120 })}
            {campo("patronatoCodiceFiscale", "Codice fiscale del patronato", { max: 30 })}
            {campo("patronatoIndirizzo", "Indirizzo", { max: 160 })}
            {campo("patronatoCapCitta", "CAP e città", { max: 120 })}
          </div>
          {campo("causale", "Causale (dopo \"relativa a\")", { multiline: true, max: 400 })}
          {campo("fraseBonifico", "Frase prima delle coordinate bancarie", { multiline: true, max: 300 })}
          <div className="max-w-40">{campo("aliquotaIva", "Aliquota IVA standard (%)")}</div>
          {err && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 text-destructive px-3 py-2 text-sm" data-testid="errore-impostazioni-ricevute">{err}</div>}
          <Button onClick={conferma} disabled={salva.isPending} data-testid="button-salva-impostazioni-ricevute">{salva.isPending ? "Salvataggio…" : "Salva"}</Button>
        </div>
      )}
    </section>
  );
}
