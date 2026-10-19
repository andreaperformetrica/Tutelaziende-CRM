import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { nomeProvincia } from "@workspace/anagrafica";
import { assegnazioniMandatoTable, collaboratoriTable, db, mandatiFirmeTable, mandatiTable, tipiPraticaTable } from "@workspace/db";
import { nonTrovato } from "./errori";

const colonneMandato = {
  id: mandatiTable.id,
  nome: mandatiTable.nome,
  provincia: mandatiTable.provincia,
  tipoPraticaId: mandatiTable.tipoPraticaId,
  fileNome: mandatiTable.fileNome,
  fileChiave: mandatiTable.fileChiave,
  fileTipo: mandatiTable.fileTipo,
  dimensione: mandatiTable.fileDimensione,
};

async function provinciaDellaSede(collaboratoreId: number): Promise<string | null> {
  const [c] = await db.select({ p: collaboratoriTable.sedeProvincia }).from(collaboratoriTable).where(eq(collaboratoriTable.id, collaboratoreId));
  if (!c) throw nonTrovato("Collaboratore non trovato.");
  return c.p;
}

/** Mandato precedente (assegnato al singolo collaboratore): serve solo a chi non ha ancora la provincia della sede. */
async function mandatoPrecedente(collaboratoreId: number) {
  const [m] = await db
    .select(colonneMandato)
    .from(mandatiTable)
    .innerJoin(assegnazioniMandatoTable, eq(assegnazioniMandatoTable.mandatoId, mandatiTable.id))
    .where(eq(assegnazioniMandatoTable.collaboratoreId, collaboratoreId));
  return m ?? null;
}

/**
 * Mandato che un collaboratore usa per un tipo di pratica: quello della provincia della sua sede per quel tipo,
 * altrimenti quello della stessa provincia valido per tutti i tipi. Senza provincia della sede vale il vecchio mandato assegnato.
 */
export async function mandatoPerTipo(collaboratoreId: number, tipoPraticaId: number) {
  const provincia = await provinciaDellaSede(collaboratoreId);
  if (!provincia) return mandatoPrecedente(collaboratoreId);
  const righe = await db
    .select(colonneMandato)
    .from(mandatiTable)
    .where(and(eq(mandatiTable.provincia, provincia), or(eq(mandatiTable.tipoPraticaId, tipoPraticaId), isNull(mandatiTable.tipoPraticaId))));
  return righe.find((m) => m.tipoPraticaId === tipoPraticaId) ?? righe.find((m) => m.tipoPraticaId === null) ?? null;
}

/** Elenco dei mandati che il collaboratore riceve (per la scheda del collaboratore). */
export async function mandatiDellaSede(collaboratoreId: number) {
  const provincia = await provinciaDellaSede(collaboratoreId);
  const base = { provincia, provinciaNome: provincia ? nomeProvincia(provincia) : null };
  if (!provincia) {
    const m = await mandatoPrecedente(collaboratoreId);
    return {
      ...base,
      mandati: m
        ? [{ mandatoId: m.id, nome: m.nome, provincia: m.provincia, tipoPraticaId: m.tipoPraticaId, tipoPraticaNome: null, fileNome: m.fileNome, origine: "precedente" as const }]
        : [],
    };
  }
  const righe = await db
    .select({ ...colonneMandato, tipoPraticaNome: tipiPraticaTable.nome })
    .from(mandatiTable)
    .leftJoin(tipiPraticaTable, eq(tipiPraticaTable.id, mandatiTable.tipoPraticaId))
    .where(eq(mandatiTable.provincia, provincia))
    .orderBy(sql`${mandatiTable.tipoPraticaId} nulls first`, asc(tipiPraticaTable.nome));
  return {
    ...base,
    mandati: righe.map((m) => ({
      mandatoId: m.id, nome: m.nome, provincia: m.provincia, tipoPraticaId: m.tipoPraticaId, tipoPraticaNome: m.tipoPraticaNome, fileNome: m.fileNome,
      origine: "provincia" as const,
    })),
  };
}

export async function firmaDellaPratica(praticaId: number) {
  const [f] = await db.select().from(mandatiFirmeTable).where(eq(mandatiFirmeTable.praticaId, praticaId));
  return f ?? null;
}

export const mappaFirma = (f: NonNullable<Awaited<ReturnType<typeof firmaDellaPratica>>>) => ({
  firmatoIl: f.firmatoIl.toISOString(),
  firmatario: f.firmatarioNome,
  codiceFiscale: f.firmatarioCodiceFiscale,
  cellulare: f.firmatarioCellulare,
  fileNome: f.fileNome,
});

