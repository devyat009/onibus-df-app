import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const FILESYSTEM_THRESHOLD = 100 * 1024; // 100KB

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
    return str.length > FILESYSTEM_THRESHOLD;
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
    const useFS = await shouldUseFileSystem(data);
    if (useFS) {
      const fileUri = getFileUri(key);
      await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(data));
      await AsyncStorage.setItem(`${key}_fs`, '1');
    } else {
      await AsyncStorage.setItem(key, JSON.stringify(data));
      await AsyncStorage.removeItem(`${key}_fs`);
    }
    await AsyncStorage.setItem(`${key}_timestamp`, String(Date.now()));
  } catch (error) {
    console.error(`Failed to cache data for key ${key}:`, error);
  }
}

export async function getCacheData<T>(key: string): Promise<T | null> {
  try {
    const useFS = await AsyncStorage.getItem(`${key}_fs`);
    if (useFS === '1') {
      const fileUri = getFileUri(key);
      const fileInfo = await FileSystem.getInfoAsync(fileUri);
      if (!fileInfo.exists) return null;
      const content = await FileSystem.readAsStringAsync(fileUri);
      return JSON.parse(content);
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