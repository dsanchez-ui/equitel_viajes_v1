import React, { useEffect, useMemo, useState } from 'react';
import { CityMaster, RequestStatus, TravelRequest, TripChangeConfig, TripChangeRequestChanges } from '../types';
import { gasService } from '../services/gasService';
import { ChangeWindow, changeDeadline, fmtDayLong, fmtHourLabel, isTripBought, toDateKey, tripChangeWindow, untilText } from '../utils/changeWindow';
import { fareLabel, fareOptionForNights } from '../utils/fare';
import { formatCop } from '../utils/money';
import { TimeInput } from './TimeInput';
import { CityCombobox } from './CityCombobox';
import { DateInput } from './DateInput';
import { TripChangeContactsBox, TripChangeContactsInline } from './TripChangeContacts';

/** Cierra la frase sin doble punto: «… 5:00 p. m.» ya termina en punto. */
const withDot = (s: string): string => (s.endsWith('.') ? s : s + '.');

interface TripChangeModalProps {
  /** Solicitudes que ve la persona: las suyas, o todas si es administrador. */
  requests: TravelRequest[];
  /** Viaje ya elegido (desde el detalle). Sin él, el primer paso es elegir el viaje. */
  initialRequest?: TravelRequest | null;
  /** Administrador: registra el cambio a nombre del viajero, sin plazo. */
  isAdmin: boolean;
  config: TripChangeConfig;
  onClose: () => void;
  /** Se llama al crear el cambio, para refrescar la lista. */
  onDone: () => void;
  /** Solo administradores: abrir el formulario completo de siempre (pasajeros, centro de costo, hotel). */
  onOpenFullForm?: (req: TravelRequest) => void;
}

type Step = 'pick' | 'form' | 'done';
type Toggle = 'fechas' | 'horas' | 'destino' | 'equipaje' | 'hospedaje';

const TERMINAL = ['ANULADO', 'DENEGADO', 'PROCESADO'];
const BLOCKED: Record<string, string> = {
  ANULADO: 'Está anulada.',
  DENEGADO: 'Fue denegada.',
  PROCESADO: 'Ya está cerrada.',
  PENDIENTE_ANALISIS_CAMBIO: 'Es una solicitud de cambio que el área de compras aún no revisa.',
  PENDIENTE_APROBACION_POLITICA: 'Todavía espera la aprobación por la política de anticipación.'
};

interface Eligibility {
  ok: boolean;
  win: ChangeWindow | null;
  why: string;
  /** El viaje ya terminó o la solicitud está cerrada: no se lista. */
  hidden: boolean;
}

const timeKey = (v: string | undefined): string => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v || '').trim());
  if (!m) return '';
  const h = Number(m[1]);
  return h <= 23 ? String(h).padStart(2, '0') + ':' + m[2] : '';
};

// #A112: la hora se muestra en 24 h («hora militar», Yurani 27-oct-2026). Con a. m./p. m.
// se confundieron las 6:22 con las 18:22 y el vuelo se cotizó 12 horas antes.
const fmtTime = (t: string): string => {
  if (!t) return 'Sin hora';
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t);
  return m ? `${m[1]}:${m[2]}` : t;
};

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Bajo un campo de fecha: el día elegido en palabras («Miércoles 4 de noviembre»); si es la misma de antes, lo dice. */
const DateHint: React.FC<{ value: string; before: string }> = ({ value, before }) => (
  <span className={`block font-normal mt-0.5 ${value && value !== before ? 'text-gray-700' : 'text-gray-400'}`}>
    {!value ? 'Elija la fecha' : cap(fmtDayLong(value)) + (value === before ? ' (no cambia)' : '')}
  </span>
);

/** Bajo un campo de hora: la hora de antes, para compararla (como la tabla «Antes / Ahora» del resumen). */
const TimeHint: React.FC<{ value: string; before: string }> = ({ value, before }) => (
  <span className="block text-gray-400 font-normal mt-0.5">{value === before ? 'No cambia' : `Antes: ${fmtTime(before)}`}</span>
);

const nightsBetween = (dep: string, ret: string): number => {
  if (!dep || !ret) return 0;
  const a = Date.UTC(+dep.slice(0, 4), +dep.slice(5, 7) - 1, +dep.slice(8, 10));
  const b = Date.UTC(+ret.slice(0, 4), +ret.slice(5, 7) - 1, +ret.slice(8, 10));
  return Math.max(0, Math.round((b - a) / 86400000));
};

const countryOf = (city: string): string => {
  const parts = String(city || '').split(',');
  return parts.length > 1 ? parts[parts.length - 1].trim().toUpperCase() : '';
};

/** ¿Se puede pedir el cambio de este viaje ahora? Misma regla que el servidor (que la vuelve a revisar). */
export const tripChangeEligibility = (r: TravelRequest, all: TravelRequest[], nowMs: number, isAdmin: boolean): Eligibility => {
  if (TERMINAL.includes(r.status)) return { ok: false, win: null, why: BLOCKED[r.status], hidden: true };
  if (BLOCKED[r.status]) return { ok: false, win: null, why: BLOCKED[r.status], hidden: false };
  if (r.replacedBy) return { ok: false, win: null, why: `Ya se cambió: el viaje vigente es ${r.replacedBy}.`, hidden: true };
  const live = all.find(x => x.relatedRequestId === r.requestId && x.requestId !== r.requestId && !TERMINAL.includes(x.status));
  if (live) return { ok: false, win: null, why: `Ya tiene un cambio en curso (${live.requestId}). El área de compras lo está gestionando.`, hidden: false };
  const win = tripChangeWindow(toDateKey(r.departureDate), toDateKey(r.returnDate), nowMs, isAdmin);
  if (!win.open) {
    if (win.reason === 'ended') return { ok: false, win, why: 'El viaje ya terminó.', hidden: true };
    return { ok: false, win, why: `El plazo para cambiarlo por la plataforma venció el ${fmtDayLong(win.deadlineKey)} a las ${fmtHourLabel(win.deadlineHour)}`, hidden: false }; // la hora ya termina en punto
  }
  return { ok: true, win, why: '', hidden: false };
};

interface FormState {
  t: Record<Toggle, boolean>;
  dep: string;
  ret: string;
  depTime: string;
  retTime: string;
  dest: string;
  bag: boolean;
  /** #A111: dónde se hospeda. */
  hotel: string;
  reason: string;
  tried: boolean;
}

const baseOf = (r: TravelRequest) => ({
  dep: toDateKey(r.departureDate),
  ret: toDateKey(r.returnDate),
  depTime: timeKey(r.departureTimePreference),
  retTime: timeKey(r.returnTimePreference),
  dest: String(r.destination || '').trim().toUpperCase(),
  bag: r.checkedBaggage === true,
  hotel: String(r.hotelName || '').replace(/\s+/g, ' ').trim().toUpperCase()
});

/**
 * «Cambiar mi viaje» (#A103): el viajero elige el viaje, marca qué cambia (fechas, horas,
 * destino o equipaje), escribe el motivo y lo envía. Se crea una solicitud de cambio
 * enlazada a la original, como siempre; el servidor la arma desde la original y vuelve a
 * revisar el plazo y los permisos.
 */
export const TripChangeModal: React.FC<TripChangeModalProps> = ({ requests, initialRequest, isAdmin, config, onClose, onDone, onOpenFullForm }) => {
  const nowMs = Date.now() + (config.clockOffset || 0);
  const [step, setStep] = useState<Step>(initialRequest ? 'form' : 'pick');
  const [req, setReq] = useState<TravelRequest | null>(initialRequest || null);
  const [form, setForm] = useState<FormState | null>(null);
  const [cities, setCities] = useState<CityMaster[]>([]);
  const [citiesState, setCitiesState] = useState<'idle' | 'loading' | 'error' | 'ok'>('idle');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [created, setCreated] = useState<{ id: string; comprado: boolean; parentId: string } | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !sending) onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, sending]);

  useEffect(() => {
    if (req && !form) {
      const b = baseOf(req);
      setForm({ t: { fechas: false, horas: false, destino: false, equipaje: false, hospedaje: false }, ...b, reason: '', tried: false });
    }
  }, [req, form]);

  const loadCities = () => {
    setCitiesState('loading');
    gasService.getCitiesList()
      .then(list => { setCities(list); setCitiesState('ok'); })
      .catch(() => setCitiesState('error'));
  };

  const pickList = useMemo(() => {
    return requests
      .map(r => ({ r, e: tripChangeEligibility(r, requests, nowMs, isAdmin) }))
      // Una solicitud de cambio aún sin revisar no se lista: su original ya dice «cambio en curso».
      .filter(x => !x.e.hidden && x.r.status !== RequestStatus.PENDING_CHANGE_APPROVAL)
      .sort((a, b) => toDateKey(a.r.departureDate).localeCompare(toDateKey(b.r.departureDate)));
    // nowMs cambia en cada render; la lista solo depende de las solicitudes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests, isAdmin]);

  const elig = req ? tripChangeEligibility(req, requests, nowMs, isAdmin) : null;
  // #A106: el plazo del viajero, para que el área de compras sepa si todavía puede pedirlo él mismo.
  const travelerWin = req && isAdmin ? tripChangeWindow(toDateKey(req.departureDate), toDateKey(req.returnDate), nowMs, false) : null;
  const mode = elig?.win?.mode || 'full';
  const hotelOnly = req?.requestMode === 'HOTEL_ONLY';
  // #A111: se puede cambiar el hospedaje siempre que la solicitud ya lo incluya
  // (solo hospedaje, o vuelo + hotel). Agregarlo donde no lo había es solicitud nueva.
  const canHotel = !!req && (hotelOnly || req.requiresHotel === true);
  // #A109: la reserva guardada por partes (APROBADO) también es tiquete comprado.
  const bought = isTripBought(req);
  const base = req ? baseOf(req) : null;

  const changes: TripChangeRequestChanges = {};
  const rows: [string, string, string][] = [];
  const tipos: string[] = [];
  if (req && form && base) {
    if (form.t.fechas) {
      const n = rows.length;
      if (mode === 'full' && form.dep && form.dep !== base.dep) { changes.departureDate = form.dep; rows.push([hotelOnly ? 'Entrada al hotel' : 'Fecha de ida', fmtDayLong(base.dep), fmtDayLong(form.dep)]); }
      if (base.ret && form.ret && form.ret !== base.ret) { changes.returnDate = form.ret; rows.push([hotelOnly ? 'Salida del hotel' : 'Fecha de regreso', fmtDayLong(base.ret), fmtDayLong(form.ret)]); }
      if (rows.length > n) tipos.push('Fecha');
    }
    if (form.t.horas && !hotelOnly) {
      const n = rows.length;
      if (mode === 'full' && form.depTime !== base.depTime) { changes.departureTimePreference = form.depTime; rows.push(['Hora del vuelo de ida', fmtTime(base.depTime), fmtTime(form.depTime)]); }
      if (base.ret && form.retTime !== base.retTime) { changes.returnTimePreference = form.retTime; rows.push(['Hora del vuelo de regreso', fmtTime(base.retTime), fmtTime(form.retTime)]); }
      if (rows.length > n) tipos.push('Hora');
    }
    if (form.t.destino && mode === 'full' && form.dest && form.dest !== base.dest) {
      changes.destination = form.dest;
      rows.push([hotelOnly ? 'Ciudad del hotel' : 'Destino', base.dest || '—', form.dest]);
      tipos.push('Destino');
    }
    if (form.t.equipaje && !hotelOnly && form.bag !== base.bag) {
      changes.checkedBaggage = form.bag;
      rows.push(['Maleta de bodega', base.bag ? 'Sí' : 'No', form.bag ? 'Sí' : 'No']);
      tipos.push('Equipaje');
    }
    if (form.t.hospedaje && canHotel) {
      const hn = form.hotel.replace(/\s+/g, ' ').trim().toUpperCase();
      if (hn && hn !== base.hotel) {
        changes.hotelName = hn;
        rows.push(['Hospedaje', base.hotel || '—', hn]);
        tipos.push('Hospedaje');
      }
    }
  }

  const problems: string[] = [];
  if (req && form && base) {
    if (form.t.fechas) {
      if (form.ret && form.dep && form.ret < form.dep) problems.push('El regreso no puede ser antes de la ida.');
      if (hotelOnly && form.ret && form.ret === form.dep) problems.push('La salida del hotel tiene que ser después de la entrada.');
      const target = mode === 'full' ? form.dep : form.ret;
      const baseTarget = mode === 'full' ? base.dep : base.ret;
      if (!isAdmin && target && target !== baseTarget) {
        const dl = changeDeadline(target);
        if (!dl || nowMs >= dl.ms) {
          problems.push(`La fecha nueva (${fmtDayLong(target)}) ya no da tiempo: para ese vuelo el plazo era el ${dl ? fmtDayLong(dl.dayKey) + ' a las ' + fmtHourLabel(dl.hour) : '—.'}`);
        }
      }
    }
    if (form.t.destino && mode === 'full' && !form.dest) problems.push('Elija el destino nuevo de la lista.');
    if (form.t.hospedaje && canHotel && !form.hotel.trim()) problems.push('Escriba dónde se quiere hospedar (hotel, apartamento, Airbnb…).');
    if (form.tried) {
      if (!rows.length) problems.push('Elija qué quiere cambiar y escriba el valor nuevo.');
      if (form.reason.trim().length < config.reasonMin) problems.push(`Escriba el motivo del cambio (mínimo ${config.reasonMin} caracteres).`);
    }
  }

  const derived: React.ReactNode[] = [];
  if (req && form && base) {
    const nb = base.ret ? nightsBetween(base.dep, base.ret) : (Number(req.nights) || 0);
    const na = form.ret ? nightsBetween(form.dep, form.ret) : nb;
    if (nb !== na) derived.push(<li key="n"><strong>Noches:</strong> {nb} → {na}</li>);
    if (!hotelOnly) {
      const fb = fareOptionForNights(nb), fa = fareOptionForNights(na);
      if (fa !== fb) derived.push(<li key="f"><strong>Tarifa del manual:</strong> {fareLabel(fb, req.purchaseAirline) || `TIPO ${fb}`} → {fareLabel(fa, req.purchaseAirline) || `TIPO ${fa}`}. La elige el área de compras.</li>);
      if (form.t.equipaje && form.bag && !base.bag) derived.push(<li key="b"><strong>Con maleta de bodega</strong> el área de compras elige una tarifa que la incluya.</li>);
    }
    if (req.requiresHotel && !hotelOnly && (nb !== na || (form.t.destino && form.dest !== base.dest))) {
      derived.push(<li key="h"><strong>Hotel:</strong> {form.t.destino && form.dest && form.dest !== base.dest ? `en ${form.dest}, ` : ''}{na} {na === 1 ? 'noche' : 'noches'}, ajustado a las fechas nuevas.</li>);
    }
    if (form.t.destino && form.dest && form.dest !== base.dest && countryOf(form.dest) && countryOf(form.dest) !== 'COLOMBIA') {
      derived.push(<li key="i"><strong>Viaje internacional:</strong> necesita el pasaporte de cada pasajero cargado y lo aprueban también Gerencia o Cadena de Suministro.</li>);
    }
  }
  const bagLater = !!(bought && form && base && form.t.equipaje && form.bag && !base.bag);

  const setF = (patch: Partial<FormState>) => setForm(f => (f ? { ...f, ...patch } : f));
  const toggle = (k: Toggle) => {
    if (!form) return;
    const on = !form.t[k];
    setF({ t: { ...form.t, [k]: on } });
    if (k === 'destino' && on && citiesState === 'idle') loadCities();
  };

  const submit = async () => {
    if (!req || !form || sending) return;
    const tried = { ...form, tried: true };
    setForm(tried);
    const willFail = !rows.length || form.reason.trim().length < config.reasonMin || problems.length > 0;
    if (willFail) return;
    setSending(true);
    setSendError('');
    try {
      const res = await gasService.requestTripChange(req.requestId, changes, form.reason.trim());
      setCreated(res);
      setStep('done');
      onDone();
    } catch (err) {
      setSendError(err instanceof Error && err.message ? err.message : 'Error de conexión. Intente de nuevo.');
    } finally {
      setSending(false);
    }
  };

  const choice = (k: Toggle, title: string, sub: string, disabled = false) => (
    <button
      type="button"
      key={k}
      onClick={() => toggle(k)}
      disabled={disabled}
      aria-pressed={!!form?.t[k]}
      data-change-choice={k}
      className={`text-left rounded-lg border-2 px-3 py-2.5 transition ${form?.t[k] ? 'border-brand-red bg-red-50' : 'border-gray-200 bg-white hover:border-gray-300'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span className="block font-bold text-gray-900">{title}{form?.t[k] ? ' ✓' : ''}</span>
      <span className="block text-xs text-gray-500">{sub}</span>
    </button>
  );

  const inputCls = 'mt-1 block w-full bg-white rounded-md border border-gray-300 shadow-sm focus:border-brand-red focus:ring-brand-red sm:text-sm p-2 text-gray-900';
  const todayKey = new Date(nowMs - 5 * 3600000).toISOString().slice(0, 10);

  return (
    <div className="fixed inset-0 z-[8000] flex items-center justify-center p-3 sm:p-4 bg-black/60" role="dialog" aria-modal="true" aria-labelledby="trip-change-title">
      <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[92vh] flex flex-col" data-trip-change>
        <div className="bg-amber-50 border-b border-amber-200 rounded-t-lg px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="trip-change-title" className="text-lg font-bold text-amber-950 flex items-center gap-2"><span aria-hidden="true">😕</span> Cambiar mi viaje</h2>
            <p className="text-xs text-amber-900 mt-0.5">
              {step === 'pick' ? 'Elija el viaje que quiere cambiar.' : step === 'form' && req ? `${req.requestId} · ${req.requestMode === 'HOTEL_ONLY' ? 'Hospedaje en ' + req.destination : req.origin + ' → ' + req.destination}` : 'Listo'}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={sending} className="text-gray-500 hover:text-gray-800 text-2xl leading-none" aria-label="Cerrar">×</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-4 text-sm text-gray-800">
          {step === 'pick' && (
            <>
              {!isAdmin && (
                <p className="text-xs text-gray-600" data-change-platform-first>
                  Todo cambio se pide aquí: así queda registrado y su jefe lo aprueba. Si escribe o llama, el área de compras le pedirá que lo haga por aquí.
                  Llamar es solo para cuando ya pasó el plazo y es urgente.
                </p>
              )}
              {pickList.length === 0 && (
                isAdmin
                  ? <p className="text-gray-600">No hay viajes que se puedan cambiar.</p>
                  : (
                    <>
                      <p className="text-gray-600">No tiene viajes que se puedan cambiar.</p>
                      <TripChangeContactsBox config={config} title="Si ya pasó el plazo y es urgente" />
                    </>
                  )
              )}
              <ul className="space-y-2">
                {pickList.map(({ r, e }) => (
                  <li key={r.requestId} className={`border rounded-lg p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 ${e.ok ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-200'}`} data-change-pick={r.requestId}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{r.requestId}</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{isTripBought(r) ? 'TIQUETE COMPRADO' : r.status}</span>
                      </div>
                      <p className="font-bold text-gray-900 mt-1">{r.requestMode === 'HOTEL_ONLY' ? `Hospedaje en ${r.destination}` : `${r.origin} → ${r.destination}`}</p>
                      <p className="text-xs text-gray-500">
                        {r.requestMode === 'HOTEL_ONLY' ? 'Entrada' : 'Ida'} {fmtDayLong(toDateKey(r.departureDate))}
                        {r.returnDate ? ` · ${r.requestMode === 'HOTEL_ONLY' ? 'Salida' : 'Regreso'} ${fmtDayLong(toDateKey(r.returnDate))}` : ' · Solo ida'}
                      </p>
                      <p className={`text-xs font-semibold mt-1 ${e.ok ? (e.win && e.win.deadlineKey === todayKey ? 'text-amber-700' : 'text-green-700') : 'text-red-700'}`}>
                        {e.ok && e.win
                          ? (isAdmin ? 'Usted puede registrarlo sin plazo.' : (e.win.mode === 'return' ? 'La ida ya voló. Puede cambiar el regreso ' : 'Puede pedir el cambio ') + withDot(untilText(e.win, nowMs)))
                          : e.why}
                      </p>
                    </div>
                    {e.ok
                      ? <button type="button" onClick={() => { setReq(r); setForm(null); setStep('form'); }} className="bg-brand-red text-white px-3 py-2 rounded text-xs font-bold uppercase tracking-wide hover:bg-red-700 shrink-0">Cambiar este viaje</button>
                      : <span className="text-[10px] font-bold uppercase text-gray-400 shrink-0">No disponible</span>}
                  </li>
                ))}
              </ul>
              {!isAdmin && pickList.some(x => !x.e.ok) && (
                <TripChangeContactsBox config={config} title="¿Un viaje ya no se puede cambiar aquí y es urgente?" />
              )}
            </>
          )}

          {step === 'form' && req && form && base && elig && (
            <>
              {!elig.ok && (
                <div className="bg-red-50 border border-red-200 text-red-800 rounded-md p-3">
                  <strong>No se puede pedir este cambio:</strong> {elig.why}
                  {!isAdmin && <> Si es urgente, <TripChangeContactsInline config={config} />.</>}
                </div>
              )}
              {isAdmin && travelerWin && travelerWin.open && (
                <div className="bg-amber-50 border border-amber-300 text-amber-950 rounded-md p-3 text-xs" data-change-traveler-can>
                  <strong>El viajero todavía puede pedirlo él mismo</strong> con «Cambiar mi viaje», {withDot(untilText(travelerWin, nowMs))}{' '}
                  Si le escribió o llamó, pídale que lo haga por la plataforma: así queda con su motivo y a su nombre. Regístrelo usted solo si es urgente.
                </div>
              )}
              {isAdmin && String(req.requesterEmail || '').toLowerCase() && (
                <div className="bg-blue-50 border border-blue-200 text-blue-900 rounded-md p-3 text-xs">
                  Registra el cambio a nombre de <strong>{req.requesterEmail}</strong>, sin plazo. Queda constancia de que lo registró usted.
                  {onOpenFullForm && (
                    <> ¿Hay que cambiar pasajeros, el centro de costo o el hotel? <button type="button" className="underline font-semibold" onClick={() => onOpenFullForm(req)}>Use el formulario completo</button>.</>
                  )}
                </div>
              )}
              {bought ? (
                <div className="bg-amber-50 border-l-4 border-amber-500 rounded-md p-3 text-amber-950">
                  <strong>{hotelOnly ? 'El hospedaje ya está reservado.' : 'El tiquete ya está comprado.'}</strong> Cambiarlo puede tener costo ({hotelOnly ? 'penalidad del hotel y diferencia de tarifa' : 'penalidad de la aerolínea y diferencia de tarifa'}) y lo aprueba
                  {' '}{req.approverName ? <strong>{req.approverName}</strong> : 'su aprobador'}, que verá cuánto costó el viaje
                  {Number(req.totalCost) > 0 ? <> (${formatCop(Number(req.totalCost))} cotizado)</> : null} y cuánto suma el cambio.
                </div>
              ) : (
                <div className="bg-blue-50 border-l-4 border-blue-400 rounded-md p-3 text-blue-950">
                  <strong>{hotelOnly ? 'El hospedaje aún no se ha reservado.' : 'El tiquete aún no se ha comprado.'}</strong> El área de compras cotiza de nuevo con los cambios. No hay penalidad.
                </div>
              )}
              {mode === 'return' && (
                <div className="bg-blue-50 border-l-4 border-blue-400 rounded-md p-3 text-blue-950">
                  <strong>{hotelOnly ? `El hospedaje ya empezó (${fmtDayLong(base.dep)}).` : `La ida ya voló (${fmtDayLong(base.dep)}).`}</strong>{' '}
                  {hotelOnly ? 'Puede cambiar la salida o el hospedaje.' : 'Puede cambiar el regreso: fecha, hora o equipaje.'}
                </div>
              )}

              <div>
                <p className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-2">1. ¿Qué quiere cambiar? Puede elegir varias.</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {choice('fechas', 'Fechas', hotelOnly ? 'Entrada o salida' : mode === 'return' ? 'Del regreso' : 'Ida o regreso')}
                  {!hotelOnly && choice('horas', 'Horas', mode === 'return' ? 'Del vuelo de regreso' : 'De los vuelos')}
                  {choice('destino', hotelOnly ? 'Ciudad' : 'Destino', mode === 'return' ? 'No, con el viaje en curso' : `Actual: ${(base.dest.split(',')[0] || '').trim()}`, mode === 'return')}
                  {!hotelOnly && choice('equipaje', 'Equipaje', 'Maleta de bodega')}
                  {canHotel && choice('hospedaje', 'Hospedaje', hotelOnly ? 'Hotel, apartamento, Airbnb…' : 'Cambiar el hotel')}
                </div>
                <p className="text-xs text-gray-500 mt-2">Si necesita cambiar algo más (por ejemplo, quitar el hospedaje), escríbalo en el motivo. Para cambiar a quien viaja, pida una solicitud nueva.</p>
              </div>

              {form.t.fechas && (
                <fieldset className="border border-gray-200 rounded-md p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <legend className="text-xs font-bold text-gray-700 px-1">Fechas</legend>
                  {mode === 'full' ? (
                    <label className="block text-xs font-semibold text-gray-600">
                      {hotelOnly ? 'Nueva entrada al hotel' : 'Nueva fecha de ida'}
                      <DateInput dataAttrs={{ 'data-change-field': 'dep' }} min={isAdmin ? undefined : todayKey} className={inputCls} value={form.dep} onChange={v => setF({ dep: v })} />
                      <DateHint value={form.dep} before={base.dep} />
                    </label>
                  ) : (
                    <p className="text-xs text-gray-600"><span className="font-semibold block">Ida</span>Ya voló el {fmtDayLong(base.dep)}.</p>
                  )}
                  {base.ret ? (
                    <label className="block text-xs font-semibold text-gray-600">
                      {hotelOnly ? 'Nueva salida del hotel' : 'Nueva fecha de regreso'}
                      <DateInput dataAttrs={{ 'data-change-field': 'ret' }} min={form.dep || todayKey} className={inputCls} value={form.ret} onChange={v => setF({ ret: v })} />
                      <DateHint value={form.ret} before={base.ret} />
                    </label>
                  ) : (
                    <p className="text-xs text-gray-500">Viaje solo de ida: para agregar un regreso pida una solicitud nueva.</p>
                  )}
                </fieldset>
              )}

              {form.t.horas && !hotelOnly && (
                <fieldset className="border border-gray-200 rounded-md p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <legend className="text-xs font-bold text-gray-700 px-1">Horas</legend>
                  {mode === 'full' && (
                    <label className="block text-xs font-semibold text-gray-600">
                      Hora del vuelo de ida
                      <TimeInput dataAttrs={{ 'data-change-field': 'depTime' }} className={inputCls} value={form.depTime} onChange={v => setF({ depTime: v })} ariaLabel="Hora nueva del vuelo de ida" />
                      <TimeHint value={form.depTime} before={base.depTime} />
                    </label>
                  )}
                  {base.ret && (
                    <label className="block text-xs font-semibold text-gray-600">
                      Hora del vuelo de regreso
                      <TimeInput dataAttrs={{ 'data-change-field': 'retTime' }} className={inputCls} value={form.retTime} onChange={v => setF({ retTime: v })} ariaLabel="Hora nueva del vuelo de regreso" />
                      <TimeHint value={form.retTime} before={base.retTime} />
                    </label>
                  )}
                </fieldset>
              )}

              {form.t.destino && mode === 'full' && (
                <fieldset className="border border-gray-200 rounded-md p-3">
                  <legend className="text-xs font-bold text-gray-700 px-1">{hotelOnly ? 'Ciudad' : 'Destino'}</legend>
                  {citiesState === 'error' ? (
                    <p className="text-xs text-red-700">No se pudo cargar la lista de ciudades. <button type="button" className="underline font-semibold" onClick={loadCities}>Reintentar</button></p>
                  ) : (
                    <>
                      <CityCombobox name="dest" value={form.dest === base.dest ? '' : form.dest} cities={cities} isLoading={citiesState === 'loading'} onChange={(_n, v) => setF({ dest: v || base.dest })} />
                      <p className="text-xs text-gray-400 mt-1">Destino actual: {base.dest}{req.origin && !hotelOnly ? ` · Origen: ${req.origin}` : ''}</p>
                    </>
                  )}
                </fieldset>
              )}

              {form.t.hospedaje && canHotel && (
                <fieldset className="border border-gray-200 rounded-md p-3">
                  <legend className="text-xs font-bold text-gray-700 px-1">Hospedaje</legend>
                  <label className="block text-xs text-gray-600 mb-1" htmlFor="tc-hotel">¿Dónde se quiere hospedar?</label>
                  <input
                    id="tc-hotel"
                    type="text"
                    maxLength={200}
                    data-change-hotel
                    className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm uppercase"
                    placeholder="Ej.: AIRBNB CENTRO, HOTEL MOVICH, APARTAMENTO…"
                    value={form.hotel}
                    onChange={e => setF({ hotel: e.target.value.toUpperCase() })}
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Actual: {base.hotel || '— sin hospedaje definido —'}. Escriba el nombre o el tipo; el área de compras cotiza y confirma.
                  </p>
                </fieldset>
              )}

              {form.t.equipaje && !hotelOnly && (
                <fieldset className="border border-gray-200 rounded-md p-3">
                  <legend className="text-xs font-bold text-gray-700 px-1">Equipaje</legend>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="checkbox" data-change-field="bag" className="mt-1 accent-red-700" checked={form.bag} onChange={e => setF({ bag: e.target.checked })} />
                    <span>Necesito maleta de bodega<br /><span className="text-xs text-gray-500">Su viaje va {base.bag ? 'con' : 'sin'} maleta de bodega. La tarifa la elige el área de compras según el manual; si pide maleta, elige una que la incluya.</span></span>
                  </label>
                </fieldset>
              )}

              {derived.length > 0 && (
                <div className="bg-gray-50 border border-gray-200 rounded-md p-3">
                  <p className="font-bold text-gray-800 mb-1">Lo que cambia con esto</p>
                  <ul className="list-disc pl-5 space-y-0.5">{derived}</ul>
                </div>
              )}
              {bagLater && (
                <div className="bg-amber-50 border border-amber-300 rounded-md p-3 text-amber-950" data-change-bag-later>
                  <strong>Agregar la maleta ahora cuesta más que haberla pedido al crear la solicitud.</strong> Se paga la diferencia de tarifa y la penalidad del cambio. Para el próximo viaje, márquela desde el principio.
                </div>
              )}

              <div>
                <p className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">Así queda su cambio</p>
                {rows.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse" data-change-summary>
                      <thead><tr className="text-left text-[11px] uppercase text-gray-500"><th className="py-1 pr-2 border-b-2">Qué</th><th className="py-1 pr-2 border-b-2">Antes</th><th className="py-1 border-b-2">Ahora</th></tr></thead>
                      <tbody>
                        {rows.map(rw => (
                          <tr key={rw[0]}><td className="py-1.5 pr-2 border-b">{rw[0]}</td><td className="py-1.5 pr-2 border-b text-gray-500">{rw[1]}</td><td className="py-1.5 border-b font-bold bg-amber-50">{rw[2]}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="text-xs text-gray-500">Elija arriba qué quiere cambiar y escriba el valor nuevo.</p>}
              </div>

              <label className="block">
                <span className="text-xs font-bold text-gray-600 uppercase tracking-wide">2. Motivo del cambio (obligatorio)</span>
                <textarea
                  data-change-field="reason"
                  className={inputCls + ' min-h-[4.5rem]'}
                  maxLength={config.reasonMax}
                  placeholder="Ej.: La reunión con el cliente se movió al sábado."
                  value={form.reason}
                  onChange={e => setF({ reason: e.target.value })}
                />
                <span className="block text-right text-[11px] text-gray-400">{form.reason.trim().length} / {config.reasonMax}</span>
              </label>

              {problems.length > 0 && (
                <ul className="bg-red-50 text-red-800 rounded-md p-3 pl-7 list-disc space-y-0.5" role="alert" data-change-problems>
                  {problems.map(pr => <li key={pr}>{pr}</li>)}
                </ul>
              )}
              {sendError && <div className="bg-red-50 border border-red-200 text-red-800 rounded-md p-3" role="alert" data-change-error>{sendError}</div>}
            </>
          )}

          {step === 'done' && created && req && (
            <div className="space-y-3" data-change-done>
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-full bg-green-600 text-white grid place-items-center text-xl font-bold" aria-hidden="true">✓</span>
                <div>
                  <p className="text-base font-bold text-gray-900">Su cambio quedó enviado</p>
                  <p className="text-xs text-gray-500">Solicitud de cambio <span className="font-mono">{created.id}</span> · reemplaza a <span className="font-mono">{created.parentId}</span></p>
                </div>
              </div>
              <div>
                <p className="font-bold text-gray-800">Qué sigue</p>
                <ol className="list-decimal pl-5 space-y-0.5">
                  <li>El área de compras revisa su cambio{created.comprado ? ' y se lo pide a la agencia' : ''}.</li>
                  <li>Le llegan por correo las opciones {created.comprado ? 'del cambio' : 'nuevas'} y usted describe cuál elige, como siempre.</li>
                  <li>Su aprobador aprueba {created.comprado ? 'el costo del cambio' : 'el viaje'}.</li>
                  <li>Recibe {hotelOnly ? (created.comprado ? 'la reserva nueva' : 'la reserva') : (created.comprado ? 'el tiquete nuevo' : 'los tiquetes')} por correo.</li>
                </ol>
              </div>
              {created.comprado && <p className="bg-blue-50 border border-blue-200 text-blue-900 rounded-md p-3">Hasta que reciba {hotelOnly ? 'la reserva nueva, la que tiene sigue siendo la válida' : 'el tiquete nuevo, el que tiene sigue siendo el válido'}.</p>}
            </div>
          )}
        </div>

        <div className="border-t px-5 py-3 flex flex-wrap justify-end gap-2 bg-gray-50 rounded-b-lg">
          {step === 'form' && !initialRequest && (
            <button type="button" onClick={() => { setStep('pick'); setReq(null); setForm(null); setSendError(''); }} disabled={sending} className="mr-auto text-sm text-gray-600 hover:text-gray-900 underline">← Elegir otro viaje</button>
          )}
          {step === 'done' ? (
            <button type="button" onClick={onClose} className="bg-gray-900 text-white px-4 py-2 rounded text-xs font-bold uppercase tracking-wide">Listo</button>
          ) : (
            <button type="button" onClick={onClose} disabled={sending} className="px-4 py-2 rounded border border-gray-300 text-gray-700 text-xs font-bold uppercase tracking-wide bg-white">Cancelar</button>
          )}
          {step === 'form' && elig?.ok && (
            <button type="button" onClick={submit} disabled={sending} data-change-submit className="bg-brand-red text-white px-4 py-2 rounded text-xs font-bold uppercase tracking-wide hover:bg-red-700 disabled:opacity-60">
              {sending ? 'Enviando…' : 'Enviar el cambio'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
