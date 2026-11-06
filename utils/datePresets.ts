/** Rangos de fecha de Métricas (Tiempos del flujo y Aprobaciones). Fechas 'AAAA-MM-DD'. */
export type DatePreset = 'today' | 'last7' | 'last30' | 'custom' | 'all';

export const DATE_PRESETS: { v: DatePreset; l: string }[] = [
  { v: 'today', l: 'Hoy' },
  { v: 'last7', l: 'Últimos 7 días' },
  { v: 'last30', l: 'Últimos 30 días' },
  { v: 'all', l: 'Todo' },
  { v: 'custom', l: 'Personalizado' },
];

export const presetToRange = (preset: DatePreset): { dateFrom?: string; dateTo?: string } => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (preset === 'all' || preset === 'custom') return {};
  const from = new Date(today);
  if (preset === 'last7') from.setDate(from.getDate() - 6);
  if (preset === 'last30') from.setDate(from.getDate() - 29);
  return { dateFrom: from.toISOString().split('T')[0], dateTo: today.toISOString().split('T')[0] };
};
