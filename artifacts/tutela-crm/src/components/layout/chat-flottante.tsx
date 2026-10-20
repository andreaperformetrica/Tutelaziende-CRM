import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { getListConversazioniChatQueryKey, useListConversazioniChat, type ChatConversazione } from "@workspace/api-client-react";
import { MessagesSquare, X } from "lucide-react";

type Avviso = { id: number; chi: string; testo: string };

const nomeConversazione = (c: ChatConversazione) => (c.utente ? `${c.utente.nome} ${c.utente.cognome}` : "Canale generale");

/**
 * Pallino della chat interna in basso a destra: mostra i messaggi non letti e, quando ne arriva uno nuovo,
 * fa comparire un avviso accanto al pallino. Non compare nella pagina della chat.
 */
export function ChatFlottante() {
  const [loc] = useLocation();
  const nellaChat = loc === "/admin/chat" || loc.startsWith("/admin/chat/");
  const q = useListConversazioniChat({ query: { queryKey: getListConversazioniChatQueryKey(), refetchInterval: 8000 } });
  const [avviso, setAvviso] = useState<Avviso | null>(null);
  const precedenti = useRef<Map<string, number> | null>(null);
  const contatoreAvvisi = useRef(0);

  const totale = (q.data ?? []).reduce((somma, c) => somma + c.nonLetti, 0);

  useEffect(() => {
    if (!q.data) return;
    const adesso = new Map(q.data.map((c) => [c.chiave, c.nonLetti] as const));
    const prima = precedenti.current;
    precedenti.current = adesso;
    // Al primo caricamento non si avvisa: i messaggi gia' presenti si vedono dal numero sul pallino.
    if (!prima || nellaChat) return;
    const nuova = q.data.find((c) => c.nonLetti > (prima.get(c.chiave) ?? 0) && c.ultimoMessaggio && !c.ultimoMessaggio.mio);
    if (!nuova?.ultimoMessaggio) return;
    contatoreAvvisi.current += 1;
    setAvviso({ id: contatoreAvvisi.current, chi: nomeConversazione(nuova), testo: nuova.ultimoMessaggio.testo });
  }, [q.data, nellaChat]);

  // L'avviso sparisce da solo.
  useEffect(() => {
    if (!avviso) return;
    const t = setTimeout(() => setAvviso(null), 8000);
    return () => clearTimeout(t);
  }, [avviso]);

  useEffect(() => { if (nellaChat) setAvviso(null); }, [nellaChat]);

  if (nellaChat) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2" data-testid="chat-flottante">
      {avviso && (
        <div className="relative w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-3 pr-8 shadow-lg" role="status" data-testid="avviso-chat">
          <Link href="/admin/chat" className="block">
            <div className="text-xs font-semibold text-primary">Nuovo messaggio da {avviso.chi}</div>
            <div className="mt-0.5 line-clamp-2 text-sm">{avviso.testo}</div>
          </Link>
          <button type="button" onClick={() => setAvviso(null)} aria-label="Chiudi avviso" className="absolute right-2 top-2 text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
      )}
      <Link href="/admin/chat" aria-label={totale > 0 ? `Chat interna, ${totale} messaggi non letti` : "Chat interna"} data-testid="pallino-chat"
        className="relative grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105">
        <MessagesSquare className="size-6" />
        {totale > 0 && (
          <span className="absolute -right-1 -top-1 min-w-6 rounded-full bg-accent px-1.5 text-center text-xs font-bold leading-6 text-accent-foreground" data-testid="pallino-chat-contatore">{totale > 99 ? "99+" : totale}</span>
        )}
      </Link>
    </div>
  );
}
