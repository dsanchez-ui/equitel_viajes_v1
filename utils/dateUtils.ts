export const parseDate = (dateStr: string | undefined): Date => {
  if (!dateStr) return new Date();
  
  // if YYYY-MM-DD
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
    // Add T00:00:00 to avoid timezone issues parsing as UTC
    return new Date(dateStr.split('T')[0] + 'T00:00:00');
  }
  
  // if DD-MM-YYYY
  if (dateStr.match(/^\d{2}-\d{2}-\d{4}/)) {
    const parts = dateStr.split(' ')[0].split('-');
    return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
  }

  // if dd/mm/yyyy
  if (dateStr.match(/^\d{1,2}\/\d{1,2}\/\d{4}/)) {
    const parts = dateStr.split(' ')[0].split('/');
    return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
  }
  
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
};

export const formatToDDMMYYYY = (dateStr: string | undefined): string => {
  if (!dateStr) return '';
  if (dateStr.match(/^\d{2}-\d{2}-\d{4}$/)) return dateStr;
  
  const date = parseDate(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}-${m}-${y}`;
};

export const formatToYYYYMMDD = (dateStr: string | undefined): string => {
  if (!dateStr) return '';
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) return dateStr;
  
  const date = parseDate(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${y}-${m}-${d}`;
};

export const getDaysDiff = (start: string | Date, end: string | Date): number => {
  const d1 = typeof start === 'string' ? parseDate(start) : start;
  const d2 = typeof end === 'string' ? parseDate(end) : end;
  
  // Clone dates to avoid mutating the originals
  const date1 = new Date(d1.getTime());
  const date2 = new Date(d2.getTime());
  
  date1.setHours(0,0,0,0);
  date2.setHours(0,0,0,0);
  
  return Math.ceil((date2.getTime() - date1.getTime()) / (1000 * 3600 * 24));
};
