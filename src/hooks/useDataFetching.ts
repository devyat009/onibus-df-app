import { useCallback, useEffect } from 'react';
import { ApiError, busService, stopService } from '../services/api';
import { useAppStore } from '../store';
import { MapBounds } from '../types';
import appConfig from '../utils/config';

export const useDataFetching = () => {
  const {
    setBuses,
    setStops,
    setLines,
    setLoading,
    setError,
    lastUpdated,
  } = useAppStore();

  const isCacheValid = useCallback((timestamp: number | null): boolean => {
    if (!timestamp) return false;
    return Date.now() - timestamp < appConfig.cache.ttl;
  }, []);

  const fetchBuses = useCallback(async (bounds?: MapBounds, force = false) => {
    const shouldSkip = !force && isCacheValid(lastUpdated.buses);
    if (shouldSkip) return;

    setLoading('buses', true);
    setError('buses', null);

    try {
      const buses = await busService.getBuses(bounds);
      setBuses(buses);
    } catch (error) {
      const message = error instanceof ApiError 
        ? error.message 
        : 'Failed to fetch buses';
      setError('buses', message);
    } finally {
      setLoading('buses', false);
    }
  }, [setBuses, setLoading, setError, lastUpdated.buses, isCacheValid]);

  const fetchStops = useCallback(async (bounds?: MapBounds, force = false) => {
    const shouldSkip = !force && isCacheValid(lastUpdated.stops);
    if (shouldSkip) return;

    setLoading('stops', true);
    setError('stops', null);

    try {
      const stops = await stopService.getStops(bounds);
      setStops(stops);
    } catch (error) {
      const message = error instanceof ApiError 
        ? error.message 
        : 'Failed to fetch stops';
      setError('stops', message);
    } finally {
      setLoading('stops', false);
    }
  }, [setStops, setLoading, setError, lastUpdated.stops, isCacheValid]);

  const fetchLines = useCallback(async (force = false) => {
    const shouldSkip = !force && isCacheValid(lastUpdated.lines);
    if (shouldSkip) return;

    setLoading('lines', true);
    setError('lines', null);

    try {
      const lines = await busService.getLines();
      setLines(lines);
    } catch (error) {
      const message = error instanceof ApiError 
        ? error.message 
        : 'Failed to fetch lines';
      setError('lines', message);
    } finally {
      setLoading('lines', false);
    }
  }, [setLines, setLoading, setError, lastUpdated.lines, isCacheValid]);

  const refreshAll = useCallback(async (bounds?: MapBounds) => {
    await Promise.all([
      fetchBuses(bounds, true),
      fetchStops(bounds, true),
      fetchLines(true),
    ]);
  }, [fetchBuses, fetchStops, fetchLines]);

  return {
    fetchBuses,
    fetchStops,
    fetchLines,
    refreshAll,
  };
};

export const useAutoRefresh = (bounds?: MapBounds, interval = 10000) => {
  const { fetchBuses } = useDataFetching();

  useEffect(() => {
    if (!bounds) return;

    const intervalId = setInterval(() => {
      fetchBuses(bounds, false); // Use cache when available
    }, interval);

    return () => clearInterval(intervalId);
  }, [fetchBuses, bounds, interval]);
};
