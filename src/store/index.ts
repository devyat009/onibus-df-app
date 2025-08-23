import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { AppTheme, Bus, BusLine, BusStop, MapState, MapStyle, TrafficJam, UserLocation } from '../types';

interface AppState extends MapState {
  // App theme (separate from map theme)
  appTheme: AppTheme;
  
  // Bus filter settings
  busTimeFilter: '30min' | '24h';
  
  // Data state
  buses: Bus[];
  stops: BusStop[];
  lines: BusLine[];
  traffic: TrafficJam[];
  userLocation: UserLocation | null;
  
  // UI state
  showTraffic: boolean;
  
  // Loading states
  loading: {
    buses: boolean;
    stops: boolean;
    lines: boolean;
    traffic: boolean;
    location: boolean;
  };
  
  // Error states
  errors: {
    buses: string | null;
    stops: string | null;
    lines: string | null;
    traffic: string | null;
    location: string | null;
  };
  
  // Cache timestamps
  lastUpdated: {
    buses: number | null;
    stops: number | null;
    lines: number | null;
    traffic: number | null;
  };
  
  // Actions
  setMapCenter: (latitude: number, longitude: number) => void;
  setMapZoom: (zoom: number) => void;
  setMapStyle: (style: MapStyle) => void;
  setAppTheme: (theme: AppTheme) => void;
  setBusTimeFilter: (filter: '30min' | '24h') => void;
  setShowBuses: (show: boolean) => void;
  setShowStops: (show: boolean) => void;
  setShowOnlyActiveBuses: (show: boolean) => void;
  setShowTraffic: (show: boolean) => void;
  setSelectedLines: (lines: string[]) => void;
  addSelectedLine: (line: string) => void;
  removeSelectedLine: (line: string) => void;
  
  setBuses: (buses: Bus[]) => void;
  setStops: (stops: BusStop[]) => void;
  setLines: (lines: BusLine[]) => void;
  setTraffic: (traffic: TrafficJam[]) => void;
  setUserLocation: (location: UserLocation | null) => void;
  
  setLoading: (key: keyof AppState['loading'], loading: boolean) => void;
  setError: (key: keyof AppState['errors'], error: string | null) => void;
  
  clearErrors: () => void;
  clearData: () => void;
}

const initialState = {
  // App theme
  appTheme: 'light' as AppTheme,
  
  // Bus filter (default 30min)
  busTimeFilter: '30min' as '30min' | '24h',
  
  // Map state
  center: {
    latitude: -15.793782954386705,
    longitude: -47.882705972050054,
  },
  zoom: 15,
  style: 'light' as MapStyle,
  showBuses: true,
  showStops: true,
  showOnlyActiveBuses: false,
  showTraffic: false,
  selectedLines: [],
  
  // Data state
  buses: [],
  stops: [],
  lines: [],
  traffic: [],
  userLocation: null,
  
  // Loading states
  loading: {
    buses: false,
    stops: false,
    lines: false,
    traffic: false,
    location: false,
  },
  
  // Error states
  errors: {
    buses: null,
    stops: null,
    lines: null,
    traffic: null,
    location: null,
  },
  
  // Cache timestamps
  lastUpdated: {
    buses: null,
    stops: null,
    lines: null,
    traffic: null,
  },
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...initialState,
      
      // Map actions
      setMapCenter: (latitude, longitude) =>
        set(state => ({
          center: { latitude, longitude },
        })),
      
      setMapZoom: (zoom) =>
        set({ zoom }),
      
      setMapStyle: (style) =>
        set({ style }),
      
      setAppTheme: (appTheme) =>
        set({ appTheme }),
      
      setBusTimeFilter: (busTimeFilter) =>
        set({ busTimeFilter }),
      
      setShowBuses: (showBuses) =>
        set({ showBuses }),
      
      setShowStops: (showStops) =>
        set({ showStops }),
      
      setShowOnlyActiveBuses: (showOnlyActiveBuses) =>
        set({ showOnlyActiveBuses }),
      
      setShowTraffic: (showTraffic) =>
        set({ showTraffic }),
      
      setSelectedLines: (selectedLines) =>
        set({ selectedLines }),
      
      addSelectedLine: (line) =>
        set(state => ({
          selectedLines: state.selectedLines.includes(line)
            ? state.selectedLines
            : [...state.selectedLines, line],
        })),
      
      removeSelectedLine: (line) =>
        set(state => ({
          selectedLines: state.selectedLines.filter(l => l !== line),
        })),
      
      // Data actions
      setBuses: (buses) =>
        set({
          buses,
          lastUpdated: { ...get().lastUpdated, buses: Date.now() },
        }),
      
      setStops: (stops) =>
        set({
          stops,
          lastUpdated: { ...get().lastUpdated, stops: Date.now() },
        }),
      
      setLines: (lines) =>
        set({
          lines,
          lastUpdated: { ...get().lastUpdated, lines: Date.now() },
        }),

      setTraffic: (traffic) =>
        set({
          traffic,
          lastUpdated: { ...get().lastUpdated, traffic: Date.now() },
        }),
      
      setUserLocation: (userLocation) =>
        set({ userLocation }),
      
      // Loading actions
      setLoading: (key, loading) =>
        set(state => ({
          loading: { ...state.loading, [key]: loading },
        })),
      
      // Error actions
      setError: (key, error) =>
        set(state => ({
          errors: { ...state.errors, [key]: error },
        })),
      
      clearErrors: () =>
        set({
          errors: {
            buses: null,
            stops: null,
            lines: null,
            traffic: null,
            location: null,
          },
        }),
      
      clearData: () =>
        set({
          buses: [],
          stops: [],
          lines: [],
          traffic: [],
          userLocation: null,
          lastUpdated: {
            buses: null,
            stops: null,
            lines: null,
            traffic: null,
          },
        }),
    }),
    {
      name: 'bus-tracker-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist user preferences, not data
      partialize: (state) => ({
        appTheme: state.appTheme,
        style: state.style,
        showBuses: state.showBuses,
        showStops: state.showStops,
        showOnlyActiveBuses: state.showOnlyActiveBuses,
        showTraffic: state.showTraffic,
        selectedLines: state.selectedLines,
      }),
    }
  )
);

// Selectors for computed values
export const selectFilteredBuses = (state: AppState): Bus[] => {
  let filtered = state.buses;
  
  if (state.showOnlyActiveBuses) {
    filtered = filtered.filter(bus => bus.active);
  }
  
  if (state.selectedLines.length > 0) {
    filtered = filtered.filter(bus =>
      state.selectedLines.some(line =>
        bus.linha.toLowerCase().includes(line.toLowerCase())
      )
    );
  }
  
  return filtered;
};

export const selectAvailableLines = (state: AppState): string[] => {
  const lines = new Set<string>();
  
  state.buses.forEach(bus => {
    if (bus.linha && bus.linha.trim()) {
      lines.add(bus.linha.trim());
    }
  });
  
  return Array.from(lines).sort();
};

export const selectHasAnyErrors = (state: AppState): boolean => {
  return Object.values(state.errors).some(error => error !== null);
};

export const selectIsLoading = (state: AppState): boolean => {
  return Object.values(state.loading).some(loading => loading);
};
