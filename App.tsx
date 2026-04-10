import React, { useEffect, useState } from 'react';
import { Layout } from './components/Layout';
import { RequestForm } from './components/RequestForm';
import { AdminDashboard } from './components/AdminDashboard';
import { UserDashboard } from './components/UserDashboard';
import { RequestDetail } from './components/RequestDetail';
import { PinEntryModal } from './components/PinEntryModal';
import { gasService, setOnSessionExpired } from './services/gasService';
import { TravelRequest, UserRole, Integrant } from './types';
import { LOGO_URL, APP_VERSION } from './constants';

const POLL_INTERVAL_MS = 15000;
const SESSION_STORAGE_KEY = 'equitel_session';

interface StoredSession {
  email: string;
  token: string;
  expiresAt: number;
  role: 'REQUESTER' | 'ANALYST';
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
        await handleLoginSuccess(stored.email, validation.role === 'ANALYST', loadedIntegrantes);
      } catch (err) {
        console.error("Init failed", err);
        clearStoredSession();
        gasService.clearSession();
        setLoading(false);
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (!userEmail) return;
    const intervalId = setInterval(async () => {
      setIsSyncing(true);
      await fetchRequests(userEmail, role === UserRole.ANALYST, true);
      setIsSyncing(false);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [userEmail, role]);

  const determineUserName = (email: string, currentIntegrantes: Integrant[] = []) => {
    const found = currentIntegrantes.find(i => i.email.toLowerCase() === email.toLowerCase());
    if (found) return `Hola, ${found.name.toUpperCase()}`;
    return "Hola, Integrante Equitel";
  };

  const handleLoginSuccess = async (email: string, authenticatedAsAdmin: boolean = false, preloadedIntegrantes?: Integrant[]) => {
    setUserEmail(email);
    gasService.setUserEmail(email);
    const list = preloadedIntegrantes || integrantes;
    setUserName(determineUserName(email, list));
    setRole(authenticatedAsAdmin ? UserRole.ANALYST : UserRole.REQUESTER);
    setLoading(false);
    await fetchRequests(email, authenticatedAsAdmin, false);
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
      alert(err?.message || 'No se pudo enviar el PIN. Intenta nuevamente.');
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
        role: (result.role as 'REQUESTER' | 'ANALYST') || 'REQUESTER'
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
      await handleLoginSuccess(pendingPinEmail, session.role === 'ANALYST', loadedIntegrantes);
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
    try {
      const isAnalyst = await gasService.checkIsAnalyst(emailToUse);
      if (isAnalyst) {
        setPendingAdminEmail(emailToUse);
        setShowPinModal(true);
      } else {
        alert('El correo ingresado no tiene permisos de administrador.');
      }
    } catch {
      alert('Error al verificar permisos. Intente de nuevo.');
    }
  };

  const handlePinSubmit = async (pin: string): Promise<boolean> => {
    try {
      const result = await gasService.verifyAdminPin(pin, pendingAdminEmail);
      if (!result.success || !result.token) return false;

      const session: StoredSession = {
        email: pendingAdminEmail,
        token: result.token,
        expiresAt: result.expiresAt || (Date.now() + 30 * 24 * 60 * 60 * 1000),
        role: 'ANALYST'
      };
      writeStoredSession(session);
      gasService.setUserEmail(pendingAdminEmail);
      gasService.setSessionToken(result.token);

      const loadedIntegrantes = await gasService.getIntegrantesData();
      setIntegrantes(loadedIntegrantes);

      setShowPinModal(false);
      await handleLoginSuccess(pendingAdminEmail, true, loadedIntegrantes);
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
    setLoginEmailInput('');

    // RESET STATE to avoid ghosts on re-login
    setView('LIST');
    setModificationRequest(null);
    setSelectedRequest(null);

    window.location.hash = '';
  };

  const fetchRequests = async (email: string, isAdmin: boolean, silent: boolean = false) => {
    if (!silent) setFetchingData(true);
    try {
      const data = isAdmin ? await gasService.getAllRequests(email) : await gasService.getMyRequests(email);
      setRequests(data);
    } catch (e) { console.error(e); } finally { if (!silent) setFetchingData(false); }
  };

  const handleManualRefresh = async () => {
    await fetchRequests(userEmail, role === UserRole.ANALYST, false);
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

  if (loading && !userEmail) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-red mx-auto"></div>
          <p className="mt-4 text-gray-500">Conectando...</p>
        </div>
      </div>
    );
  }

  if (!userEmail) {
    return (
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
              <input name="email" type="email" autoComplete="username" placeholder="usuario@equitel.com.co" className="w-full bg-gray-50 text-gray-900 placeholder-gray-400 border border-gray-300 rounded-md shadow-sm p-3 focus:ring-2 focus:ring-brand-red focus:border-brand-red outline-none transition" value={loginEmailInput} onChange={(e) => setLoginEmailInput(e.target.value)} autoFocus disabled={loginBusy} />
            </div>
            <div className="space-y-3">
              <button type="submit" disabled={loginBusy} className="w-full bg-brand-red text-white py-3 px-4 rounded font-bold uppercase tracking-wide hover:bg-red-700 transition shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed">{loginBusy ? 'ENVIANDO PIN...' : 'INGRESAR'}</button>
              <div className="relative flex py-2 items-center"><div className="flex-grow border-t border-gray-300"></div><span className="flex-shrink-0 mx-4 text-gray-400 text-xs uppercase font-bold">O Acceso Staff</span><div className="flex-grow border-t border-gray-300"></div></div>
              <button type="button" onClick={handleAdminLoginClick} disabled={loginBusy} className="w-full bg-black text-white py-3 px-4 rounded font-bold uppercase tracking-wide hover:bg-gray-800 transition shadow hover:shadow-md disabled:opacity-60">ADMINISTRADOR</button>
            </div>
          </form>
          <p className="mt-6 text-[10px] text-gray-400 leading-relaxed">
            🔒 La primera vez que ingreses, recibirás un PIN de 8 dígitos en tu correo corporativo. Lo usarás cada vez que accedas desde un navegador o dispositivo nuevo.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Layout userEmail={userEmail} userName={userName} role={role} onLogout={handleLogout} onRefresh={handleManualRefresh}>

      {role === UserRole.REQUESTER && view === 'LIST' && (
        <UserDashboard
          requests={requests}
          isLoading={fetchingData}
          isSyncing={isSyncing}
          onNewRequest={() => setView('NEW')}
          onViewRequest={setSelectedRequest}
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

      {role === UserRole.ANALYST && (
        <AdminDashboard requests={requests} integrantes={integrantes} onRefresh={handleManualRefresh} isLoading={fetchingData} onViewRequest={setSelectedRequest} />
      )}

      {selectedRequest && (
        <RequestDetail
          request={selectedRequest}
          integrantes={integrantes}
          onClose={() => setSelectedRequest(null)}
          onRefresh={handleManualRefresh}
          onModify={handleRequestModification}
        />
      )}
      <div className="fixed bottom-2 left-4 text-xs text-gray-400 font-mono font-bold z-[9999] pointer-events-none drop-shadow-sm">
        v{APP_VERSION}
      </div>
    </Layout>
  );
};

export default App;
