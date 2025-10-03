import {
  ApiResponse,
  ErrorCode,
  MapBounds
} from '../types';
//import { CACHE_KEYS, CacheOptions, getCachedOrFetch } from '../utils/asyncStorage';
import appConfig from '../utils/config';
import { BusService } from './busService';
import { FrotaService } from './frotaService';
import { StopService } from './stopService';

class ApiError extends Error {
  code: ErrorCode;
  details?: any;

  constructor(code: ErrorCode, message: string, details?: any) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

export class ApiService {
  private baseUrl: string;

  constructor(
    private frotaService: FrotaService,
  ) {
    this.baseUrl = appConfig.api.baseUrl;
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

      if (bounds && useGeoserver) {
        // Normalize bounds to ensure correct min/max values with high precision
        const minX = Math.min(bounds.west, bounds.east).toFixed(8);
        const maxX = Math.max(bounds.west, bounds.east).toFixed(8);
        const minY = Math.min(bounds.south, bounds.north).toFixed(8);
        const maxY = Math.max(bounds.south, bounds.north).toFixed(8);


        if (endpoint === appConfig.api.endpoints.geoParadas2025 || endpoint === appConfig.api.endpoints.geoOnibusPosicao) {
          const bbox = `${minX},${minY},${maxX},${maxY},EPSG:4326`;
          url += `&bbox=${bbox}&srsName=EPSG:4326`;
        }
        // else if (endpoint === appConfig.api.endpoints.geoOnibusPosicao) {
        //   // CQL_FILTER
        //   const polygon = `POLYGON((${minX} ${minY},${maxX} ${minY},${maxX} ${maxY},${minX} ${maxY},${minX} ${minY}))`;
        //   url += `&CQL_FILTER=INTERSECTS(geom_point,${encodeURIComponent(polygon)})`;
        // }
        else {
          // Default bbox parameter for other geoserver endpoints
          const bbox = `${minX},${minY},${maxX},${maxY},EPSG:4326`;
          url += `&bbox=${bbox}&srsName=EPSG:4326`;
        }
      }

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
      if (error instanceof ApiError) {
        throw error;
      }
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

