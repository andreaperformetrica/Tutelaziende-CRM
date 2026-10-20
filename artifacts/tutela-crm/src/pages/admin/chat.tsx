import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetNonLettiChatQueryKey, getListConversazioniChatQueryKey, getListMessaggiChatQueryKey,
  useListConversazioniChat, useListMessaggiChat, useSegnaLettaChat, useSendMessaggioChat,
  type ChatConversazione,
} from "@workspace/api-client-react";
import { ArrowLeft, Hash, Loader2, MessagesSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, PageHeader } from "@/components/common";
import { UtenteAvatar } from "@/components/utenti/colore-utente";
import { cn } from "@/lib/utils";
import { fmtIstante, parseApiError, ruoloLabel } from "@/lib/format";

export const titolo = (c: ChatConversazione) => (c.utente ? `${c.utente.nome} ${c.utente.cognome}` : "Canale generale");

export function Icona({ c }: { c: ChatConversazione }) {
  return c.utente
    ? <UtenteAvatar id={c.utente.id} colore={c.utente.colore} nome={c.utente.nome} cognome={c.utente.cognome} />
    : <div className="size-9 rounded-full bg-primary text-primary-foreground grid place-items-center"><Hash className="size-4" /></div>;
}

export function Conversazione({ c }: { c: ChatConversazione }) {
  const qc = useQueryClient();
  const chiave = c.chiave;
  const q = useListMessaggiChat(chiave, { query: { queryKey: getListMessaggiChatQueryKey(chiave), refetchInterval: 4000 } });
  const invia = useSendMessaggioChat();
  const segna = useSegnaLettaChat();
  const [testo, setTesto] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const fondo = useRef<HTMLDivElement>(null);
  const ultimoLetto = useRef(0);
  const messaggi = q.data ?? [];
  const ultimoId = messaggi.length ? messaggi[messaggi.length - 1]!.id : 0;

  useEffect(() => { ultimoLetto.current = 0; }, [chiave]);
  useEffect(() => { fondo.current?.scrollIntoView({ block: "end" }); }, [ultimoId, chiave]);
  // I messaggi mostrati a schermo risultano letti.
  useEffect(() => {
    if (ultimoId > ultimoLetto.current) {
      ultimoLetto.current = ultimoId;
      segna.mutate({ chiave, data: { fino: ultimoId } }, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListConversazioniChatQueryKey() });
          qc.invalidateQueries({ queryKey: getGetNonLettiChatQueryKey() });
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ultimoId, chiave]);

  const manda = () => {
    const t = testo.trim();
    if (!t || invia.isPending) return;
    setErrore(null);
    invia.mutate({ chiave, data: { testo: t } }, {
      onSuccess: () => {
        setTesto("");
        qc.invalidateQueries({ queryKey: getListMessaggiChatQueryKey(chiave) });
        qc.invalidateQueries({ queryKey: getListConversazioniChatQueryKey() });
      },
      onError: (e) => setErrore(parseApiError(e).message),
    });
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto p-4 space-y-3" data-testid="messaggi-chat" aria-live="polite">
        {q.isLoading ? <Skeleton className="h-16" />
          : q.isError ? <ErrorState message={parseApiError(q.error).message} onRetry={() => q.refetch()} />
          : messaggi.length === 0 ? <p className="text-sm text-muted-foreground text-center py-10">Ancora nessun messaggio. Scrivi il primo.</p>
          : messaggi.map((m) => (
            <div key={m.id} className={cn("flex gap-2 max-w-[85%]", m.mio && "ml-auto flex-row-reverse")} data-testid={`messaggio-${m.id}`}>
              {!m.mio && <UtenteAvatar id={m.mittente.id} colore={m.mittente.colore} nome={m.mittente.nome} cognome={m.mittente.cognome} className="size-7 text-[10px]" />}
              <div className={cn("rounded-lg px-3 py-2", m.mio ? "bg-primary text-primary-foreground" : "bg-secondary")}>
                {!m.mio && <div className="text-[11px] font-semibold mb-0.5">{m.mittente.nome} {m.mittente.cognome} <span className="font-normal opacity-70">· {ruoloLabel(m.mittente.ruolo)}</span></div>}
                <p className="text-sm whitespace-pre-wrap break-words">{m.testo}</p>
                <div className={cn("text-[10px] mt-1", m.mio ? "text-primary-foreground/70" : "text-muted-foreground")}>{fmtIstante(m.creatoIl)}</div>
              </div>
            </div>
          ))}
        <div ref={fondo} />
      </div>
      <div className="border-t border-border p-3 space-y-2">
        {errore && <div role="alert" className="text-sm text-destructive font-medium" data-testid="errore-chat">{errore}</div>}
        <div className="flex gap-2 items-end">
          <Textarea value={testo} maxLength={2000} rows={2} onChange={(e) => setTesto(e.target.value)} placeholder={`Scrivi a ${titolo(c)}`} data-testid="input-messaggio-chat"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); manda(); } }} />
          <Button onClick={manda} disabled={!testo.trim() || invia.isPending} data-testid="button-invia-chat" aria-label="Invia">
            {invia.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Invio con Invio, a capo con Maiusc + Invio. I messaggi non si possono modificare né cancellare.</p>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const q = useListConversazioniChat({ query: { queryKey: getListConversazioniChatQueryKey(), refetchInterval: 8000 } });
  const [scelta, setScelta] = useState("generale");
  const [apertaSuTelefono, setApertaSuTelefono] = useState(false);
  const conv = q.data?.find((c) => c.chiave === scelta);

  return (
    <div>
      <PageHeader kicker="Back office" title="Chat interna" subtitle="Solo per chi lavora in ufficio: i collaboratori non vedono questi messaggi." />
      {q.isLoading ? <Skeleton className="h-96" /> : q.isError ? <ErrorState message={parseApiError(q.error).message} onRetry={() => q.refetch()} /> : (
        <div className="grid md:grid-cols-[280px_1fr] rounded-lg border border-border bg-card overflow-hidden h-[calc(100dvh-14rem)] min-h-[420px] rise">
          <nav className={cn("border-r border-border overflow-y-auto", apertaSuTelefono && "hidden md:block")} aria-label="Conversazioni" data-testid="elenco-conversazioni">
            {q.data?.map((c) => (
              <button key={c.chiave} type="button" onClick={() => { setScelta(c.chiave); setApertaSuTelefono(true); }} data-testid={`conversazione-${c.chiave}`}
                className={cn("w-full flex items-center gap-3 px-3 py-2.5 text-left border-b border-border/60 hover:bg-secondary/60 transition-colors", scelta === c.chiave && "bg-secondary")}>
                <Icona c={c} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">{titolo(c)}</div>
                  <div className="text-xs text-muted-foreground truncate">{c.ultimoMessaggio ? `${c.ultimoMessaggio.mio ? "Tu: " : ""}${c.ultimoMessaggio.testo}` : c.utente ? ruoloLabel(c.utente.ruolo) : "Tutti gli utenti interni"}</div>
                </div>
                {c.nonLetti > 0 && <span className="min-w-5 rounded-full bg-accent px-1.5 text-center text-[11px] font-bold text-accent-foreground" data-testid={`non-letti-${c.chiave}`} aria-label={`${c.nonLetti} messaggi non letti`}>{c.nonLetti}</span>}
              </button>
            ))}
          </nav>
          <section className={cn("min-h-0 flex flex-col", !apertaSuTelefono && "hidden md:flex")} aria-label="Messaggi">
            {conv ? (
              <>
                <header className="flex items-center gap-3 px-4 py-2.5 border-b border-border">
                  <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setApertaSuTelefono(false)} aria-label="Torna alle conversazioni"><ArrowLeft className="size-4" /></Button>
                  <Icona c={conv} />
                  <div className="font-bold" data-testid="titolo-conversazione">{titolo(conv)}</div>
                </header>
                <div className="flex-1 min-h-0"><Conversazione key={conv.chiave} c={conv} /></div>
              </>
            ) : <div className="m-auto text-muted-foreground flex items-center gap-2"><MessagesSquare className="size-5" /> Scegli una conversazione</div>}
          </section>
        </div>
      )}
    </div>
  );
}
