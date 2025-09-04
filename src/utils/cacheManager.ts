import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const FILESYSTEM_THRESHOLD = 100 * 1024; // 100KB - sugestão original para decidir usar FS
const MAX_CACHE_FILE_SIZE = 40 * 1024 * 1024; // 40MB máximo para gravar/ler de uma vez
const MAX_READ_FILE_SIZE = 45 * 1024 * 1024; // 45MB - se o arquivo for maior que isso, não tenta ler

export interface CacheOptions {
  ttl?: number; // Time to live in milliseconds
  forceRefresh?: boolean;
}

function getFileUri(key: string) {
  return FileSystem.documentDirectory + key + '.json';
}

async function shouldUseFileSystem(data: any): Promise<boolean> {
  try {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    return str.length > FILESYSTEM_THRESHOLD && str.length <= MAX_CACHE_FILE_SIZE;
  } catch {
    return false;
  }
}

export async function getCachedOrFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: CacheOptions = {}
): Promise<T> {
  const { ttl = THREE_DAYS_MS, forceRefresh = false } = options;

  if (forceRefresh) {
    const data = await fetcher();
    await setCacheData(key, data);
    return data;
  }

  const timestamp = await AsyncStorage.getItem(`${key}_timestamp`);
  const now = Date.now();

  if (timestamp && now - Number(timestamp) < ttl) {
    const cache = await getCacheData<T>(key);
    if (cache !== null) return cache;
  }

  const data = await fetcher();
  await setCacheData(key, data);
  return data;
}

export async function setCacheData<T>(key: string, data: T): Promise<void> {
  try {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    const useFS = await shouldUseFileSystem(data);

    // If stringified data is too large, skip caching to avoid OOM.
    if (str.length > MAX_CACHE_FILE_SIZE) {
      console.warn(`Cache for ${key} too large (${Math.round(str.length / 1024)} KB). Skipping FS/AsyncStorage write.`);
      // Still set timestamp so other logic knows we tried to cache recently
      await AsyncStorage.setItem(`${key}_timestamp`, String(Date.now()));
      // Remove any previous FS flag so reads don't attempt to stream a huge file
      await AsyncStorage.removeItem(`${key}_fs`);
      return;
    }

    if (useFS) {
      const fileUri = getFileUri(key);
      await FileSystem.writeAsStringAsync(fileUri, str);
      await AsyncStorage.setItem(`${key}_fs`, '1');
      await AsyncStorage.removeItem(key); // ensure AsyncStorage copy not stale
    } else {
      await AsyncStorage.setItem(key, str);
      await AsyncStorage.removeItem(`${key}_fs`);
    }
    await AsyncStorage.setItem(`${key}_timestamp`, String(Date.now()));
  } catch (error) {
    console.error(`Failed to cache data for key ${key}:`, error);
    // On error, try to clean FS flag to avoid future attempts to read a corrupted/huge file
    try {
      await AsyncStorage.removeItem(`${key}_fs`);
    } catch {}
  }
}

export async function getCacheData<T>(key: string): Promise<T | null> {
  try {
    const useFS = await AsyncStorage.getItem(`${key}_fs`);
    if (useFS === '1') {
      const fileUri = getFileUri(key);
      const fileInfo = await FileSystem.getInfoAsync(fileUri);
      if (!fileInfo.exists) {
        // cleanup inconsistent flags
        await AsyncStorage.removeItem(`${key}_fs`);
        await AsyncStorage.removeItem(`${key}_timestamp`);
        return null;
      }

      // If file is suspiciously large, avoid loading it into memory
      if (typeof fileInfo.size === 'number' && fileInfo.size > MAX_READ_FILE_SIZE) {
        console.warn(`Cached file ${key} is too large to read safely (${Math.round((fileInfo.size || 0) / 1024)} KB). Removing file and returning null.`);
        try {
          await FileSystem.deleteAsync(fileUri, { idempotent: true });
        } catch (err) {
          console.error('Failed to delete large cache file:', err);
        }
        await AsyncStorage.removeItem(`${key}_fs`);
        await AsyncStorage.removeItem(`${key}_timestamp`);
        return null;
      }

      try {
        const content = await FileSystem.readAsStringAsync(fileUri);
        return JSON.parse(content);
      } catch (err: any) {
        // Trata casos comuns de "file not found" / ENOENT sem poluir os logs
        const msg = String(err?.message || err);
        if (msg.includes('FileNotFoundException') || msg.includes('ENOENT') || msg.includes('open failed')) {
          // arquivo pode ter sido removido entre getInfoAsync e read; limpa flags e segue
          try {
            await AsyncStorage.removeItem(`${key}_fs`);
            await AsyncStorage.removeItem(`${key}_timestamp`);
          } catch {}
          return null;
        }

        console.error(`Failed to read/parse cache file ${key}:`, err);
        // If reading failed (OOM or corruption), remove the file and flags to prevent repeated failures
        try {
          await FileSystem.deleteAsync(fileUri, { idempotent: true });
        } catch (e) {}
        await AsyncStorage.removeItem(`${key}_fs`);
        await AsyncStorage.removeItem(`${key}_timestamp`);
        return null;
      }
    } else {
      const cache = await AsyncStorage.getItem(key);
      return cache ? JSON.parse(cache) : null;
    }
  } catch (error) {
    console.error(`Failed to get cached data for key ${key}:`, error);
    return null;
  }
}

export async function clearCache(key?: string): Promise<void> {
  try {
    if (key) {
      await AsyncStorage.removeItem(key);
      await AsyncStorage.removeItem(`${key}_timestamp`);
      const useFS = await AsyncStorage.getItem(`${key}_fs`);
      if (useFS === '1') {
        const fileUri = getFileUri(key);
        await FileSystem.deleteAsync(fileUri, { idempotent: true });
        await AsyncStorage.removeItem(`${key}_fs`);
      }
    } else {
      await AsyncStorage.clear();
      // Opcional: limpar todos arquivos do FileSystem se necessário
      const dir = FileSystem.documentDirectory;
      if (dir) {
        const files = await FileSystem.readDirectoryAsync(dir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            await FileSystem.deleteAsync(dir + file, { idempotent: true });
          }
        }
      }
    }
  } catch (error) {
    console.error('Failed to clear cache:', error);
  }
}

export async function clearAllCache(): Promise<void> {
  try {
    // Limpa AsyncStorage
    await AsyncStorage.clear();

    // Limpa todos arquivos de cache do FileSystem
    const dir = FileSystem.documentDirectory;
    if (dir) {
      const files = await FileSystem.readDirectoryAsync(dir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          await FileSystem.deleteAsync(dir + file, { idempotent: true });
        }
      }
    }
  } catch (error) {
    console.error('Failed to clear all cache:', error);
  }
}

export async function isCacheValid(key: string, ttl: number = THREE_DAYS_MS): Promise<boolean> {
  try {
    const timestamp = await AsyncStorage.getItem(`${key}_timestamp`);
    if (!timestamp) return false;
    const now = Date.now();
    return now - Number(timestamp) < ttl;
  } catch (error) {
    console.error(`Failed to check cache validity for key ${key}:`, error);
    return false;
  }
}

// Cache keys constants
export const CACHE_KEYS = {
  LINES: 'bus_lines',
  FROTA: 'frota_operadora',
  STOPS: 'bus_stops',
  BUSES: 'bus_positions',
  BUS_HORARIO: 'bus_hours',
} as const;