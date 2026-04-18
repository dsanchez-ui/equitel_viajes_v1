import React, { useEffect, useState } from 'react';
import { Layout } from './components/Layout';
import { RequestForm } from './components/RequestForm';
import { AdminDashboard } from './components/AdminDashboard';
import { UserDashboard } from './components/UserDashboard';
import { RequestDetail } from './components/RequestDetail';
import { PinEntryModal } from './components/PinEntryModal';
import { gasService, setOnSessionExpired, setOnHealthChange } from './services/gasService';
import { TravelRequest, UserRole, Integrant } from './types';
import { LOGO_URL, APP_VERSION } from './constants';

const POLL_INTERVAL_MS = 15000;
const SESSION_STORAGE_KEY = 'equitel_session';

type StoredRole = 'REQUESTER' | 'ANALYST' | 'SUPERADMIN';

interface StoredSession {
  email: string;
  token: string;
  expiresAt: number;
  role: StoredRole;
}

const readStoredSession = (): StoredSession | null => {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.email || !parsed.token) return null;
    if (parsed.expiresAt && Date.now() > Number(parsed.expiresAt)) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeStoredSession = (s: StoredSession) => {
  try { localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(s)); } catch { /* noop */ }
};

const clearStoredSession = () => {
  try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch { /* noop */ }
};

const App: React.FC = () => {
  const [userEmail, setUserEmail] = useState<string>('');
  const [userName, setUserName] = useState<string>('Integrante Equitel');

  const [view, setView] = useState<'LIST' | 'NEW' | 'ADMIN'>('LIST');
  const [requests, setRequests] = useState<TravelRequest[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<TravelRequest | null>(null);

  // Modification State
  const [modificationRequest, setModificationRequest] = useState<TravelRequest | null>(null);

  const [integrantes, setIntegrantes] = useState<Integrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchingData, setFetchingData] = useState(false);
  const [role, setRole] = useState<UserRole>(UserRole.REQUESTER);
  // Permite a un analista ver su propio dashboard de usuario (para crear
  // solicitudes propias). true = ver como usuario, false = ver como admin.
  // Solo aplica cuando role === ANALYST; si role es REQUESTER, se ignora.
  const [viewAsRequester, setViewAsRequester] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [loginEmailInput, setLoginEmailInput] = useState('');
  const [showPinModal, setShowPinModal] = useState(false);
  const [pendingAdminEmail, setPendingAdminEmail] = useState('');

  // User PIN flow state
  const [showUserPinModal, setShowUserPinModal] = useState(false);
  const [pendingPinEmail, setPendingPinEmail] = useState('');
  const [pinFlowMessage, setPinFlowMessage] = useState('');
  const [pinFlowKind, setPinFlowKind] = useState<'existing' | 'sent'>('sent');
  const [loginBusy, setLoginBusy] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);

  // Health monitoring: el banner aparece SOLO cuando hay fallos de transporte
  // (red caída, GAS caído, 5xx). Errores lógicos del backend no lo disparan.
  const [systemHealth, setSystemHealth] = useState<'ok' | 'down'>('ok');

  // Listen for session expiry events from gasService
  useEffect(() => {
    setOnSessionExpired(() => {
      clearStoredSession();
      setUserEmail('');
      gasService.clearSession();
      setRequests([]);
      setRole(UserRole.REQUESTER);
      setView('LIST');
      setLoading(false);
      alert('Tu sesión ha expirado. Por favor inicia sesión nuevamente.');
    });
    return () => setOnSessionExpired(null);
  }, []);

  // Listen for health changes from gasService (transport failures only)
  useEffect(() => {
    setOnHealthChange((status) => setSystemHealth(status));
    return () => setOnHealthChange(null);
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const stored = readStoredSession();
        if (!stored) {
          setLoading(false);
          return;
        }
        // Validate session against backend
        gasService.setUserEmail(stored.email);
        gasService.setSessionToken(stored.token);
        const validation = await gasService.validateSession(stored.email, stored.token);
        if (!validation.valid) {
          clearStoredSession();
          gasService.clearSession();
          setLoading(false);
          return;
        }
        // Session OK → load integrantes (now session-protected) and finish login
        const loadedIntegrantes = await gasService.getIntegrantesData();
        setIntegrantes(loadedIntegrantes);
        await handleLoginSuccess(stored.email, (validation.role as StoredRole) || 'REQUESTER', loadedIntegrantes);
      } catch (err) {
        console.error("Init failed", err);
        clearStoredSession();
        gasService.clearSession();
        setLoading(false);
      }
    };
    init();
  }, []);

  // Modo efectivo: analista/superadmin viendo como usuario → fetch como usuario.
  // Un SUPERADMIN ES un ANALYST con extras (herencia), así que en modo admin
  // ambos roles tienen acceso al dashboard de admin.
  const isAdminRole = role === UserRole.ANALYST || role === UserRole.SUPERADMIN;
  const isEffectiveAdmin = isAdminRole && !viewAsRequester;
  // Solo los superadmin tienen capacidades extra (saltar selección, etc.).
  const isEffectiveSuperAdmin = role === UserRole.SUPERADMIN && !viewAsRequester;

  useEffect(() => {
    if (!userEmail) return;
    // SECURITY/RACE (#A3): capturamos snapshot de los valores AL momento de
    // disparar el tick, y al terminar comparamos con los actuales. Si el
    // usuario alternó viewAsRequester durante el tick en vuelo, el resultado
    // corresponde a la vista anterior — no lo aplicamos para evitar mostrar
    // lista de otra vista. `mounted` evita setState sobre componente desmontado.
    let mounted = true;
    const intervalId = setInterval(async () => {
      const snapshotAdmin = isEffectiveAdmin;
      setIsSyncing(true);
      try {
        await fetchRequests(userEmail, snapshotAdmin, true, () => mounted && snapshotAdmin === isEffectiveAdmin);
      } finally {
        if (mounted) setIsSyncing(false);
      }
    }, POLL_INTERVAL_MS);
    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, [userEmail, role, viewAsRequester]);

  const determineUserName = (email: string, currentIntegrantes: Integrant[] = []) => {
    // Defensive: si integrantes tiene filas con email/name undefined, no queremos
    // que .toLowerCase() lance TypeError y tumbe el flujo de login.
    try {
      const target = String(email || '').toLowerCase();
      const found = currentIntegrantes.find(i => i && i.email && String(i.email).toLowerCase() === target);
      if (found && found.name) return `Hola, ${String(found.name).toUpperCase()}`;
    } catch (e) {
      console.warn('determineUserName error:', e);
    }
    return "Hola, Integrante Equitel";
  };

  const handleLoginSuccess = async (email: string, storedRole: StoredRole = 'REQUESTER', preloadedIntegrantes?: Integrant[]) => {
    // CRÍTICO: toda la función está envuelta en try/finally para GARANTIZAR
    // que setLoading(false) siempre se ejecute, aun si alguna operación lanza
    // una excepción inesperada. Sin esto, el usuario podría quedar atrapado
    // en un spinner infinito.
    setLoading(true);
    let finalRole: StoredRole = storedRole;
    try {
      gasService.setUserEmail(email);
      const list = preloadedIntegrantes || integrantes;

      // DEFENSE-IN-DEPTH: si la sesión dice que somos admin (ANALYST o SUPERADMIN),
      // re-confirmar contra el backend con checkIsAnalyst. Si el backend dice que
      // NO, rebajar a REQUESTER (caso donde alguien fue removido de ANALYST_EMAILS
      // pero la sesión vieja aún tiene rol admin guardado). Un superadmin también
      // pasa checkIsAnalyst porque isUserAnalyst hereda superadmin (backend).
      if (storedRole === 'ANALYST' || storedRole === 'SUPERADMIN') {
        try {
          const confirmedAnalyst = await gasService.checkIsAnalyst(email);
          if (!confirmedAnalyst) {
            console.warn('Session role was admin but backend downgraded to REQUESTER.');
            finalRole = 'REQUESTER';
          }
        } catch (err) {
          console.error('checkIsAnalyst failed during login, defaulting to REQUESTER:', err);
          finalRole = 'REQUESTER';
        }
      }

      const isAdmin = finalRole === 'ANALYST' || finalRole === 'SUPERADMIN';
      // Pre-cargar los requests silenciosamente (fetchRequests ya tiene su propio
      // try/catch, nunca re-lanza). Así, cuando el dashboard aparezca, ya tendrá
      // datos sin mostrar el indicador interno de fetching (tenemos el spinner).
      await fetchRequests(email, isAdmin, true);

      // Batch de state updates finales: React 18 los procesa en un solo render,
      // así que la transición de spinner → dashboard correcto es atómica.
      const nextRole = finalRole === 'SUPERADMIN' ? UserRole.SUPERADMIN
                     : finalRole === 'ANALYST' ? UserRole.ANALYST
                     : UserRole.REQUESTER;
      setRole(nextRole);
      setViewAsRequester(false);
      setUserName(determineUserName(email, list));
      setUserEmail(email);
    } catch (err) {
      // Fallback defensivo: si algo inesperado se rompe (p.ej. data malformada),
      // limpia la sesión y devuelve al usuario al login para que reintente en
      // lugar de dejarlo en un estado híbrido inconsistente.
      console.error('handleLoginSuccess failed:', err);
      clearStoredSession();
      gasService.clearSession();
      setUserEmail('');
      setRequests([]);
      setRole(UserRole.REQUESTER);
      setViewAsRequester(false);
      alert('No se pudo completar el inicio de sesión. Por favor intenta de nuevo.');
    } finally {
      // SIEMPRE apaga el spinner — no importa qué haya pasado arriba.
      setLoading(false);
    }
  };

  const handleRequesterLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailLower = loginEmailInput.toLowerCase().trim();
    if (!emailLower || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
      alert('Por favor ingresa un correo válido.');
      return;
    }
    setLoginBusy(true);
    try {
      const result = await gasService.requestUserPin(emailLower, false);
      setPendingPinEmail(emailLower);
      if (result.hasExistingPin) {
        setPinFlowKind('existing');
        setPinFlowMessage(
          `Ya tienes un PIN configurado para ${result.maskedEmail}. Ingresa el PIN que recibiste anteriormente. Si no lo recuerdas, usa "Reenviar PIN" para generar uno nuevo.`
        );
      } else if (result.isFirstTime) {
        setPinFlowKind('sent');
        setPinFlowMessage(
          `Es tu primera vez ingresando. Te enviamos tu PIN inicial de 8 dígitos a ${result.maskedEmail}.`
        );
      } else {
        setPinFlowKind('sent');
        setPinFlowMessage(
          `Te enviamos un PIN de 8 dígitos a ${result.maskedEmail}.`
        );
      }
      setShowUserPinModal(true);
    } catch (err: any) {
      const msg = String(err?.message || '');
      // Si el backend marca el correo como admin-only, abrimos el flujo dedicado
      // automáticamente para no dejar al administrador colgado con un error.
      if (msg.indexOf('ADMIN_REDIRECT') >= 0) {
        setPendingAdminEmail(emailLower);
        setShowPinModal(true);
      } else {
        alert(msg || 'No se pudo enviar el PIN. Intenta nuevamente.');
      }
    } finally {
      setLoginBusy(false);
    }
  };

  const handleUserPinSubmit = async (pin: string): Promise<boolean> => {
    try {
      const result = await gasService.verifyUserPin(pendingPinEmail, pin);
      if (!result.success || !result.token) return false;

      // Persist session
      const session: StoredSession = {
        email: pendingPinEmail,
        token: result.token,
        expiresAt: result.expiresAt || (Date.now() + 30 * 24 * 60 * 60 * 1000),
        role: (result.role as StoredRole) || 'REQUESTER'
      };
      writeStoredSession(session);
      gasService.setUserEmail(pendingPinEmail);
      gasService.setSessionToken(result.token);

      // Now we can load integrantes (session-protected endpoint)
      const loadedIntegrantes = await gasService.getIntegrantesData();
      setIntegrantes(loadedIntegrantes);

      setShowUserPinModal(false);
      setPendingPinEmail('');
      setPinFlowMessage('');
      await handleLoginSuccess(pendingPinEmail, session.role, loadedIntegrantes);
      return true;
    } catch (err: any) {
      console.error('verifyUserPin error', err);
      return false;
    }
  };

  const handleResendUserPin = async () => {
    if (!pendingPinEmail) return;
    const result = await gasService.requestUserPin(pendingPinEmail, true);
    setPinFlowKind('sent');
    setPinFlowMessage(
      `Te enviamos un nuevo PIN de 8 dígitos a ${result.maskedEmail}. El PIN anterior ya no es válido.`
    );
  };

  const handleAdminLoginClick = async () => {
    const emailToUse = loginEmailInput.trim();
    if (!emailToUse) {
      alert('Por favor ingrese su correo corporativo de administrador.');
      return;
    }
    // CRÍTICO: setAdminBusy da retroalimentación visual inmediata ("VERIFICANDO...").
    // Sin esto, en Safari iPhone el botón parecía no responder durante la latencia
    // de checkIsAnalyst (puede tardar varios segundos en cold-start de GAS).
    setAdminBusy(true);
    try {
      // RETRY: reintentamos una sola vez si el primer intento falla — cubre
      // cold start de GAS donde la primera llamada toma 8-15s y puede abortar
      // antes de que el servidor esté listo. Segunda llamada casi siempre OK.
      let isAnalyst: boolean;
      try {
        isAnalyst = await gasService.checkIsAnalyst(emailToUse);
      } catch (firstErr) {
        console.warn('checkIsAnalyst primer intento falló, reintentando:', firstErr);
        await new Promise(r => setTimeout(r, 800));
        isAnalyst = await gasService.checkIsAnalyst(emailToUse);
      }
      if (isAnalyst) {
        setPendingAdminEmail(emailToUse);
        setShowPinModal(true);
      } else {
        // SOLO aquí, con respuesta CONFIRMADA del backend de que NO es analista,
        // mostramos el mensaje de "no tiene permisos". Antes, cualquier error
        // de red se confundía con "no es analista" (bug crítico).
        alert('El correo ingresado no tiene permisos de administrador.');
      }
    } catch (err: any) {
      console.error('handleAdminLoginClick error:', err);
      alert('Error de conexión al verificar permisos. Verifique su internet y vuelva a intentar. Si persiste, intente dentro de 1 minuto (el servidor puede estar arrancando).');
    } finally {
      setAdminBusy(false);
    }
  };

  const handlePinSubmit = async (pin: string): Promise<boolean> => {
    try {
      const result = await gasService.verifyAdminPin(pin, pendingAdminEmail);
      if (!result.success || !result.token) return false;

      const sessionRole: StoredRole = (result.role as StoredRole) || 'ANALYST';
      const session: StoredSession = {
        email: pendingAdminEmail,
        token: result.token,
        expiresAt: result.expiresAt || (Date.now() + 30 * 24 * 60 * 60 * 1000),
        role: sessionRole
      };
      writeStoredSession(session);
      gasService.setUserEmail(pendingAdminEmail);
      gasService.setSessionToken(result.token);

      const loadedIntegrantes = await gasService.getIntegrantesData();
      setIntegrantes(loadedIntegrantes);

      setShowPinModal(false);
      await handleLoginSuccess(pendingAdminEmail, sessionRole, loadedIntegrantes);
      return true;
    } catch (e) {
      console.error('verifyAdminPin error', e);
      return false;
    }
  };

  const handleLogout = () => {
    // Best-effort backend logout (does not block UI)
    gasService.logout().catch(() => { /* noop */ });
    clearStoredSession();

    setUserEmail('');
    gasService.clearSession();
    setRequests([]);
    setRole(UserRole.REQUESTER);
    setViewAsRequester(false);
    setLoginEmailInput('');

    // RESET STATE to avoid ghosts on re-login
    setView('LIST');
    setModificationRequest(null);
    setSelectedRequest(null);

    window.location.hash = '';
  };

  const fetchRequests = async (
    email: string,
    isAdmin: boolean,
    silent: boolean = false,
    stillValid: () => boolean = () => true
  ) => {
    if (!silent) setFetchingData(true);
    try {
      const data = isAdmin ? await gasService.getAllRequests(email) : await gasService.getMyRequests(email);
      // RACE (#A3): si durante el fetch el usuario alternó vista (admin↔user)
      // o el componente se desmontó, descartamos el resultado para no
      // sobreescribir el estado actual con la lista de la vista anterior.
      if (!stillValid()) {
        return;
      }
      // DEFENSIVA 1: si el backend devuelve algo que no es array (undefined, null,
      // objeto de error), NO sobreescribir el estado. Mantiene la lista previa.
      if (!Array.isArray(data)) {
        console.warn('fetchRequests: respuesta no es array, se preserva estado anterior', data);
        return;
      }
      // DEFENSIVA 2: durante auto-refresh silencioso, si la respuesta viene vacía
      // pero la lista previa tenía datos, es casi seguro un hiccup transitorio
      // (cold start, timeout parcial, red). No vaciamos la UI — el admin veía 30
      // solicitudes y de repente ninguna es una experiencia aterrorizante. Si el
      // admin quiere confirmar vaciado real, usa el botón Refrescar manual.
      if (silent && data.length === 0) {
        setRequests(prev => (prev.length > 0 ? prev : data));
        return;
      }
      setRequests(data);
    } catch (e) { console.error(e); } finally { if (!silent) setFetchingData(false); }
  };

  const handleManualRefresh = async () => {
    await fetchRequests(userEmail, isEffectiveAdmin, false);
  };

  const handleToggleView = async () => {
    const next = !viewAsRequester;

    // DEFENSE-IN-DEPTH: antes de cambiar a vista admin, re-verificar con el
    // backend que el usuario SIGUE siendo analyst. Esto previene que alguien
    // con React DevTools manipule el state `role` en memoria para acceder al
    // dashboard admin. Si el backend dice que NO es analyst, forzar logout.
    if (!next) {
      // next=false significa "cambiar a vista admin"
      const _isAdminLike = role === UserRole.ANALYST || role === UserRole.SUPERADMIN;
      if (!_isAdminLike) {
        // Sanity check adicional — no debería ni mostrarse el botón en este caso
        alert('No tienes permisos de administrador.');
        return;
      }
      try {
        const stillAnalyst = await gasService.checkIsAnalyst(userEmail);
        if (!stillAnalyst) {
          alert('Tus permisos de administrador han cambiado. Se cerrará la sesión por seguridad.');
          handleLogout();
          return;
        }
      } catch (err) {
        alert('No se pudo verificar tus permisos. Intenta de nuevo.');
        return;
      }
    }

    setViewAsRequester(next);
    // Reset view state to LIST al cambiar de modo para no dejar forms colgados
    setView('LIST');
    setSelectedRequest(null);
    setModificationRequest(null);
    // Refetch con el modo opuesto
    await fetchRequests(userEmail, role === UserRole.ANALYST && next === false, false);
  };

  // --- MODIFICATION FLOW ---
  const handleRequestModification = (req: TravelRequest) => {
    setSelectedRequest(null); // Close detail modal
    setModificationRequest(req); // Set context
    setView('NEW'); // Go to form view
  };

  const handleFormCancel = () => {
    setModificationRequest(null);
    setView('LIST');
  };

  const handleFormSuccess = () => {
    setModificationRequest(null);
    setView('LIST');
    handleManualRefresh();
  };

  // Banner global de salud del sistema. Solo se renderiza cuando systemHealth
  // === 'down' — si está 'ok', retorna null (cero impacto visual). Posición
  // fixed top-0, z-index muy alto → NUNCA desplaza ni se superpone bajo otro
  // contenido. Pointer-events: auto en el banner para que el link sea clickeable.
  const healthBanner = systemHealth === 'down' ? (
    <div
      role="alert"
      aria-live="polite"
      className="fixed top-0 left-0 right-0 z-[10000] bg-red-700 text-white shadow-2xl border-b-2 border-red-900"
    >
      <div className="max-w-5xl mx-auto px-3 py-2 sm:px-4 flex items-start gap-2 text-xs sm:text-sm leading-snug">
        <span className="text-base sm:text-lg flex-shrink-0 mt-0.5" aria-hidden="true">⚠️</span>
        <div className="flex-1">
          <strong className="font-bold">Sistema presentando fallas de conectividad.</strong>{' '}
          <span className="opacity-95">
            Probablemente sea una <strong>falla del servicio de Google Apps Script</strong> (no del Portal de Viajes). Verifícalo en{' '}
            <a
              href="https://www.google.com/appsstatus/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold hover:text-red-100 break-all"
            >
              google.com/appsstatus
            </a>{' '}
            o reintenta en un momento.
          </span>
        </div>
      </div>
    </div>
  ) : null;

  // Spinner mientras loading esté activo — sin importar si userEmail ya se seteó.
  // Esto previene el "flash" de dashboard equivocado cuando se está validando la
  // sesión de un analyst (orden: setUserEmail → render intermedio con role=REQUESTER
  // → setRole(ANALYST) → render correcto). Ahora loading cubre todo el proceso.
  if (loading) {
    return (
      <>
        {healthBanner}
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-red mx-auto"></div>
            <p className="mt-4 text-gray-500">Conectando...</p>
          </div>
        </div>
      </>
    );
  }

  if (!userEmail) {
    return (
      <>
        {healthBanner}
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        {showPinModal && (
          <PinEntryModal
            isOpen={showPinModal}
            title="PIN de Administrador"
            associatedEmail={pendingAdminEmail}
            onClose={() => setShowPinModal(false)}
            onSubmit={handlePinSubmit}
          />
        )}
        {showUserPinModal && (
          <PinEntryModal
            isOpen={showUserPinModal}
            title="Ingresa tu PIN de acceso"
            subtitle="Para proteger tu información, ingresa el PIN de 8 dígitos asociado a tu cuenta."
            associatedEmail={pendingPinEmail}
            infoBox={
              pinFlowKind === 'existing' ? (
                <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900 text-left">
                  <p className="font-bold mb-1">🔑 PIN ya configurado</p>
                  <p>{pinFlowMessage}</p>
                </div>
              ) : (
                <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-800 text-left">
                  <p className="font-bold mb-1">📧 PIN enviado</p>
                  <p>{pinFlowMessage}</p>
                  <p className="mt-2 text-blue-600">
                    Revisa tu bandeja de entrada y la carpeta de spam. El PIN llega en segundos.
                  </p>
                </div>
              )
            }
            onClose={() => { setShowUserPinModal(false); setPendingPinEmail(''); setPinFlowMessage(''); }}
            onSubmit={handleUserPinSubmit}
            onResend={handleResendUserPin}
          />
        )}
        <div className="bg-white p-8 rounded-lg shadow-2xl text-center max-w-md w-full border-t-8 border-brand-red">
          <div className="flex justify-center mb-6">
            <img src={LOGO_URL} alt="Organización Equitel" className="h-20 w-auto object-contain" referrerPolicy="no-referrer" />
          </div>
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight leading-tight">Portal de Viajes</h2>
            <h3 className="text-xl font-bold text-brand-red tracking-wide">Organización Equitel</h3>
          </div>
          <form onSubmit={handleRequesterLogin}>
            <div className="text-left mb-6">
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Correo Corporativo</label>
              <input name="email" type="email" autoComplete="username" placeholder="usuario@equitel.com.co" className="w-full bg-gray-50 text-gray-900 placeholder-gray-400 border border-gray-300 rounded-md shadow-sm p-3 focus:ring-2 focus:ring-brand-red focus:border-brand-red outline-none transition" value={loginEmailInput} onChange={(e) => setLoginEmailInput(e.target.value)} autoFocus disabled={loginBusy || adminBusy} />
            </div>
            <div className="space-y-3">
              <button type="submit" disabled={loginBusy || adminBusy} className="w-full bg-brand-red text-white py-3 px-4 rounded font-bold uppercase tracking-wide hover:bg-red-700 transition shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed">{loginBusy ? 'ENVIANDO PIN...' : 'INGRESAR'}</button>
              <div className="relative flex py-2 items-center"><div className="flex-grow border-t border-gray-300"></div><span className="flex-shrink-0 mx-4 text-gray-400 text-xs uppercase font-bold">O Acceso Staff</span><div className="flex-grow border-t border-gray-300"></div></div>
              <button type="button" onClick={handleAdminLoginClick} disabled={loginBusy || adminBusy} className="w-full bg-black text-white py-3 px-4 rounded font-bold uppercase tracking-wide hover:bg-gray-800 transition shadow hover:shadow-md disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2">
                {adminBusy && (
                  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                  </svg>
                )}
                <span>{adminBusy ? 'VERIFICANDO...' : 'ADMINISTRADOR'}</span>
              </button>
            </div>
          </form>
          <p className="mt-6 text-[10px] text-gray-400 leading-relaxed">
            🔒 La primera vez que ingreses, recibirás un PIN de 8 dígitos en tu correo corporativo. Lo usarás cada vez que accedas desde un navegador o dispositivo nuevo.
          </p>
        </div>
      </div>
      </>
    );
  }

  return (
    <>
    {healthBanner}
    <Layout
      userEmail={userEmail}
      userName={userName}
      role={isEffectiveAdmin ? (role === UserRole.SUPERADMIN ? 'SUPERADMIN' : 'ANALYST') : 'REQUESTER'}
      onLogout={handleLogout}
      onRefresh={handleManualRefresh}
      canToggleView={role === UserRole.ANALYST || role === UserRole.SUPERADMIN}
      viewAsRequester={viewAsRequester}
      onToggleView={handleToggleView}
    >

      {!isEffectiveAdmin && view === 'LIST' && (
        <UserDashboard
          requests={requests}
          isLoading={fetchingData}
          isSyncing={isSyncing}
          onNewRequest={() => setView('NEW')}
          onViewRequest={setSelectedRequest}
          onRefresh={handleManualRefresh}
        />
      )}

      {view === 'NEW' && (
        <RequestForm
          userEmail={userEmail}
          integrantes={integrantes}
          onSuccess={handleFormSuccess}
          onCancel={handleFormCancel}
          isModification={!!modificationRequest}
          initialData={modificationRequest || undefined}
        />
      )}

      {isEffectiveAdmin && view === 'LIST' && (
        <AdminDashboard requests={requests} integrantes={integrantes} onRefresh={handleManualRefresh} isLoading={fetchingData} onViewRequest={setSelectedRequest} isSuperAdmin={isEffectiveSuperAdmin} />
      )}

      {selectedRequest && (
        <RequestDetail
          request={selectedRequest}
          integrantes={integrantes}
          onClose={() => setSelectedRequest(null)}
          onRefresh={handleManualRefresh}
          onModify={handleRequestModification}
          isAdmin={isEffectiveAdmin}
          isSuperAdmin={isEffectiveSuperAdmin}
        />
      )}
      <div className="fixed bottom-2 left-4 text-xs text-gray-400 font-mono font-bold z-[9999] pointer-events-none drop-shadow-sm">
        v{APP_VERSION}
      </div>
    </Layout>
    </>
  );
};

export default App;
