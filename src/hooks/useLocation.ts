import * as Location from 'expo-location';
import { useCallback, useEffect } from 'react';
import { useAppStore } from '../store';
import { UserLocation } from '../types';

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

      const userLoc: UserLocation = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy || undefined,
        timestamp: location.timestamp,
      };

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

      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 5000, // Update every 5 seconds
          distanceInterval: 5, // Update every 5 meters
        },
        (location) => {
          const userLoc: UserLocation = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracy: location.coords.accuracy || undefined,
            timestamp: location.timestamp,
          };
          setUserLocation(userLoc);
        }
      );

      return subscription;
    } catch (error) {
      setError('location', 'Failed to watch location');
      return null;
    }
  }, [setUserLocation, setError, requestPermission]);

  const clearLocation = useCallback(() => {
    setUserLocation(null);
  }, [setUserLocation]);

  // Auto-request location on mount if not already available
  useEffect(() => {
    if (!userLocation) {
      getCurrentLocation();
    }
  }, [getCurrentLocation, userLocation]);

  return {
    userLocation,
    getCurrentLocation,
    watchLocation,
    clearLocation,
    requestPermission,
  };
};
