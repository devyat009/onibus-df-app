export const normalizeLineNumber = (value?: string | number): string => {
  if (value == null) return '';
  return String(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/\s+/g, '');
};

export const stripLeadingZeros = (value: string): string => {
  const trimmed = value.replace(/^0+/, '');
  return trimmed.length > 0 ? trimmed : '0';
};

/**
 * Generates canonical lookup keys for a DFTrans/SEMOB line code without causing
 * collisions between distinct dotted sub-lines (e.g. "0.112" vs "11.2").
 */
export const getLineLookupKeys = (value?: string | number): string[] => {
  const norm = normalizeLineNumber(value);
  if (!norm) return [];

  const keys = new Set<string>([norm]);

  if (norm.includes('.')) {
    const [rawPrefix, ...rest] = norm.split('.');
    const suffix = rest.join('.');
    const prefixDigits = rawPrefix.replace(/[^0-9]/g, '');
    const normPrefix = prefixDigits ? stripLeadingZeros(prefixDigits) : rawPrefix;
    keys.add(`${normPrefix}.${suffix}`);

    // Lines in bacia 0 ("0.089", "0.110") sometimes appear dotless ("0089", "089", "110") in raw GPS feeds
    if (normPrefix === '0' && /^[0-9]+$/.test(suffix)) {
      const combinedDigits = `0${suffix}`;
      keys.add(`PLAIN:${combinedDigits}`);
      keys.add(`PLAIN:${stripLeadingZeros(suffix)}`);
    }
  } else {
    const digits = norm.replace(/[^0-9]/g, '');
    if (digits) {
      const stripped = stripLeadingZeros(digits);
      keys.add(`PLAIN:${digits}`);
      keys.add(`PLAIN:${stripped}`);
      // Match against "0.XXX" formatted lines when GPS omits the dot
      if (digits.startsWith('0') && digits.length >= 3) {
        keys.add(`0.${digits.slice(1)}`);
      }
      if (stripped.length <= 3) {
        keys.add(`0.${stripped.padStart(3, '0')}`);
      }
    }
  }

  return Array.from(keys);
};

export const matchesLineNumber = (a?: string | number, b?: string | number): boolean => {
  const normA = normalizeLineNumber(a);
  const normB = normalizeLineNumber(b);

  if (!normA || !normB) return false;
  if (normA === normB) return true;

  // If both explicitly specify dotted prefix.ramal structure (e.g. "0.112" vs "11.2"),
  // compare prefix and suffix separately so ramal digits never merge into prefix digits.
  if (normA.includes('.') && normB.includes('.')) {
    const [prefA, ...restA] = normA.split('.');
    const [prefB, ...restB] = normB.split('.');
    const normPrefA = stripLeadingZeros(prefA.replace(/[^0-9]/g, '') || prefA);
    const normPrefB = stripLeadingZeros(prefB.replace(/[^0-9]/g, '') || prefB);
    return normPrefA === normPrefB && restA.join('.') === restB.join('.');
  }

  const keysA = getLineLookupKeys(normA);
  const keysB = new Set(getLineLookupKeys(normB));
  return keysA.some(k => keysB.has(k));
};

/**
 * Normalizes SEMOB/DFTrans direction codes across all APIs:
 * - GeoServer `ultima_posicao`: '0' = IDA, '1' = VOLTA (and occasional corrupted date strings like '06/11/2026' -> '')
 * - Dados `/posicao` & GeoServer `percuso das linhas`: 'IDA', 'VOLTA', 'CIRCULAR'
 * - Dados `/horario`: 'I', 'V', 'C'
 */
export const normalizeSentido = (value?: string | number | null): string => {
  if (value == null) return '';
  const upper = String(value).toUpperCase().trim();
  if (!upper || upper === 'NULL' || upper === 'UNDEFINED') return '';

  // Reject corrupted date/timestamp strings injected by operator feeds (e.g. "06/11/2026")
  if (/[\/:\-]/.test(upper)) return '';

  if (upper === '0' || upper === 'I' || upper === 'IDA') return 'I';
  if (upper === '1' || upper === '2' || upper === 'V' || upper === 'VOLTA') return 'V';
  if (upper === 'C' || upper === 'CIRCULAR') return 'C';
  if (upper === 'R' || upper === 'RETORNO') return 'R';

  return '';
};

/**
 * Checks whether a bus's reported `sentido` is compatible with a target line's `sentido`.
 * On CIRCULAR lines ('C'), onboard AVL trackers still transmit '0' ('I') or '1' ('V'),
 * so any vehicle direction is valid on a circular line.
 */
export const areSentidosCompatible = (
  busSentido?: string | number | null,
  lineSentido?: string | number | null
): boolean => {
  const normLine = normalizeSentido(lineSentido);
  if (!normLine || normLine === 'C') return true;

  const normBus = normalizeSentido(busSentido);
  if (!normBus || normBus === 'C') return true;

  return normBus === normLine;
};

export const formatSentidoLabel = (value?: string | number | null): string => {
  const norm = normalizeSentido(value);
  if (norm === 'I') return 'IDA';
  if (norm === 'V') return 'VOLTA';
  if (norm === 'C') return 'CIRCULAR';
  if (norm === 'R') return 'RETORNO';
  return '';
};

export const buildLineKey = (lineNumber?: string | number, sentido?: string): string => {
  const normalizedLine = normalizeLineNumber(lineNumber);
  const normalizedSentido = normalizeSentido(sentido);
  const digits = normalizedLine.replace(/[^0-9]/g, '');
  return [normalizedLine, normalizedSentido, digits].filter(Boolean).join('|');
};
