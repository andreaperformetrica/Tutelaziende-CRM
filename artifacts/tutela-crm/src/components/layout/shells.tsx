import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetConteggioSegnalazioniQueryKey, useGetConteggioSegnalazioni, useLogout, type SessioneUtente } from "@workspace/api-client-react";
import { Inbox, Paperclip, UserCheck, KeyRound, LogOut, ScrollText, ShieldCheck, Users, UsersRound, Home, UserRound, TriangleAlert, FileText, FileSignature, ListOrdered, Clock, Bell, CalendarDays, Coins } from "lucide-react";
import { iniziali, ruoloLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

function useEsci() {
  const qc = useQueryClient();
  const [, nav] = useLocation();
  const m = useLogout();
  return () => m.mutate(undefined, { onSettled: () => { qc.clear(); nav("/login"); } });
}

function Marchio({ chiaro }: { chiaro?: boolean }) {
  return (
    <div className="space-y-1.5">
      <img src={`${import.meta.env.BASE_URL}logo-bianco.png`} alt="Tutelaziende" className="h-7 w-auto" data-testid="logo" />
      <div className={cn("text-[10px] uppercase tracking-[0.2em]", chiaro ? "text-primary-foreground/70" : "text-sidebar-foreground/60")}>Patronato e CAF</div>
    </div>
  );
}

const VOCI = [
  { href: "/admin/pratiche", label: "Pratiche", icon: Inbox, roles: ["super_admin", "admin", "operatore"], id: "pratiche" },
  { href: "/admin/le-mie-pratiche", label: "Le mie pratiche", icon: UserCheck, roles: ["super_admin", "admin", "operatore"], id: "le-mie-pratiche" },
  { href: "/admin/collaboratori", label: "Collaboratori", icon: UsersRound, roles: ["super_admin", "admin", "operatore"], id: "collaboratori" },
  { href: "/admin/assistiti", label: "Assistiti", icon: UserRound, roles: ["super_admin", "admin", "operatore"], id: "assistiti" },
  { href: "/admin/segnalazioni", label: "Segnalazioni", icon: TriangleAlert, roles: ["super_admin", "admin"], id: "segnalazioni" },
  { href: "/admin/eventi", label: "Eventi e corsi", icon: CalendarDays, roles: ["super_admin", "admin"], id: "eventi" },
  { href: "/admin/compensi", label: "Compensi", icon: Coins, roles: ["super_admin", "admin"], id: "compensi" },
  { href: "/admin/tipi-pratica", label: "Tipi di pratica", icon: FileText, roles: ["super_admin", "admin"], id: "tipi-pratica" },
  { href: "/admin/mandati", label: "Mandati", icon: FileSignature, roles: ["super_admin", "admin"], id: "mandati" },
  { href: "/admin/stati-pratica", label: "Stati pratica", icon: ListOrdered, roles: ["super_admin", "admin"], id: "stati-pratica" },
  { href: "/admin/categorie-allegato", label: "Categorie allegati", icon: Paperclip, roles: ["super_admin", "admin"], id: "categorie-allegato" },
  { href: "/admin/orari", label: "Orari di caricamento", icon: Clock, roles: ["super_admin", "admin"], id: "orari" },
  { href: "/admin/utenti", label: "Utenti interni", icon: Users, roles: ["super_admin", "admin"], id: "utenti" },
  { href: "/admin/notifiche", label: "Registro notifiche", icon: Bell, roles: ["super_admin", "admin"], id: "notifiche" },
  { href: "/admin/log", label: "Log operazioni", icon: ScrollText, roles: ["super_admin", "admin"], id: "log" },
];

export function BackofficeShell({ s, children }: { s: SessioneUtente; children: ReactNode }) {
  const [loc] = useLocation();
  const esci = useEsci();
  const voci = VOCI.filter((v) => v.roles.includes(s.ruolo));
  const attivo = (h: string) => loc === h || loc.startsWith(h + "/");
  const vedeSegnalazioni = s.ruolo === "super_admin" || s.ruolo === "admin";
  const conteggio = useGetConteggioSegnalazioni({ query: { enabled: vedeSegnalazioni, refetchInterval: 30000, queryKey: getGetConteggioSegnalazioniQueryKey() } });
  const aperte = conteggio.data?.aperte ?? 0;
  return (
    <div className="min-h-[100dvh] md:grid md:grid-cols-[17rem_1fr]">
      <aside className="bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:h-[100dvh] flex md:flex-col gap-3 md:gap-0 p-3 md:p-5 items-center md:items-stretch overflow-x-auto">
        <div className="md:mb-8 shrink-0"><Marchio /></div>
        <div className="hidden md:block text-[10px] uppercase tracking-[0.2em] text-sidebar-foreground/50 mb-2 px-2">Area gestionale</div>
        <nav className="flex md:flex-col gap-1 md:flex-1" data-testid="nav-backoffice">
          {voci.map((v) => (
            <Link key={v.href} href={v.href} data-testid={`link-menu-${v.id}`}
              className={cn("group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                attivo(v.href) ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground")}>
              <span className={cn("absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded bg-sidebar-primary transition-transform origin-center", attivo(v.href) ? "scale-y-100" : "scale-y-0")} />
              <v.icon className="size-4 opacity-80" /> {v.label}
              {v.id === "segnalazioni" && aperte > 0 && (
                <span className="ml-auto min-w-5 rounded-full bg-sidebar-primary px-1.5 text-center text-[11px] font-bold text-sidebar-primary-foreground" data-testid="badge-segnalazioni" aria-label={`${aperte} segnalazioni aperte`}>{aperte}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="hidden md:block border-t border-sidebar-border pt-4 space-y-3">
          <div className="flex items-center gap-3 px-1">
            <div className="size-9 rounded-full bg-sidebar-primary text-sidebar-primary-foreground grid place-items-center text-sm font-bold">{iniziali(s.nome, s.cognome)}</div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-sidebar-accent-foreground truncate" data-testid="text-utente-nome">{s.nome} {s.cognome}</div>
              <div className="flex items-center gap-1 text-xs text-sidebar-foreground/70" data-testid="text-utente-ruolo"><ShieldCheck className="size-3" /> {ruoloLabel(s.ruolo)}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Link href="/cambia-password" data-testid="link-cambia-password" className="flex items-center justify-center gap-1.5 rounded-md border border-sidebar-border py-1.5 text-xs hover:bg-sidebar-accent transition-colors"><KeyRound className="size-3.5" /> Cambia password</Link>
            <button onClick={esci} data-testid="button-esci" className="flex items-center justify-center gap-1.5 rounded-md border border-sidebar-border py-1.5 text-xs hover:bg-sidebar-accent transition-colors"><LogOut className="size-3.5" /> Esci</button>
          </div>
        </div>
        <div className="md:hidden ml-auto flex gap-1 shrink-0">
          <Link href="/cambia-password" aria-label="Cambia password" className="p-2 rounded-md hover:bg-sidebar-accent"><KeyRound className="size-4" /></Link>
          <button onClick={esci} aria-label="Esci" className="p-2 rounded-md hover:bg-sidebar-accent" data-testid="button-esci-mobile"><LogOut className="size-4" /></button>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 md:px-8 md:py-8 w-full">{children}</main>
    </div>
  );
}

export function CollaboratoreShell({ s, children }: { s: SessioneUtente; children: ReactNode }) {
  const [loc] = useLocation();
  const esci = useEsci();
  const voci = [{ href: "/collaboratore", label: "Home", icon: Home }, { href: "/collaboratore/assistiti", label: "Assistiti", icon: UserRound }, { href: "/collaboratore/pratiche", label: "Le mie pratiche", icon: FileText }, { href: "/collaboratore/eventi", label: "Eventi", icon: CalendarDays }, { href: "/cambia-password", label: "Cambia password", icon: KeyRound }];
  return (
    <div className="min-h-[100dvh] bg-secondary/40 paper">
      <header className="bg-primary text-primary-foreground border-b-4 border-accent">
        <div className="mx-auto max-w-5xl px-4 h-16 flex items-center gap-6">
          <Marchio chiaro />
          <nav className="flex gap-1 ml-2" data-testid="nav-collaboratore">
            {voci.map((v) => (
              <Link key={v.href} href={v.href} data-testid={`link-menu-${v.label.toLowerCase().replace(" ", "-")}`}
                className={cn("flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors", (loc === v.href || (v.href !== "/collaboratore" && loc.startsWith(v.href + "/"))) ? "bg-accent text-accent-foreground" : "hover:bg-primary-foreground/10")}>
                <v.icon className="size-4" /><span className="hidden sm:inline">{v.label}</span>
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden sm:block text-right leading-tight">
              <div className="text-sm font-semibold" data-testid="text-utente-nome">{s.nome} {s.cognome}</div>
              <div className="text-[11px] opacity-70">{ruoloLabel(s.ruolo)}</div>
            </div>
            <button onClick={esci} data-testid="button-esci" className="flex items-center gap-1.5 rounded-full border border-primary-foreground/30 px-3 py-1.5 text-sm hover:bg-primary-foreground/10 transition-colors"><LogOut className="size-4" /> Esci</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
