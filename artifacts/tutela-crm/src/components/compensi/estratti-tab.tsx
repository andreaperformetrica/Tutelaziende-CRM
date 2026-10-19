import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetRegistroInviiEstrattiQueryKey, getListEstrattiQueryKey, useGetRegistroInviiEstratti, useInviaEstrattiMultiplo, useListEstratti, type InvioMultiploEstrattiEsito } from "@workspace/api-client-react";
import { FileText, History, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/common";
import { useToast } from "@/hooks/use-toast";
import { fmtData, fmtEuro, fmtIstante, parseApiError } from "@/lib/format";
import { SceltaCollaboratore } from "./scelta-collaboratore";

export function EstrattiTab() {
  const [, nav] = useLocation();
  const [coll, setColl] = useState("all");
  const [stato, setStato] = useState("all");
  const [anno, setAnno] = useState("");
  const qc = useQueryClient();
  const { toast } = useToast();
  const [scelti, setScelti] = useState<Set<number>>(new Set());
  const [conferma, setConferma] = useState<number[] | null>(null);
  const [esito, setEsito] = useState<InvioMultiploEstrattiEsito | null>(null);
  const [registro, setRegistro] = useState(false);
  const invia = useInviaEstrattiMultiplo();
  const lista = useListEstratti({
    ...(coll !== "all" ? { collaboratoreId: Number(coll) } : {}),
    ...(stato !== "all" ? { stato: stato as "da_pagare" | "pagato" } : {}),
    ...(/^\d{4}$/.test(anno) ? { anno: Number(anno) } : {}),
  });
  const righe = lista.data ?? [];
  const nScelti = righe.filter((e) => scelti.has(e.id)).length;
  const tutti = righe.length > 0 && nScelti === righe.length;
  const alterna = (id: number, v: boolean) => setScelti((s) => { const n = new Set(s); if (v) n.add(id); else n.delete(id); return n; });

  const spedisci = () => {
    if (!conferma) return;
    invia.mutate({ data: { ids: conferma } }, {
      onSuccess: (r) => {
        setConferma(null);
        setScelti(new Set());
        qc.invalidateQueries({ queryKey: getListEstrattiQueryKey() });
        qc.invalidateQueries({ queryKey: getGetRegistroInviiEstrattiQueryKey() });
        setEsito(r);
      },
      onError: (e) => { setConferma(null); toast({ variant: "destructive", title: "Invio non riuscito", description: parseApiError(e).message }); },
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="space-y-1.5"><Label>Collaboratore</Label><div><SceltaCollaboratore valore={coll} onChange={setColl} conTutti testid="filtro-estratti-collaboratore" /></div></div>
        <div className="space-y-1.5"><Label>Stato</Label>
          <Select value={stato} onValueChange={setStato}>
            <SelectTrigger className="w-40 bg-card" data-testid="filtro-estratti-stato"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Tutti</SelectItem><SelectItem value="da_pagare">Da pagare</SelectItem><SelectItem value="pagato">Pagati</SelectItem></SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><Label htmlFor="f-anno">Anno</Label><Input id="f-anno" inputMode="numeric" maxLength={4} placeholder="2026" value={anno} onChange={(e) => setAnno(e.target.value)} className="w-28 bg-card" data-testid="filtro-estratti-anno" /></div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setRegistro(true)} data-testid="button-registro-invii"><History className="size-4 mr-2" />Registro invii</Button>
          <Button disabled={nScelti === 0 || invia.isPending} onClick={() => setConferma(righe.filter((e) => scelti.has(e.id)).map((e) => e.id))} data-testid="button-invia-selezionati">
            <Mail className="size-4 mr-2" />Invia per email{nScelti > 0 ? ` (${nScelti})` : ""}
          </Button>
        </div>
      </div>
      {lista.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : lista.isError ? (
        <ErrorState message={parseApiError(lista.error).message} onRetry={() => lista.refetch()} />
      ) : !lista.data?.length ? (
        <EmptyState icon={<FileText className="size-6" />} title="Nessun estratto" text="Gli estratti si creano dal resoconto, confermando le pratiche chiuse." />
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-x-auto rise">
          <Table className="tabella-schede">
            <TableHeader>
              <TableRow className="bg-muted/60 hover:bg-muted/60">
                <TableHead className="w-10"><Checkbox checked={tutti} onCheckedChange={(v) => setScelti(v ? new Set(righe.map((e) => e.id)) : new Set())} aria-label="Seleziona tutti gli estratti" data-testid="seleziona-tutti-estratti" /></TableHead>
                {["N.", "Data", "Collaboratore", "Pratiche", "Punti", "Ristorno", "Stato", "Ultimo invio", ""].map((h, i) => <TableHead key={h} className={`text-[11px] uppercase tracking-wider font-semibold h-10 ${i >= 4 && i < 6 ? "text-right" : ""}`}>{h}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.data.map((e) => (
                <TableRow key={e.id} className="cursor-pointer hover:bg-secondary/50" onClick={() => nav(`/admin/compensi/estratti/${e.id}`)} data-testid={`row-estratto-${e.id}`}>
                  <TableCell onClick={(x) => x.stopPropagation()}><Checkbox checked={scelti.has(e.id)} onCheckedChange={(v) => alterna(e.id, v === true)} aria-label={`Seleziona l'estratto ${e.id}`} data-testid={`check-estratto-${e.id}`} /></TableCell>
                  <TableCell data-label="Estratto n." className="tabular-nums font-semibold">{e.id}</TableCell>
                  <TableCell data-label="Data" className="tabular-nums">{fmtData(e.dataEstratto)}</TableCell>
                  <TableCell data-label="Collaboratore">{e.collaboratoreNome} <span className="text-muted-foreground text-xs">({e.numeroSportello})</span></TableCell>
                  <TableCell data-label="Pratiche" className="tabular-nums">{e.numeroPratiche}</TableCell>
                  <TableCell data-label="Punti" className="text-right tabular-nums">{e.totalePunti}</TableCell>
                  <TableCell data-label="Ristorno" className="text-right tabular-nums">{fmtEuro(e.totaleEuro)}</TableCell>
                  <TableCell data-label="Stato">{e.pagato ? <Badge className="bg-primary text-primary-foreground">Pagato il {fmtData(e.pagatoIl)}</Badge> : <Badge variant="outline">Da pagare</Badge>}</TableCell>
                  <TableCell data-label="Ultimo invio" className="text-sm" data-testid={`ultimo-invio-${e.id}`}>
                    {e.ultimoInvioIl ? <><span className="tabular-nums">{fmtIstante(e.ultimoInvioIl)}</span><br /><span className="text-xs text-muted-foreground">{e.ultimoInvioEtichetta}</span></> : <span className="text-muted-foreground">Mai inviato</span>}
                  </TableCell>
                  <TableCell onClick={(x) => x.stopPropagation()}>
                    <Button size="sm" variant="outline" onClick={() => setConferma([e.id])} data-testid={`button-invia-${e.id}`}><Mail className="size-3.5 mr-1.5" />Invia</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!conferma} onOpenChange={(o) => { if (!o) setConferma(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{conferma?.length === 1 ? "Inviare l'estratto per email?" : `Inviare ${conferma?.length} estratti per email?`}</DialogTitle>
            <DialogDescription>Ogni estratto arriva, in PDF, all'indirizzo del proprio collaboratore. Ogni invio resta nel registro.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConferma(null)}>Annulla</Button>
            <Button onClick={spedisci} disabled={invia.isPending} data-testid="button-conferma-invio">{invia.isPending ? "Invio in corso…" : "Invia"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!esito} onOpenChange={(o) => { if (!o) setEsito(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Esito dell'invio</DialogTitle></DialogHeader>
          <ul className="space-y-1.5 text-sm max-h-80 overflow-y-auto" data-testid="esito-invio-multiplo">
            {esito?.risultati.map((r) => (
              <li key={r.id} className="rounded-md border border-border px-3 py-2">
                Estratto n. {r.id}{r.collaboratoreNome ? ` · ${r.collaboratoreNome}` : ""}: <strong>{r.esitoEtichetta}</strong>
                {r.dettaglio && <span className="text-muted-foreground"> ({r.dettaglio})</span>}
              </li>
            ))}
          </ul>
          <DialogFooter><Button onClick={() => setEsito(null)}>Chiudi</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <RegistroInvii aperto={registro} onChiudi={() => setRegistro(false)} />
    </div>
  );
}

function RegistroInvii({ aperto, onChiudi }: { aperto: boolean; onChiudi: () => void }) {
  const dati = useGetRegistroInviiEstratti({ query: { enabled: aperto, queryKey: getGetRegistroInviiEstrattiQueryKey() } });
  return (
    <Dialog open={aperto} onOpenChange={(o) => { if (!o) onChiudi(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Registro degli invii</DialogTitle>
          <DialogDescription>Tutti gli estratti inviati per email, dal più recente.</DialogDescription>
        </DialogHeader>
        {dati.isLoading ? <Skeleton className="h-32 w-full" /> : dati.isError ? (
          <ErrorState message={parseApiError(dati.error).message} onRetry={() => dati.refetch()} />
        ) : !dati.data?.length ? (
          <p className="text-sm text-muted-foreground py-6 text-center" data-testid="registro-vuoto">Nessun estratto è ancora stato inviato.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto rounded-md border border-border" data-testid="registro-invii">
            <Table>
              <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60">{["Data e ora", "Estratto", "Collaboratore", "Destinatario", "Esito"].map((h) => <TableHead key={h} className="text-[11px] uppercase tracking-wider font-semibold h-9">{h}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {dati.data.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell className="tabular-nums whitespace-nowrap">{fmtIstante(n.creatoIl)}</TableCell>
                    <TableCell className="tabular-nums">n. {n.estrattoId}</TableCell>
                    <TableCell>{n.collaboratoreNome}</TableCell>
                    <TableCell className="break-all">{n.destinatarioContatto}</TableCell>
                    <TableCell><strong>{n.esitoEtichetta}</strong>{n.dettaglioEsito && <span className="block text-xs text-muted-foreground">{n.dettaglioEsito}</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <DialogFooter><Button onClick={onChiudi}>Chiudi</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
