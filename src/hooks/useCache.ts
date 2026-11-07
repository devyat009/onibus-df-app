import { useCallback, useEffect, useState } from 'react';
import { busService, frotaService } from '../services/api';
import { BusLine, CacheOptions, EnhancedBus, FrotaOperadora, MapBounds } from '../types';
import { CacheManager } from '../utils/cacheManager';

export const useAppCache = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cacheStats, setCacheStats] = useState<any>(null);

  const refreshCacheStats = useCallback(async () => {
    try {
      const stats = await CacheManager.getCacheStats();
      setCacheStats(stats);
    } catch (err) {
      console.error('Failed to get cache stats:', err);
    }
  }, []);

  const clearAllCache = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      await CacheManager.clearAllCache();
      await refreshCacheStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear cache');
    } finally {
      setIsLoading(false);
    }
  }, [refreshCacheStats]);

  const forceRefreshMainCaches = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      await CacheManager.forceRefreshMainCaches();
      await refreshCacheStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh cache');
    } finally {
      setIsLoading(false);
    }
  }, [refreshCacheStats]);

  useEffect(() => {
    refreshCacheStats();
  }, [refreshCacheStats]);

  return {
    isLoading,
    error,
    cacheStats,
    clearAllCache,
    forceRefreshMainCaches,
    refreshCacheStats,
  };
};

export const useCachedLines = (options?: CacheOptions) => {
  const [lines, setLines] = useState<BusLine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLines = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await busService.getLinesCached(options);
      setLines(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch lines');
    } finally {
      setIsLoading(false);
    }
  }, [options]);

  useEffect(() => {
    fetchLines();
  }, [fetchLines]);

  return {
    lines,
    isLoading,
    error,
    refetch: fetchLines,
  };
};

export const useCachedFrota = (options?: CacheOptions) => {
  const [frota, setFrota] = useState<FrotaOperadora[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFrota = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await frotaService.getFrotaCached(options);
      setFrota(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch frota');
    } finally {
      setIsLoading(false);
    }
  }, [options]);

  useEffect(() => {
    fetchFrota();
  }, [fetchFrota]);

  return {
    frota,
    isLoading,
    error,
    refetch: fetchFrota,
  };
};

// Hook for enhanced buses (with operator information)
export const useEnhancedBuses = (bounds?: MapBounds) => {
  const [buses, setBuses] = useState<EnhancedBus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEnhancedBuses = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await busService.getEnhancedBuses(bounds);
      setBuses(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch enhanced buses');
    } finally {
      setIsLoading(false);
    }
  }, [bounds]);

  useEffect(() => {
    fetchEnhancedBuses();
  }, [fetchEnhancedBuses]);

  return {
    buses,
    isLoading,
    error,
    refetch: fetchEnhancedBuses,
  };
};
