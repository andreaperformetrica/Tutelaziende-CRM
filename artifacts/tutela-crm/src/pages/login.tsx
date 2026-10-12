import { useState } from "react";
import { Redirect, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetSessioneQueryKey, useLogin } from "@workspace/api-client-react";
import { Loader2, LockKeyhole } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useSession, homeFor } from "@/lib/auth";
import { parseApiError } from "@/lib/format";

export default function LoginPage() {
  const { session, isLoading } = useSession();
  const qc = useQueryClient();
  const [, nav] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const login = useLogin();

  if (session) return <Redirect to={session.deveCambiarePassword ? "/cambia-password" : homeFor(session.area)} />;

  const invia = (ev: React.FormEvent) => {
    ev.preventDefault();
    setErrore(null);
    login.mutate({ data: { email: email.trim(), password } }, {
      onSuccess: (s) => {
        qc.setQueryData(getGetSessioneQueryKey(), s);
        qc.invalidateQueries({ queryKey: getGetSessioneQueryKey() });
        nav(s.deveCambiarePassword ? "/cambia-password" : homeFor(s.area));
      },
      onError: (e) => {
        const p = parseApiError(e);
        setErrore(p.status === 429 ? "Troppi tentativi di accesso. Attendi qualche minuto prima di riprovare." : p.message);
      },
    });
  };

  return (
    <div className="min-h-[100dvh] grid lg:grid-cols-[1.1fr_1fr]">
      <div className="hidden lg:flex relative flex-col justify-between bg-sidebar text-sidebar-foreground p-12 overflow-hidden">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "repeating-linear-gradient(0deg, currentColor 0 1px, transparent 1px 34px)" }} />
        <div className="absolute -right-24 -bottom-24 size-96 rounded-full border-[40px] border-accent/25" />
        <div className="relative flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}logo-bianco.png`} alt="Tutelaziende" className="h-10 w-auto" data-testid="logo" />
        </div>
        <div className="relative max-w-md rise">
          <h1 className="font-serif text-5xl leading-[1.05] text-sidebar-accent-foreground">Ogni pratica,<br />un fascicolo in ordine.</h1>
          <p className="mt-5 text-sidebar-foreground/80">Il gestionale dello sportello: anagrafiche, collaboratori e registro delle operazioni, in un unico posto.</p>
        </div>
        <div className="relative text-xs uppercase tracking-[0.2em] text-sidebar-foreground/50">Patronato · CAF · Collaboratori territoriali</div>
      </div>
      <div className="flex items-center justify-center p-6 paper">
        <form onSubmit={invia} className="w-full max-w-sm rise" data-testid="form-login">
          <div className="lg:hidden mb-8"><img src={`${import.meta.env.BASE_URL}logo.png`} alt="Tutelaziende" className="h-8 w-auto" /></div>
          <div className="size-11 rounded-full bg-secondary grid place-items-center mb-4"><LockKeyhole className="size-5 text-secondary-foreground" /></div>
          <h2 className="text-3xl font-bold">Accedi</h2>
          <p className="text-sm text-muted-foreground mt-1 mb-6">Inserisci le credenziali che ti ha fornito l'ufficio.</p>
          {errore && <div role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive font-medium" data-testid="text-login-errore">{errore}</div>}
          <div className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" /></div>
            <div className="space-y-1.5"><Label htmlFor="password">Password</Label><Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-password" /></div>
            <Button type="submit" className="w-full" disabled={login.isPending || isLoading} data-testid="button-login">
              {login.isPending && <Loader2 className="size-4 mr-2 animate-spin" />} Entra
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
