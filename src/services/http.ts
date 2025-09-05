// HTTP service with timeout, retry logic and memory protection

export type HttpTextResponse = {
  ok: boolean;
  status: number;
  text: string;
};

// Maximum response size: 5MB to prevent OOM
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;

export async function fetchWithCache(url: string, options?: RequestInit): Promise<HttpTextResponse> {
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Add timeout to prevent hanging requests
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

      const resp = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Check content length to prevent OOM
      const contentLength = resp.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
        throw new Error(`Response too large: ${contentLength} bytes (max: ${MAX_RESPONSE_SIZE})`);
      }

      // Use streaming read for large responses
      const reader = resp.body?.getReader();
      if (!reader) {
        const text = await resp.text();
        return { ok: resp.ok, status: resp.status, text };
      }

      const chunks: Uint8Array[] = [];
      let totalSize = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          totalSize += value.length;
          if (totalSize > MAX_RESPONSE_SIZE) {
            reader.cancel();
            throw new Error(`Response too large: ${totalSize} bytes (max: ${MAX_RESPONSE_SIZE})`);
          }

          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }

      // Combine chunks
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      const text = new TextDecoder().decode(combined);
      return { ok: resp.ok, status: resp.status, text };

    } catch (err) {
      lastError = err as Error;
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      const isOOM = err instanceof Error && err.message.includes('too large');

      console.log(`Fetch attempt ${attempt}/${maxRetries} failed:`, {
        url: url.substring(0, 100) + '...',
        error: lastError.message,
        isTimeout,
        isOOM
      });

      // If it's OOM or last attempt, return the error immediately
      if (isOOM || attempt === maxRetries) {
        const text = isTimeout ? 'Request timeout after retries' :
          isOOM ? 'Response too large, try with smaller dataset' :
            String(lastError?.message || lastError);
        return { ok: false, status: isTimeout ? 408 : isOOM ? 413 : 0, text };
      }

      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }

  // This should never be reached, but just in case
  return {
    ok: false,
    status: 0,
    text: lastError?.message || 'Unknown error'
  };
}


