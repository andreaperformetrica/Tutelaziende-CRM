import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetAvvisiQueryKey, getGetConteggioAlertQueryKey, getGetConteggioSegnalazioniQueryKey, getGetNonLettiChatQueryKey, useGetAvvisi, useGetConteggioAlert, useGetConteggioSegnalazioni, useGetNonLettiChat, useLogout, type SessioneUtente } from "@workspace/api-client-react";
import { Inbox, UserCheck, KeyRound, LogOut, ScrollText, ShieldCheck, Users, UsersRound, Home, UserRound, TriangleAlert, FileText, FileSignature, ListOrdered, Clock, Bell, CalendarDays, Coins, Settings, ChevronDown, Newspaper, Menu, LayoutDashboard, MessagesSquare, BellRing, ChartColumn } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { UtenteAvatar } from "@/components/utenti/colore-utente";
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

type Voce = { href: string; label: string; icon: typeof Inbox; roles: string[]; id: string; gruppo?: string };

const VOCI: Voce[] = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["super_admin", "admin", "operatore"], id: "dashboard" },
  { href: "/admin/pratiche", label: "Pratiche", icon: Inbox, roles: ["super_admin", "admin", "operatore"], id: "pratiche" },
  { href: "/admin/le-mie-pratiche", label: "Le mie pratiche", icon: UserCheck, roles: ["super_admin", "admin", "operatore"], id: "le-mie-pratiche" },
  { href: "/admin/collaboratori", label: "Collaboratori", icon: UsersRound, roles: ["super_admin", "admin", "operatore"], id: "collaboratori" },
  { href: "/admin/assistiti", label: "Assistiti", icon: UserRound, roles: ["super_admin", "admin", "operatore"], id: "assistiti" },
  { href: "/admin/news", label: "News", icon: Newspaper, roles: ["super_admin", "admin", "operatore"], id: "news" },
  { href: "/admin/chat", label: "Chat interna", icon: MessagesSquare, roles: ["super_admin", "admin", "operatore"], id: "chat" },
  { href: "/admin/segnalazioni", label: "Segnalazioni", icon: TriangleAlert, roles: ["super_admin", "admin"], id: "segnalazioni" },
  { href: "/admin/alert", label: "Alert", icon: BellRing, roles: ["super_admin", "admin"], id: "alert" },
  { href: "/admin/eventi", label: "Eventi e corsi", icon: CalendarDays, roles: ["super_admin", "admin"], id: "eventi" },
  { href: "/admin/compensi", label: "Compensi", icon: Coins, roles: ["super_admin", "admin"], id: "compensi" },
  { href: "/admin/statistiche", label: "Statistiche operatori", icon: ChartColumn, roles: ["super_admin"], id: "statistiche" },
  { href: "/admin/tipi-pratica", label: "Tipi di pratica", icon: FileText, roles: ["super_admin", "admin"], id: "tipi-pratica", gruppo: "settaggi" },
  { href: "/admin/mandati", label: "Mandati", icon: FileSignature, roles: ["super_admin", "admin"], id: "mandati", gruppo: "settaggi" },
  { href: "/admin/stati-pratica", label: "Stati pratica", icon: ListOrdered, roles: ["super_admin", "admin"], id: "stati-pratica", gruppo: "settaggi" },
  { href: "/admin/orari", label: "Orari di caricamento", icon: Clock, roles: ["super_admin", "admin"], id: "orari", gruppo: "settaggi" },
  { href: "/admin/utenti", label: "Utenti interni", icon: Users, roles: ["super_admin", "admin"], id: "utenti", gruppo: "settaggi" },
  { href: "/admin/notifiche", label: "Registro notifiche", icon: Bell, roles: ["super_admin", "admin"], id: "notifiche", gruppo: "settaggi" },
  { href: "/admin/log", label: "Log operazioni", icon: ScrollText, roles: ["super_admin", "admin"], id: "log", gruppo: "settaggi" },
];

const ETICHETTA_BADGE: Record<string, string> = { segnalazioni: "segnalazioni aperte", chat: "messaggi non letti", alert: "alert aperti" };

function VoceMenu({ v, attiva, conteggi }: { v: Voce; attiva: boolean; conteggi: Record<string, number> }) {
  const n = conteggi[v.id] ?? 0;
  return (
    <Link href={v.href} data-testid={`link-menu-${v.id}`}
      className={cn("group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
        attiva ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground")}>
      <span className={cn("absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded bg-sidebar-primary transition-transform origin-center", attiva ? "scale-y-100" : "scale-y-0")} />
      <v.icon className="size-4 opacity-80" /> {v.label}
      {n > 0 && (
        <span className="ml-auto min-w-5 rounded-full bg-sidebar-primary px-1.5 text-center text-[11px] font-bold text-sidebar-primary-foreground" data-testid={`badge-${v.id}`} aria-label={`${n} ${ETICHETTA_BADGE[v.id] ?? ""}`}>{n}</span>
      )}
    </Link>
  );
}

export function BackofficeShell({ s, children }: { s: SessioneUtente; children: ReactNode }) {
  const [loc] = useLocation();
  const esci = useEsci();
  const voci = VOCI.filter((v) => v.roles.includes(s.ruolo));
  const attivo = (h: string) => loc === h || loc.startsWith(h + "/");
  const principali = voci.filter((v) => !v.gruppo);
  const settaggi = voci.filter((v) => v.gruppo === "settaggi");
  const settaggiAttivo = settaggi.some((v) => attivo(v.href));
  const [settaggiAperto, setSettaggiAperto] = useState(false);
  const [menuMobile, setMenuMobile] = useState(false);
  const vedeSegnalazioni = s.ruolo === "super_admin" || s.ruolo === "admin";
  const conteggio = useGetConteggioSegnalazioni({ query: { enabled: vedeSegnalazioni, refetchInterval: 30000, queryKey: getGetConteggioSegnalazioniQueryKey() } });
  const nonLetti = useGetNonLettiChat({ query: { refetchInterval: 15000, queryKey: getGetNonLettiChatQueryKey() } });
  const alertAperti = useGetConteggioAlert({ query: { enabled: vedeSegnalazioni, refetchInterval: 60000, queryKey: getGetConteggioAlertQueryKey() } });
  const conteggi: Record<string, number> = { segnalazioni: conteggio.data?.aperte ?? 0, chat: nonLetti.data?.totale ?? 0, alert: alertAperti.data?.aperti ?? 0 };
  // Su telefono il menu si chiude da solo quando si cambia pagina.
  useEffect(() => { setMenuMobile(false); }, [loc]);
  const voceCorrente = voci.find((v) => attivo(v.href));

  const elenco = (testid: string) => (
    <nav className="flex flex-col gap-1 flex-1" data-testid={testid}>
      {principali.map((v) => <VoceMenu key={v.href} v={v} attiva={attivo(v.href)} conteggi={conteggi} />)}
      {settaggi.length > 0 && (
        <div className="flex flex-col gap-1">
          <button type="button" onClick={() => setSettaggiAperto((a) => !a)} aria-expanded={settaggiAperto || settaggiAttivo}
            className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground", settaggiAttivo && "text-sidebar-accent-foreground")}>
            <Settings className="size-4 opacity-80" /> Settaggi
            <ChevronDown className={cn("ml-auto size-4 opacity-70 transition-transform", (settaggiAperto || settaggiAttivo) && "rotate-180")} />
          </button>
          <div className={cn("flex flex-col gap-1 ml-4 pl-2 border-l border-sidebar-border", !(settaggiAperto || settaggiAttivo) && "hidden")}>
            {settaggi.map((v) => <VoceMenu key={v.href} v={v} attiva={attivo(v.href)} conteggi={conteggi} />)}
          </div>
        </div>
      )}
    </nav>
  );

  const profilo = (t: boolean) => (
    <div className="border-t border-sidebar-border pt-4 space-y-3">
      <div className="flex items-center gap-3 px-1">
        {s.ruolo === "collaboratore"
          ? <div className="size-9 rounded-full bg-sidebar-primary text-sidebar-primary-foreground grid place-items-center text-sm font-bold">{iniziali(s.nome, s.cognome)}</div>
          : <UtenteAvatar id={s.id} colore={s.colore} nome={s.nome} cognome={s.cognome} />}
        <div className="min-w-0">
          <div className="text-sm font-semibold text-sidebar-accent-foreground truncate" data-testid={t ? "text-utente-nome" : undefined}>{s.nome} {s.cognome}</div>
          <div className="flex items-center gap-1 text-xs text-sidebar-foreground/70" data-testid={t ? "text-utente-ruolo" : undefined}><ShieldCheck className="size-3" /> {ruoloLabel(s.ruolo)}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Link href="/cambia-password" data-testid={t ? "link-cambia-password" : undefined} className="flex items-center justify-center gap-1.5 rounded-md border border-sidebar-border py-2 text-xs hover:bg-sidebar-accent transition-colors"><KeyRound className="size-3.5" /> Cambia password</Link>
        <button onClick={esci} data-testid={t ? "button-esci" : "button-esci-mobile"} className="flex items-center justify-center gap-1.5 rounded-md border border-sidebar-border py-2 text-xs hover:bg-sidebar-accent transition-colors"><LogOut className="size-3.5" /> Esci</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] md:grid md:grid-cols-[17rem_1fr]">
      {/* Computer: barra laterale fissa. */}
      <aside className="hidden md:flex md:flex-col bg-sidebar text-sidebar-foreground sticky top-0 h-[100dvh] p-5 overflow-y-auto">
        <div className="mb-8 shrink-0"><Marchio /></div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-sidebar-foreground/50 mb-2 px-2">Area gestionale</div>
        {elenco("nav-backoffice")}
        {profilo(true)}
      </aside>

      {/* Telefono e tablet: barra in alto con menu a cassetto. */}
      <header className="md:hidden sticky top-0 z-40 bg-sidebar text-sidebar-foreground flex items-center gap-3 px-3 h-14 pt-[env(safe-area-inset-top)] box-content">
        <Sheet open={menuMobile} onOpenChange={setMenuMobile}>
          <SheetTrigger asChild>
            <button type="button" aria-label="Apri il menu" data-testid="button-menu-mobile" className="relative size-11 grid place-items-center rounded-md hover:bg-sidebar-accent">
              <Menu className="size-6" />
              {Object.values(conteggi).some((n) => n > 0) && <span className="absolute top-1.5 right-1.5 size-2.5 rounded-full bg-sidebar-primary" aria-hidden />}
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="bg-sidebar text-sidebar-foreground border-sidebar-border w-[85vw] max-w-xs p-5 flex flex-col overflow-y-auto" data-testid="menu-mobile">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <SheetDescription className="sr-only">Navigazione dell&apos;area gestionale</SheetDescription>
            <div className="mb-6 shrink-0"><Marchio /></div>
            {elenco("nav-backoffice-mobile")}
            <div className="mt-4">{profilo(false)}</div>
          </SheetContent>
        </Sheet>
        <div className="min-w-0 flex-1">
          <img src={`${import.meta.env.BASE_URL}logo-bianco.png`} alt="Tutelaziende" className="h-6 w-auto" data-testid="logo-mobile" />
        </div>
        {voceCorrente && <div className="text-sm font-semibold truncate max-w-[45%] text-right" data-testid="titolo-sezione-mobile">{voceCorrente.label}</div>}
      </header>
      <main className="min-w-0 px-4 py-5 md:px-8 md:py-8 w-full">{children}</main>
    </div>
  );
}

function Contatore({ n, className, id }: { n: number; className?: string; id: string }) {
  if (n <= 0) return null;
  return (
    <span className={cn("min-w-5 rounded-full bg-accent px-1.5 text-center text-[11px] font-bold leading-5 text-accent-foreground", className)} data-testid={id} aria-label={`${n} novità`}>{n > 99 ? "99+" : n}</span>
  );
}

export function CollaboratoreShell({ s, children }: { s: SessioneUtente; children: ReactNode }) {
  const [loc] = useLocation();
  const esci = useEsci();
  const qc = useQueryClient();
  const avvisi = useGetAvvisi({ query: { queryKey: getGetAvvisiQueryKey(), refetchInterval: 60_000 } });
  // Ad ogni cambio di pagina i contatori si riallineano (per esempio dopo aver aperto una pratica o confermato un evento).
  useEffect(() => { qc.invalidateQueries({ queryKey: getGetAvvisiQueryKey() }); }, [loc, qc]);
  const novita: Record<string, number> = {
    "/collaboratore/pratiche": avvisi.data?.pratiche.length ?? 0,
    "/collaboratore/eventi": avvisi.data?.eventi.length ?? 0,
  };
  const voci = [
    { href: "/collaboratore", label: "Home", corto: "Home", icon: Home },
    { href: "/collaboratore/assistiti", label: "Assistiti", corto: "Assistiti", icon: UserRound },
    { href: "/collaboratore/pratiche", label: "Le mie pratiche", corto: "Pratiche", icon: FileText },
    { href: "/collaboratore/eventi", label: "Eventi", corto: "Eventi", icon: CalendarDays },
    { href: "/collaboratore/impostazioni", label: "Impostazioni", corto: "Impostazioni", icon: Settings },
  ];
  const attiva = (href: string) => loc === href || (href !== "/collaboratore" && loc.startsWith(href + "/"));
  return (
    <div className="min-h-[100dvh] bg-[hsl(220_9%_95%)] overflow-x-hidden">
      <header className="bg-primary text-primary-foreground border-b-4 border-accent">
        <div className="mx-auto max-w-5xl px-4 h-14 lg:h-16 flex items-center gap-4 lg:gap-6">
          <Marchio chiaro />
          <nav className="hidden lg:flex gap-1 ml-2" data-testid="nav-collaboratore">
            {voci.filter((v) => v.href !== "/collaboratore/impostazioni").map((v) => (
              <Link key={v.href} href={v.href} data-testid={`link-menu-${v.label.toLowerCase().replace(" ", "-")}`}
                className={cn("flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors", attiva(v.href) ? "bg-accent text-accent-foreground" : "hover:bg-primary-foreground/10")}>
                <v.icon className="size-4 shrink-0" /><span>{v.label}</span>
                <Contatore n={novita[v.href] ?? 0} id={`contatore-${v.corto.toLowerCase()}`} />
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden sm:block text-right leading-tight">
              <div className="text-sm font-semibold" data-testid="text-utente-nome">{s.nome} {s.cognome}</div>
              <Link href="/collaboratore/impostazioni" data-testid="link-menu-impostazioni"
                className={cn("inline-flex items-center gap-1 text-[11px] opacity-70 hover:opacity-100 hover:underline", attiva("/collaboratore/impostazioni") && "opacity-100 underline")}>
                <Settings className="size-3" /> Impostazioni
              </Link>
            </div>
            <button onClick={esci} data-testid="button-esci" aria-label="Esci" className="flex items-center gap-1.5 rounded-full border border-primary-foreground/30 size-10 sm:size-auto justify-center sm:px-3 sm:py-1.5 text-sm hover:bg-primary-foreground/10 transition-colors"><LogOut className="size-4" /> <span className="hidden sm:inline">Esci</span></button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-5 lg:py-8 pb-28 lg:pb-8">{children}</main>
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-card border-t border-border shadow-[0_-2px_12px_rgba(0,0,0,0.08)] pb-[env(safe-area-inset-bottom)]" data-testid="nav-collaboratore-mobile" aria-label="Menu principale">
        <ul className="grid grid-cols-5">
          {voci.map((v) => (
            <li key={v.href}>
              <Link href={v.href} data-testid={`tab-${v.corto.toLowerCase()}`} aria-current={attiva(v.href) ? "page" : undefined}
                className={cn("flex flex-col items-center justify-center gap-0.5 min-h-16 px-1 text-[11px] font-semibold transition-colors", attiva(v.href) ? "text-primary" : "text-muted-foreground")}>
                <span className={cn("relative grid place-items-center h-7 w-12 rounded-full transition-colors", attiva(v.href) && "bg-accent")}>
                  <v.icon className="size-5" />
                  <Contatore n={novita[v.href] ?? 0} id={`contatore-mobile-${v.corto.toLowerCase()}`} className="absolute -top-1 right-0 min-w-4 px-1 text-[10px] leading-4 bg-destructive text-destructive-foreground" />
                </span>
                <span className="truncate max-w-full">{v.corto}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
