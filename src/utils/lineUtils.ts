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

export const matchesLineNumber = (a?: string | number, b?: string | number): boolean => {
  const normA = normalizeLineNumber(a);
  const normB = normalizeLineNumber(b);

  if (!normA || !normB) return false;
  if (normA === normB) return true;

  const digitsA = normA.replace(/[^0-9]/g, '');
  const digitsB = normB.replace(/[^0-9]/g, '');
  if (digitsA && digitsB && digitsA === digitsB) return true;

  const trimmedA = digitsA ? stripLeadingZeros(digitsA) : '';
  const trimmedB = digitsB ? stripLeadingZeros(digitsB) : '';
  if (trimmedA && trimmedB && trimmedA === trimmedB) return true;

  return false;
};

export const normalizeSentido = (value?: string): string => {
  if (!value) return '';
  const upper = value.toUpperCase().trim();
  if (upper === 'IDA') return 'I';
  if (upper === 'VOLTA') return 'V';
  if (upper === 'RETORNO') return 'R';
  if (upper === 'CIRCULAR') return 'C';
  if (upper.length === 1) return upper;
  return upper.charAt(0);
};

export const buildLineKey = (lineNumber?: string | number, sentido?: string): string => {
  const normalizedLine = normalizeLineNumber(lineNumber);
  const normalizedSentido = normalizeSentido(sentido);
  const digits = normalizedLine.replace(/[^0-9]/g, '');
  return [normalizedLine, normalizedSentido, digits].filter(Boolean).join('|');
};
