/**
 * Centro de costos de otra unidad (#A133; pedido de Yurani, decisiones de David del 24-nov-2026).
 *
 * ⚠️ GEMELO de `_ouCostCenters_` / `_ouPlan_` en server/Code.gs: `tools/check-other-unit.cjs` compara los
 * dos lados dentro de `npm run verify`. El formulario ordena la lista y avisa; el servidor vuelve a decidir
 * al crear la solicitud con USUARIOS, «CDS vs UDEN» y la tabla de responsables de MISC (nunca confía en lo
 * que mande el navegador).
 *
 * - La unidad que paga es la dueña del centro de costos (un centro puede estar en dos: 1901).
 * - Si el viajero es de otra unidad, el centro de costos «es de otra unidad»: el costo cuenta en el
 *   presupuesto de la dueña y la aprueba también su responsable.
 * - Solo se ofrecen centros de costos de las unidades que tienen responsable registrado.
 */
import { CostCenterMaster } from '../types';

/** Filas de «CDS vs UDEN» que no son de ninguna unidad (centros de costos generales). */
const NOT_A_UNIT = ['na', '-', ''];

/** Igual que `_csNormalize_`: sin tildes, sin espacios raros, en minúscula. */
export function unitKey(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ /g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const cleanLabel = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** ¿Es una unidad de verdad? (no NA ni «-»). */
export function isRealUnit(unit: unknown): boolean {
  return !NOT_A_UNIT.includes(unitKey(unit));
}

/** Unidades dueñas de un centro de costos, sin repetir. VARIOS, vacío o desconocido: ninguna. */
export function ownerUnits(code: unknown, master: CostCenterMaster[]): string[] {
  const c = String(code ?? '').trim();
  if (!c || c.toUpperCase() === 'VARIOS') return [];
  const out: string[] = [];
  master.forEach(m => {
    if (String(m.code ?? '').trim() !== c || !isRealUnit(m.businessUnit)) return;
    const label = cleanLabel(m.businessUnit);
    if (!out.some(u => unitKey(u) === unitKey(label))) out.push(label);
  });
  return out;
}

/**
 * A qué unidad se carga el viaje y si es otra unidad (la misma cuenta de `_ouPlan_`). Sin unidad del
 * viajero no hay «otra unidad»: el viaje va a la dueña del centro de costos.
 */
export function planCharge(code: unknown, travelerUnit: unknown, master: CostCenterMaster[]): { chargedUnit: string; cross: boolean } {
  const owners = ownerUnits(code, master);
  const traveler = cleanLabel(travelerUnit);
  if (!owners.length) return { chargedUnit: traveler, cross: false };
  const own = owners.find(u => unitKey(u) === unitKey(traveler));
  if (own) return { chargedUnit: own, cross: false };
  return { chargedUnit: owners[0], cross: !!unitKey(traveler) };
}

export interface OtherUnitGroup {
  unit: string;
  /** Quién aprueba los viajes que otras unidades le cargan (nombres, «A o B»). '' = sin responsable. */
  approvers: string;
  centers: CostCenterMaster[];
}

/**
 * Los centros de costos de las OTRAS unidades que se pueden elegir: solo las que tienen responsable, en
 * orden alfabético, cada centro una vez. `keepCode` (el centro de costos de una solicitud que se está
 * modificando) se ofrece aunque su unidad no tenga responsable: el viaje ya estaba cargado allá.
 */
export function otherUnitGroups(
  master: CostCenterMaster[],
  travelerUnit: unknown,
  responsibles: { unit: string; approvers: string }[],
  keepCode?: string
): OtherUnitGroup[] {
  const travelerKey = unitKey(travelerUnit);
  const who = new Map<string, string>();
  responsibles.forEach(r => { if (unitKey(r.unit)) who.set(unitKey(r.unit), String(r.approvers || '')); });
  const keepOwners = keepCode ? ownerUnits(keepCode, master).map(unitKey) : [];
  const groups = new Map<string, OtherUnitGroup>();
  master.forEach(m => {
    const key = unitKey(m.businessUnit);
    if (!isRealUnit(m.businessUnit) || key === travelerKey) return;
    const code = String(m.code ?? '').trim();
    if (!code || code.toUpperCase() === 'VARIOS') return;
    const offered = who.has(key) || (keepCode !== undefined && code === String(keepCode).trim() && keepOwners.includes(key));
    if (!offered) return;
    let g = groups.get(key);
    if (!g) { g = { unit: cleanLabel(m.businessUnit), approvers: who.get(key) || '', centers: [] }; groups.set(key, g); }
    if (!g.centers.some(c => String(c.code).trim() === code)) g.centers.push(m);
  });
  return Array.from(groups.values()).sort((a, b) => a.unit.localeCompare(b.unit, 'es'));
}

/** La etiqueta de la lista de unidades que corresponde a `unit` (escrita de cualquier forma), o ''. */
export function matchUnit(unit: unknown, units: string[]): string {
  const k = unitKey(unit);
  return k ? units.find(u => unitKey(u) === k) || '' : '';
}
