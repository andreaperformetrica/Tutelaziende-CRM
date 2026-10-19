import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetTipoPraticaQueryKey, getListTipiPraticaQueryKey, useCreateAllegatoTipo, useCreateNormativaTipo, useDeleteAllegatoTipo,
  useDeleteCompensoCollaboratore, useDeleteNormativaTipo, useListCollaboratori, useSaveCompensoCollaboratore, useUpdateNormativaTipo, useUpdateScadenzaTipo,
  type TipoPratica,
} from "@workspace/api-client-react";
import { Check, ExternalLink, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FieldError } from "@/components/common";
import { ConfermaElimina } from "@/components/pratiche/conferma-elimina";
import { SelettoreDocumento } from "@/components/pratiche/selettore-documento";
import { leggiTipo } from "@/components/pratiche/campi-tipo";
import { useToast } from "@/hooks/use-toast";
import { fmtEuro, parseApiError } from "@/lib/format";

function useAggiorna(id: number) {
  const qc = useQueryClient();
  return (t: TipoPratica) => {
    qc.setQueryData(getGetTipoPraticaQueryKey(id), t);
    qc.invalidateQueries({ queryKey: getListTipiPraticaQueryKey() });
  };
}

const Sezione = ({ titolo, nota, testId, children }: { titolo: string; nota: string; testId: string; children: React.ReactNode }) => (
  <section className="rounded-lg border border-border bg-card p-5 space-y-4 rise" data-testid={testId}>
    <div>
      <h2 className="text-lg font-bold">{titolo}</h2>
      <p className="text-sm text-muted-foreground">{nota}</p>
    </div>
    {children}
  </section>
);

// ---------------------------------------------------------------------------------------------

export function CompensiCollaboratoreTipo({ tipo }: { tipo: TipoPratica }) {
  const { toast } = useToast();
  const aggiorna = useAggiorna(tipo.id);
  const collaboratori = useListCollaboratori({ stato: "attivi" }, { query: { queryKey: ["collaboratori-attivi-compensi-tipo"] } });
  const salva = useSaveCompensoCollaboratore();
  const del = useDeleteCompensoCollaboratore();
  const [collId, setCollId] = useState("");
  const [pagabile, setPagabile] = useState(tipo.pagabile);
  const [punti, setPunti] = useState(String(tipo.punti));
  const [valore, setValore] = useState(tipo.valoreEuro.toFixed(2).replace(".", ","));
  const [err, setErr] = useState<string | null>(null);
  const [daEliminare, setDaEliminare] = useState<number | null>(null);
  const onError = (e: unknown) => setErr(parseApiError(e).message);

  const imposta = (c: { collaboratoreId: string; pagabile: boolean; punti: number; valoreEuro: number }) => {
    setCollId(c.collaboratoreId); setPagabile(c.pagabile); setPunti(String(c.punti)); setValore(c.valoreEuro.toFixed(2).replace(".", ","));
  };
  const scegli = (v: string) => {
    const esistente = tipo.compensiCollaboratori.find((c) => String(c.collaboratoreId) === v);
    imposta(esistente ? { collaboratoreId: v, pagabile: esistente.pagabile, punti: esistente.punti, valoreEuro: esistente.valoreEuro } : { collaboratoreId: v, pagabile: tipo.pagabile, punti: tipo.punti, valoreEuro: tipo.valoreEuro });
  };
  const aggiungi = () => {
    if (!collId) return setErr("Scegli il collaboratore");
    const r = leggiTipo({ nome: "x", attivo: true, pagabile, punti, valore });
    if ("errori" in r) return setErr(r.errori.punti ?? r.errori.valoreEuro ?? "Dati non validi");
    setErr(null);
    salva.mutate({ id: tipo.id, data: { collaboratoreId: Number(collId), pagabile: r.dati.pagabile, punti: r.dati.punti, valoreEuro: r.dati.valoreEuro } }, {
      onSuccess: (t) => { aggiorna(t); setCollId(""); toast({ title: "Eccezione salvata" }); }, onError,
    });
  };

  return (
    <Sezione titolo="Compensi per collaboratore" testId="sezione-compensi-collaboratore"
      nota="Il default del tipo (pagabile, punti, euro) vale per tutti. Qui si indicano le eccezioni per singoli collaboratori: l'eccezione ha la precedenza sul default.">
      {!tipo.compensiCollaboratori.length ? <p className="text-sm text-muted-foreground" data-testid="nessuna-eccezione">Nessuna eccezione: vale il default del tipo per tutti i collaboratori.</p> : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {tipo.compensiCollaboratori.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 p-2.5" data-testid={`riga-eccezione-${c.id}`}>
              <div className="min-w-0 flex-1">
                <span className="font-medium">{c.collaboratoreNome}</span> <span className="text-xs text-muted-foreground">sportello {c.numeroSportello}</span>
                <div className="text-sm text-muted-foreground">{c.pagabile ? `Pagabile · ${c.punti} punti · ${fmtEuro(c.valoreEuro)}` : "Non pagabile"}</div>
              </div>
              <Button size="icon" variant="ghost" className="size-8" onClick={() => { imposta({ collaboratoreId: String(c.collaboratoreId), pagabile: c.pagabile, punti: c.punti, valoreEuro: c.valoreEuro }); setErr(null); }} aria-label={`Modifica l'eccezione di ${c.collaboratoreNome}`}><Pencil className="size-4" /></Button>
              <Button size="icon" variant="ghost" className="size-8 text-destructive" onClick={() => setDaEliminare(c.id)} aria-label={`Togli l'eccezione di ${c.collaboratoreNome}`} data-testid={`button-elimina-eccezione-${c.id}`}><Trash2 className="size-4" /></Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 max-w-xs">
          <Label htmlFor="eccezione-collaboratore">Collaboratore</Label>
          <Select value={collId} onValueChange={scegli}>
            <SelectTrigger id="eccezione-collaboratore" className="bg-card w-full" data-testid="select-eccezione-collaboratore"><SelectValue placeholder="Scegli il collaboratore" /></SelectTrigger>
            <SelectContent>
              {(collaboratori.data ?? []).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.cognome} {c.nome} · sportello {c.numeroSportello}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm pb-2"><Switch checked={pagabile} onCheckedChange={setPagabile} data-testid="switch-eccezione-pagabile" /> Pagabile</label>
        {pagabile && (
          <>
            <div className="w-24">
              <Label htmlFor="eccezione-punti">Punti</Label>
              <Input id="eccezione-punti" inputMode="numeric" value={punti} onChange={(e) => setPunti(e.target.value)} data-testid="input-eccezione-punti" />
            </div>
            <div className="w-32">
              <Label htmlFor="eccezione-valore">Valore in euro</Label>
              <Input id="eccezione-valore" inputMode="decimal" value={valore} onChange={(e) => setValore(e.target.value)} data-testid="input-eccezione-valore" />
            </div>
          </>
        )}
        <Button onClick={aggiungi} disabled={salva.isPending} data-testid="button-salva-eccezione">
          {salva.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Plus className="size-4 mr-2" />} Salva eccezione
        </Button>
      </div>
      <FieldError id="errore-eccezioni">{err ?? undefined}</FieldError>
      <ConfermaElimina aperto={daEliminare !== null} titolo="Togliere l'eccezione?" testo="Per questo collaboratore tornerà a valere il default del tipo di pratica."
        onAnnulla={() => setDaEliminare(null)}
        onConferma={() => { const id = daEliminare!; setDaEliminare(null); del.mutate({ id }, { onSuccess: (t) => { aggiorna(t); toast({ title: "Eccezione tolta" }); }, onError }); }} />
    </Sezione>
  );
}

// ---------------------------------------------------------------------------------------------

export function NormativeTipo({ tipo }: { tipo: TipoPratica }) {
  const { toast } = useToast();
  const aggiorna = useAggiorna(tipo.id);
  const crea = useCreateNormativaTipo();
  const modifica = useUpdateNormativaTipo();
  const del = useDeleteNormativaTipo();
  const [titolo, setTitolo] = useState("");
  const [url, setUrl] = useState("");
  const [modId, setModId] = useState<number | null>(null);
  const [modTitolo, setModTitolo] = useState("");
  const [modUrl, setModUrl] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [daEliminare, setDaEliminare] = useState<number | null>(null);
  const onError = (e: unknown) => setErr(parseApiError(e).message);

  const aggiungi = () => {
    if (!titolo.trim() || !url.trim()) return setErr("Inserisci il titolo e l'indirizzo del link");
    setErr(null);
    crea.mutate({ id: tipo.id, data: { titolo: titolo.trim(), url: url.trim() } }, { onSuccess: (t) => { aggiorna(t); setTitolo(""); setUrl(""); toast({ title: "Link aggiunto" }); }, onError });
  };
  const conferma = (id: number) => {
    if (!modTitolo.trim() || !modUrl.trim()) return setErr("Inserisci il titolo e l'indirizzo del link");
    setErr(null);
    modifica.mutate({ id, data: { titolo: modTitolo.trim(), url: modUrl.trim() } }, { onSuccess: (t) => { aggiorna(t); setModId(null); }, onError });
  };

  return (
    <Sezione titolo="Link alle normative" testId="sezione-normative"
      nota="I collaboratori vedono questi link in fondo alla pagina della pratica, nella sezione Normative.">
      {!tipo.normative.length ? <p className="text-sm text-muted-foreground" data-testid="nessuna-normativa">Nessun link.</p> : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {tipo.normative.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center gap-2 p-2.5" data-testid={`riga-normativa-${n.id}`}>
              {modId === n.id ? (
                <>
                  <Input className="h-8 max-w-56" value={modTitolo} onChange={(e) => setModTitolo(e.target.value)} maxLength={150} aria-label="Titolo" data-testid={`input-titolo-normativa-${n.id}`} />
                  <Input className="h-8 max-w-sm" value={modUrl} onChange={(e) => setModUrl(e.target.value)} maxLength={1000} aria-label="Indirizzo" />
                  <Button size="icon" variant="ghost" className="size-8" onClick={() => conferma(n.id)} aria-label="Conferma"><Check className="size-4" /></Button>
                  <Button size="icon" variant="ghost" className="size-8" onClick={() => setModId(null)} aria-label="Annulla"><X className="size-4" /></Button>
                </>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{n.titolo}</div>
                    <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline break-all inline-flex items-center gap-1">{n.url} <ExternalLink className="size-3" /></a>
                  </div>
                  <Button size="icon" variant="ghost" className="size-8" onClick={() => { setModId(n.id); setModTitolo(n.titolo); setModUrl(n.url); setErr(null); }} aria-label={`Modifica ${n.titolo}`}><Pencil className="size-4" /></Button>
                  <Button size="icon" variant="ghost" className="size-8 text-destructive" onClick={() => setDaEliminare(n.id)} aria-label={`Elimina ${n.titolo}`} data-testid={`button-elimina-normativa-${n.id}`}><Trash2 className="size-4" /></Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1 max-w-xs">
          <Label htmlFor="nuova-normativa-titolo">Titolo</Label>
          <Input id="nuova-normativa-titolo" value={titolo} onChange={(e) => setTitolo(e.target.value)} maxLength={150} placeholder="Es. Circolare INPS" data-testid="input-normativa-titolo" />
        </div>
        <div className="min-w-56 flex-[2] max-w-md">
          <Label htmlFor="nuova-normativa-url">Indirizzo (URL)</Label>
          <Input id="nuova-normativa-url" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={1000} placeholder="https://" data-testid="input-normativa-url"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); aggiungi(); } }} />
        </div>
        <Button onClick={aggiungi} disabled={crea.isPending} aria-label="Aggiungi il link" data-testid="button-aggiungi-normativa">
          {crea.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        </Button>
      </div>
      <FieldError id="errore-normative">{err ?? undefined}</FieldError>
      <ConfermaElimina aperto={daEliminare !== null} titolo="Eliminare il link?" testo="Il link non sarà più mostrato ai collaboratori."
        onAnnulla={() => setDaEliminare(null)}
        onConferma={() => { const id = daEliminare!; setDaEliminare(null); del.mutate({ id }, { onSuccess: (t) => { aggiorna(t); toast({ title: "Link eliminato" }); }, onError }); }} />
    </Sezione>
  );
}

// ---------------------------------------------------------------------------------------------

export function AllegatiOperatoreTipo({ tipo }: { tipo: TipoPratica }) {
  const { toast } = useToast();
  const aggiorna = useAggiorna(tipo.id);
  const crea = useCreateAllegatoTipo();
  const del = useDeleteAllegatoTipo();
  const [nome, setNome] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [daEliminare, setDaEliminare] = useState<number | null>(null);
  const onError = (e: unknown) => setErr(parseApiError(e).message);

  const aggiungi = () => {
    if (!nome) return setErr("Scegli il documento");
    setErr(null);
    crea.mutate({ id: tipo.id, data: { nome } }, { onSuccess: (t) => { aggiorna(t); setNome(""); toast({ title: "Documento aggiunto" }); }, onError });
  };

  return (
    <Sezione titolo="Allegati dell'operatore" testId="sezione-allegati-operatore"
      nota="Documenti che l'operatore può allegare alla pratica durante la lavorazione (non obbligatori). La voce «Altro», con nome libero, è sempre disponibile.">
      {!tipo.allegatiOperatore.length ? <p className="text-sm text-muted-foreground" data-testid="nessun-allegato-operatore">Nessun documento in elenco: l&apos;operatore potrà usare solo «Altro».</p> : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {tipo.allegatiOperatore.map((a) => (
            <li key={a.id} className="flex items-center gap-2 p-2.5" data-testid={`riga-allegato-operatore-${a.id}`}>
              <span className="font-medium flex-1">{a.nome}</span>
              <Button size="icon" variant="ghost" className="size-8 text-destructive" onClick={() => setDaEliminare(a.id)} aria-label={`Togli ${a.nome}`} data-testid={`button-elimina-allegato-operatore-${a.id}`}><Trash2 className="size-4" /></Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <SelettoreDocumento id="allegato-operatore-doc" etichetta="Aggiungi un documento" valore={nome} onChange={setNome} esclusi={tipo.allegatiOperatore.map((a) => a.nome)} testId="allegato-operatore" />
        <Button onClick={aggiungi} disabled={crea.isPending} data-testid="button-aggiungi-allegato-operatore"><Plus className="size-4 mr-2" /> Aggiungi</Button>
      </div>
      <FieldError id="errore-allegati-operatore">{err ?? undefined}</FieldError>
      <ConfermaElimina aperto={daEliminare !== null} titolo="Togliere il documento?" testo="Non sarà più proposto agli operatori per questo tipo di pratica."
        onAnnulla={() => setDaEliminare(null)}
        onConferma={() => { const id = daEliminare!; setDaEliminare(null); del.mutate({ id }, { onSuccess: (t) => { aggiorna(t); toast({ title: "Documento tolto" }); }, onError }); }} />
    </Sezione>
  );
}

// ---------------------------------------------------------------------------------------------

export function ScadenzaTipo({ tipo }: { tipo: TipoPratica }) {
  const { toast } = useToast();
  const aggiorna = useAggiorna(tipo.id);
  const salva = useUpdateScadenzaTipo();
  const [attiva, setAttiva] = useState(tipo.scadenzaGiorni !== null);
  const [giorni, setGiorni] = useState(tipo.scadenzaGiorni !== null ? String(tipo.scadenzaGiorni) : "");
  const [anticipo, setAnticipo] = useState(String(tipo.anticipoGiorni));
  const [err, setErr] = useState<string | null>(null);

  const invia = () => {
    const g = Number(giorni);
    const a = Number(anticipo);
    if (attiva && (!Number.isInteger(g) || g < 1 || g > 3650)) return setErr("Scrivi i giorni di scadenza (da 1 a 3650).");
    if (!Number.isInteger(a) || a < 0 || a > 365) return setErr("L'anticipo deve essere un numero di giorni da 0 a 365.");
    if (attiva && a >= g) return setErr("L'anticipo deve essere minore dei giorni di scadenza.");
    setErr(null);
    salva.mutate({ id: tipo.id, data: { scadenzaGiorni: attiva ? g : null, anticipoGiorni: a } }, {
      onSuccess: (t) => { aggiorna(t); toast({ title: "Scadenza salvata" }); },
      onError: (e) => setErr(parseApiError(e).message),
    });
  };

  return (
    <Sezione titolo="Scadenza" testId="sezione-scadenza"
      nota="Giorni entro cui la pratica va lavorata, contati dall'invio. Quando la scadenza si avvicina compare un avviso nelle pratiche in gestione e l'operatore che ha la pratica in carico riceve un'email. Senza scadenza non c'è nessun avviso.">
      <label className="flex items-center gap-3 text-sm font-medium">
        <Switch checked={attiva} onCheckedChange={setAttiva} data-testid="switch-scadenza" /> Questo tipo di pratica ha una scadenza
      </label>
      {attiva && (
        <div className="flex flex-wrap gap-4">
          <div>
            <Label htmlFor="scadenza-giorni" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Scade dopo (giorni)</Label>
            <Input id="scadenza-giorni" type="number" min={1} max={3650} value={giorni} onChange={(e) => setGiorni(e.target.value)} className="mt-1 w-40 bg-card" data-testid="input-scadenza-giorni" />
          </div>
          <div>
            <Label htmlFor="anticipo-giorni" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Avvisa prima (giorni)</Label>
            <Input id="anticipo-giorni" type="number" min={0} max={365} value={anticipo} onChange={(e) => setAnticipo(e.target.value)} className="mt-1 w-40 bg-card" data-testid="input-anticipo-giorni" />
          </div>
        </div>
      )}
      <FieldError id="errore-scadenza">{err ?? undefined}</FieldError>
      <Button onClick={invia} disabled={salva.isPending} data-testid="button-salva-scadenza">
        {salva.isPending && <Loader2 className="size-4 mr-2 animate-spin" />} Salva scadenza
      </Button>
    </Sezione>
  );
}
