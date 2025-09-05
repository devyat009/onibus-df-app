import { useCallback, useEffect, useState } from 'react';
import { CACHE_KEYS, getCacheData, setCacheData } from '../utils/asyncStorage';

interface UseFavoritesResult {
  favorites: string[];
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
  setFavorites: (favorites: string[]) => void;
}

export const useFavorites = (cacheKey: string): UseFavoritesResult => {
  const [favorites, setFavorites] = useState<string[]>([]);

  // Carregar favoritos do cache
  useEffect(() => {
    const loadFavorites = async () => {
      try {
        const data = await getCacheData<string[]>(cacheKey);
        if (Array.isArray(data)) {
          setFavorites(data);
        }
      } catch (error) {
        console.error('Erro ao carregar favoritos:', error);
      }
    };

    loadFavorites();
  }, [cacheKey]);

  // Salvar favoritos no cache quando mudarem
  useEffect(() => {
    const saveFavorites = async () => {
      try {
        await setCacheData(cacheKey, favorites);
      } catch (error) {
        console.error('Erro ao salvar favoritos:', error);
      }
    };

    if (favorites.length > 0 || favorites.length === 0) {
      saveFavorites();
    }
  }, [favorites, cacheKey]);

  const isFavorite = useCallback((id: string): boolean => {
    return favorites.includes(id);
  }, [favorites]);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites(prev => 
      prev.includes(id) 
        ? prev.filter(fav => fav !== id)
        : [...prev, id]
    );
  }, []);

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
