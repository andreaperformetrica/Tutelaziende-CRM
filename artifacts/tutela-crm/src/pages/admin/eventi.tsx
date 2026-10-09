import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getListEventiBackofficeQueryKey, useCreateEvento, useListEventiBackoffice } from "@workspace/api-client-react";
import { CalendarDays, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { FormEvento } from "@/components/eventi/form-evento";
import { useToast } from "@/hooks/use-toast";
import { fmtData, fmtOrarioEvento, parseApiError } from "@/lib/format";

export default function EventiBackoffice() {
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const lista = useListEventiBackoffice();
  const crea = useCreateEvento();
  const [nuovo, setNuovo] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div>
      <PageHeader title="Eventi e corsi" subtitle="Eventi di formazione, inviti alle sedi, presenze e attestati."
        actions={<Button onClick={() => { setErr(null); setNuovo(true); }} data-testid="button-nuovo-evento"><Plus className="size-4 mr-2" /> Nuovo evento</Button>} />

      {lista.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : lista.isError ? (
        <ErrorState message={parseApiError(lista.error).message} onRetry={() => lista.refetch()} />
      ) : !lista.data?.length ? (
        <EmptyState icon={<CalendarDays className="size-6" />} title="Nessun evento" text="Crea il primo evento e scegli le sedi da invitare."
          action={<Button onClick={() => setNuovo(true)}>Nuovo evento</Button>} />
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-x-auto rise">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60 hover:bg-muted/60">
                {["Evento", "Quando", "Luogo", "Sedi confermate", "Iscritti", "Presenti", ""].map((h) => <TableHead key={h} className="text-[11px] uppercase tracking-wider font-semibold h-10 whitespace-nowrap">{h}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.data.map((r) => (
                <TableRow key={r.evento.id} className="cursor-pointer hover:bg-secondary/50" onClick={() => nav(`/admin/eventi/${r.evento.id}`)} data-testid={`row-evento-${r.evento.id}`}>
                  <TableCell className="font-semibold">{r.evento.titolo}</TableCell>
                  <TableCell className="tabular-nums whitespace-nowrap">{fmtData(r.evento.data)} · {fmtOrarioEvento(r.evento.oraInizio, r.evento.oraFine)}</TableCell>
                  <TableCell className="text-sm">{r.evento.luogo}</TableCell>
                  <TableCell className="tabular-nums">{r.confermati} / {r.invitati}</TableCell>
                  <TableCell className="tabular-nums">{r.partecipanti}</TableCell>
                  <TableCell className="tabular-nums">{r.presenti}</TableCell>
                  <TableCell>{r.evento.passato ? <Badge variant="outline">Concluso</Badge> : <Badge className="bg-primary text-primary-foreground">In programma</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={nuovo} onOpenChange={setNuovo}>
        <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nuovo evento</DialogTitle></DialogHeader>
          <FormEvento conSedi etichetta="Crea e invita" invio={crea.isPending} errore={err} onAnnulla={() => setNuovo(false)}
            onSubmit={(d, sedi) => {
              setErr(null);
              crea.mutate({ data: { ...d, collaboratoriIds: sedi } }, {
                onSuccess: (r) => {
                  qc.invalidateQueries({ queryKey: getListEventiBackofficeQueryKey() });
                  toast({ title: "Evento creato", description: sedi.length ? `Inviti inviati a ${sedi.length} ${sedi.length === 1 ? "sede" : "sedi"}.` : undefined });
                  setNuovo(false);
                  nav(`/admin/eventi/${r.evento.id}`);
                },
                onError: (e) => setErr(parseApiError(e).message),
              });
            }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
