/** Masks a recipient for logs: never the full address or number. */
export function maskDestination(destination: string): string {
  const at = destination.indexOf('@');
  if (at > 0) {
    const domain = destination.slice(at + 1);
    return `${destination[0]}***@${domain.slice(0, 1)}***${domain.slice(domain.lastIndexOf('.'))}`;
  }
  const digits = destination.replace(/\D/g, '');
  return digits.length > 4 ? `***${digits.slice(-3)}` : '***';
}
