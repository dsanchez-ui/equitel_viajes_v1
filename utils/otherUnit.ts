/**
 * Centro de costos de otra unidad (#A133; pedido de Yurani, decisiones de David del 24-nov-2026).
 *
 * ⚠️ GEMELO de `_ouCostCenters_` / `_ouPlan_` en server/Code.gs: `tools/check-other-unit.cjs` compara los
 * dos lados dentro de `npm run verify`. El formulario ordena la lista y avisa; el servidor vuelve a decidir
 * al crear la solicitud con USUARIOS, «CDS vs UDEN» y la tabla de responsables de MISC (nunca confía en lo
 * que mande el navegador).
 *
 * - La unidad que paga es la dueña del centro de costos (un centro puede estar en dos: 1901); con VARIOS, la
 *   unidad elegida en el formulario.
 * - La unidad del viajero es la del primer pasajero (USUARIOS, o la que se le pregunta una sola vez).
 * - Si son distintas, el viaje se carga a otra unidad: cuenta en el presupuesto de la que paga y la aprueba
 *   también su responsable. Una unidad sin responsable no recibe viajes de otras unidades.
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
 * A qué unidad se carga el viaje y si es otra unidad (la misma cuenta de `_ouPlan_`). La unidad que paga es la
 * dueña del centro de costos; con VARIOS, la unidad elegida (`sentUnit`). Sin unidad del viajero no hay «otra
 * unidad».
 */
export function planCharge(
  code: unknown,
  sentUnit: unknown,
  travelerUnit: unknown,
  master: CostCenterMaster[]
): { chargedUnit: string; cross: boolean } {
  let owners = ownerUnits(code, master);
  const sent = cleanLabel(sentUnit);
  if (!owners.length && unitKey(sent) && isRealUnit(sent)) owners = [sent];
  const traveler = cleanLabel(travelerUnit);
  if (!owners.length) return { chargedUnit: sent, cross: false };
  const own = owners.find(u => unitKey(u) === unitKey(traveler));
  if (own) return { chargedUnit: own, cross: false };
  return { chargedUnit: owners.find(u => unitKey(u) === unitKey(sent)) || owners[0], cross: !!unitKey(traveler) };
}

/** Quién aprueba los viajes que otras unidades le cargan a `unit` («A o B»), o '' si no tiene responsable. */
export function responsibleFor(unit: unknown, responsibles: { unit: string; approvers: string }[]): string {
  const k = unitKey(unit);
  const r = k ? responsibles.find(x => unitKey(x.unit) === k) : undefined;
  return r ? String(r.approvers || '') : '';
}

/** La etiqueta de la lista de unidades que corresponde a `unit` (escrita de cualquier forma), o ''. */
export function matchUnit(unit: unknown, units: string[]): string {
  const k = unitKey(unit);
  return k ? units.find(u => unitKey(u) === k) || '' : '';
}
