import React, { useEffect, useRef, useState } from 'react';

/**
 * Aviso de versión nueva (#A124; David, 5-nov-2026: Yurani no veía un cambio ya publicado porque
 * no había recargado la página y nada se lo decía).
 *
 * Cada compilación lleva un identificador (__APP_BUILD_ID__) y publica el mismo en /version.json
 * (vite.config.ts). La app lo pide cada 5 minutos y cada vez que la persona vuelve a la pestaña;
 * si el del servidor es otro, ya hay una versión nueva y sale este aviso. No recarga sola: quien
 * esté llenando una solicitud perdería lo escrito. «Más tarde» lo esconde 30 minutos.
 * Solo en producción: con `npm run dev` no hay version.json.
 */
const CHECK_EVERY_MS = 5 * 60 * 1000;
const SNOOZE_MS = 30 * 60 * 1000;

/** ¿El servidor tiene otra versión? null si no se pudo saber (sin red, archivo viejo o inválido). */
export const serverHasNewVersion = async (current: string): Promise<boolean | null> => {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    const id = data && typeof data.buildId === 'string' ? data.buildId : '';
    return id ? id !== current : null;
  } catch {
    return null;
  }
};

export const UpdateBanner: React.FC = () => {
  const [available, setAvailable] = useState(false);
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const found = useRef(false);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let busy = false;
    const check = async () => {
      if (found.current || busy || document.hidden) return;
      busy = true;
      const isNew = await serverHasNewVersion(__APP_BUILD_ID__);
      busy = false;
      if (isNew) { found.current = true; setAvailable(true); }
    };
    const onBack = () => { setNow(Date.now()); if (!document.hidden) void check(); };
    const timer = window.setInterval(() => { setNow(Date.now()); void check(); }, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('focus', onBack);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onBack);
      window.removeEventListener('focus', onBack);
    };
  }, []);

  if (!available || now < snoozedUntil) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-update-banner
      className="fixed inset-x-0 bottom-4 z-[10000] flex justify-center px-4 pointer-events-none"
    >
      <div className="pointer-events-auto flex w-full max-w-xl flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-white px-4 py-3 shadow-2xl">
        <span className="text-2xl" aria-hidden="true">🔄</span>
        <div className="min-w-[12rem] flex-1 text-sm text-gray-800">
          <p className="font-bold text-gray-900">Hay una versión nueva de la plataforma</p>
          <p className="text-xs text-gray-600">Actualice para ver los últimos cambios. Si está escribiendo una solicitud, envíela primero.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setSnoozedUntil(Date.now() + SNOOZE_MS); setNow(Date.now()); }}
            className="rounded border border-gray-300 bg-white px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50"
          >
            Más tarde
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded bg-brand-red px-3 py-2 text-xs font-bold text-white hover:bg-red-700"
          >
            Actualizar ahora
          </button>
        </div>
      </div>
    </div>
  );
};
