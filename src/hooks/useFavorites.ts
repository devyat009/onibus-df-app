import { useCallback, useEffect, useState } from 'react';
import { CACHE_KEYS, getCacheData, setCacheData } from '../utils/asyncStorage';

interface UseFavoritesResult {
  favorites: string[];
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
  setFavorites: (favorites: string[]) => void;
}

// Estado global compartilhado para favoritos
const favoritesState = {
  buses: [] as string[],
  stops: [] as string[],
  busListeners: new Set<(favorites: string[]) => void>(),
  stopListeners: new Set<(favorites: string[]) => void>(),
};

export const useFavorites = (cacheKey: string): UseFavoritesResult => {
  const isBusCache = cacheKey === CACHE_KEYS.FAVORITES_BUSES;
  const currentFavorites = isBusCache ? favoritesState.buses : favoritesState.stops;
  const currentListeners = isBusCache ? favoritesState.busListeners : favoritesState.stopListeners;
  
  const [favorites, setFavoritesLocal] = useState<string[]>(currentFavorites);

  // Sincronizar com estado global
  useEffect(() => {
    const updateLocal = (newFavorites: string[]) => {
      setFavoritesLocal(newFavorites);
    };

    currentListeners.add(updateLocal);
    setFavoritesLocal(currentFavorites);

    return () => {
      currentListeners.delete(updateLocal);
    };
  }, [currentListeners, currentFavorites]);

  // Carregar favoritos do cache na primeira execução
  useEffect(() => {
    const loadFavorites = async () => {
      try {
        const data = await getCacheData<string[]>(cacheKey);
        if (Array.isArray(data)) {
          if (isBusCache) {
            favoritesState.buses = data;
          } else {
            favoritesState.stops = data;
          }
          
          // Notificar todos os listeners
          currentListeners.forEach(listener => listener(data));
        }
      } catch (error) {
        console.error('Erro ao carregar favoritos:', error);
      }
    };

    loadFavorites();
  }, [cacheKey, isBusCache, currentListeners]);

  const setFavorites = useCallback((newFavorites: string[]) => {
    if (isBusCache) {
      favoritesState.buses = newFavorites;
    } else {
      favoritesState.stops = newFavorites;
    }

    // Salvar no cache
    setCacheData(cacheKey, newFavorites).catch(error => {
      console.error('Erro ao salvar favoritos:', error);
    });

    // Notificar todos os listeners
    currentListeners.forEach(listener => listener(newFavorites));
  }, [cacheKey, isBusCache, currentListeners]);

  const isFavorite = useCallback((id: string): boolean => {
    return favorites.includes(id);
  }, [favorites]);

  const toggleFavorite = useCallback((id: string) => {
    const currentFavs = isBusCache ? favoritesState.buses : favoritesState.stops;
    const newFavorites = currentFavs.includes(id) 
      ? currentFavs.filter(fav => fav !== id)
      : [...currentFavs, id];
    
    setFavorites(newFavorites);
  }, [isBusCache, setFavorites]);

  return {
    favorites,
    isFavorite,
    toggleFavorite,
    setFavorites
  };
};

// Hook específico para favoritos de ônibus
export const useBusFavorites = () => {
  return useFavorites(CACHE_KEYS.FAVORITES_BUSES);
};

// Hook específico para favoritos de paradas
export const useStopFavorites = () => {
  return useFavorites(CACHE_KEYS.FAVORITES_STOPS);
};
