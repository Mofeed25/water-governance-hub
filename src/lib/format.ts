import type { RiskGrade, SyncStatus } from '@/lib/mizan-types';

export const riskMeta: Record<RiskGrade, { label: string; cls: string; bar: string; dot: string }> = {
  high: { label: 'خطر مرتفع', cls: 'bg-red-50 text-red-700 border-red-200', bar: 'bg-red-500', dot: 'bg-red-500' },
  med: { label: 'خطر متوسط', cls: 'bg-amber-50 text-amber-700 border-amber-200', bar: 'bg-amber-500', dot: 'bg-amber-500' },
  stable: { label: 'مستقر', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
};

export const syncMeta: Record<SyncStatus, { label: string; cls: string; dot: string }> = {
  synced: { label: 'متزامن', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', dot: 'bg-emerald-500' },
  pending: { label: 'محفوظ محلياً - في انتظار الشبكة', cls: 'text-amber-700 bg-amber-50 border-amber-200', dot: 'bg-amber-500' },
  retrying: { label: 'إعادة المحاولة', cls: 'text-brand-700 bg-brand-50 border-brand-200', dot: 'bg-brand-500' },
  failed: { label: 'فشل المزامنة', cls: 'text-red-700 bg-red-50 border-red-200', dot: 'bg-red-500' },
};

export function fmtNum(n: number, digits = 0): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}

export function fmtYER(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

export function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function gradeColor(g: string): string {
  switch (g) {
    case 'A': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'B': return 'bg-lime-100 text-lime-700 border-lime-200';
    case 'C': return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'D': return 'bg-orange-100 text-orange-700 border-orange-200';
    default: return 'bg-red-100 text-red-700 border-red-200';
  }
}

export function pct(n: number, total: number): number {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}
