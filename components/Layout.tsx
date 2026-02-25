
import React from 'react';
import { LOGO_URL } from '../constants';

interface LayoutProps {
  children: React.ReactNode;
  userEmail: string;
  userName?: string;
  role: string;
  onLogout?: () => void;
  onRefresh?: () => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, userEmail, userName, role, onLogout, onRefresh }) => {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="bg-black shadow-md border-b border-gray-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <div className="flex-shrink-0 flex items-center gap-4">
                <img 
                  src={LOGO_URL} 
                  alt="Organización Equitel" 
                  className="h-10 w-auto object-contain bg-white rounded-sm px-1"
                  referrerPolicy="no-referrer"
                />
                <span className="font-bold text-lg sm:text-xl tracking-wide text-white hidden sm:block">
                  Portal de Viajes - Organización Equitel
                </span>
                <span className="font-bold text-lg tracking-wide text-white sm:hidden">
                  Equitel Viajes
                </span>
              </div>
              <div className="hidden sm:ml-10 sm:flex sm:space-x-8">
                <span className="border-brand-red text-white inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium tracking-wide">
                  DASHBOARD
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
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
      <footer className="bg-white border-t mt-auto">
        <div className="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8 text-center text-sm text-gray-500">
          &copy; {new Date().getFullYear()} Equitel • Gestión de Viajes Corporativos.
        </div>
      </footer>
    </div>
  );
};
