import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { EventoDati } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/common";
import { SelettoreSedi } from "@/components/eventi/selettore-sedi";

export interface DatiFormEvento {
  titolo: string; data: string; oraInizio: string; oraFine: string | null; luogo: string; descrizione: string;
}

/** Modulo dati evento. Con `conSedi` mostra anche la scelta delle sedi da invitare (solo in creazione). */
export function FormEvento({ iniziale, conSedi, invio, errore, onSubmit, onAnnulla, etichetta }: {
  iniziale?: EventoDati; conSedi?: boolean; invio: boolean; errore: string | null; etichetta: string;
  onSubmit: (d: DatiFormEvento, sedi: number[]) => void; onAnnulla: () => void;
}) {
  const [titolo, setTitolo] = useState(iniziale?.titolo ?? "");
  const [data, setData] = useState(iniziale?.data ?? "");
  const [oraInizio, setOraInizio] = useState(iniziale?.oraInizio ?? "");
  const [oraFine, setOraFine] = useState(iniziale?.oraFine ?? "");
  const [luogo, setLuogo] = useState(iniziale?.luogo ?? "");
  const [descrizione, setDescrizione] = useState(iniziale?.descrizione ?? "");
  const [sedi, setSedi] = useState<number[]>([]);
  const [locale, setLocale] = useState<string | null>(null);

  const invia = () => {
    if (!titolo.trim()) return setLocale("Inserisci il titolo.");
    if (!data) return setLocale("Inserisci la data.");
    if (!oraInizio) return setLocale("Inserisci l'ora di inizio.");
    if (oraFine && oraFine <= oraInizio) return setLocale("L'ora di fine deve essere dopo l'ora di inizio.");
    if (!luogo.trim()) return setLocale("Inserisci il luogo.");
    setLocale(null);
    onSubmit({ titolo: titolo.trim(), data, oraInizio, oraFine: oraFine || null, luogo: luogo.trim(), descrizione: descrizione.trim() }, sedi);
  };

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); invia(); }} noValidate>
      <div>
        <Label htmlFor="ev-titolo">Titolo</Label>
        <Input id="ev-titolo" value={titolo} maxLength={150} onChange={(e) => setTitolo(e.target.value)} data-testid="input-evento-titolo" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <Label htmlFor="ev-data">Data</Label>
          <Input id="ev-data" type="date" value={data} onChange={(e) => setData(e.target.value)} data-testid="input-evento-data" />
        </div>
        <div>
          <Label htmlFor="ev-inizio">Ora di inizio</Label>
          <Input id="ev-inizio" type="time" value={oraInizio} onChange={(e) => setOraInizio(e.target.value)} data-testid="input-evento-inizio" />
        </div>
        <div>
          <Label htmlFor="ev-fine">Ora di fine (facoltativa)</Label>
          <Input id="ev-fine" type="time" value={oraFine} onChange={(e) => setOraFine(e.target.value)} data-testid="input-evento-fine" />
        </div>
      </div>
      <div>
        <Label htmlFor="ev-luogo">Luogo</Label>
        <Input id="ev-luogo" value={luogo} maxLength={200} onChange={(e) => setLuogo(e.target.value)} data-testid="input-evento-luogo" />
      </div>
      <div>
        <Label htmlFor="ev-descrizione">Descrizione</Label>
        <Textarea id="ev-descrizione" rows={3} value={descrizione} maxLength={4000} onChange={(e) => setDescrizione(e.target.value)} data-testid="input-evento-descrizione" />
      </div>
      {conSedi && (
        <div>
          <Label className="mb-1.5 block">Sedi invitate</Label>
          <SelettoreSedi selezionate={sedi} onChange={setSedi} />
          <p className="text-xs text-muted-foreground mt-1.5">Le sedi scelte ricevono l'invito per email e WhatsApp.</p>
        </div>
      )}
      <FieldError id="errore-evento">{locale ?? errore}</FieldError>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onAnnulla}>Annulla</Button>
        <Button type="submit" disabled={invio} data-testid="button-salva-evento">
          {invio && <Loader2 className="size-4 mr-2 animate-spin" />}{etichetta}
        </Button>
      </div>
    </form>
  );
}
