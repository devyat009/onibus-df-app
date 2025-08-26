// Core domain types for the bus tracking application

export interface Bus {
  id: string;
  prefixo: string;
  linha: string;
  latitude: number;
  longitude: number;
  velocidade: number;
  sentido: string;
  datalocal: string;
  dataregistro?: string;
  tarifa?: number;
  active: boolean;
}

// Enhanced Bus with operator information from frota cache
export interface EnhancedBus extends Bus {
  operadora?: {
    nome: string;
    servico: string;
    tipoOnibus: string;
    dataReferencia: string;
  };
  corOperadora?: string;
}

// Traffic data from Waze API
export interface TrafficJam {
  id: string;
  street: string;
  lines: [number, number][];
  speedKMH: number;
  level: number;
  color: string; // Based on level
  pubMillis: number;
  blockDescription: string; // Descricao do bloqueio
  blockType: string; // Tipo do bloqueio
  pattern: any;
}

export interface TrafficAlert {
  id: string;
  level: number;
  color: string;
  street?: string;
  description?: string;
}

export interface BusStop {
  id: string;
  codigo: string;
  nome: string;
  descricao: string;
  latitude: number;
  longitude: number;
  situacao?: string;
}

export interface BusLine {
  id: string;
  codigo: string;
  nome: string;
  servico: string;
  coordinates: [number, number][]; // [lng, lat] format
  tipo: 'LineString' | 'MultiLineString';
}

export interface BusHorario {
  id_linha: number;
  id_operadora: number;
  cd_linha: string;
  rm_operadora: string;
  sentido: string;
  hr_prevista: string;
  tempo_percuso: number;
  dias_semana: string;
  dia_label: string;
}

export interface FrotaOperadora {
  id: string;
  dataReferencia: string;
  servico: string;
  operadora: string;
  numeroVeiculo: string;
  tipoOnibus: string;
}

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface MapState {
  center: {
    latitude: number;
    longitude: number;
  };
  zoom: number;
  style: MapStyle;
  showBuses: boolean;
  showStops: boolean;
  showOnlyActiveBuses: boolean;
  selectedLines: string[];
}

export type MapStyle = 
  | 'light'
  | 'dark'
  | 'osm' 
  | 'stadia_dark' 
  | 'stadia_bright';

export type AppTheme = 'light' | 'dark';

export interface UserLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp: number;
}

export interface ApiResponse<T> {
  type: 'FeatureCollection';
  timeStamp?: string;
  features: {
    type: 'Feature';
    properties: T;
    geometry: {
      type: 'Point' | 'LineString' | 'MultiLineString';
      coordinates: number[] | number[][] | number[][][];
    };
  }[];
}

// API response types
export interface BusApiProperties {
  prefixo: string;
  cd_linha?: string;
  linha?: string;
  servico?: string;
  velocidade: number;
  sentido?: string;
  datalocal: string;
  dataregistro?: string;
  tarifa?: number;
}

export interface StopApiProperties {
  parada?: string;
  cd_parada?: string;
  codigo?: string;
  id?: string;
  descricao?: string;
  ds_ponto?: string;
  nm_parada?: string;
  nome?: string;
  ds_descricao?: string;
  situacao?: string;
  estrutura_de_paragem?: string;
  tipo?: string;
}

export interface LineApiProperties {
  cd_linha?: string;
  linha?: string;
  servico?: string;
  cd_linha_principal?: string;
  codigo?: string;
  cod_linha?: string;
}

export interface FrotaApiProperties {
  id_frota?: string,
  data_referencia?: string,
  servico?: string,
  operadora?: string,
  numero_veiculo?: string,
  tipo_onibus?: string,
}

// App configuration
export interface AppConfig {
  api: {
    baseUrl: string;
    endpoints: {
      buses: string;
      stops: string;
      lines: string;
      frota: string;
      horario: string;
    };
  };
  cache: {
    ttl: number; // Time to live in milliseconds
    maxSize: number;
  };
}

// Cache configuration
export interface CacheOptions {
  ttl?: number; // Time to live in milliseconds
  forceRefresh?: boolean;
}

// Error types
export interface AppError {
  code: string;
  message: string;
  details?: any;
  timestamp: number;
}

export type ErrorCode = 
  | 'NETWORK_ERROR'
  | 'LOCATION_PERMISSION_DENIED'
  | 'LOCATION_UNAVAILABLE'
  | 'API_ERROR'
  | 'CACHE_ERROR'
  | 'UNKNOWN_ERROR';
