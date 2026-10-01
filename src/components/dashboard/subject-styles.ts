/**
 * Shared subject color system + types — used by the Dashboard overview and
 * the Subjects section so both render subject data identically.
 */

export type SubjectColor =
  | 'emerald'
  | 'orange'
  | 'teal'
  | 'amber'
  | 'violet'
  | 'rose';

export type Subject = {
  id: string;
  name: string;
  color: SubjectColor;
  createdAt: string;
};

export const SUBJECT_COLORS: { value: SubjectColor; swatch: string }[] = [
  { value: 'emerald', swatch: 'bg-emerald-500' },
  { value: 'orange', swatch: 'bg-orange-500' },
  { value: 'teal', swatch: 'bg-teal-500' },
  { value: 'amber', swatch: 'bg-amber-500' },
  { value: 'violet', swatch: 'bg-violet-500' },
  { value: 'rose', swatch: 'bg-rose-500' },
];

export const CHIP_STYLES: Record<SubjectColor, string> = {
  emerald: 'bg-emerald-50 text-emerald-600',
  orange: 'bg-orange-50 text-orange-500',
  teal: 'bg-teal-50 text-teal-600',
  amber: 'bg-amber-50 text-amber-500',
  violet: 'bg-violet-50 text-violet-500',
  rose: 'bg-rose-50 text-rose-500',
};

export const BORDER_STYLES: Record<SubjectColor, string> = {
  emerald: 'border-emerald-200',
  orange: 'border-orange-200',
  teal: 'border-teal-200',
  amber: 'border-amber-200',
  violet: 'border-violet-200',
  rose: 'border-rose-200',
};
