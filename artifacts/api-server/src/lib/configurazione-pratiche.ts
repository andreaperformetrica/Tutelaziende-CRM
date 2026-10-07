import { asc, eq, inArray } from "drizzle-orm";
import { db, documentiTipoTable, moduliTipoTable, tipiPraticaTable } from "@workspace/db";
import { HttpError, nonTrovato } from "./errori";
import type { Executor } from "./log";

type RigaTipo = typeof tipiPraticaTable.$inferSelect;
type RigaDocumento = typeof documentiTipoTable.$inferSelect;
type RigaModulo = typeof moduliTipoTable.$inferSelect;

/** Nome libero: spazi normalizzati, obbligatorio, lunghezza massima. */
export function pulisciNome(valore: unknown, etichetta: string, max = 120): string {
  const nome = typeof valore === "string" ? valore.replace(/\s+/g, " ").trim() : "";
  if (!nome) throw new HttpError(400, `${etichetta} è obbligatorio.`, "DATI_NON_VALIDI", "nome");
  if (nome.length > max) throw new HttpError(400, `${etichetta} può avere al massimo ${max} caratteri.`, "DATI_NON_VALIDI", "nome");
  return nome;
}

export function mappaTipo(t: RigaTipo, documenti: RigaDocumento[], moduli: RigaModulo[]) {
  return {
    id: t.id,
    nome: t.nome,
    attivo: t.attivo,
    pagabile: t.pagabile,
    punti: t.punti,
    valoreEuro: t.valoreCentesimi / 100,
    creatoIl: t.creatoIl.toISOString(),
    documenti: documenti
      .filter((d) => d.tipoPraticaId === t.id)
      .sort((a, b) => a.ordine - b.ordine || a.id - b.id)
      .map((d) => ({ id: d.id, nome: d.nome, mandato: d.mandato, ordine: d.ordine })),
    moduli: moduli
      .filter((m) => m.tipoPraticaId === t.id)
      .sort((a, b) => a.id - b.id)
      .map((m) => ({
        id: m.id,
        nome: m.nome,
        fileNome: m.fileNome,
        fileTipo: m.fileTipo,
        dimensione: m.fileDimensione,
        caricatoIl: m.caricatoIl.toISOString(),
      })),
  };
}

export async function elencoTipi(executor: Executor = db) {
  const tipi = await executor.select().from(tipiPraticaTable).orderBy(asc(tipiPraticaTable.nome));
  if (!tipi.length) return [];
  const ids = tipi.map((t) => t.id);
  const documenti = await executor.select().from(documentiTipoTable).where(inArray(documentiTipoTable.tipoPraticaId, ids));
  const moduli = await executor.select().from(moduliTipoTable).where(inArray(moduliTipoTable.tipoPraticaId, ids));
  return tipi.map((t) => mappaTipo(t, documenti, moduli));
}

export async function caricaTipoMappato(id: number, executor: Executor = db) {
  const [t] = await executor.select().from(tipiPraticaTable).where(eq(tipiPraticaTable.id, id));
  if (!t) throw nonTrovato("Tipo di pratica non trovato.");
  const documenti = await executor.select().from(documentiTipoTable).where(eq(documentiTipoTable.tipoPraticaId, id));
  const moduli = await executor.select().from(moduliTipoTable).where(eq(moduliTipoTable.tipoPraticaId, id));
  return mappaTipo(t, documenti, moduli);
}

/** Verifica che `ids` contenga esattamente gli id esistenti (senza doppioni): serve per i riordini. */
export function controllaOrdine(ids: number[], esistenti: number[]): void {
  const a = [...ids].sort((x, y) => x - y);
  const b = [...esistenti].sort((x, y) => x - y);
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
    throw new HttpError(409, "L'elenco è cambiato nel frattempo. Ricarica la pagina e riprova.", "ORDINE_NON_VALIDO");
  }
}
