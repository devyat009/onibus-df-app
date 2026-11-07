import * as Location from 'expo-location';
import { useCallback } from 'react';
import { useAppStore } from '../store';
import { UserLocation } from '../types';

// Abaixo de ~0.75 m/s (~2.7 km/h) o GPS em repouso gera apenas ruído/deriva (multipath)
const MIN_SPEED_MS_THRESHOLD = 0.75;

function parseLocationCoords(location: Location.LocationObject, previousHeading?: number | null): UserLocation {
  const rawSpeedMs = location.coords.speed;
  const accuracy = location.coords.accuracy ?? 999;

  let speedKmh = 0;
  if (
    rawSpeedMs != null &&
    isFinite(rawSpeedMs) &&
    rawSpeedMs >= MIN_SPEED_MS_THRESHOLD &&
    !(accuracy > 25 && rawSpeedMs < 1.5)
  ) {
    speedKmh = rawSpeedMs * 3.6;
  }

  const heading =
    location.coords.heading != null && location.coords.heading >= 0
      ? location.coords.heading
      : (previousHeading ?? null);

  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy || undefined,
    timestamp: location.timestamp,
    speed: speedKmh,
    heading,
  };
}

export const useLocation = () => {
  const { 
    setUserLocation, 
    setLoading, 
    setError,
    userLocation 
  } = useAppStore();

  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      setLoading('location', true);
      setError('location', null);

      const { status } = await Location.requestForegroundPermissionsAsync();
      
      if (status !== 'granted') {
        setError('location', 'Location permission denied');
        return false;
      }

      return true;
    } catch (error) {
      setError('location', 'Failed to request location permission');
      return false;
    } finally {
      setLoading('location', false);
    }
  }, [setLoading, setError]);

  const getCurrentLocation = useCallback(async (): Promise<UserLocation | null> => {
    try {
      setLoading('location', true);
      setError('location', null);

      const hasPermission = await requestPermission();
      if (!hasPermission) {
        console.warn('Permissão negada');
        return null;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 5000,
        distanceInterval: 10,
      });

      const currentLoc = useAppStore.getState().userLocation;
      const userLoc = parseLocationCoords(location, currentLoc?.heading);

      setUserLocation(userLoc);
      return userLoc;
    } catch (error) {
      console.error('Erro ao obter localização:', error);
      setError('location', 'location');
      return null;
    } finally {
      setLoading('location', false);
    }
  }, [setUserLocation, setLoading, setError, requestPermission]);

  const watchLocation = useCallback(async (): Promise<Location.LocationSubscription | null> => {
    try {
      const hasPermission = await requestPermission();
      if (!hasPermission) {
        return null;
      }

      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          const current = useAppStore.getState().userLocation;
          if (current && current.speed !== 0) {
            setUserLocation({ ...current, speed: 0 });
          }
        }, 3500);
      };

      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 1000,
          distanceInterval: 0,
        },
        (location) => {
          resetIdleTimer();
          const currentLoc = useAppStore.getState().userLocation;
          const userLoc = parseLocationCoords(location, currentLoc?.heading);
          setUserLocation(userLoc);
        }
      );

      const originalRemove = subscription.remove.bind(subscription);
      subscription.remove = () => {
        if (idleTimer) clearTimeout(idleTimer);
        originalRemove();
      };

      return subscription;
    } catch (error) {
      setError('location', 'Failed to watch location');
      return null;
    }
  }, [setUserLocation, setError, requestPermission]);

  const clearLocation = useCallback(() => {
    setUserLocation(null);
  }, [setUserLocation]);

  return {
    userLocation,
    getCurrentLocation,
    watchLocation,
    clearLocation,
    requestPermission,
  };
};
