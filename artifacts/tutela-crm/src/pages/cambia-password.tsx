import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetSessioneQueryKey, useCambiaPassword } from "@workspace/api-client-react";
import { KeyRound, Loader2, ShieldAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useSession, homeFor } from "@/lib/auth";
import { parseApiError } from "@/lib/format";
import { FieldError } from "@/components/common";

export default function CambiaPasswordPage({ incorporata = false }: { incorporata?: boolean }) {
  const { session } = useSession();
  const qc = useQueryClient();
  const [, nav] = useLocation();
  const { toast } = useToast();
  const [att, setAtt] = useState("");
  const [nuova, setNuova] = useState("");
  const [conf, setConf] = useState("");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [srv, setSrv] = useState<string | null>(null);
  const m = useCambiaPassword();
  const forzato = !incorporata && !!session?.deveCambiarePassword;

  const invia = (ev: React.FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (!att) e.passwordAttuale = "Inserisci la password attuale";
    if (nuova.length < 8) e.nuovaPassword = "La nuova password deve avere almeno 8 caratteri";
    else if (nuova === att) e.nuovaPassword = "La nuova password deve essere diversa da quella attuale";
    if (conf !== nuova) e.conferma = "Le due password non coincidono";
    setErrs(e); setSrv(null);
    if (Object.keys(e).length) return;
    m.mutate({ data: { passwordAttuale: att, nuovaPassword: nuova } }, {
      onSuccess: (s) => {
        qc.setQueryData(getGetSessioneQueryKey(), s);
        qc.invalidateQueries({ queryKey: getGetSessioneQueryKey() });
        toast({ title: "Password aggiornata" });
        if (incorporata) { setAtt(""); setNuova(""); setConf(""); setErrs({}); } else nav(homeFor(s.area));
      },
      onError: (err) => {
        const p = parseApiError(err);
        setSrv(p.message);
        if (p.campo === "passwordAttuale" || p.campo === "nuovaPassword") setErrs({ [p.campo]: p.message });
      },
    });
  };

  const campi = [
    { id: "passwordAttuale", label: "Password attuale", v: att, set: setAtt, ac: "current-password" },
    { id: "nuovaPassword", label: "Nuova password", v: nuova, set: setNuova, ac: "new-password" },
    { id: "conferma", label: "Conferma nuova password", v: conf, set: setConf, ac: "new-password" },
  ];
  return (
    <div className={forzato ? "min-h-[100dvh] grid place-items-center p-6 bg-sidebar" : incorporata ? "" : "max-w-lg"}>
      <form onSubmit={invia} className={`rise ${forzato ? "w-full max-w-md bg-card rounded-xl p-8 shadow-2xl border-t-4 border-accent" : "bg-card border border-border rounded-lg p-6"}`} data-testid="form-cambia-password">
        {forzato ? (
          <div className="flex gap-3 rounded-md bg-accent/20 border border-accent p-3 mb-5" data-testid="avviso-primo-accesso">
            <ShieldAlert className="size-5 shrink-0 mt-0.5" />
            <p className="text-sm"><b>Primo accesso o password reimpostata.</b> Per motivi di sicurezza devi scegliere una nuova password personale prima di continuare: non potrai usare altre sezioni finché non l'avrai cambiata.</p>
          </div>
        ) : null}
        <div className="flex items-center gap-2 mb-1"><KeyRound className="size-5 text-primary" />{incorporata ? <h2 className="text-lg font-bold">Cambia password</h2> : <h1 className="text-2xl font-bold">Cambia password</h1>}</div>
        <p className="text-sm text-muted-foreground mb-5">Almeno 8 caratteri, diversa da quella attuale.</p>
        {srv && <div role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive font-medium" data-testid="text-errore">{srv}</div>}
        <div className="space-y-4">
          {campi.map((c) => (
            <div key={c.id} className="space-y-1.5">
              <Label htmlFor={c.id}>{c.label}</Label>
              <Input id={c.id} type="password" autoComplete={c.ac} value={c.v} onChange={(e) => c.set(e.target.value)} className={errs[c.id] ? "border-destructive" : ""} data-testid={`input-${c.id}`} />
              <FieldError>{errs[c.id]}</FieldError>
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={m.isPending} data-testid="button-salva-password">{m.isPending && <Loader2 className="size-4 mr-2 animate-spin" />} Salva nuova password</Button>
            {!forzato && !incorporata && session && <Button type="button" variant="ghost" onClick={() => nav(homeFor(session.area))} data-testid="button-annulla">Annulla</Button>}
          </div>
        </div>
      </form>
    </div>
  );
}
