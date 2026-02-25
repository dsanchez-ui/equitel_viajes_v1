
import React, { useEffect, useState } from 'react';
import { Layout } from './components/Layout';
import { RequestForm } from './components/RequestForm';
import { AdminDashboard } from './components/AdminDashboard';
import { RequestDetail } from './components/RequestDetail';
import { PinEntryModal } from './components/PinEntryModal';
import { gasService } from './services/gasService';
import { TravelRequest, UserRole, Integrant } from './types';
import { LOGO_URL } from './constants';

const POLL_INTERVAL_MS = 15000;

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

  useEffect(() => {
    const init = async () => {
      try {
        const loadedIntegrantes = await gasService.getIntegrantesData();
        setIntegrantes(loadedIntegrantes);
        const email = await gasService.getCurrentUser();
        if (email) {
            handleLoginSuccess(email, true, loadedIntegrantes);
        } else {
            setLoading(false);
        }
      } catch (err) {
        console.error("Init failed", err);
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

  const handleLoginSuccess = async (email: string, auto: boolean = false, preloadedIntegrantes?: Integrant[]) => {
      setUserEmail(email);
      const list = preloadedIntegrantes || integrantes;
      setUserName(determineUserName(email, list));
      const isAdmin = email.includes('compras') || email.includes('admin') || email.includes('analista');
      setRole(isAdmin ? UserRole.ANALYST : UserRole.REQUESTER);
      setLoading(false);
      await fetchRequests(email, isAdmin, false); 
  };

  const handleRequesterLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if(loginEmailInput) handleLoginSuccess(loginEmailInput);
  };

  const handleAdminLoginClick = () => {
    let emailToUse = loginEmailInput || 'admin@travelmaster.com';
    if (emailToUse.includes('admin') || emailToUse.includes('compras') || emailToUse.includes('analista')) {
        setPendingAdminEmail(emailToUse);
        setShowPinModal(true);
    } else {
        alert('El correo ingresado no tiene permisos de administrador (debe contener "admin", "compras" o "analista").');
    }
  };

  const handlePinSubmit = async (pin: string) => {
      try {
          const isValid = await gasService.verifyAdminPin(pin);
          if (isValid) {
              setShowPinModal(false);
              handleLoginSuccess(pendingAdminEmail);
              return true;
          }
          return false;
      } catch (e) { return false; }
  };

  const handleLogout = () => {
      setUserEmail('');
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
    } catch(e) { console.error(e); } finally { if (!silent) setFetchingData(false); }
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
        {showPinModal && <PinEntryModal isOpen={showPinModal} onClose={() => setShowPinModal(false)} onSubmit={handlePinSubmit} />}
        <div className="bg-white p-8 rounded-lg shadow-2xl text-center max-w-md w-full border-t-8 border-brand-red">
            <div className="flex justify-center mb-6">
                <img src={LOGO_URL} alt="Organización Equitel" className="h-20 w-auto object-contain" referrerPolicy="no-referrer" />
            </div>
            <div className="mb-8">
               <h2 className="text-2xl font-bold text-gray-900 tracking-tight leading-tight">Portal de Viajes</h2>
               <h3 className="text-xl font-bold text-brand-red tracking-wide">Organización Equitel</h3>
            </div>
            <div className="text-left mb-6">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Correo Corporativo</label>
                <input name="email" type="email" placeholder="usuario@equitel.com.co" className="w-full bg-gray-50 text-gray-900 placeholder-gray-400 border border-gray-300 rounded-md shadow-sm p-3 focus:ring-2 focus:ring-brand-red focus:border-brand-red outline-none transition" value={loginEmailInput} onChange={(e) => setLoginEmailInput(e.target.value)} autoFocus />
            </div>
            <div className="space-y-3">
                <button onClick={handleRequesterLogin} className="w-full bg-brand-red text-white py-3 px-4 rounded font-bold uppercase tracking-wide hover:bg-red-700 transition shadow-lg hover:shadow-xl transform hover:-translate-y-0.5">INGRESAR</button>
                <div className="relative flex py-2 items-center"><div className="flex-grow border-t border-gray-300"></div><span className="flex-shrink-0 mx-4 text-gray-400 text-xs uppercase font-bold">O Acceso Staff</span><div className="flex-grow border-t border-gray-300"></div></div>
                <button onClick={handleAdminLoginClick} className="w-full bg-black text-white py-3 px-4 rounded font-bold uppercase tracking-wide hover:bg-gray-800 transition shadow hover:shadow-md">ADMINISTRADOR</button>
            </div>
        </div>
      </div>
    );
  }

  return (
    <Layout userEmail={userEmail} userName={userName} role={role} onLogout={handleLogout}>
      
      {role === UserRole.REQUESTER && view === 'LIST' && (
        <div className="space-y-6">
           <div className="flex justify-between items-center border-b pb-4 border-gray-200">
             <div className="flex items-center gap-4">
                <h1 className="text-2xl font-bold text-gray-900 uppercase tracking-tight">Mis Solicitudes</h1>
                {isSyncing && <span className="text-xs text-brand-red animate-pulse font-medium">● Sincronizando...</span>}
             </div>
             <button onClick={() => setView('NEW')} className="bg-brand-red text-white px-5 py-2 rounded shadow hover:bg-red-700 transition font-bold uppercase text-xs tracking-wide">+ Nueva Solicitud</button>
           </div>
           
           {fetchingData ? (
             <div className="flex justify-center items-center h-64 bg-white rounded-lg border border-gray-200">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-4 border-brand-red mx-auto mb-3"></div>
                    <p className="text-gray-400 text-sm font-medium">Cargando sus solicitudes...</p>
                </div>
             </div>
           ) : (
             <>
               <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                 {requests.map(req => (
                   <div key={req.requestId} className="bg-white p-6 rounded shadow-sm hover:shadow-md transition border-t-4 border-brand-red relative group">
                     <div className="flex justify-between items-start mb-2">
                        <span className="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{req.requestId}</span>
                        <span className={`text-xs font-bold px-2 py-1 rounded ${
                            req.status === 'APROBADO' ? 'bg-green-100 text-green-700' : 
                            req.status === 'DENEGADO' ? 'bg-red-100 text-red-700' : 
                            req.status === 'ANULADO' ? 'bg-gray-200 text-gray-500 line-through' :
                            'bg-gray-100 text-gray-600'
                        }`}>{req.status}</span>
                     </div>
                     <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        <span>{req.origin}</span><span className="text-brand-red text-xl">➝</span><span>{req.destination}</span>
                     </h3>
                     <p className="text-sm text-gray-500 mt-1">Salida: <span className="font-medium text-gray-700">{req.departureDate}</span></p>
                     
                     {req.relatedRequestId && <p className="text-xs text-blue-500 mt-1">Vinculada a {req.relatedRequestId}</p>}

                     <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between items-center">
                        <span className="text-xs font-bold text-gray-400 uppercase">{req.passengers.length} Pasajero(s)</span>
                        <button onClick={() => setSelectedRequest(req)} className="text-brand-red text-xs font-bold uppercase tracking-wide hover:underline focus:outline-none">Ver Detalle</button>
                     </div>
                   </div>
                 ))}
               </div>
               
               {requests.length === 0 && (
                 <div className="col-span-full text-center py-16 bg-white rounded border border-gray-200 flex flex-col items-center justify-center">
                   <div className="bg-gray-100 rounded-full p-4 mb-4">
                      <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                   </div>
                   <h3 className="text-lg font-bold text-gray-900 mb-1">No tienes solicitudes activas</h3>
                   <button onClick={() => setView('NEW')} className="bg-brand-red text-white px-5 py-2.5 rounded font-bold shadow hover:bg-red-700 transition uppercase text-xs tracking-wide mt-4">Crear Solicitud</button>
                 </div>
               )}
             </>
           )}
        </div>
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

      {role === UserRole.ANALYST && view !== 'NEW' && (
        <AdminDashboard requests={requests} onRefresh={handleManualRefresh} isLoading={fetchingData} onViewRequest={setSelectedRequest} />
      )}
      
      {selectedRequest && (
        <RequestDetail 
          request={selectedRequest} 
          integrantes={integrantes}
          onClose={() => setSelectedRequest(null)}
          onRefresh={handleManualRefresh}
          onModify={handleRequestModification}
          isAdmin={role === UserRole.ANALYST} 
        />
      )}
    </Layout>
  );
};

export default App;
