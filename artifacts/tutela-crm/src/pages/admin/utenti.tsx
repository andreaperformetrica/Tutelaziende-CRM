import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListUtentiQueryKey, getGetUtenteQueryKey, useCreateUtente, useGetUtente, useImpostaPasswordProvvisoriaUtente, useListUtenti, useUpdateUtente,
  type RuoloInterno, type Utente,
} from "@workspace/api-client-react";
import { KeyRound, Loader2, Lock, Pencil, Plus, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PasswordProvvisoria } from "@/components/password-provvisoria";
import { PasswordDialog } from "@/components/password-dialog";
import { EmptyState, ErrorState, FieldError, PageHeader, StatoBadge } from "@/components/common";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/lib/auth";
import { SelettoreColore, UtenteAvatar } from "@/components/utenti/colore-utente";
import { fmtIstante, parseApiError, ruoloLabel } from "@/lib/format";

function UtenteDialog({ open, onClose, utenteId, ruoliOfferti }: { open: boolean; onClose: () => void; utenteId: number | null; ruoliOfferti: RuoloInterno[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateUtente();
  const update = useUpdateUtente();
  const det = useGetUtente(utenteId ?? 0, { query: { enabled: open && utenteId !== null, queryKey: getGetUtenteQueryKey(utenteId ?? 0) } });
  const [f, setF] = useState({ nome: "", cognome: "", email: "", ruolo: ruoliOfferti[0] as RuoloInterno, attivo: true, colore: null as string | null, pw: "" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [srv, setSrv] = useState<string | null>(null);
  const modifica = utenteId !== null;

  useEffect(() => {
    if (!open) return;
    setErrs({}); setSrv(null);
    if (!modifica) setF({ nome: "", cognome: "", email: "", ruolo: ruoliOfferti[0]!, attivo: true, colore: null, pw: "" });
  }, [open, modifica, ruoliOfferti]);
  useEffect(() => {
    if (open && modifica && det.data) setF({ nome: det.data.nome, cognome: det.data.cognome, email: det.data.email, ruolo: det.data.ruolo, attivo: det.data.attivo, colore: det.data.colore, pw: "" });
  }, [open, modifica, det.data]);

  const invia = () => {
    const e: Record<string, string> = {};
    if (!f.nome.trim()) e.nome = "Inserisci il nome";
    if (!f.cognome.trim()) e.cognome = "Inserisci il cognome";
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = "Indirizzo email non valido";
    if (!modifica && f.pw.length < 8) e.passwordProvvisoria = "Almeno 8 caratteri";
    setErrs(e); setSrv(null);
    if (Object.keys(e).length) return;
    const onError = (err: unknown) => {
      const p = parseApiError(err);
      setSrv(p.message);
      const campo = p.code === "EMAIL_DUPLICATA" ? "email" : p.campo;
      if (campo) setErrs({ [campo]: p.message });
    };
    const onSuccess = () => {
      qc.invalidateQueries({ queryKey: getListUtentiQueryKey() });
      if (utenteId !== null) qc.invalidateQueries({ queryKey: getGetUtenteQueryKey(utenteId) });
      toast({ title: modifica ? "Utente aggiornato" : "Utente creato" });
      onClose();
    };
    const base = { nome: f.nome.trim(), cognome: f.cognome.trim(), email: f.email.trim(), ruolo: f.ruolo, colore: f.colore };
    if (modifica) update.mutate({ id: utenteId, data: { ...base, attivo: f.attivo } }, { onSuccess, onError });
    else create.mutate({ data: { ...base, passwordProvvisoria: f.pw } }, { onSuccess, onError });
  };
  const pending = create.isPending || update.isPending;
  const campo = (id: "nome" | "cognome" | "email", label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`u-${id}`}>{label}</Label>
      <Input id={`u-${id}`} autoComplete="off" value={f[id]} onChange={(e) => setF({ ...f, [id]: e.target.value })} className={errs[id] ? "border-destructive" : ""} data-testid={`input-utente-${id}`} />
      <FieldError>{errs[id]}</FieldError>
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" data-testid="dialog-utente">
        <DialogHeader>
          <DialogTitle>{modifica ? "Modifica utente interno" : "Nuovo utente interno"}</DialogTitle>
          <DialogDescription>{modifica ? "Aggiorna i dati e il ruolo dell'utente." : "L'utente dovrà cambiare la password provvisoria al primo accesso."}</DialogDescription>
        </DialogHeader>
        {modifica && det.isLoading ? <Skeleton className="h-48 w-full" /> : modifica && det.isError ? <ErrorState message={parseApiError(det.error).message} onRetry={() => det.refetch()} /> : (
          <div className="space-y-4">
            {srv && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive font-medium" data-testid="errore-utente">{srv}</div>}
            <div className="grid grid-cols-2 gap-3">{campo("cognome", "Cognome")}{campo("nome", "Nome")}</div>
            {campo("email", "Email")}
            <div className="space-y-1.5">
              <Label>Ruolo</Label>
              <Select value={f.ruolo} onValueChange={(v) => setF({ ...f, ruolo: v as RuoloInterno })} disabled={ruoliOfferti.length === 1}>
                <SelectTrigger data-testid="select-ruolo"><SelectValue /></SelectTrigger>
                <SelectContent>{ruoliOfferti.map((r) => <SelectItem key={r} value={r}>{ruoloLabel(r)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Colore</Label><SelettoreColore value={f.colore} onChange={(c) => setF({ ...f, colore: c })} idUtente={utenteId} /></div>
            {modifica ? (
              <label className="flex items-center gap-3 text-sm font-medium"><Switch checked={f.attivo} onCheckedChange={(v) => setF({ ...f, attivo: v })} data-testid="switch-utente-attivo" /> Utente attivo</label>
            ) : (
              <div className="space-y-1.5"><Label>Password provvisoria</Label><PasswordProvvisoria value={f.pw} onChange={(v) => setF({ ...f, pw: v })} invalid={!!errs.passwordProvvisoria} /><FieldError>{errs.passwordProvvisoria}</FieldError></div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} data-testid="button-annulla-utente">Annulla</Button>
          <Button onClick={invia} disabled={pending || (modifica && !det.data)} data-testid="button-salva-utente">{pending && <Loader2 className="size-4 mr-2 animate-spin" />} {modifica ? "Salva" : "Crea utente"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function UtentiPage() {
  const { session } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const lista = useListUtenti();
  const imposta = useImpostaPasswordProvvisoriaUtente();
  const [dlg, setDlg] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const [pw, setPw] = useState<Utente | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const isSuper = session?.ruolo === "super_admin";
  const ruoli: RuoloInterno[] = isSuper ? ["super_admin", "admin", "operatore"] : ["operatore"];
  const gestibile = (u: Utente) => isSuper || u.ruolo === "operatore";
  const forbidden = lista.isError && parseApiError(lista.error).status === 403;

  return (
    <div>
      <PageHeader kicker="Amministrazione" title="Utenti interni" subtitle={lista.data ? `${lista.data.length} utenti` : undefined}
        actions={<Button onClick={() => setDlg({ open: true, id: null })} data-testid="button-nuovo-utente"><Plus className="size-4 mr-1.5" /> Nuovo utente</Button>} />
      {!isSuper && <p className="text-sm text-muted-foreground mb-4 rise">Come amministratore puoi gestire solo gli utenti con ruolo Operatore.</p>}
      {lista.isLoading ? <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        : forbidden ? <ErrorState message={parseApiError(lista.error).message} />
        : lista.isError ? <ErrorState message={parseApiError(lista.error).message} onRetry={() => lista.refetch()} />
        : !lista.data?.length ? <EmptyState icon={<Users className="size-6" />} title="Nessun utente interno" text="Crea il primo utente per far lavorare lo staff in back office." action={<Button onClick={() => setDlg({ open: true, id: null })}>Nuovo utente</Button>} />
        : (
          <div className="rounded-lg border border-border bg-card overflow-x-auto rise">
            <Table className="tabella-schede">
              <TableHeader><TableRow className="bg-muted/60 hover:bg-muted/60">
                {["Cognome e nome", "Email", "Ruolo", "Stato", "Ultimo accesso", ""].map((h) => <TableHead key={h} className="text-[11px] uppercase tracking-wider font-semibold h-10">{h}</TableHead>)}
              </TableRow></TableHeader>
              <TableBody>
                {lista.data.map((u) => (
                  <TableRow key={u.id} className="hover:bg-secondary/50 transition-colors" data-testid={`row-utente-${u.id}`}>
                    <TableCell className="font-semibold"><span className="inline-flex items-center gap-3"><UtenteAvatar id={u.id} colore={u.colore} nome={u.nome} cognome={u.cognome} className="size-8 text-xs" />{u.cognome} {u.nome}</span></TableCell>
                    <TableCell data-label="Email" className="text-sm">{u.email}</TableCell>
                    <TableCell data-label="Ruolo"><Badge variant="outline">{ruoloLabel(u.ruolo)}</Badge></TableCell>
                    <TableCell data-label="Stato"><div className="flex flex-col gap-1 items-start"><StatoBadge attivo={u.attivo} />{u.deveCambiarePassword && <span className="text-[11px] text-accent-foreground font-semibold">Cambio password in attesa</span>}</div></TableCell>
                    <TableCell data-label="Ultimo accesso" className="text-sm tabular-nums">{u.ultimoAccesso ? fmtIstante(u.ultimoAccesso) : <span className="text-muted-foreground">Mai</span>}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {gestibile(u) ? (<>
                        <Button size="sm" variant="ghost" onClick={() => setDlg({ open: true, id: u.id })} data-testid={`button-modifica-utente-${u.id}`}><Pencil className="size-3.5 mr-1" /> Modifica</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setPwErr(null); setPw(u); }} data-testid={`button-password-utente-${u.id}`}><KeyRound className="size-3.5 mr-1" /> Password</Button>
                      </>) : <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Lock className="size-3" /> Solo super amministratore</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      <UtenteDialog open={dlg.open} utenteId={dlg.id} ruoliOfferti={ruoli} onClose={() => setDlg({ open: false, id: null })} />
      <PasswordDialog open={!!pw} onClose={() => setPw(null)} nome={pw ? `${pw.cognome} ${pw.nome}` : ""} pending={imposta.isPending} error={pwErr}
        onConfirm={(p) => pw && imposta.mutate({ id: pw.id, data: { passwordProvvisoria: p } }, {
          onSuccess: () => { qc.invalidateQueries({ queryKey: getListUtentiQueryKey() }); qc.invalidateQueries({ queryKey: getGetUtenteQueryKey(pw.id) }); setPw(null); toast({ title: "Password provvisoria impostata" }); },
          onError: (e) => setPwErr(parseApiError(e).message),
        })} />
    </div>
  );
}
