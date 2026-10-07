import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FieldError } from "@/components/common";

export interface ValoriTipo {
  nome: string;
  attivo: boolean;
  pagabile: boolean;
  punti: string;
  valore: string;
}

export const tipoVuoto: ValoriTipo = { nome: "", attivo: true, pagabile: false, punti: "0", valore: "0,00" };

/** Converte e controlla i valori del modulo; restituisce errori per campo oppure i dati pronti per l'API. */
export function leggiTipo(v: ValoriTipo): { errori: Record<string, string> } | { dati: { nome: string; attivo: boolean; pagabile: boolean; punti: number; valoreEuro: number } } {
  const errori: Record<string, string> = {};
  if (!v.nome.trim()) errori.nome = "Inserisci il nome del tipo di pratica";
  let punti = 0;
  let valoreEuro = 0;
  if (v.pagabile) {
    if (!/^\d{1,4}$/.test(v.punti.trim())) errori.punti = "Inserisci un numero intero di punti (0 o più)";
    else punti = Number(v.punti.trim());
    const t = v.valore.trim().replace(",", ".");
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) errori.valoreEuro = "Inserisci un importo in euro, al massimo con due decimali";
    else valoreEuro = Number(t);
  }
  if (Object.keys(errori).length) return { errori };
  return { dati: { nome: v.nome.trim(), attivo: v.attivo, pagabile: v.pagabile, punti, valoreEuro } };
}

export function CampiTipo({ v, onChange, errs, mostraAttivo }: { v: ValoriTipo; onChange: (v: ValoriTipo) => void; errs: Record<string, string>; mostraAttivo?: boolean }) {
  const set = (p: Partial<ValoriTipo>) => onChange({ ...v, ...p });
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="tipo-nome">Nome</Label>
        <Input id="tipo-nome" value={v.nome} onChange={(e) => set({ nome: e.target.value })} maxLength={120} placeholder="Es. Assegno familiare" data-testid="input-tipo-nome" aria-invalid={!!errs.nome} />
        <FieldError id="errore-tipo-nome">{errs.nome}</FieldError>
      </div>
      <div className="flex items-center justify-between rounded-md border border-border p-3">
        <div>
          <Label htmlFor="tipo-pagabile">Pagabile</Label>
          <p className="text-xs text-muted-foreground">Solo le pratiche pagabili hanno punti e valore in euro.</p>
        </div>
        <Switch id="tipo-pagabile" checked={v.pagabile} onCheckedChange={(c) => set({ pagabile: c })} data-testid="switch-tipo-pagabile" />
      </div>
      {v.pagabile && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="tipo-punti">Punti</Label>
            <Input id="tipo-punti" inputMode="numeric" value={v.punti} onChange={(e) => set({ punti: e.target.value })} data-testid="input-tipo-punti" aria-invalid={!!errs.punti} />
            <FieldError id="errore-tipo-punti">{errs.punti}</FieldError>
          </div>
          <div>
            <Label htmlFor="tipo-valore">Valore in euro</Label>
            <Input id="tipo-valore" inputMode="decimal" value={v.valore} onChange={(e) => set({ valore: e.target.value })} data-testid="input-tipo-valore" aria-invalid={!!errs.valoreEuro} />
            <FieldError id="errore-tipo-valore">{errs.valoreEuro}</FieldError>
          </div>
        </div>
      )}
      {mostraAttivo && (
        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div>
            <Label htmlFor="tipo-attivo">Attivo</Label>
            <p className="text-xs text-muted-foreground">Un tipo disattivato non sarà più proponibile per nuove pratiche.</p>
          </div>
          <Switch id="tipo-attivo" checked={v.attivo} onCheckedChange={(c) => set({ attivo: c })} data-testid="switch-tipo-attivo" />
        </div>
      )}
    </div>
  );
}
