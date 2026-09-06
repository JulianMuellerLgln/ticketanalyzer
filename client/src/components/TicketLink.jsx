function toBrowseUrl(baseUrl, ticketKey) {
  if (!baseUrl || !ticketKey) return null;
  const clean = String(baseUrl).replace(/\/$/, '');
  return `${clean}/browse/${encodeURIComponent(ticketKey)}`;
}

export function linkifyTicketText(text) {
  const source = String(text || '');
  const re = /\b[A-Z][A-Z0-9]+-\d+\b/g;
  const parts = [];
  let last = 0;
  let m;
  while ((m = re.exec(source)) !== null) {
    if (m.index > last) {
      parts.push({ type: 'text', value: source.slice(last, m.index) });
    }
    parts.push({ type: 'ticket', value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < source.length) {
    parts.push({ type: 'text', value: source.slice(last) });
  }
  return parts;
}

export default function TicketLink({ ticketKey, baseUrl, className = '', children }) {
  const href = toBrowseUrl(baseUrl, ticketKey);
  if (!href) {
    return <span className={className}>{children || ticketKey}</span>;
  }
  return (
    <a className={className} href={href} target="_blank" rel="noreferrer">
      {children || ticketKey}
    </a>
  );
}
