export function generateId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

export function normalizeImageInput(input) {
  if (!input || typeof input !== 'object') return null;

  const rawData =
    typeof input.data === 'string'
      ? input.data
      : typeof input.imageBase64 === 'string'
        ? input.imageBase64
        : null;

  if (!rawData) return null;

  const dataUrlMatch = rawData.match(/^data:([^;]+);base64,(.+)$/);
  const mimeType = dataUrlMatch?.[1] ?? input.mimeType ?? input.mime_type ?? 'image/jpeg';
  const data = (dataUrlMatch?.[2] ?? rawData).replace(/\s/g, '');

  if (!data) {
    const error = new Error('Image data is empty.');
    error.status = 400;
    throw error;
  }

  return { data, mimeType };
}

export function redactError(error) {
  const raw = error instanceof Error ? error.message : String(error);
  const apiKey = process.env.GEMINI_API_KEY;
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;

  return [apiKey, telegramToken].filter(Boolean).reduce(
    (message, secret) => message.replaceAll(secret, '[redacted]'),
    raw,
  );
}

export function getStatus(error) {
  const status = Number(error?.status);
  if (Number.isInteger(status) && status >= 400 && status < 600) {
    return status;
  }
  return 500;
}
