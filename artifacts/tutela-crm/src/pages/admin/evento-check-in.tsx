import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetEventoBackofficeQueryKey, useGetEventoBackoffice, useRegistraCheckInEvento, type CheckInEsito } from "@workspace/api-client-react";
import jsQR from "jsqr";
import { AlertTriangle, ArrowLeft, Camera, CameraOff, CheckCircle2, LogIn, LogOut, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common";
import { cn } from "@/lib/utils";
import { fmtData, fmtIstante, parseApiError } from "@/lib/format";

type Tipo = "entrata" | "uscita";
type Esito = { tipo: "ok" | "avviso" | "errore"; titolo: string; testo?: string; ora: string };

export default function EventoCheckIn() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const qc = useQueryClient();
  const evento = useGetEventoBackoffice(id);
  const check = useRegistraCheckInEvento();
  const [tipo, setTipo] = useState<Tipo>("entrata");
  const [esito, setEsito] = useState<Esito | null>(null);
  const [recenti, setRecenti] = useState<Esito[]>([]);
  const [manuale, setManuale] = useState("");
  const [camera, setCamera] = useState<"spenta" | "avvio" | "attiva">("spenta");
  const [erroreCamera, setErroreCamera] = useState<string | null>(null);

  const video = useRef<HTMLVideoElement>(null);
  const flusso = useRef<MediaStream | null>(null);
  const raf = useRef<number | null>(null);
  const ultimo = useRef<{ codice: string; quando: number } | null>(null);
  const occupato = useRef(false);
  const tipoRef = useRef<Tipo>(tipo);
  tipoRef.current = tipo;

  const registra = useCallback((codice: string) => {
    const c = codice.trim();
    if (!c || occupato.current) return;
    occupato.current = true;
    const t = tipoRef.current;
    const ora = new Date().toISOString();
    const nota = (e: Esito) => { setEsito(e); setRecenti((r) => [e, ...r].slice(0, 6)); };
    check.mutate({ id, data: { codice: c, tipo: t } }, {
      onSuccess: (r: CheckInEsito) => {
        const nome = `${r.partecipante.cognome} ${r.partecipante.nome}`;
        const verbo = t === "entrata" ? "Entrata" : "Uscita";
        if (r.esito === "registrato") nota({ tipo: r.avviso ? "avviso" : "ok", titolo: `${verbo} registrata: ${nome}`, testo: r.avviso ?? `${r.partecipante.sedeNome}`, ora });
        else nota({ tipo: "avviso", titolo: nome, testo: r.avviso ?? `${verbo} già registrata.`, ora });
        if (navigator.vibrate) navigator.vibrate(r.esito === "registrato" ? 80 : [60, 60, 60]);
        qc.invalidateQueries({ queryKey: getGetEventoBackofficeQueryKey(id) });
      },
      onError: (e) => { nota({ tipo: "errore", titolo: "QR non valido", testo: parseApiError(e).message, ora }); if (navigator.vibrate) navigator.vibrate([200]); },
      onSettled: () => { occupato.current = false; },
    });
  }, [check, id, qc]);

  const ferma = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    flusso.current?.getTracks().forEach((t) => t.stop());
    flusso.current = null;
    if (video.current) video.current.srcObject = null;
    setCamera("spenta");
  }, []);

  useEffect(() => ferma, [ferma]);

  const avvia = async () => {
    setErroreCamera(null);
    if (!navigator.mediaDevices?.getUserMedia) { setErroreCamera("Questo browser non permette di usare la fotocamera. Inserisci il codice a mano."); return; }
    setCamera("avvio");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      flusso.current = s;
      const v = video.current!;
      v.srcObject = s;
      await v.play();
      setCamera("attiva");
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const ciclo = () => {
        if (!flusso.current) return;
        if (v.readyState === v.HAVE_ENOUGH_DATA && v.videoWidth > 0) {
          const scala = Math.min(1, 640 / v.videoWidth);
          canvas.width = Math.round(v.videoWidth * scala);
          canvas.height = Math.round(v.videoHeight * scala);
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const r = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
          if (r?.data) {
            const adesso = Date.now();
            if (!ultimo.current || ultimo.current.codice !== r.data || adesso - ultimo.current.quando > 4000) {
              ultimo.current = { codice: r.data, quando: adesso };
              registra(r.data);
            }
          }
        }
        raf.current = requestAnimationFrame(ciclo);
      };
      raf.current = requestAnimationFrame(ciclo);
    } catch (e) {
      ferma();
      const nome = (e as { name?: string }).name;
      setErroreCamera(nome === "NotAllowedError" ? "Accesso alla fotocamera negato. Consentilo nelle impostazioni del browser oppure inserisci il codice a mano." : "Impossibile avviare la fotocamera. Inserisci il codice a mano.");
    }
  };

  if (evento.isLoading) return <div className="space-y-3 max-w-xl mx-auto"><Skeleton className="h-10 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (evento.isError || !evento.data) return <ErrorState message={parseApiError(evento.error).message} onRetry={() => evento.refetch()} />;
  const e = evento.data.evento;
  const presenti = evento.data.partecipanti.filter((p) => p.entrataIl).length;
  const usciti = evento.data.partecipanti.filter((p) => p.uscitaIl).length;

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <Link href={`/admin/eventi/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Torna all'evento</Link>
      <div>
        <h1 className="text-2xl font-bold leading-tight" data-testid="text-page-title">Check-in</h1>
        <p className="text-sm text-muted-foreground">{e.titolo} · {fmtData(e.data)}</p>
        <p className="text-sm mt-1" data-testid="text-riepilogo-check-in"><strong>{presenti}</strong> entrati · <strong>{usciti}</strong> usciti · {evento.data.partecipanti.length} iscritti</p>
      </div>

      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tipo di registrazione">
        {([["entrata", "Entrata", LogIn], ["uscita", "Uscita", LogOut]] as const).map(([v, label, Icona]) => (
          <button key={v} type="button" onClick={() => setTipo(v)} aria-pressed={tipo === v} data-testid={`button-tipo-${v}`}
            className={cn("h-16 rounded-lg border-2 text-lg font-bold flex items-center justify-center gap-2 transition-colors",
              tipo === v ? "bg-primary text-primary-foreground border-primary" : "bg-card border-input hover:bg-secondary/60")}>
            <Icona className="size-5" /> {label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card p-3 space-y-3">
        <div className={cn("relative aspect-square w-full overflow-hidden rounded-md bg-black/90", camera === "spenta" && "grid place-items-center")}>
          <video ref={video} playsInline muted className={cn("size-full object-cover", camera === "spenta" && "hidden")} data-testid="video-scanner" />
          {camera === "spenta" && <div className="text-center text-white/70 p-6"><Camera className="size-10 mx-auto mb-2" /><p className="text-sm">Fotocamera spenta</p></div>}
          {camera === "attiva" && <div className="pointer-events-none absolute inset-[18%] rounded-lg border-2 border-white/80" />}
        </div>
        {camera === "spenta" ? (
          <Button className="w-full h-12" onClick={avvia} data-testid="button-avvia-camera"><Camera className="size-4 mr-2" /> Avvia la scansione</Button>
        ) : (
          <Button className="w-full h-12" variant="outline" onClick={ferma} disabled={camera === "avvio"} data-testid="button-ferma-camera"><CameraOff className="size-4 mr-2" /> Ferma la fotocamera</Button>
        )}
        {erroreCamera && <p className="text-sm text-destructive font-medium" data-testid="errore-camera">{erroreCamera}</p>}
      </div>

      <form className="flex gap-2" onSubmit={(ev) => { ev.preventDefault(); registra(manuale); setManuale(""); }}>
        <Input value={manuale} onChange={(ev) => setManuale(ev.target.value)} placeholder="Codice a mano (TUTELA-…)" autoComplete="off" autoCapitalize="characters" className="h-11 bg-card font-mono" data-testid="input-codice-manuale" />
        <Button type="submit" className="h-11" disabled={!manuale.trim() || check.isPending} data-testid="button-registra-manuale">Registra</Button>
      </form>

      {esito && <CartaEsito esito={esito} grande />}
      {recenti.length > 1 && (
        <div className="space-y-1.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ultime registrazioni</h2>
          {recenti.slice(1).map((r, i) => <CartaEsito key={`${r.ora}-${i}`} esito={r} />)}
        </div>
      )}
    </div>
  );
}

function CartaEsito({ esito, grande }: { esito: Esito; grande?: boolean }) {
  const stile = esito.tipo === "ok" ? "border-emerald-600/40 bg-emerald-50 text-emerald-900"
    : esito.tipo === "avviso" ? "border-amber-500/50 bg-amber-50 text-amber-900"
    : "border-destructive/40 bg-destructive/5 text-destructive";
  const Icona = esito.tipo === "ok" ? CheckCircle2 : esito.tipo === "avviso" ? AlertTriangle : XCircle;
  return (
    <div className={cn("rounded-lg border-2 flex items-start gap-3", stile, grande ? "p-4" : "p-2.5 text-sm")} data-testid={grande ? "esito-check-in" : undefined} role="status">
      <Icona className={cn("shrink-0", grande ? "size-8" : "size-5")} />
      <div className="min-w-0">
        <div className={cn("font-bold", grande && "text-lg leading-tight")}>{esito.titolo}</div>
        {esito.testo && <div className="text-sm">{esito.testo}</div>}
        <div className="text-xs opacity-70 tabular-nums mt-0.5">{fmtIstante(esito.ora, true)}</div>
      </div>
    </div>
  );
}
