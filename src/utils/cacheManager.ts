import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const FILESYSTEM_THRESHOLD = 100 * 1024; // 100KB - suggestion to original for deciding if to use FS
const MAX_CACHE_FILE_SIZE = 40 * 1024 * 1024; // 40MB maximum for writing/reading at once
const MAX_READ_FILE_SIZE = 45 * 1024 * 1024; // 45MB - if the file is larger than this, don't try to read

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
      // Persist the size copy to avoid having to open huge files with undefined size
      await AsyncStorage.setItem(`${key}_fs_size`, String(str.length));
      await AsyncStorage.setItem(`${key}_fs`, '1');
      await AsyncStorage.removeItem(key); // ensure AsyncStorage copy not stale
    } else {
      await AsyncStorage.setItem(key, str);
      await AsyncStorage.removeItem(`${key}_fs`);
      await AsyncStorage.removeItem(`${key}_fs_size`);
    }
    await AsyncStorage.setItem(`${key}_timestamp`, String(Date.now()));
  } catch (error) {
    console.error(`Failed to cache data for key ${key}:`, error);
    // On error, try to clean FS flag to avoid future attempts to read a corrupted/huge file
    try {
      await AsyncStorage.removeItem(`${key}_fs`);
      await AsyncStorage.removeItem(`${key}_fs_size`);
    } catch {}
  }
}

export async function getCacheData<T>(key: string): Promise<T | null> {
  try {
    const useFS = await AsyncStorage.getItem(`${key}_fs`);
    if (useFS === '1') {
      const fileUri = getFileUri(key);
      // First, check the saved size in metadata to avoid opening huge files
      // If size is missing or too large, remove the file and return null
      // This avoids OOM crashes on devices with limited memory
      const savedSizeStr = await AsyncStorage.getItem(`${key}_fs_size`);
      const savedSize = savedSizeStr ? Number(savedSizeStr) : undefined;
      if (typeof savedSize === 'number' && savedSize > MAX_READ_FILE_SIZE) {
        console.warn(`Cached file ${key} (metadata) too large (${Math.round(savedSize / 1024)} KB). Removing file.`);
        try { await FileSystem.deleteAsync(fileUri, { idempotent: true }); } catch {}
        await AsyncStorage.removeItem(`${key}_fs`);
        await AsyncStorage.removeItem(`${key}_fs_size`);
        await AsyncStorage.removeItem(`${key}_timestamp`);
        return null;
      }

      const fileInfo = await FileSystem.getInfoAsync(fileUri);
      if (!fileInfo.exists) {
        // cleanup inconsistent flags
        await AsyncStorage.removeItem(`${key}_fs`);
        await AsyncStorage.removeItem(`${key}_fs_size`);
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
        await AsyncStorage.removeItem(`${key}_fs_size`);
        await AsyncStorage.removeItem(`${key}_timestamp`);
        return null;
      }

      // if dont have size in metadata nor in fileInfo, safer to skip reading (avoid OOM)
      if (typeof fileInfo.size !== 'number' && typeof savedSize !== 'number') {
        console.warn(`Cached file ${key} has unknown size. Skipping read and removing file to avoid OOM.`);
        try { await FileSystem.deleteAsync(fileUri, { idempotent: true }); } catch {}
        await AsyncStorage.removeItem(`${key}_fs`);
        await AsyncStorage.removeItem(`${key}_fs_size`);
        await AsyncStorage.removeItem(`${key}_timestamp`);
        return null;
      }

      try {
        const content = await FileSystem.readAsStringAsync(fileUri);
        return JSON.parse(content);
      } catch (err: any) {
        // treat common "file not found" / ENOENT cases without polluting logs
        const msg = String(err?.message || err);
        if (msg.includes('FileNotFoundException') || msg.includes('ENOENT') || msg.includes('open failed')) {
          // file can be deleted between getInfoAsync and read; clean flags and continue
          try {
            await AsyncStorage.removeItem(`${key}_fs`);
            await AsyncStorage.removeItem(`${key}_timestamp`);
          } catch { }
          return null;
        }

        console.error(`Failed to read/parse cache file ${key}:`, err);
        // If reading failed (OOM or corruption), remove the file and flags to prevent repeated failures
        try {
          await FileSystem.deleteAsync(fileUri, { idempotent: true });
        } catch (e) { }
        await AsyncStorage.removeItem(`${key}_fs`);
        await AsyncStorage.removeItem(`${key}_fs_size`);
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
      await AsyncStorage.removeItem(`${key}_fs_size`);
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
    // Clean AsyncStorage
    await AsyncStorage.clear();

    // Clean all cache files from the FileSystem
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

export async function getCacheStats() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter(key => !key.endsWith('_timestamp') && !key.endsWith('_fs') && !key.endsWith('_fs_size'));

    let asyncStorageBytes = 0;
    for (const key of cacheKeys) {
      const value = await AsyncStorage.getItem(key);
      if (typeof value === 'string') {
        asyncStorageBytes += value.length;
      }
    }

    let fileCount = 0;
    let fileBytes = 0;
    const dir = FileSystem.documentDirectory;
    if (dir) {
      const files = await FileSystem.readDirectoryAsync(dir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        fileCount += 1;
        try {
          const info = await FileSystem.getInfoAsync(dir + file);
          if (info.exists && typeof info.size === 'number') {
            fileBytes += info.size;
          }
        } catch (err) {
          console.warn('Failed to read cache file info:', err);
        }
      }
    }

    return {
      keys: cacheKeys,
      keyCount: cacheKeys.length,
      asyncStorageBytes,
      fileCount,
      fileBytes,
      lastUpdated: Date.now(),
    };
  } catch (error) {
    console.error('Failed to compute cache stats:', error);
    return {
      keys: [] as string[],
      keyCount: 0,
      asyncStorageBytes: 0,
      fileCount: 0,
      fileBytes: 0,
      lastUpdated: Date.now(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function forceRefreshMainCaches(): Promise<void> {
  try {
    const entries = Object.values(CACHE_KEYS);
    await Promise.all(entries.map(key => clearCache(key)));
  } catch (error) {
    console.error('Failed to refresh caches:', error);
    throw error;
  }
}

export const CacheManager = {
  getCacheStats,
  clearAllCache,
  clearCache,
  forceRefreshMainCaches,
};

// Cache keys constants
export const CACHE_KEYS = {
  LINES: 'bus_lines',
  LINES_DADOS: 'bus_lines_dados',
  FROTA: 'frota_operadora',
  STOPS: 'bus_stops',
  STOP_DADOS: 'stop_dados',
  BUSES: 'bus_positions',
  BUS_HORARIO: 'bus_hours',
  BUS_HORARIO_DADOS: 'bus_hours_dados',
  NUMEROS_BUS_DADOS: 'numeros_bus_dados',
} as const;