/**
 * Validación y normalización del número de Orden de Trabajo (OT).
 *
 * ⚠️ ESTE ARCHIVO TIENE UN GEMELO EN EL BACKEND.
 * La misma lógica vive en `server/Code.gs` (`_normalizeWorkOrder_` /
 * `_validateWorkOrder_`). Si cambias las reglas aquí, cámbialas allá.
 * No se puede compartir el código: son runtimes distintos (Vite/TS vs Apps Script).
 *
 * ---------------------------------------------------------------------------
 * FORMATO CANÓNICO:  OT-<EE><CCC>-<NÚMERO>       ej. OT-CUBTA-110256
 *
 *   EE   = 2 letras de empresa   (CU=Cumandes, ET=Equitel, IG=Ingenergía, LI=LAP)
 *   CCC  = 3 letras de ciudad    (BTA, MED, BQL, PEI, YUM, URA, BEL, PSO, RSO…)
 *   NÚM  = el consecutivo de la orden
 *
 * Se valida la ESTRUCTURA, no la lista de códigos: no existe una hoja maestra de
 * OT contra la cual verificar, y una empresa o ciudad nueva debe poder operar sin
 * esperar un despliegue. Decisión de David, 2026-09-05.
 *
 * POR QUÉ IMPORTA (no es cosmético): una OT bien formada exime a la solicitud de
 * cargar al presupuesto de la unidad y de pedir la aprobación del responsable de
 * presupuesto (`_esOTValida_` / `_requiresBudgetOverrun_` en Code.gs). Una OT real
 * escrita como "CUBEL 482" NO la reconoce el backend, así que el viaje se carga
 * al presupuesto de la unidad y dispara una aprobación que no correspondía.
 *
 * La OT es OPCIONAL: vacío es válido. Lo que no se acepta es basura (`NA`, `16034`,
 * `PRUEBA!!`) — de las 149 OT escritas en producción al 2026-09-05, 67 no eran
 * reconocibles por el backend.
 */

/** Resultado de validar una OT. */
export interface WorkOrderCheck {
  /** true si el valor es aceptable (incluye el caso "vacío"). */
  ok: boolean;
  /** Valor ya normalizado que debe guardarse. Cadena vacía si no se indicó OT. */
  value: string;
  /** Mensaje para el usuario cuando `ok` es false. */
  error?: string;
  /** true si hubo que corregir el formato de lo que escribió el usuario. */
  corrected?: boolean;
}

/** Placeholder y ayuda que se muestran en el formulario. */
export const WORK_ORDER_PLACEHOLDER = 'OT-CUBTA-110256';

/**
 * Valores con los que la gente responde "no aplica". Merecen un mensaje distinto
 * al de un formato inválido: hay que decirles que dejen el campo vacío.
 * (44 de las 67 OT malas de producción son de este tipo.)
 */
const NOT_APPLICABLE = /^(N\.?\/?A\.?|NO\s*APLICA|NINGUN[AO]?|SIN\s*OT|NO\s*TIENE|PENDIENTE)$/i;

/**
 * Estructura canónica ya normalizada.
 * Número de 1 a 10 dígitos: en producción van de 3 ("482") a 6 ("123573").
 */
const CANONICAL = /^OT-[A-Z]{2}[A-Z]{3}-\d{1,10}$/;

/**
 * Partes de una OT escrita de cualquier forma razonable. Cubre las variantes
 * reales encontradas en la hoja: "OTCUURA-207", "OT-CUMED 46437", "OT CUBTA 15560",
 * "OT-CUMED55980", "OT- CUPSO 1817" y hasta la que omite el prefijo ("CUBEL 482").
 */
const LOOSE = /^([A-Z]{2})[\s\-_.]*([A-Z]{3})[\s\-_.]*(\d{1,10})$/;

/**
 * Lleva lo que el usuario escribió a la forma canónica, si se puede hacer sin
 * adivinar. Devuelve null cuando el valor no es reconocible como OT.
 *
 * Deliberadamente NO intenta rescatar valores con texto extra
 * ("INDUSUR-PUNTO NET.. OT-CUBTA-110256", "OT-CUMED-55738 Medellín"): esa
 * información adicional es del usuario y debe ir en observaciones, no en un campo
 * que el backend interpreta. Se rechaza y se le pide que la quite.
 */
export function normalizeWorkOrder(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, ' ');
  if (!s) return null;

  // Quita el prefijo OT junto con el separador que traiga (o sin ninguno).
  // Lo que queda debe ser exactamente <empresa><ciudad><número>.
  const body = s.replace(/^OT[\s\-_.]*/, '');
  const m = body.match(LOOSE);
  if (!m) return null;

  // El número se conserva TAL CUAL: no se le quitan ceros a la izquierda, porque
  // es un identificador, no una cantidad.
  return `OT-${m[1]}${m[2]}-${m[3]}`;
}

/**
 * Valida el campo de OT del formulario.
 * La OT es opcional: un valor vacío devuelve `ok: true` con `value: ''`.
 */
export function validateWorkOrder(raw: string | null | undefined): WorkOrderCheck {
  const original = String(raw ?? '').trim();
  if (!original) return { ok: true, value: '' };

  if (NOT_APPLICABLE.test(original)) {
    return {
      ok: false,
      value: original,
      error:
        'La Orden de Trabajo es opcional: si el viaje no tiene OT, deje el campo vacío ' +
        'en vez de escribir "N/A".',
    };
  }

  const normalized = normalizeWorkOrder(original);

  if (!normalized || !CANONICAL.test(normalized)) {
    // Un valor puramente numérico es el error más común después de "N/A":
    // es el consecutivo sin el prefijo ni el código.
    if (/^\d+$/.test(original)) {
      return {
        ok: false,
        value: original,
        error:
          `"${original}" es solo el consecutivo. Falta el prefijo y el código de ` +
          `empresa y ciudad. Formato: ${WORK_ORDER_PLACEHOLDER} ` +
          '(OT- + 2 letras de empresa + 3 de ciudad + - + número).',
      };
    }
    return {
      ok: false,
      value: original,
      error:
        `"${original}" no tiene el formato de una Orden de Trabajo. ` +
        `Debe ser ${WORK_ORDER_PLACEHOLDER}: el prefijo OT-, luego 2 letras de ` +
        'empresa y 3 de ciudad, un guion y el número. ' +
        'Si quiere anotar algo más, use el campo de observaciones.',
    };
  }

  return { ok: true, value: normalized, corrected: normalized !== original };
}
