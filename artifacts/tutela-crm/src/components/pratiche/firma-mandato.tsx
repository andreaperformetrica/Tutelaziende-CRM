import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetPraticaQueryKey, useConfermaFirmaMandato, useRichiediFirmaMandato, type FirmaMandato, type RichiestaFirmaMandato } from "@workspace/api-client-react";
import { BadgeCheck, Loader2, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { fmtCellulare, fmtData, parseApiError } from "@/lib/format";

/** Riquadro con i dati della firma (data, ora, cellulare e codice fiscale di chi ha firmato). */
export function DatiFirma({ firma }: { firma: FirmaMandato }) {
  const quando = new Date(firma.firmatoIl);
  const ora = quando.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Rome" });
  const data = fmtData(quando.toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" }));
  return (
    <div className="flex gap-2 rounded-md border border-emerald-600/40 bg-emerald-50 text-emerald-950 p-3 text-sm" data-testid="dati-firma">
      <BadgeCheck className="size-5 shrink-0 text-emerald-700 mt-0.5" />
      <div>
        <div className="font-semibold">Mandato firmato con codice SMS</div>
        <div>Firmatario: {firma.firmatario} · codice fiscale <span className="font-mono">{firma.codiceFiscale}</span></div>
        <div>Il {data} alle {ora} · cellulare <span className="font-mono">{fmtCellulare(firma.cellulare)}</span></div>
      </div>
    </div>
  );
}

/** Pulsante "Firma mandato": invia il codice SMS e chiede di inserirlo. */
export function FirmaMandatoBottone({ praticaId }: { praticaId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const richiedi = useRichiediFirmaMandato();
  const conferma = useConfermaFirmaMandato();
  const [aperto, setAperto] = useState(false);
  const [richiesta, setRichiesta] = useState<RichiestaFirmaMandato | null>(null);
  const [codice, setCodice] = useState("");
  const [errore, setErrore] = useState<string | null>(null);

  const chiudi = () => { setAperto(false); setRichiesta(null); setCodice(""); setErrore(null); };
  const chiediCodice = () => {
    setErrore(null);
    richiedi.mutate({ id: praticaId }, {
      onSuccess: (r) => { setRichiesta(r); setCodice(""); setAperto(true); },
      onError: (e) => { setErrore(parseApiError(e).message); setAperto(true); },
    });
  };
  const firma = () => {
    setErrore(null);
    conferma.mutate({ id: praticaId, data: { codice } }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getGetPraticaQueryKey(praticaId) }); toast({ title: "Mandato firmato" }); chiudi(); },
      onError: (e) => setErrore(parseApiError(e).message),
    });
  };

  return (
    <>
      <Button size="sm" onClick={chiediCodice} disabled={richiedi.isPending} data-testid="button-firma-mandato">
        {richiedi.isPending ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <PenLine className="size-4 mr-1.5" />} Firma mandato
      </Button>
      <Dialog open={aperto} onOpenChange={(o) => { if (!o) chiudi(); }}>
        <DialogContent data-testid="dialog-firma-mandato">
          <DialogHeader>
            <DialogTitle>Firma del mandato</DialogTitle>
            <DialogDescription>
              {richiesta
                ? richiesta.inviato
                  ? `Abbiamo inviato un SMS con un codice di 6 cifre al numero ${richiesta.cellulare}. Il codice vale 10 minuti.`
                  : `L'invio degli SMS non è ancora configurato: il codice è stato scritto nel registro del server (numero ${richiesta.cellulare}).`
                : "Non è stato possibile avviare la firma."}
            </DialogDescription>
          </DialogHeader>
          {richiesta && (
            <div className="space-y-1.5">
              <Label htmlFor="codice-firma">Codice ricevuto</Label>
              <Input id="codice-firma" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={codice} autoFocus
                onChange={(e) => setCodice(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => { if (e.key === "Enter" && codice.length === 6) firma(); }}
                className="font-mono tracking-[0.4em] text-lg w-40" data-testid="input-codice-firma" />
              <button type="button" className="text-xs text-primary underline underline-offset-2" onClick={chiediCodice} disabled={richiedi.isPending} data-testid="button-reinvia-codice">Invia un nuovo codice</button>
            </div>
          )}
          {errore && <p className="text-sm text-destructive" role="alert" data-testid="errore-firma">{errore}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={chiudi}>Annulla</Button>
            {richiesta && <Button onClick={firma} disabled={codice.length !== 6 || conferma.isPending} data-testid="button-conferma-firma">
              {conferma.isPending && <Loader2 className="size-4 mr-1.5 animate-spin" />} Firma
            </Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
