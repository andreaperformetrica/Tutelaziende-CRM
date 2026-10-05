import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PasswordProvvisoria } from "@/components/password-provvisoria";

export function PasswordDialog({ open, onClose, nome, pending, error, onConfirm }: {
  open: boolean; onClose: () => void; nome: string; pending: boolean; error: string | null; onConfirm: (pw: string) => void;
}) {
  const [pw, setPw] = useState("");
  const [locale, setLocale] = useState<string | null>(null);
  useEffect(() => { if (open) { setPw(""); setLocale(null); } }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="dialog-password">
        <DialogHeader>
          <DialogTitle>Imposta password provvisoria</DialogTitle>
          <DialogDescription>Nuova password temporanea per {nome}. Al prossimo accesso sarà obbligato a cambiarla.</DialogDescription>
        </DialogHeader>
        <PasswordProvvisoria value={pw} onChange={setPw} invalid={!!(locale || error)} />
        {(locale || error) && <p className="text-sm font-medium text-destructive" role="alert" data-testid="errore-password">{locale ?? error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} data-testid="button-annulla-password">Annulla</Button>
          <Button disabled={pending} data-testid="button-conferma-password"
            onClick={() => { if (pw.length < 8) { setLocale("La password deve avere almeno 8 caratteri"); return; } setLocale(null); onConfirm(pw); }}>
            {pending && <Loader2 className="size-4 mr-2 animate-spin" />} Imposta password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
