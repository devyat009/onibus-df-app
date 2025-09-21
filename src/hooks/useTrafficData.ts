import { useCallback, useEffect, useRef } from 'react';
import { wazeTrafficService } from '../services/wazeApi';
import { useAppStore } from '../store';
import { MapBounds } from '../types';

interface UseTrafficDataOptions {
  enabled?: boolean;
  bounds?: MapBounds;
  updateInterval?: number; // em minutos
}

export function useTrafficData({
  enabled = true,
  bounds,
  updateInterval = 2
}: UseTrafficDataOptions = {}) {
  const {
    traffic,
    setTraffic,
    setLoading,
    setError,
    loading,
    errors
  } = useAppStore();

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastBoundsRef = useRef<MapBounds | null>(null);

  // Function to fetch traffic data
  const fetchTrafficData = useCallback(async (mapBounds: MapBounds) => {
    if (!enabled) return;

    try {
      setLoading('traffic', true);
      setError('traffic', null);

      const trafficJams = await wazeTrafficService.getTrafficJams(mapBounds);

      // Debug: Validate data structure
      const validJams = trafficJams.filter(jam => {
        const isValid = jam.lines &&
          Array.isArray(jam.lines) &&
          jam.lines.length >= 2 &&
          jam.lines.every(coord =>
            Array.isArray(coord) &&
            coord.length === 2 &&
            typeof coord[0] === 'number' &&
            typeof coord[1] === 'number' &&
            !isNaN(coord[0]) && !isNaN(coord[1]) &&
            Math.abs(coord[0]) <= 180 && // longitude valid
            Math.abs(coord[1]) <= 90     // latitude valid
          );

        if (!isValid) {
          console.warn('Invalid traffic jam data:', {
            id: jam.id,
            street: jam.street,
            linesLength: jam.lines?.length,
            firstCoord: jam.lines?.[0]
          });
        }

        return isValid;
      });

      // console.log(`Carregados ${validJams.length} dados de trânsito válidos de ${trafficJams.length} totais`);
      setTraffic(validJams);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro ao carregar dados de trânsito';
      setError('traffic', errorMessage);
      console.error('Erro ao buscar dados de trânsito:', error);
    } finally {
      setLoading('traffic', false);
    }
  }, [enabled, setLoading, setError, setTraffic]);

  // Function to check if bounds changed significantly (to avoid unnecessary API calls)
  const boundsChanged = (newBounds: MapBounds, oldBounds: MapBounds | null): boolean => {
    if (!oldBounds) return true;

    const threshold = 0.001; // ~100m difference
    return (
      Math.abs(newBounds.north - oldBounds.north) > threshold ||
      Math.abs(newBounds.south - oldBounds.south) > threshold ||
      Math.abs(newBounds.east - oldBounds.east) > threshold ||
      Math.abs(newBounds.west - oldBounds.west) > threshold
    );
  };

  // Setup interval for automatic updates
  useEffect(() => {
    if (!enabled || !bounds) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Fetch immediately if bounds changed
    if (boundsChanged(bounds, lastBoundsRef.current)) {
      fetchTrafficData(bounds);
      lastBoundsRef.current = bounds;
    }

    // Setup interval for periodic updates
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(() => {
      if (bounds) {
        fetchTrafficData(bounds);
      }
    }, updateInterval * 60 * 1000); // Convert minutes to milliseconds

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, bounds, updateInterval, fetchTrafficData]);

  // Manual refresh function
  const refreshTrafficData = () => {
    if (bounds) {
      fetchTrafficData(bounds);
    }
  };

  // Clear traffic data
  const clearTrafficData = () => {
    setTraffic([]);
    setError('traffic', null);
  };

  return {
    traffic,
    isLoading: loading.traffic,
    error: errors.traffic,
    refreshTrafficData,
    clearTrafficData,
  };
}
