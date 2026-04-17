export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export function daysUntil(iso: string): number {
  const diff = new Date(iso).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length < 10) return phone;
  const first = digits.slice(0, 3);
  const last = digits.slice(-4);
  return `${first}-****-${last}`;
}

export function birthYearLabel(birthDate: string | null | undefined): string {
  if (!birthDate) return '';
  const year = birthDate.substring(0, 4);
  return `${year}년생`;
}
