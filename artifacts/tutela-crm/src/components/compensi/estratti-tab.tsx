import { useState } from "react";
import { useLocation } from "wouter";
import { useListEstratti } from "@workspace/api-client-react";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/common";
import { fmtData, fmtEuro, parseApiError } from "@/lib/format";
import { SceltaCollaboratore } from "./scelta-collaboratore";

export function EstrattiTab() {
  const [, nav] = useLocation();
  const [coll, setColl] = useState("all");
  const [stato, setStato] = useState("all");
  const [anno, setAnno] = useState("");
  const lista = useListEstratti({
    ...(coll !== "all" ? { collaboratoreId: Number(coll) } : {}),
    ...(stato !== "all" ? { stato: stato as "da_pagare" | "pagato" } : {}),
    ...(/^\d{4}$/.test(anno) ? { anno: Number(anno) } : {}),
  });
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
      </div>
      {lista.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : lista.isError ? (
        <ErrorState message={parseApiError(lista.error).message} onRetry={() => lista.refetch()} />
      ) : !lista.data?.length ? (
        <EmptyState icon={<FileText className="size-6" />} title="Nessun estratto" text="Gli estratti si creano dal resoconto, confermando le pratiche chiuse." />
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-x-auto rise">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60 hover:bg-muted/60">
                {["N.", "Data", "Collaboratore", "Pratiche", "Punti", "Ristorno", "Stato"].map((h, i) => <TableHead key={h} className={`text-[11px] uppercase tracking-wider font-semibold h-10 ${i >= 4 && i < 6 ? "text-right" : ""}`}>{h}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.data.map((e) => (
                <TableRow key={e.id} className="cursor-pointer hover:bg-secondary/50" onClick={() => nav(`/admin/compensi/estratti/${e.id}`)} data-testid={`row-estratto-${e.id}`}>
                  <TableCell className="tabular-nums font-semibold">{e.id}</TableCell>
                  <TableCell className="tabular-nums">{fmtData(e.dataEstratto)}</TableCell>
                  <TableCell>{e.collaboratoreNome} <span className="text-muted-foreground text-xs">({e.numeroSportello})</span></TableCell>
                  <TableCell className="tabular-nums">{e.numeroPratiche}</TableCell>
                  <TableCell className="text-right tabular-nums">{e.totalePunti}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtEuro(e.totaleEuro)}</TableCell>
                  <TableCell>{e.pagato ? <Badge className="bg-primary text-primary-foreground">Pagato il {fmtData(e.pagatoIl)}</Badge> : <Badge variant="outline">Da pagare</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
