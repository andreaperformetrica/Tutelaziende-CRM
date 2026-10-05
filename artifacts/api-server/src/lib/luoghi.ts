import dati from "../data/luoghi.json";

export interface LuogoDati {
  codice: string;
  nome: string;
  provincia: string | null;
  tipo: "comune" | "stato";
  attuale: boolean;
}

export const CODICE_ITALIA = "IT";

type VoceComune = [string, string, string, 0 | 1, string[]];
type VoceStato = [string, string, 0 | 1];

function normalizza(testo: string): string {
  return testo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface Indicizzato extends LuogoDati {
  chiavi: string[];
}

const indice: Indicizzato[] = [
  ...(dati.comuni as VoceComune[]).map(
    ([codice, nome, provincia, attuale, alias]): Indicizzato => ({
      codice,
      nome,
      provincia,
      tipo: "comune",
      attuale: attuale === 1,
      chiavi: [nome, ...alias].map(normalizza),
    }),
  ),
  ...(dati.stati as VoceStato[]).map(
    ([codice, nome, attuale]): Indicizzato => ({
      codice,
      nome,
      provincia: null,
      tipo: "stato",
      attuale: attuale === 1,
      chiavi: [normalizza(nome)],
    }),
  ),
];

const perCodice = new Map(indice.map((l) => [l.codice, l]));

function senzaChiavi(l: Indicizzato): LuogoDati {
  return { codice: l.codice, nome: l.nome, provincia: l.provincia, tipo: l.tipo, attuale: l.attuale };
}

export function trovaLuogo(codice: string): LuogoDati | null {
  const l = perCodice.get(codice.trim().toUpperCase());
  return l ? senzaChiavi(l) : null;
}

/** Cerca per nome (anche parziale o con alias) ordinando prima i luoghi attuali e le corrispondenze piu precise. */
export function cercaLuoghi(q: string, tipo?: "comune" | "stato", limite = 20): LuogoDati[] {
  const ricerca = normalizza(q);
  if (ricerca.length < 2) return [];
  const risultati: Array<{ luogo: Indicizzato; punti: number }> = [];
  for (const luogo of indice) {
    if (tipo && luogo.tipo !== tipo) continue;
    let migliore = -1;
    for (const chiave of luogo.chiavi) {
      let punti = -1;
      if (chiave === ricerca) punti = 4;
      else if (chiave.startsWith(ricerca)) punti = 3;
      else if (chiave.includes(` ${ricerca}`)) punti = 2;
      else if (chiave.includes(ricerca)) punti = 1;
      if (punti > migliore) migliore = punti;
    }
    if (migliore >= 0) risultati.push({ luogo, punti: migliore + (luogo.attuale ? 10 : 0) });
  }
  risultati.sort((a, b) => b.punti - a.punti || a.luogo.nome.localeCompare(b.luogo.nome, "it"));
  return risultati.slice(0, limite).map((r) => senzaChiavi(r.luogo));
}

export interface NazionalitaDati {
  codice: string;
  nome: string;
}

const nazionalita: NazionalitaDati[] = [
  { codice: CODICE_ITALIA, nome: "Italia" },
  ...indice.filter((l) => l.tipo === "stato" && l.attuale).map((l) => ({ codice: l.codice, nome: l.nome })),
];

export function elencoNazionalita(): NazionalitaDati[] {
  return nazionalita;
}

export function trovaNazionalita(codice: string): NazionalitaDati | null {
  const c = codice.trim().toUpperCase();
  return nazionalita.find((n) => n.codice === c) ?? null;
}
