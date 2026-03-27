// Core domain types for the bus tracking application

export interface Bus {
  id: string;
  prefixo: string;
  linha: string;
  latitude: number;
  longitude: number;
  velocidade: number;
  sentido: string;
  direcao?: string;
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
  codigo: number;
  nome: string;
  descricao: string;
  latitude: number;
  longitude: number;
  situacao?: boolean;
}

export interface BusStopDados {
  id: number;
  linParadas: string[]; // Array of "numero - sentido" strings (e.g., "0.011 - CIRCULAR")
}

export interface BusLine {
  id: number;
  linha: string;
  nome: string;
  sentido: string;
  tarifa: number;
  coordinates: [number, number][]; // [lng, lat] format
  tipo: 'LineString' | 'MultiLineString';
}

export interface BusLineV2 {
  numero: string;
  sentido: string;
  geolinhas: { type: string; coordinates: [number, number][] }[];
}

export interface BusHorario {
  id_linha: number;
  id_operadora: number;
  cd_linha: string;
  nm_operadora?: string;
  sentido: string;
  hr_prevista: string;
  tempo_percurso: number;
  dias_semana: string;
  dia_label: string;
  dt_inicio_vigencia?: string;
  dt_final_vigencia?: string;
}

export interface BusHorarioV2 {
  numero_linha: string;
  sentido: string;
  tempo_percurso: number;
  horarios: string[];
}

export interface StopSchedule {
  stop: BusStop;
  lines: {
    line: BusLine;
    schedules: BusHorario[];
  }[];
}

export interface StopScheduleV2 {
  stop: BusStop;
  lines: {
    line: BusLine;
    schedules: BusHorarioV2[];
  }[];
}

export interface RealTimeArrivalEstimate {
  bus: Bus;
  etaMinutes: number;
  distanceMeters: number;
  speedKmh: number;
  isApproaching: boolean;
}

export interface LineRealtimeArrivals {
  line: BusLine;
  arrivals: RealTimeArrivalEstimate[];
}

export type StopRealtimeArrivalsMap = Record<string, LineRealtimeArrivals>;

export interface FrotaOperadora {
  id: string;
  dataReferencia: string;
  servico: string;
  operadora: string;
  numeroVeiculo: string;
  tipoOnibus: string;
}

export interface DadosNumerosVeiculos {
  numero: string;
  descricao: string;
  sentido: string;
  tarifa: string;
  operadoras: {
    id_operadora: number;
    nome: string;
  }
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
  direcao?: string;
  datalocal: string;
  dataregistro?: string;
  tarifa?: number;
}

// New bus position API response types
export interface NewBusGeoApiResponse {
  type: 'FeatureCollection';
  NomeOperadora: string;
  features: {
    type: 'Feature';
    geometry: {
      type: 'Point';
      coordinates: [number, number]; // [longitude, latitude]
    };
    properties: {
      veiculo: {
        prefixo: string;
        numero: string;
        sentido: string;
        linha?: string;
      };
      direcao: string;
      velocidade: string;
      datalocal: string;
    };
  }[];
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

export interface Stop2025ApiProperties {
  id: string;
  cod_parada_v2025: number;
  latitude: number;
  longitude: number;
  endereco: string;
  parada_ativa: boolean;
  tipo_abrigo: string;
}


export interface LineApiProperties {
  id: number;
  linha?: string;
  sentido?: string;
  nome: string;
  tarifa?: number;
  situacao?: string;
  situacao_da_linha?: boolean;
}

export interface LineV2ApiProperties {
  numero: string;
  sentido: string;
  geolinhas: { type: string; coordinates: [number, number][]; }[];
}

export interface FrotaApiProperties {
  id_frota?: string,
  data_referencia?: string,
  servico?: string,
  operadora?: string,
  numero_veiculo?: string,
  tipo_onibus?: string,
}

export interface HorarioApiProperties {
  id_linha?: number;
  id_operadora?: number;
  cd_linha?: string;
  nm_operadora?: string;
  sentido?: string;
  hr_prevista?: string;
  tempo_percurso?: number;
  dias_semana?: string;
  dia_label?: string;
  dt_inicio_vigencia?: string;
  dt_final_vigencia?: string;
}

export interface HorarioV2Api {
  numero: string;
  sentido: string;
  tempo_percurso: number;
  horarios: string[];
}

export interface NumerosDadosApiProperties {
  numero: string;
  descricao: string;
  sentido: string;
  tarifa: string;
  operadoras: {
    id_operadora: number;
    nome: string;
  }[];
}

// App configuration - geo is different than dados 
export interface AppConfig {
  api: {
    baseUrl: string;
    geoserverUrl?: string;
    endpoints: {
      geoOnibusPosicao: string;
      geoParadas: string;
      geoParadas2025: string;
      geoLinhasEspaciais: string;
      geoFrotaOperadora: string;
      geoHorario: string;
      dadosOnibusPosicao: string;
      dadosParadas: string;
      dadosOperadora: string;
      dadosLinhasEspaciais: string; 
      dadosHorario: string;
      dadosNumeros: string;
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
