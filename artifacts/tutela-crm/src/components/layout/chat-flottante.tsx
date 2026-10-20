import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { getListConversazioniChatQueryKey, useListConversazioniChat } from "@workspace/api-client-react";
import { ArrowLeft, Maximize2, MessagesSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common";
import { Conversazione, Icona, titolo } from "@/pages/admin/chat";
import { cn } from "@/lib/utils";
import { parseApiError, ruoloLabel } from "@/lib/format";

type Avviso = { chiave: string; chi: string; testo: string };

/**
 * Chat interna in un popup in basso a destra: il pallino mostra i messaggi non letti, cliccandolo si apre la chat
 * senza lasciare la pagina. Quando arriva un messaggio nuovo compare un avviso accanto al pallino.
 * Non compare nella pagina della chat a tutto schermo.
 */
export function ChatFlottante() {
  const [loc] = useLocation();
  const nellaChat = loc === "/admin/chat" || loc.startsWith("/admin/chat/");
  const q = useListConversazioniChat({ query: { queryKey: getListConversazioniChatQueryKey(), refetchInterval: 8000 } });
  const [aperto, setAperto] = useState(false);
  const [scelta, setScelta] = useState<string | null>(null);
  const [avviso, setAvviso] = useState<Avviso | null>(null);
  const precedenti = useRef<Map<string, number> | null>(null);
  const stato = useRef({ aperto, scelta });
  stato.current = { aperto, scelta };

  const totale = (q.data ?? []).reduce((somma, c) => somma + c.nonLetti, 0);
  const conv = scelta ? q.data?.find((c) => c.chiave === scelta) : undefined;

  useEffect(() => {
    if (!q.data) return;
    const adesso = new Map(q.data.map((c) => [c.chiave, c.nonLetti] as const));
    const prima = precedenti.current;
    precedenti.current = adesso;
    // Al primo caricamento non si avvisa: i messaggi gia' presenti si vedono dal numero sul pallino.
    if (!prima || nellaChat) return;
    const nuova = q.data.find((c) => c.nonLetti > (prima.get(c.chiave) ?? 0) && c.ultimoMessaggio && !c.ultimoMessaggio.mio);
    if (!nuova?.ultimoMessaggio) return;
    // Se la conversazione e' gia' aperta nel popup, il messaggio si vede e risulta letto.
    if (stato.current.aperto && stato.current.scelta === nuova.chiave) return;
    setAvviso({ chiave: nuova.chiave, chi: titolo(nuova), testo: nuova.ultimoMessaggio.testo });
  }, [q.data, nellaChat]);

  // L'avviso sparisce da solo.
  useEffect(() => {
    if (!avviso) return;
    const t = setTimeout(() => setAvviso(null), 8000);
    return () => clearTimeout(t);
  }, [avviso]);

  // Esc chiude il popup.
  useEffect(() => {
    if (!aperto) return;
    const chiudi = (e: KeyboardEvent) => { if (e.key === "Escape") setAperto(false); };
    window.addEventListener("keydown", chiudi);
    return () => window.removeEventListener("keydown", chiudi);
  }, [aperto]);

  useEffect(() => { if (nellaChat) { setAvviso(null); setAperto(false); } }, [nellaChat]);

  if (nellaChat) return null;

  const apri = (chiave: string | null) => { setScelta(chiave); setAperto(true); setAvviso(null); };

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3" data-testid="chat-flottante">
      {aperto && (
        <section aria-label="Chat interna" data-testid="popup-chat"
          className="flex h-[min(560px,calc(100dvh-7.5rem))] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
          <header className="flex items-center gap-2 border-b border-border bg-primary px-3 py-2.5 text-primary-foreground">
            {conv ? (
              <Button variant="ghost" size="icon" className="size-8 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground" onClick={() => setScelta(null)} aria-label="Torna alle conversazioni" data-testid="popup-chat-indietro"><ArrowLeft className="size-4" /></Button>
            ) : <MessagesSquare className="ml-1 size-4" />}
            <div className="min-w-0 flex-1 truncate text-sm font-bold" data-testid="popup-chat-titolo">{conv ? titolo(conv) : "Chat interna"}</div>
            <Button asChild variant="ghost" size="icon" className="size-8 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground">
              <Link href="/admin/chat" aria-label="Apri la chat a tutta pagina" title="Apri a tutta pagina"><Maximize2 className="size-4" /></Link>
            </Button>
            <Button variant="ghost" size="icon" className="size-8 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground" onClick={() => setAperto(false)} aria-label="Chiudi la chat" data-testid="popup-chat-chiudi"><X className="size-4" /></Button>
          </header>
          <div className="min-h-0 flex-1">
            {q.isLoading ? <div className="p-3"><Skeleton className="h-16" /></div>
              : q.isError ? <div className="p-3"><ErrorState message={parseApiError(q.error).message} onRetry={() => q.refetch()} /></div>
              : conv ? <Conversazione key={conv.chiave} c={conv} />
              : (
                <nav className="h-full overflow-y-auto" aria-label="Conversazioni" data-testid="popup-chat-elenco">
                  {q.data?.map((c) => (
                    <button key={c.chiave} type="button" onClick={() => setScelta(c.chiave)} data-testid={`popup-conversazione-${c.chiave}`}
                      className="flex w-full items-center gap-3 border-b border-border/60 px-3 py-2.5 text-left transition-colors hover:bg-secondary/60">
                      <Icona c={c} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{titolo(c)}</div>
                        <div className="truncate text-xs text-muted-foreground">{c.ultimoMessaggio ? `${c.ultimoMessaggio.mio ? "Tu: " : ""}${c.ultimoMessaggio.testo}` : c.utente ? ruoloLabel(c.utente.ruolo) : "Tutti gli utenti interni"}</div>
                      </div>
                      {c.nonLetti > 0 && <span className="min-w-5 rounded-full bg-accent px-1.5 text-center text-[11px] font-bold text-accent-foreground" aria-label={`${c.nonLetti} messaggi non letti`}>{c.nonLetti}</span>}
                    </button>
                  ))}
                </nav>
              )}
          </div>
        </section>
      )}
      {!aperto && avviso && (
        <div className="relative w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-3 pr-8 shadow-lg" role="status" data-testid="avviso-chat">
          <button type="button" onClick={() => apri(avviso.chiave)} className="block w-full text-left" data-testid="avviso-chat-apri">
            <div className="text-xs font-semibold text-primary">Nuovo messaggio da {avviso.chi}</div>
            <div className="mt-0.5 line-clamp-2 text-sm">{avviso.testo}</div>
          </button>
          <button type="button" onClick={() => setAvviso(null)} aria-label="Chiudi avviso" className="absolute right-2 top-2 text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
      )}
      <button type="button" onClick={() => (aperto ? setAperto(false) : apri(scelta))} data-testid="pallino-chat" aria-expanded={aperto}
        aria-label={aperto ? "Chiudi la chat interna" : totale > 0 ? `Apri la chat interna, ${totale} messaggi non letti` : "Apri la chat interna"}
        className={cn("relative grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105")}>
        {aperto ? <X className="size-6" /> : <MessagesSquare className="size-6" />}
        {!aperto && totale > 0 && (
          <span className="absolute -right-1 -top-1 min-w-6 rounded-full bg-accent px-1.5 text-center text-xs font-bold leading-6 text-accent-foreground" data-testid="pallino-chat-contatore">{totale > 99 ? "99+" : totale}</span>
        )}
      </button>
    </div>
  );
}
