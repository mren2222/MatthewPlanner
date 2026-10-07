export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate()+days); return localDate(d);
}
