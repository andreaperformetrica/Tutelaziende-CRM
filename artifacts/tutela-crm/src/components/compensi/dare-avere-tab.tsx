import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetDareAvereQueryKey, getListRicevuteQueryKey, useCreateRicevuta, useCreateRigaDareAvere, useDeleteRigaDareAvere, useGetDareAvere, useListCollaboratori, useUpdateRigaDareAvere, type RigaDareAvere, type SezioneDareAvere } from "@workspace/api-client-react";
import { Pencil, Plus, Printer, Receipt, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorState } from "@/components/common";
import { ConfermaElimina } from "@/components/pratiche/conferma-elimina";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/lib/auth";
import { fmtData, fmtEuro, parseApiError } from "@/lib/format";
import { urlDareAverePdf } from "@/lib/upload";
import { SceltaCollaboratore } from "./scelta-collaboratore";

type SezioneManuale = "naspi" | "pensionati" | "caf" | "crediti" | "debiti";
const TITOLI: Record<SezioneManuale, string> = { naspi: "Naspi", pensionati: "Pensionati", caf: "CAF", crediti: "Crediti", debiti: "Debiti" };
interface Form { id: number | null; sezione: SezioneManuale; descrizione: string; importo: string; data: string; nota: string }

interface FormRicevuta { riga: RigaDareAvere; sezione: string; importo: string; aliquota: string }

export function DareAvereTab() {
  const qc = useQueryClient();
  const [, nav] = useLocation();
  const { session } = useSession();
  const puoModificare = session?.ruolo === "super_admin" || session?.ruolo === "admin";
  const elencoCollaboratori = useListCollaboratori({ stato: "tutti" });
  const creaRicevuta = useCreateRicevuta();
  const [ricevuta, setRicevuta] = useState<FormRicevuta | null>(null);
  const [errRicevuta, setErrRicevuta] = useState<string | null>(null);
  const { toast } = useToast();
  const [coll, setColl] = useState("");
  const [anno, setAnno] = useState(String(new Date().getFullYear()));
  const annoOk = /^\d{4}$/.test(anno) && Number(anno) >= 2000 && Number(anno) <= 2100;
  const params = { collaboratoreId: Number(coll), anno: Number(anno) };
  const dati = useGetDareAvere(params, { query: { enabled: !!coll && annoOk, queryKey: getGetDareAvereQueryKey(params) } });
  const crea = useCreateRigaDareAvere();
  const modifica = useUpdateRigaDareAvere();
  const elimina = useDeleteRigaDareAvere();
  const [form, setForm] = useState<Form | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [daEliminare, setDaEliminare] = useState<RigaDareAvere | null>(null);

  const aggiorna = (d: unknown) => qc.setQueryData(getGetDareAvereQueryKey(params), d);
  const apri = (sezione: SezioneManuale, r?: RigaDareAvere) => {
    setErr(null);
    setForm({ id: r?.id ?? null, sezione, descrizione: r?.descrizione ?? "", importo: r ? String(r.importoEuro).replace(".", ",") : "", data: r?.dataPagamento ?? "", nota: r?.nota ?? "" });
  };
  const salva = () => {
    if (!form) return;
    const importoEuro = Number(form.importo.replace(",", "."));
    if (!form.descrizione.trim()) return setErr("Inserisci la descrizione.");
    if (!Number.isFinite(importoEuro) || importoEuro <= 0) return setErr("Inserisci un importo maggiore di zero.");
    setErr(null);
    const corpo = { descrizione: form.descrizione.trim(), importoEuro, dataPagamento: form.data || null, nota: form.nota.trim() };
    const opz = { onSuccess: (d: unknown) => { aggiorna(d); setForm(null); toast({ title: form.id ? "Riga modificata" : "Riga aggiunta" }); }, onError: (e: unknown) => setErr(parseApiError(e).message) };
    if (form.id) modifica.mutate({ id: form.id, data: corpo }, opz);
    else crea.mutate({ data: { ...corpo, collaboratoreId: params.collaboratoreId, anno: params.anno, sezione: form.sezione } }, opz);
  };

  const collSelezionato = (elencoCollaboratori.data ?? []).find((c) => String(c.id) === coll);
  const conIva = collSelezionato?.tipoSoggetto === "PARTITA_IVA";
  const apriRicevuta = (riga: RigaDareAvere, sezioneCodice: string) => {
    setErrRicevuta(null);
    setRicevuta({ riga, sezione: sezioneCodice, importo: String(riga.importoEuro.toFixed(2)).replace(".", ","), aliquota: "" });
  };
  const emettiRicevuta = () => {
    if (!ricevuta) return;
    const importoEuro = Number(ricevuta.importo.replace(",", "."));
    if (!Number.isFinite(importoEuro) || importoEuro <= 0) return setErrRicevuta("Inserisci un importo maggiore di zero.");
    const aliquotaIva = conIva && ricevuta.aliquota.trim() ? Number(ricevuta.aliquota.replace(",", ".")) : null;
    if (aliquotaIva !== null && (!Number.isFinite(aliquotaIva) || aliquotaIva < 0 || aliquotaIva > 100)) return setErrRicevuta("L'aliquota IVA deve essere tra 0 e 100.");
    const r = ricevuta.riga;
    const origineTipo = r.estrattoId ? "estratto" : r.importazioneId ? "importazione" : "riga";
    const origineId = r.estrattoId ?? r.importazioneId ?? r.id;
    if (origineId === null) return;
    setErrRicevuta(null);
    creaRicevuta.mutate({ data: { collaboratoreId: params.collaboratoreId, anno: params.anno, origineTipo, origineId, importoEuro, aliquotaIva } }, {
      onSuccess: (d) => {
        qc.invalidateQueries({ queryKey: getGetDareAvereQueryKey(params) });
        qc.invalidateQueries({ queryKey: getListRicevuteQueryKey() });
        setRicevuta(null);
        toast({ title: `Ricevuta n. ${d.ricevuta.numero}/${d.ricevuta.anno} creata` });
        nav(`/admin/pagamenti-fatture/${d.ricevuta.id}`);
      },
      onError: (e) => setErrRicevuta(parseApiError(e).message),
    });
  };

  const sezione = (s: SezioneDareAvere) => {
    const manuale = !s.automatica;
    return (
      <div key={s.sezione} className="rounded-lg border border-border bg-card overflow-hidden" data-testid={`sezione-${s.sezione}`}>
        <div className="flex items-center justify-between bg-muted/70 px-4 py-2">
          <h3 className="font-semibold">{s.titolo}</h3>
          {manuale && puoModificare && <Button size="sm" variant="outline" onClick={() => apri(s.sezione as SezioneManuale)} data-testid={`button-aggiungi-${s.sezione}`}><Plus className="size-4 mr-1" />Aggiungi riga</Button>}
          {s.automatica && <span className="text-xs text-muted-foreground">Compilata dagli estratti</span>}
        </div>
        {s.righe.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">Nessuna riga.</p> : (
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent">
              {["Descrizione", "", "Importo", "Data pagamento", "Nota", ""].map((h, i) => <TableHead key={i} className={`text-[11px] uppercase tracking-wider h-9 ${i === 2 ? "text-right" : ""}`}>{h}</TableHead>)}
            </TableRow></TableHeader>
            <TableBody>
              {s.righe.map((r, i) => (
                <TableRow key={r.id ?? `a${i}`} data-testid={`riga-${s.sezione}-${i}`}>
                  <TableCell>{r.descrizione}</TableCell>
                  <TableCell className="text-muted-foreground">euro</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtEuro(r.importoEuro)}</TableCell>
                  <TableCell className="tabular-nums">{r.riferimento ?? fmtData(r.dataPagamento)}</TableCell>
                  <TableCell className="text-sm">{r.nota}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {manuale && puoModificare && r.id !== null && !r.ricevuta && <>
                      <Button size="icon" variant="ghost" aria-label="Modifica la riga" onClick={() => apri(s.sezione as SezioneManuale, r)} data-testid={`button-modifica-riga-${r.id}`}><Pencil className="size-4" /></Button>
                      <Button size="icon" variant="ghost" aria-label="Elimina la riga" onClick={() => setDaEliminare(r)} data-testid={`button-elimina-riga-${r.id}`}><Trash2 className="size-4" /></Button>
                    </>}
                    {s.sezione !== "debiti" && (r.ricevuta ? (
                      <Link href={`/admin/pagamenti-fatture/${r.ricevuta.id}`} className="inline-flex items-center gap-1.5 text-sm underline mr-3" data-testid={`link-ricevuta-${s.sezione}-${i}`}>
                        Ricevuta n. {r.ricevuta.numero}/{r.ricevuta.anno}
                        {r.ricevuta.pagata && <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Pagata</Badge>}
                      </Link>
                    ) : (
                      <Button size="sm" variant="outline" className="mr-2" onClick={() => apriRicevuta(r, s.sezione)} data-testid={`button-crea-ricevuta-${s.sezione}-${i}`}><Receipt className="size-3.5 mr-1.5" />Crea ricevuta</Button>
                    ))}
                    {s.automatica && r.estrattoId && <Link className="text-sm underline" href={`/admin/compensi/estratti/${r.estrattoId}`}>Apri estratto</Link>}
                    {r.importazioneId && <Link className="text-sm underline" href={`/admin/compensi/importazioni/${r.importazioneId}`}>Apri importazione</Link>}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-secondary/40 hover:bg-secondary/40 font-semibold">
                <TableCell>{s.sezione === "debiti" ? "Totale debiti" : s.sezione === "crediti" ? "Totale crediti" : "Totale"}</TableCell><TableCell className="text-muted-foreground font-normal">euro</TableCell>
                <TableCell className="text-right tabular-nums">{fmtEuro(s.totaleEuro)}</TableCell><TableCell colSpan={3} />
              </TableRow>
            </TableBody>
          </Table>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="space-y-1.5"><Label>Collaboratore</Label><div><SceltaCollaboratore valore={coll} onChange={setColl} testid="dare-avere-collaboratore" /></div></div>
        <div className="space-y-1.5"><Label htmlFor="da-anno">Anno</Label><Input id="da-anno" inputMode="numeric" maxLength={4} value={anno} onChange={(e) => setAnno(e.target.value)} className="w-28 bg-card" data-testid="dare-avere-anno" /></div>
        {coll && annoOk && <Button variant="outline" asChild><a href={urlDareAverePdf(Number(coll), Number(anno))} target="_blank" rel="noreferrer" data-testid="button-pdf-dare-avere"><Printer className="size-4 mr-2" />Stampa PDF</a></Button>}
      </div>
      {!coll ? <p className="text-sm text-muted-foreground">Scegli un collaboratore per vedere il dare e avere dell'anno.</p>
        : !annoOk ? <p className="text-sm text-muted-foreground">Inserisci un anno valido (aaaa).</p>
        : dati.isLoading ? <Skeleton className="h-64 w-full" />
        : dati.isError ? <ErrorState message={parseApiError(dati.error).message} onRetry={() => dati.refetch()} />
        : dati.data && (
          <div className="space-y-4 max-w-5xl">
            <h2 className="font-serif text-xl font-semibold">{dati.data.collaboratoreNome} · Sportello {dati.data.numeroSportello}</h2>
            {dati.data.sezioni.map(sezione)}
            <div className="flex items-center justify-between rounded-lg border-2 border-primary bg-card px-4 py-3 font-semibold" data-testid="totale-avere">
              <span>Totale euro avere <span className="font-normal text-xs text-muted-foreground">(importi e crediti, meno i debiti)</span></span>
              <span className="tabular-nums text-lg">{fmtEuro(dati.data.totaleAvereEuro)}</span>
            </div>
          </div>
        )}

      <Dialog open={!!form} onOpenChange={(o) => { if (!o) setForm(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form?.id ? "Modifica riga" : "Nuova riga"}{form ? ` · ${TITOLI[form.sezione]}` : ""}</DialogTitle></DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="space-y-1.5"><Label htmlFor="r-desc">Descrizione</Label><Input id="r-desc" maxLength={120} value={form.descrizione} onChange={(e) => setForm({ ...form, descrizione: e.target.value })} data-testid="input-riga-descrizione" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label htmlFor="r-imp">Importo (euro)</Label><Input id="r-imp" inputMode="decimal" placeholder="0,00" value={form.importo} onChange={(e) => setForm({ ...form, importo: e.target.value })} data-testid="input-riga-importo" /></div>
                <div className="space-y-1.5"><Label htmlFor="r-data">Data pagamento</Label><Input id="r-data" type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} data-testid="input-riga-data" /></div>
              </div>
              <div className="space-y-1.5"><Label htmlFor="r-nota">Nota</Label><Input id="r-nota" maxLength={300} value={form.nota} onChange={(e) => setForm({ ...form, nota: e.target.value })} data-testid="input-riga-nota" /></div>
              {form.sezione === "debiti" && <p className="text-xs text-muted-foreground">Inserisci il debito come importo positivo: viene sottratto dal totale.</p>}
              {form.sezione === "crediti" && <p className="text-xs text-muted-foreground">Inserisci il credito come importo positivo: viene sommato al totale.</p>}
              {err && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 text-destructive px-3 py-2 text-sm">{err}</div>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Annulla</Button>
            <Button onClick={salva} disabled={crea.isPending || modifica.isPending} data-testid="button-salva-riga">Salva</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!ricevuta} onOpenChange={(o) => { if (!o) setRicevuta(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Crea ricevuta</DialogTitle></DialogHeader>
          {ricevuta && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Ricevuta a nome di <strong>{dati.data?.collaboratoreNome}</strong> per: {ricevuta.riga.descrizione}. Porta la data di oggi e il prossimo numero dell'anno.</p>
              <div className="space-y-1.5">
                <Label htmlFor="ric-imp">{conIva ? "Imponibile (euro)" : "Importo (euro)"}</Label>
                <Input id="ric-imp" inputMode="decimal" value={ricevuta.importo} onChange={(e) => setRicevuta({ ...ricevuta, importo: e.target.value })} data-testid="input-ricevuta-importo" />
              </div>
              {conIva ? (
                <div className="space-y-1.5">
                  <Label htmlFor="ric-iva">Aliquota IVA (%)</Label>
                  <Input id="ric-iva" inputMode="decimal" placeholder="Quella standard delle impostazioni" value={ricevuta.aliquota} onChange={(e) => setRicevuta({ ...ricevuta, aliquota: e.target.value })} data-testid="input-ricevuta-iva" />
                  <p className="text-xs text-muted-foreground">Il collaboratore ha la partita IVA: la ricevuta riporta imponibile, IVA e totale.</p>
                </div>
              ) : <p className="text-xs text-muted-foreground">Questo collaboratore non ha la partita IVA: la ricevuta è senza IVA.</p>}
              {collSelezionato && !collSelezionato.iban && <p className="text-xs text-destructive">Manca l'IBAN del collaboratore: va inserito nella sua scheda prima di creare la ricevuta.</p>}
              {errRicevuta && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 text-destructive px-3 py-2 text-sm" data-testid="errore-ricevuta">{errRicevuta}</div>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRicevuta(null)}>Annulla</Button>
            <Button onClick={emettiRicevuta} disabled={creaRicevuta.isPending} data-testid="button-conferma-ricevuta">{creaRicevuta.isPending ? "Creazione…" : "Crea ricevuta"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfermaElimina aperto={!!daEliminare} titolo={`Eliminare la riga "${daEliminare?.descrizione ?? ""}"?`} testo="La riga sarà tolta dal dare e avere."
        onAnnulla={() => setDaEliminare(null)}
        onConferma={() => {
          if (!daEliminare?.id) return;
          elimina.mutate({ id: daEliminare.id }, {
            onSuccess: (d) => { aggiorna(d); setDaEliminare(null); toast({ title: "Riga eliminata" }); },
            onError: (e) => { setDaEliminare(null); toast({ title: "Eliminazione non riuscita", description: parseApiError(e).message, variant: "destructive" }); },
          });
        }} />
    </div>
  );
}
