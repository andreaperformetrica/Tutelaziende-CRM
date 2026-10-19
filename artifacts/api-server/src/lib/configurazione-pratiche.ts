import { asc, eq, inArray } from "drizzle-orm";
import {
  allegatiTipoTable,
  collaboratoriTable,
  compensiCollaboratoreTable,
  db,
  documentiTipoTable,
  moduliTipoTable,
  normativeTipoTable,
  personeTable,
  tipiPraticaTable,
} from "@workspace/db";
import { HttpError, nonTrovato } from "./errori";
import type { Executor } from "./log";

type RigaTipo = typeof tipiPraticaTable.$inferSelect;
type RigaDocumento = typeof documentiTipoTable.$inferSelect;
type RigaModulo = typeof moduliTipoTable.$inferSelect;
type RigaNormativa = typeof normativeTipoTable.$inferSelect;
type RigaAllegato = typeof allegatiTipoTable.$inferSelect;
export type RigaCompenso = typeof compensiCollaboratoreTable.$inferSelect & { cognome: string; nome: string; sportello: string };

interface Extra {
  compensi: RigaCompenso[];
  normative: RigaNormativa[];
  allegati: RigaAllegato[];
}

/** Nome libero: spazi normalizzati, obbligatorio, lunghezza massima. */
export function pulisciNome(valore: unknown, etichetta: string, max = 120): string {
  const nome = typeof valore === "string" ? valore.replace(/\s+/g, " ").trim() : "";
  if (!nome) throw new HttpError(400, `${etichetta} è obbligatorio.`, "DATI_NON_VALIDI", "nome");
  if (nome.length > max) throw new HttpError(400, `${etichetta} può avere al massimo ${max} caratteri.`, "DATI_NON_VALIDI", "nome");
  return nome;
}

export function mappaTipo(t: RigaTipo, documenti: RigaDocumento[], moduli: RigaModulo[], extra: Extra) {
  return {
    id: t.id,
    nome: t.nome,
    attivo: t.attivo,
    pagabile: t.pagabile,
    punti: t.punti,
    valoreEuro: t.valoreCentesimi / 100,
    scadenzaGiorni: t.scadenzaGiorni,
    anticipoGiorni: t.anticipoGiorni,
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
        compilazioneAutomatica: m.compilazioneAutomatica,
        caricatoIl: m.caricatoIl.toISOString(),
      })),
    compensiCollaboratori: extra.compensi
      .filter((c) => c.tipoPraticaId === t.id)
      .sort((a, b) => `${a.cognome} ${a.nome}`.localeCompare(`${b.cognome} ${b.nome}`, "it") || a.id - b.id)
      .map((c) => ({
        id: c.id,
        collaboratoreId: c.collaboratoreId,
        collaboratoreNome: `${c.cognome} ${c.nome}`.trim(),
        numeroSportello: c.sportello,
        pagabile: c.pagabile,
        punti: c.punti,
        valoreEuro: c.valoreCentesimi / 100,
      })),
    normative: extra.normative
      .filter((n) => n.tipoPraticaId === t.id)
      .sort((a, b) => a.ordine - b.ordine || a.id - b.id)
      .map((n) => ({ id: n.id, titolo: n.titolo, url: n.url })),
    allegatiOperatore: extra.allegati
      .filter((a) => a.tipoPraticaId === t.id)
      .sort((a, b) => a.ordine - b.ordine || a.id - b.id)
      .map((a) => ({ id: a.id, nome: a.nome })),
  };
}

async function caricaExtra(executor: Executor, ids: number[]): Promise<Extra> {
  const compensi = await executor
    .select({ c: compensiCollaboratoreTable, cognome: personeTable.cognome, nome: personeTable.nome, sportello: collaboratoriTable.numeroSportello })
    .from(compensiCollaboratoreTable)
    .innerJoin(collaboratoriTable, eq(collaboratoriTable.id, compensiCollaboratoreTable.collaboratoreId))
    .innerJoin(personeTable, eq(personeTable.id, collaboratoriTable.personaId))
    .where(inArray(compensiCollaboratoreTable.tipoPraticaId, ids));
  const normative = await executor.select().from(normativeTipoTable).where(inArray(normativeTipoTable.tipoPraticaId, ids));
  const allegati = await executor.select().from(allegatiTipoTable).where(inArray(allegatiTipoTable.tipoPraticaId, ids));
  return { compensi: compensi.map((r) => ({ ...r.c, cognome: r.cognome, nome: r.nome, sportello: r.sportello })), normative, allegati };
}

export async function elencoTipi(executor: Executor = db) {
  const tipi = await executor.select().from(tipiPraticaTable).orderBy(asc(tipiPraticaTable.nome));
  if (!tipi.length) return [];
  const ids = tipi.map((t) => t.id);
  const documenti = await executor.select().from(documentiTipoTable).where(inArray(documentiTipoTable.tipoPraticaId, ids));
  const moduli = await executor.select().from(moduliTipoTable).where(inArray(moduliTipoTable.tipoPraticaId, ids));
  const extra = await caricaExtra(executor, ids);
  return tipi.map((t) => mappaTipo(t, documenti, moduli, extra));
}

export async function caricaTipoMappato(id: number, executor: Executor = db) {
  const [t] = await executor.select().from(tipiPraticaTable).where(eq(tipiPraticaTable.id, id));
  if (!t) throw nonTrovato("Tipo di pratica non trovato.");
  const documenti = await executor.select().from(documentiTipoTable).where(eq(documentiTipoTable.tipoPraticaId, id));
  const moduli = await executor.select().from(moduliTipoTable).where(eq(moduliTipoTable.tipoPraticaId, id));
  return mappaTipo(t, documenti, moduli, await caricaExtra(executor, [id]));
}

/** Verifica che `ids` contenga esattamente gli id esistenti (senza doppioni): serve per i riordini. */
export function controllaOrdine(ids: number[], esistenti: number[]): void {
  const a = [...ids].sort((x, y) => x - y);
  const b = [...esistenti].sort((x, y) => x - y);
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
    throw new HttpError(409, "L'elenco è cambiato nel frattempo. Ricarica la pagina e riprova.", "ORDINE_NON_VALIDO");
  }
}
