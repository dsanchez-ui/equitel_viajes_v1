
import React from 'react';
import { LOGO_URL } from '../constants';

interface LayoutProps {
  children: React.ReactNode;
  userEmail: string;
  userName?: string;
  role: string;
  onLogout?: () => void;
  onRefresh?: () => void;
  // Toggle de vista admin↔usuario — solo se muestra si canToggleView=true.
  // Permite a un analista ver su dashboard de usuario para crear solicitudes propias.
  canToggleView?: boolean;
  viewAsRequester?: boolean;
  onToggleView?: () => void;
  // Ensancha el contenedor para vistas densas (el panel de analista, que tiene
  // una tabla de ~10 columnas). Sin esto, el tope de max-w-7xl (1280px) obliga a
  // la tabla a hacer scroll horizontal aunque la pantalla tenga espacio de sobra,
  // y la barra de scroll queda al final de las 50 filas de la página.
  wide?: boolean;
  // #A119: «Mis aprobaciones», solo para quien aprueba algo. count = pendientes (null = aún no se sabe).
  onApprovals?: () => void;
  approvalsCount?: number | null;
  approvalsActive?: boolean;
}

export const Layout: React.FC<LayoutProps> = ({ children, userEmail, userName, role, onLogout, onRefresh, canToggleView, viewAsRequester, onToggleView, wide, onApprovals, approvalsCount, approvalsActive }) => {
  // Header, main y footer comparten el mismo ancho para que el logo y el
  // contenido queden alineados en ambos modos.
  const containerWidth = wide ? 'max-w-[1800px]' : 'max-w-7xl';
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="bg-black shadow-md border-b border-gray-800 sticky top-0 z-50">
        <div className={`${containerWidth} mx-auto px-4 sm:px-6 lg:px-8`}>
          <div className="flex justify-between h-16">
            <div className="flex items-center min-w-0 flex-1">
              <div className="flex items-center gap-4 min-w-0">
                <img
                  src={LOGO_URL}
                  alt="Organización Equitel"
                  className="h-10 w-auto object-contain bg-white rounded-sm px-1 flex-shrink-0"
                  referrerPolicy="no-referrer"
                />
                <span className="font-bold text-base lg:text-xl tracking-wide text-white hidden sm:block truncate">
                  Portal de Viajes - Organización Equitel
                </span>
                <span className="font-bold text-lg tracking-wide text-white sm:hidden">
                  Equitel Viajes
                </span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-bold text-white truncate max-w-[400px]" title={userName || userEmail}>
                    {userName || userEmail}
                </p>
                <p className="text-xs text-gray-400">{role}</p>
              </div>
              
              <div className="flex items-center gap-2">
                {onApprovals && (
                  <button
                    onClick={onApprovals}
                    className={`relative inline-flex items-center px-3 py-1.5 border shadow-sm text-xs font-medium rounded focus:outline-none transition-colors ${
                      approvalsActive
                        ? 'border-brand-red text-white bg-brand-red hover:bg-red-700'
                        : 'border-gray-600 text-gray-300 bg-gray-900 hover:bg-gray-800 hover:text-white'
                    }`}
                    title={approvalsActive ? 'Volver a la lista' : 'Lo que tiene por aprobar y lo que ya decidió'}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 sm:mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <span className="hidden sm:inline whitespace-nowrap">MIS APROBACIONES</span>
                    {!!approvalsCount && approvalsCount > 0 && (
                      <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-400 text-black text-[10px] font-bold" aria-label={`${approvalsCount} por aprobar`}>
                        {approvalsCount}
                      </span>
                    )}
                  </button>
                )}

                {canToggleView && onToggleView && (
                  <button
                    onClick={onToggleView}
                    className={`inline-flex items-center px-3 py-1.5 border shadow-sm text-xs font-medium rounded focus:outline-none transition-colors ${
                      viewAsRequester
                        ? 'border-brand-red text-white bg-brand-red hover:bg-red-700'
                        : 'border-gray-600 text-gray-300 bg-gray-900 hover:bg-gray-800 hover:text-white'
                    }`}
                    title={viewAsRequester ? 'Cambiar a vista de administrador' : 'Cambiar a vista de usuario (tus solicitudes)'}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 sm:mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    <span className="hidden sm:inline whitespace-nowrap">{viewAsRequester ? 'VER ADMIN' : 'VER USUARIO'}</span>
                  </button>
                )}

                {onRefresh && (
                  <button
                    onClick={onRefresh}
                    className="inline-flex items-center px-3 py-1.5 border border-gray-600 shadow-sm text-xs font-medium rounded text-gray-300 bg-gray-900 hover:bg-gray-800 hover:text-white focus:outline-none transition-colors"
                    title="Sincronizar / Refrescar"
                  >
                    <svg className="h-4 w-4 sm:mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span className="hidden sm:inline">REFRESCAR</span>
                  </button>
                )}

                {onLogout && (
                  <button 
                    onClick={onLogout}
                    className="inline-flex items-center px-3 py-1.5 border border-gray-600 shadow-sm text-xs font-medium rounded text-gray-300 bg-gray-900 hover:bg-gray-800 hover:text-white focus:outline-none transition-colors"
                    title="Cerrar Sesión"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 sm:mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    <span className="hidden sm:inline">SALIR</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>
      <main className={`flex-1 ${containerWidth} w-full mx-auto px-4 sm:px-6 lg:px-8 py-8`}>
        {children}
      </main>
      <footer className="bg-white border-t mt-auto">
        <div className={`${containerWidth} mx-auto py-4 px-4 sm:px-6 lg:px-8 text-center text-sm text-gray-500`}>
          &copy; {new Date().getFullYear()} Equitel • Gestión de Viajes Corporativos.
        </div>
      </footer>
    </div>
  );
};
