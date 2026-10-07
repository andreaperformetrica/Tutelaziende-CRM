import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getListTipiPraticaQueryKey, getGetTipoPraticaQueryKey, useCreateTipoPratica, useListTipiPratica } from "@workspace/api-client-react";
import { FileText, Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, PageHeader } from "@/components/common";
import { CampiTipo, leggiTipo, tipoVuoto, type ValoriTipo } from "@/components/pratiche/campi-tipo";
import { useToast } from "@/hooks/use-toast";
import { fmtEuro, parseApiError } from "@/lib/format";

function NuovoTipoDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, nav] = useLocation();
  const create = useCreateTipoPratica();
  const [v, setV] = useState<ValoriTipo>(tipoVuoto);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [srv, setSrv] = useState<string | null>(null);

  const invia = () => {
    const r = leggiTipo(v);
    setSrv(null);
    if ("errori" in r) return setErrs(r.errori);
    setErrs({});
    create.mutate({ data: r.dati }, {
      onSuccess: (t) => {
        qc.setQueryData(getGetTipoPraticaQueryKey(t.id), t);
        qc.invalidateQueries({ queryKey: getListTipiPraticaQueryKey() });
        toast({ title: "Tipo di pratica creato" });
        onClose();
        nav(`/admin/tipi-pratica/${t.id}`);
      },
      onError: (e) => {
        const p = parseApiError(e);
        setSrv(p.message);
        if (p.campo) setErrs({ [p.campo]: p.message });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); else { setV(tipoVuoto); setErrs({}); setSrv(null); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nuovo tipo di pratica</DialogTitle></DialogHeader>
        <CampiTipo v={v} onChange={setV} errs={errs} />
        {srv && !Object.keys(errs).length && <p className="text-sm font-medium text-destructive" data-testid="errore-form">{srv}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annulla</Button>
          <Button onClick={invia} disabled={create.isPending} data-testid="button-salva-tipo">
            {create.isPending && <Loader2 className="size-4 mr-2 animate-spin" />} Crea tipo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function TipiPraticaPage() {
  const q = useListTipiPratica();
  const [nuovo, setNuovo] = useState(false);
  const tipi = q.data ?? [];
  return (
    <div>
      <PageHeader kicker="Configurazione" title="Tipi di pratica"
        subtitle="Per ogni tipo: dati economici, documenti obbligatori e moduli scaricabili dai collaboratori."
        actions={<Button onClick={() => setNuovo(true)} data-testid="button-nuovo-tipo"><Plus className="size-4 mr-2" /> Nuovo tipo</Button>} />
      {q.isLoading ? <Skeleton className="h-56 w-full" />
        : q.isError ? <ErrorState message="Impossibile caricare i tipi di pratica." onRetry={() => q.refetch()} />
        : !tipi.length ? <EmptyState icon={<FileText className="size-6" />} title="Nessun tipo di pratica" text="Crea il primo tipo per iniziare a configurare le pratiche." action={<Button onClick={() => setNuovo(true)}><Plus className="size-4 mr-2" /> Nuovo tipo</Button>} />
        : (
          <div className="rounded-lg border border-border bg-card overflow-x-auto rise">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead><TableHead>Stato</TableHead><TableHead>Pagabile</TableHead>
                  <TableHead className="text-right">Punti</TableHead><TableHead className="text-right">Valore</TableHead>
                  <TableHead className="text-right">Documenti</TableHead><TableHead className="text-right">Moduli</TableHead><TableHead className="text-right"><span className="sr-only">Azioni</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tipi.map((t) => (
                  <TableRow key={t.id} data-testid={`riga-tipo-${t.id}`}>
                    <TableCell className="font-semibold"><Link href={`/admin/tipi-pratica/${t.id}`} className="hover:underline" data-testid={`link-tipo-${t.id}`}>{t.nome}</Link></TableCell>
                    <TableCell>{t.attivo ? <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">Attivo</Badge> : <Badge variant="outline" className="text-muted-foreground">Disattivato</Badge>}</TableCell>
                    <TableCell>{t.pagabile ? "Sì" : "No"}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.pagabile ? t.punti : "-"}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.pagabile ? fmtEuro(t.valoreEuro) : "-"}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.documenti.length}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.moduli.length}</TableCell>
                    <TableCell className="text-right"><Button asChild size="sm" variant="outline"><Link href={`/admin/tipi-pratica/${t.id}`} data-testid={`button-modifica-tipo-${t.id}`}><Pencil className="size-4 mr-1.5" /> Modifica</Link></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      <NuovoTipoDialog open={nuovo} onClose={() => setNuovo(false)} />
    </div>
  );
}
