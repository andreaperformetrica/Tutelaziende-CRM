/** Lettura di un foglio Excel (.xlsx) o di un file CSV in una tabella di celle, senza interpretarne il contenuto. */
import ExcelJS from "exceljs";
import { HttpError } from "./errori";

export type Cella = string | number | null;
export interface RigaTabella {
  /** Numero di riga come lo vede l'utente nel foglio. */
  numero: number;
  celle: Cella[];
}
export interface Tabella {
  intestazioni: string[];
  righe: RigaTabella[];
}

export const MAX_RIGHE_IMPORT = 20000;
export const ESTENSIONI_IMPORT = ["xlsx", "csv"] as const;

const vuota = (c: Cella) => c === null || (typeof c === "string" && c.trim() === "");

function valoreCella(v: ExcelJS.CellValue): Cella {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  if (typeof v === "boolean") return v ? "Sì" : "No";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v) return valoreCella((v as { result?: ExcelJS.CellValue }).result ?? null);
    if ("richText" in v) return valoreCella((v.richText as { text: string }[]).map((t) => t.text).join(""));
    if ("text" in v) return valoreCella(String((v as { text: unknown }).text));
  }
  return null;
}

function finalizza(righeGrezze: { numero: number; celle: Cella[] }[]): Tabella {
  // Intestazione: tra le prime righe non vuote, quella con piu' celle compilate (salta titoli e righe di testata).
  const piene = (r: { celle: Cella[] }) => r.celle.filter((c) => !vuota(c)).length;
  let iIntest = -1;
  let visti = 0;
  righeGrezze.forEach((r, i) => {
    if (piene(r) === 0 || visti >= 10) return;
    visti++;
    if (iIntest < 0 || piene(r) > piene(righeGrezze[iIntest]!)) iIntest = i;
  });
  if (iIntest < 0) throw new HttpError(400, "Il file è vuoto: non contiene nessuna riga.", "FILE_NON_VALIDO");
  const testa = righeGrezze[iIntest]!;
  const intestazioni = testa.celle.map((c, i) => (vuota(c) ? `Colonna ${i + 1}` : String(c).trim()));
  const righe = righeGrezze.slice(iIntest + 1).filter((r) => r.celle.some((c) => !vuota(c)));
  if (righe.length > MAX_RIGHE_IMPORT) {
    throw new HttpError(400, `Il file ha più di ${MAX_RIGHE_IMPORT} righe: dividilo in più file.`, "FILE_TROPPO_GRANDE");
  }
  return { intestazioni, righe: righe.map((r) => ({ numero: r.numero, celle: intestazioni.map((_, i) => r.celle[i] ?? null) })) };
}

async function leggiXlsx(buffer: Buffer): Promise<Tabella> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new HttpError(400, "Il file non può essere letto come Excel (.xlsx). Controlla che non sia danneggiato.", "FILE_NON_VALIDO");
  }
  const foglio = wb.worksheets.find((w) => w.actualRowCount > 0);
  if (!foglio) throw new HttpError(400, "Il file è vuoto: non contiene nessuna riga.", "FILE_NON_VALIDO");
  const colonne = foglio.columnCount;
  const grezze: { numero: number; celle: Cella[] }[] = [];
  foglio.eachRow({ includeEmpty: false }, (riga, numero) => {
    const celle: Cella[] = [];
    for (let i = 1; i <= colonne; i++) celle.push(valoreCella(riga.getCell(i).value));
    grezze.push({ numero, celle });
  });
  return finalizza(grezze);
}

function decodifica(buffer: Buffer): string {
  let testo: string;
  try {
    testo = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    testo = new TextDecoder("windows-1252").decode(buffer);
  }
  return testo.replace(/^\uFEFF/, "");
}

function leggiCsv(buffer: Buffer): Tabella {
  const testo = decodifica(buffer);
  const prima = testo.split(/\r?\n/, 1)[0] ?? "";
  const conta = (c: string) => prima.split(c).length - 1;
  const sep = [";", "\t", ","].sort((a, b) => conta(b) - conta(a))[0]!;
  const record: string[][] = [];
  let campo = "";
  let riga: string[] = [];
  let inVirgolette = false;
  const chiudiCampo = () => {
    riga.push(campo);
    campo = "";
  };
  const chiudiRiga = () => {
    chiudiCampo();
    record.push(riga);
    riga = [];
  };
  for (let i = 0; i < testo.length; i++) {
    const ch = testo[i]!;
    if (inVirgolette) {
      if (ch === '"') {
        if (testo[i + 1] === '"') {
          campo += '"';
          i++;
        } else inVirgolette = false;
      } else campo += ch;
    } else if (ch === '"' && campo === "") inVirgolette = true;
    else if (ch === sep) chiudiCampo();
    else if (ch === "\n") chiudiRiga();
    else if (ch !== "\r") campo += ch;
  }
  if (campo !== "" || riga.length) chiudiRiga();
  return finalizza(record.map((celle, i) => ({ numero: i + 1, celle: celle.map((c) => (c.trim() === "" ? null : c.trim())) })));
}

export async function leggiTabella(buffer: Buffer, estensione: string): Promise<Tabella> {
  if (estensione === "xlsx") return leggiXlsx(buffer);
  if (estensione === "csv") return leggiCsv(buffer);
  throw new HttpError(400, "Formato non ammesso. Carica un file Excel .xlsx oppure un CSV (da Excel: Salva con nome).", "FILE_FORMATO_NON_AMMESSO");
}

/** Importo da cella: numeri veri oppure testo all'italiana ("1.234,56", "€ 12,50"). */
export function leggiImporto(c: Cella): number | null {
  if (c === null) return null;
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  let t = c.replace(/[€\s\u00a0]/g, "");
  if (!/^[-+]?[\d.,]+$/.test(t)) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^[-+]?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
