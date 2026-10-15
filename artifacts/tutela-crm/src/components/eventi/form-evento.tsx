import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { EventoDati } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/common";
import { SelettoreSedi } from "@/components/eventi/selettore-sedi";

export interface DatiFormEvento {
  titolo: string; data: string; oraInizio: string; oraFine: string | null; luogo: string; tipoCorso: "CAF" | "PATRONATO"; argomento: string; descrizione: string;
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
  const [tipoCorso, setTipoCorso] = useState<"CAF" | "PATRONATO" | "">(iniziale?.tipoCorso ?? "");
  const [argomento, setArgomento] = useState(iniziale?.argomento ?? "");
  const [descrizione, setDescrizione] = useState(iniziale?.descrizione ?? "");
  const [sedi, setSedi] = useState<number[]>([]);
  const [locale, setLocale] = useState<string | null>(null);

  const invia = () => {
    if (!titolo.trim()) return setLocale("Inserisci il titolo.");
    if (!data) return setLocale("Inserisci la data.");
    if (!oraInizio) return setLocale("Inserisci l'ora di inizio.");
    if (oraFine && oraFine <= oraInizio) return setLocale("L'ora di fine deve essere dopo l'ora di inizio.");
    if (!luogo.trim()) return setLocale("Inserisci il luogo.");
    if (!tipoCorso) return setLocale("Scegli il tipo di corso.");
    if (!argomento.trim()) return setLocale("Inserisci l'argomento del corso.");
    setLocale(null);
    onSubmit({ titolo: titolo.trim(), data, oraInizio, oraFine: oraFine || null, luogo: luogo.trim(), tipoCorso, argomento: argomento.trim(), descrizione: descrizione.trim() }, sedi);
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <Label htmlFor="ev-tipo">Tipo di corso</Label>
          <Select value={tipoCorso} onValueChange={(v) => setTipoCorso(v as "CAF" | "PATRONATO")}>
            <SelectTrigger id="ev-tipo" data-testid="select-evento-tipo-corso"><SelectValue placeholder="Scegli" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="CAF">CAF</SelectItem>
              <SelectItem value="PATRONATO">Patronato</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="ev-argomento">Argomento del corso</Label>
          <Input id="ev-argomento" value={argomento} maxLength={150} placeholder="Esempio: 730-2026" onChange={(e) => setArgomento(e.target.value)} data-testid="input-evento-argomento" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">Tipo, argomento e data compaiono sull&apos;attestato dei partecipanti.</p>
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
