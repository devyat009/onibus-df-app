import {
  ApiResponse,
  MapBounds
} from '../types';
import appConfig from '../utils/config';
import { ApiError } from './apiError';
import { BusService } from './busService';
import { FrotaService } from './frotaService';
import { StopService } from './stopService';

const DEFAULT_DF_BOUNDS: MapBounds = {
  north: -15.43,
  south: -16.06,
  east: -47.33,
  west: -48.12,
};

export class ApiService {
  private get baseUrl(): string {
    return appConfig.api.baseUrl;
  }

  constructor(
    private frotaService: FrotaService,
  ) {
  }

  async makeRequest<T>(endpoint: string, bounds?: MapBounds, useGeoserver: boolean = false): Promise<ApiResponse<T>> {
    try {
      let url: string;
      
      if (useGeoserver) {
        // Use geoserver for legacy endpoints
        const geoserverUrl = appConfig.api.geoserverUrl;
        url = `${geoserverUrl}?${endpoint}`;
      } else {
        // Use new API baseUrl for new endpoints
        url = endpoint.startsWith('/') ? `${this.baseUrl}${endpoint}` : `${this.baseUrl}?${endpoint}`;
      }

      const effectiveBounds =
        bounds || (useGeoserver && endpoint === appConfig.api.endpoints.geoOnibusPosicao ? DEFAULT_DF_BOUNDS : undefined);

      if (effectiveBounds && useGeoserver) {
        // Normalize bounds to ensure correct min/max values with high precision
        const minX = Math.min(effectiveBounds.west, effectiveBounds.east).toFixed(8);
        const maxX = Math.max(effectiveBounds.west, effectiveBounds.east).toFixed(8);
        const minY = Math.min(effectiveBounds.south, effectiveBounds.north).toFixed(8);
        const maxY = Math.max(effectiveBounds.south, effectiveBounds.north).toFixed(8);

        const bbox = `${minX},${minY},${maxX},${maxY},EPSG:4326`;
        url += `&bbox=${bbox}&srsName=EPSG:4326`;
      }

      console.log('[ApiService] Requesting URL:', url);
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
        },
        cache: 'no-store',
      });

      const contentType = response.headers.get('content-type') || '';

      if (!response.ok) {
        let errorBody: any = undefined;
        try {
          if (contentType.includes('application/json')) {
            errorBody = await response.json();
          } else {
            errorBody = await response.text();
          }
        } catch {
          errorBody = 'Erro ao ler corpo da resposta';
        }

        throw new ApiError('API_ERROR', `HTTP ${response.status} - ${response.statusText}`, {
          status: response.status,
          statusText: response.statusText,
          url,
          body: errorBody,
        });
      }

      // Só tenta parsear como JSON se o content-type for correto
      if (!contentType.includes('application/json')) {
        const text = await response.text();
        throw new ApiError('API_ERROR', 'Resposta não é JSON', {
          status: response.status,
          statusText: response.statusText,
          url,
          body: text,
          contentType,
          headers: Object.fromEntries(response.headers.entries()),
        });
      }

      const data = await response.json();
      return data as ApiResponse<T>;
    } catch (error: any) {
      const context = {
        endpoint,
        bounds,
        useGeoserver,
        message: error?.message,
        name: error?.name,
        code: error?.code,
        details: error?.details,
        stack: error?.stack,
        type: typeof error,
      };

      if (error instanceof ApiError) {
        console.error('[ApiService] ApiError caught in makeRequest:', context);
        throw error;
      }
      console.error('[ApiService] Unexpected error in makeRequest:', context);
      throw new ApiError('NETWORK_ERROR', `Failed to fetch data: ${error?.message || error}`, {
        originalError: error,
        stack: error?.stack,
      });
    }
  }

}

export { ApiError };

// Create singleton instances with circular dependency resolution
const frotaServiceInstance = new FrotaService(null as any);
const busServiceInstance = new BusService(null as any, frotaServiceInstance);
const stopServiceInstance = new StopService(null as any, busServiceInstance);
const apiServiceInstance = new ApiService(frotaServiceInstance);

// Inject the correct ApiService instance into FrotaService and BusService
(frotaServiceInstance as any).apiService = apiServiceInstance;
(busServiceInstance as any).apiService = apiServiceInstance;
(stopServiceInstance as any).apiService = apiServiceInstance;

// Export instances for global use
export const apiService = apiServiceInstance;
export const busService = busServiceInstance;
export const stopService = stopServiceInstance;
export const frotaService = frotaServiceInstance;
export default apiService;
