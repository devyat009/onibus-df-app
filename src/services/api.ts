import { useAppStore } from '../store';
import {
  ApiResponse,
  Bus,
  BusApiProperties,
  BusHorario,
  BusHorarioV2,
  BusLine,
  BusLineV2,
  BusStop,
  BusStopDados,
  EnhancedBus,
  ErrorCode,
  FrotaApiProperties,
  FrotaOperadora,
  HorarioApiProperties,
  LineApiProperties,
  MapBounds,
  NewBusApiResponse,
  Stop2025ApiProperties,
  StopRealtimeArrivalsMap,
  StopSchedule,
  StopScheduleV2
} from '../types';
//import { CACHE_KEYS, CacheOptions, getCachedOrFetch } from '../utils/asyncStorage';
import { CACHE_KEYS, CacheOptions, getCachedOrFetch } from "@/src/utils/cacheManager";
import appConfig from '../utils/config';
import { buildLineKey, matchesLineNumber, normalizeLineNumber, normalizeSentido, stripLeadingZeros } from '../utils/lineUtils';

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

class ApiService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = appConfig.api.baseUrl;
  }

  private async makeRequest<T>(endpoint: string, bounds?: MapBounds, useGeoserver: boolean = false): Promise<ApiResponse<T>> {
    try {
      let url: string;
      
      if (useGeoserver) {
        // Use geoserver for legacy endpoints
        const geoserverUrl = appConfig.api.geoserverUrl || 'http://geoserver.semob.df.gov.br/geoserver/semob/ows';
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
          // Use CQL_FILTER with INTERSECTS polygon for geoParadas2025
          // Format: POLYGON((lon lat,lon lat,lon lat,lon lat,lon lat))
          const polygon = `POLYGON((${minX} ${minY},${maxX} ${minY},${maxX} ${maxY},${minX} ${maxY},${minX} ${minY}))`;
          url += `&CQL_FILTER=INTERSECTS(geom_point,${encodeURIComponent(polygon)})`;
        } else {
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

  async getBuses(bounds?: MapBounds, timeFilter?: '30min' | '24h'): Promise<Bus[]> {
    // Use filter from store if not provided as parameter
    const filterToUse = timeFilter || useAppStore.getState().busTimeFilter;

    let allBuses: Bus[] = [];
    let shouldUseFallback = false;

    try {
      const geoserverEndpoint = appConfig.api.endpoints.geoOnibusPosicao || appConfig.api.endpoints.dadosOnibusPosicao;
      const response = await this.makeRequest<BusApiProperties>(
        geoserverEndpoint,
        bounds,
        true // Prefer geoserver data when available
      );

      // checks
      if (!response) {
        console.warn('Geoserver returned null/undefined response; using fallback API.');
        shouldUseFallback = true;
      } else if (!response.features) {
        console.warn('Geoserver response missing features property; using fallback API.');
        shouldUseFallback = true;
      } else if (!Array.isArray(response.features)) {
        console.warn('Geoserver response.features is not an array; using fallback API.');
        shouldUseFallback = true;
      } else {
        const transformed = response.features
          .map(feature => this.transformBusFromApi(feature))
          .filter((bus): bus is Bus => bus !== null);

        allBuses = transformed;
      }
    } catch (error) {
      console.warn('Failed to fetch buses from geoserver (error caught), falling back to new API:', error);
      shouldUseFallback = true;
    }

    // fallback only if geoserver failed
    if (shouldUseFallback) {
      console.warn('Using new bus API fallback.');
      allBuses = await this.fetchBusesFromNewApi();
    }

    function filterActiveBusesRecent(buses: Bus[], filter: '30min' | '24h' = '30min'): Bus[] {
      const now = Date.now();
      const TWENTY_FOUR_HOURS = 9999999999 * 60 * 60 * 1000; // all time
      const TWO_HOURS = 2 * 60 * 60 * 1000; // 2 horas para captar mais ônibus

      const timeLimit = filter === '24h' ? TWENTY_FOUR_HOURS : TWO_HOURS;

      const validBuses = buses.filter(bus => {
        if (!bus.datalocal && !bus.dataregistro) return false;

        let busTime: number;

        if (bus.dataregistro) {
          // dataregistro já está em formato ISO UTC
          busTime = new Date(bus.dataregistro).getTime();
        } else {
          // datalocal precisa ser convertido corretamente
          const isoString = bus.datalocal.includes('T')
            ? bus.datalocal
            : bus.datalocal.replace(' ', 'T');
          busTime = new Date(isoString).getTime();
        }

        if (isNaN(busTime)) return false;
        const timeDiff = now - busTime;
        return timeDiff >= 0 && timeDiff <= timeLimit;
      });

      return validBuses;
    }

    const timeFilteredBuses = filterActiveBusesRecent(allBuses, filterToUse);
    if (bounds) {
      // console.log('Bounds filter:', bounds);
      // console.log('Buses before bounds filter:', timeFilteredBuses.length);
    }
    const inViewBuses = bounds
      ? timeFilteredBuses.filter(bus => this.isBusInBounds(bus, bounds))
      : timeFilteredBuses;
    if (bounds) {
      // console.log('Buses after bounds filter:', inViewBuses.length);
      if (inViewBuses.length === 0 && timeFilteredBuses.length > 0) {
      // console.log('Sample bus coords:', { lat: timeFilteredBuses[0].latitude, lng: timeFilteredBuses[0].longitude });
      }
    }

    return inViewBuses;
    //return allBuses;
  }

  /**
   * Fetch buses from the new API endpoint
   */
  private async fetchBusesFromNewApi(): Promise<Bus[]> {
    try {
      // console.log('Fetching buses from new API:', `${this.baseUrl}${appConfig.api.endpoints.buses}`);
      const response = await fetch(`${this.baseUrl}${appConfig.api.endpoints.dadosOnibusPosicao}`, {
        headers: {
          'Accept': 'application/json',
        },
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new ApiError('API_ERROR', `HTTP ${response.status} - ${response.statusText}`, {
          status: response.status,
          statusText: response.statusText,
          url: `${this.baseUrl}${appConfig.api.endpoints.dadosOnibusPosicao}`,
        });
      }

      const data: NewBusApiResponse[] = await response.json();
      // console.log('Raw API response:', { operatorCount: data.length, firstOperator: data[0] });
      const allBuses: Bus[] = [];

      // Process each operator's data
      data.forEach(operatorData => {
        if (operatorData.features && Array.isArray(operatorData.features)) {
          const buses = operatorData.features
            .map(feature => this.transformBusFromNewApi(feature, operatorData.NomeOperadora))
            .filter(bus => bus !== null) as Bus[];
          //console.log(`Operator ${operatorData.NomeOperadora}: ${buses.length} buses`);
          allBuses.push(...buses);
        }
      });

      // console.log(`Total buses fetched from new API: ${allBuses.length}`);
      return allBuses;
    } catch (error: any) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError('NETWORK_ERROR', `Failed to fetch bus data: ${error?.message || error}`, {
        originalError: error,
        stack: error?.stack,
      });
    }
  }

  /**
   * Get buses enhanced with operator information from frota cache
   * This method merges bus data with frota data based on prefixo/numeroVeiculo
   */
  async getEnhancedBuses(bounds?: MapBounds, timeFilter?: '30min' | '24h'): Promise<EnhancedBus[]> {
    // Use filter from store if not provided as parameter
    const filterToUse = timeFilter || useAppStore.getState().busTimeFilter;

    // Get buses and frota data in parallel
    const [buses, frota] = await Promise.all([
      this.getBuses(bounds, filterToUse),
      this.getFrotaCached() // Use cached frota data
    ]);

    // console.log(`Enhanced buses - got ${buses.length} buses from getBuses`);
    // console.log(`Enhanced buses - got ${frota.length} frota entries`);

    // Create a map of numeroVeiculo -> FrotaOperadora for fast lookup
    const frotaMap = new Map<string, FrotaOperadora>();
    frota.forEach(item => {
      if (item.numeroVeiculo) {
        frotaMap.set(item.numeroVeiculo, item);
      }
    });

    // console.log(`Enhanced buses - created frotaMap with ${frotaMap.size} entries`);

    // Enhance buses with operator information
    const enhancedBuses = buses.map(bus => this.enhanceBusWithOperator(bus, frotaMap));

    // console.log(`Enhanced buses - returning ${enhancedBuses.length} enhanced buses`);

    return enhancedBuses;
  }

  /**
   * Enhance a single bus with operator information
   */
  private enhanceBusWithOperator(bus: Bus, frotaMap: Map<string, FrotaOperadora>): EnhancedBus {
    const frotaInfo = frotaMap.get(bus.prefixo);

    // Mapeamento das operadoras principais e suas cores
    const operadorasPrincipais: { [key: string]: { nome: string; cor: string } } = {
      'URBI': { nome: 'URBI', cor: '#00bfffff' }, // Light blue
      'PIONEIRA': { nome: 'PIONEIRA', cor: '#ffdd00ff' }, // Yellow
      'PIRACICABANA': { nome: 'PIRACICABANA', cor: '#006400' }, // Dark green
      'MARECHAL': { nome: 'MARECHAL', cor: '#fb6900' }, // Orange
      'SÃO JOSÉ': { nome: 'SÃO JOSÉ', cor: '#7af200' }, // #938326 before, now is #7af200 and is called BsBus
      'UNIÃO TRANSPORTE BRASÍLIA': { nome: 'UNIÃO TRANSPORTE BRASÍLIA', cor: '#00ffff' }, // Blue cyano
    };

    let nomeOperadora = frotaInfo?.operadora || '';
    let corOperadora: string | undefined = undefined;

    // Detect operadora by keywords in the name (ignoring case) and assign the corresponding color
    let found = false;
    for (const key in operadorasPrincipais) {
      if (nomeOperadora.toUpperCase().includes(key)) {
        nomeOperadora = operadorasPrincipais[key].nome;
        corOperadora = operadorasPrincipais[key].cor;
        found = true;
        break;
      }
    }
    // If not found in main operators, assign a default color
    if (!found && nomeOperadora) {
      corOperadora = '#5a4799';
    }

    // Ensure there is always a color, even without an operator
    if (!corOperadora) {
      corOperadora = '#5a4799';
    }

    const enhancedBus: EnhancedBus = {
      ...bus,
      operadora: frotaInfo
        ? {
          nome: nomeOperadora,
          servico: frotaInfo.servico,
          tipoOnibus: frotaInfo.tipoOnibus,
          dataReferencia: frotaInfo.dataReferencia,
        }
        : undefined,
      corOperadora,
    };

    return enhancedBus;
  }

  async getStops(bounds?: MapBounds): Promise<BusStop[]> {
    let endpoint = appConfig.api.endpoints.geoParadas2025;

    const response = await this.makeRequest<Stop2025ApiProperties>(
      endpoint,
      bounds,
      true // Use geoserver for stops
    );

    const stops = response.features
      .map(feature => this.transformStop2025FromApi(feature))
      .filter((stop): stop is BusStop => !!stop && stop.situacao !== false);

    // console.log('Successfully loaded ' + stops.length + ' stops from geoserver (server-side filtered)');
    return stops;
  }

  async getStopDados(): Promise<BusStopDados[]> {
    const response = await fetch(`${this.baseUrl}${appConfig.api.endpoints.dadosParadas}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch stop: ${response.statusText}`);
    }

    const data = await response.json();
    const entries = Array.isArray(data) ? data : (data?.paradas ?? []);

    return entries
      .map((entry: any) => {
        const id = Number(entry?.codParada ?? entry?.id);
        if (!Number.isFinite(id)) return null;

        let linhas = entry?.linParadaSentido ?? entry?.linParadas ?? [];
        if (typeof linhas === 'string') {
          linhas = linhas.split(/[,;]\s*/).filter(Boolean);
        }
        if (!Array.isArray(linhas)) {
          linhas = [];
        }

        return {
          id,
          linParadas: linhas.map(String),
        };
      })
      .filter((item: BusStopDados): item is BusStopDados => item !== null);
  }

  async getLines(): Promise<BusLine[]> {
    const response = await this.makeRequest<LineApiProperties>(
      appConfig.api.endpoints.geoLinhasEspaciais,
      undefined,
      true // Use geoserver for lines
    );

    return response.features
      .map(feature => this.transformLineFromApi(feature))
      .filter(line => line !== null) as BusLine[];
  }

  async getLinesV2(): Promise<BusLineV2[]> {
    const response = await fetch(`${this.baseUrl}${appConfig.api.endpoints.dadosLinhasEspaciais}`, {
      headers: {
        'Accept': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch lines V2: ${response.statusText}`);
    }

    const data = await response.json();

    // API returns array directly, not wrapped in features
    const rawFeatures = Array.isArray(data) ? data : [];

    const lines = rawFeatures
      .map((feature: any) => this.transformLineV2FromApi(feature))
      .filter((line: BusLineV2 | null): line is BusLineV2 => line !== null);

    return lines;
  }
  // Cached version of getLines - data persists for 3 days
  async getLinesCached(options?: CacheOptions): Promise<BusLine[]> {
    return getCachedOrFetch(
      CACHE_KEYS.LINES,
      () => this.getLines(),
      options
    );
  }

  async getLinesV2Cached(options?: CacheOptions): Promise<BusLineV2[]> {
    return getCachedOrFetch(
      CACHE_KEYS.LINES_DADOS,
      () => this.getLinesV2(),
      options
    );
  }

  async getFrota(): Promise<FrotaOperadora[]> {
    const response = await this.makeRequest<FrotaOperadora>(
      appConfig.api.endpoints.geoFrotaOperadora,
      undefined,
      true // Use geoserver for frota
    );

    return response.features
      .map(feature => this.transformFrotaFromApi(feature))
      .filter(frota => frota !== null) as FrotaOperadora[];
  }

  // Cached version of getFrota - data persists for 3 days
  async getFrotaCached(options?: CacheOptions): Promise<FrotaOperadora[]> {
    return getCachedOrFetch(
      CACHE_KEYS.FROTA,
      () => this.getFrota(),
      options
    );
  }

  // Cached version of getStops - data persists for shorter time as stops change more frequently
  async getStopsCached(bounds?: MapBounds, options?: CacheOptions): Promise<BusStop[]> {
    const cacheKey = bounds
      ? `${CACHE_KEYS.STOPS}_${bounds.north}_${bounds.south}_${bounds.east}_${bounds.west}`
      : CACHE_KEYS.STOPS;

    return getCachedOrFetch(
      cacheKey,
      () => this.getStops(bounds),
      { ttl: 30 * 60 * 1000, ...options } // 30 minutes default TTL for stops
    );
  }

  async getStopDadosCached(options?: CacheOptions): Promise<BusStopDados[]> {
    return getCachedOrFetch(
      CACHE_KEYS.STOP_DADOS,
      () => this.getStopDados(),
      options
    );
  }

  // Cached version of getHorario
  async getHorarioCached(options?: CacheOptions): Promise<BusHorario[]> {
    return getCachedOrFetch(
      CACHE_KEYS.BUS_HORARIO,
      () => this.getHorario(),
      options
    );
  }

  async getHorarioV2Cached(options?: CacheOptions): Promise<BusHorarioV2[]> {
    return getCachedOrFetch(
      CACHE_KEYS.BUS_HORARIO_DADOS,
      () => this.getHorarioV2(),
      options
    );
  }


  /**
   * Calculate if a bus line passes through a stop using proximity analysis
   * Both coordinates should be in the same projection system
   */
  private doesLinePassThroughStop(line: BusLine, stop: BusStop, tolerance: number = 500): boolean {
    if (!line.coordinates || line.coordinates.length === 0) {
      return false;
    }

    // Check if any segment of the line is within tolerance distance of the stop
    const stopCoords = [stop.longitude, stop.latitude];


    // Quick bounds check first to avoid expensive calculations
    const lineBounds = this.getLineBounds(line.coordinates);
    const stopBuffer = tolerance / 111320; // Convert meters to degrees (approximate)

    if (stopCoords[1] < lineBounds.minLat - stopBuffer ||
      stopCoords[1] > lineBounds.maxLat + stopBuffer ||
      stopCoords[0] < lineBounds.minLng - stopBuffer ||
      stopCoords[0] > lineBounds.maxLng + stopBuffer) {
      // console.log(`Line ${line.codigo} is outside bounds for stop ${stop.codigo}`);
      return false;
    }

    // Check distance to each line segment
    for (let i = 0; i < line.coordinates.length - 1; i++) {
      const point1 = line.coordinates[i];
      const point2 = line.coordinates[i + 1];

      // Skip invalid coordinates
      if (!point1 || !point2 || point1.length < 2 || point2.length < 2) {
        continue;
      }

      // Fast pre-check: if both points are far away, skip Haversine calculation
      if (
        Math.abs(point1[0] - stopCoords[0]) > 0.05 && // ~5km
        Math.abs(point2[0] - stopCoords[0]) > 0.05 &&
        Math.abs(point1[1] - stopCoords[1]) > 0.05 &&
        Math.abs(point2[1] - stopCoords[1]) > 0.05
      ) {
        continue;
      }

      const distance = this.pointToLineDistance(stopCoords, point1, point2);
      if (distance <= tolerance) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get bounds of a line for quick filtering
   */
  private getLineBounds(coordinates: [number, number][]): { minLat: number, maxLat: number, minLng: number, maxLng: number } {
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    coordinates.forEach(([lng, lat]) => {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    });

    return { minLat, maxLat, minLng, maxLng };
  }

  /**
   * Calculate distance from a point to a line segment using Haversine formula for geographic coordinates
   */
  private pointToLineDistance(point: number[], lineStart: number[], lineEnd: number[]): number {
    if (!point || !lineStart || !lineEnd ||
      point.length < 2 || lineStart.length < 2 || lineEnd.length < 2) {
      return Infinity;
    }

    const [px, py] = point; // px = longitude, py = latitude
    const [x1, y1] = lineStart;
    const [x2, y2] = lineEnd;

    // Validate coordinates
    if (isNaN(px) || isNaN(py) || isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) {
      return Infinity;
    }

    // Calculate the distance from point to line segment
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;

    if (lenSq === 0) {
      // Line segment is actually a point - calculate distance using Haversine
      return this.haversineDistance(y1, x1, py, px); // latitude, longitude
    }

    let param = dot / lenSq;

    if (param < 0) {
      param = 0;
    } else if (param > 1) {
      param = 1;
    }

    const xx = x1 + param * C;
    const yy = y1 + param * D;

    // Use Haversine distance for geographic coordinates
    return this.haversineDistance(yy, xx, py, px); // latitude, longitude
  }

  /**
   * Calculate distance between two points using Haversine formula (returns distance in meters)
   */
  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // Earth's radius in meters
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Get schedule information for a specific bus stop
   */
  async getStopSchedule(stop: BusStop): Promise<StopSchedule> {
    console.log(`Getting schedule for stop: ${stop.codigo} - ${stop.nome}`);

    const [lines, horarios] = await Promise.all([
      this.getLinesCached(),
      this.getHorarioCached()
    ]);

    console.log(`Loaded ${lines.length} lines and ${horarios.length} schedules`);

    let relevantLines: BusLine[] = [];


    // If still no matches, try proximity algorithm with multiple tolerances
    if (relevantLines.length === 0) {
      console.log('Strategy 2 failed, trying strategy 3: Proximity algorithm...');
      const tolerances = [100, 300, 500, 1000, 2000]; // Try increasing distances

      for (const tolerance of tolerances) {
        console.log(`Trying proximity with ${tolerance}m tolerance...`);
        relevantLines = lines.filter(line => {
          const passesThrough = this.doesLinePassThroughStop(line, stop, tolerance);
          if (passesThrough) {
            console.log(`Strategy 3: Line ${line.codigo} passes through stop ${stop.codigo} with ${tolerance}m tolerance`);
          }
          return passesThrough;
        });

        if (relevantLines.length > 0) {
          console.log(`Found ${relevantLines.length} lines with ${tolerance}m tolerance`);
          break;
        }
      }
    }

    console.log(`Found ${relevantLines.length} lines that might serve stop ${stop.codigo}`);

    // Group schedules by line
    const linesWithSchedules = relevantLines.map(line => {
      const lineSchedules = horarios.filter(horario =>
        horario.cd_linha === line.codigo
      );

      console.log(`Line ${line.codigo} has ${lineSchedules.length} schedules`);

      return {
        line,
        schedules: lineSchedules.sort((a, b) => a.hr_prevista.localeCompare(b.hr_prevista))
      };
    }).filter(item => item.schedules.length > 0);

    console.log(`Final result: ${linesWithSchedules.length} lines with schedules`);

    return {
      stop,
      lines: linesWithSchedules
    };
  }

  async getStopScheduleV2(stop: BusStop): Promise<StopScheduleV2> {
    console.log(`[GETSTOPSCHEDULEV2] Getting V2 schedule for stop: ${stop.codigo} - ${stop.nome}`);
    const lines = await this.getLinesV2();
    const horarios = await this.getHorarioV2Cached();
    const paradas = await this.getStopDadosCached();

    // console.log(`[GETSTOPSCHEDULEV2] Loaded ${lines.length} lines and ${horarios.length} schedules`);
    // console.log(`[GETSTOPSCHEDULEV2] Finding lines that serve stop ${stop.codigo}`);

    // Helper function to map full sentido to abbreviated sentido
    const mapSentidoToAbbreviation = (sentido: string): string => {
      const upperSentido = sentido.toUpperCase();
      if (upperSentido === 'IDA') return 'I';
      if (upperSentido === 'VOLTA') return 'V';
      if (upperSentido === 'CIRCULAR') return 'C';
      // Return first letter as fallback
      return upperSentido.charAt(0);
    };

    let relevantLines: BusLineV2[] = [];

    if (Array.isArray(paradas)) {
      for (const parada of paradas) {
        if (parada.id === Number(stop.codigo)) {
          // console.log(`[GETSTOPSCHEDULEV2] Found matching parada for stop ${stop.codigo}:`, parada);
          
          for (const bus of parada.linParadas) {
            // Parse "0.011 - CIRCULAR" -> numero: "0.011", sentido: "CIRCULAR"
            const parts = bus.split(' - ');
            if (parts.length < 2) continue;
            
            const numero = parts[0].trim();
            const sentido = parts[1].trim();
            
            const matchedLine = lines.find(
              line => line.numero === numero && line.sentido === sentido
            );
            
            if (matchedLine && !relevantLines.includes(matchedLine)) {
              relevantLines.push(matchedLine);
            }
          }
        }
      }
    }
    // console.log(`[GETSTOPSCHEDULEV2] Found ${relevantLines.length} lines that might serve stop ${stop.codigo}`);
    
    const linesWithSchedules = relevantLines.map(line => {
      // Map the full sentido name to its abbreviation for matching with horarios
      const sentidoAbbrev = mapSentidoToAbbreviation(line.sentido);
      
      const matchingSchedules = horarios.filter(
        horario => horario.numero_linha === line.numero && horario.sentido === sentidoAbbrev
      );
      
      // console.log(`[GETSTOPSCHEDULEV2] Line ${line.numero} (${line.sentido} -> ${sentidoAbbrev}): ${matchingSchedules.length} schedules found`);
      if (matchingSchedules.length > 0) {
        // console.log(`[GETSTOPSCHEDULEV2] First schedule sample:`, matchingSchedules[0]);
      }
      
      return {
        line,
        schedules: matchingSchedules
      };
    }).filter(item => item.schedules.length > 0);

    // console.log(`[GETSTOPSCHEDULEV2] Final result: ${linesWithSchedules.length} lines with schedules`);
    // console.log(`[GETSTOPSCHEDULEV2] Complete result:`, JSON.stringify(linesWithSchedules, null, 2));

    return {
      stop,
      lines: linesWithSchedules
    };
  }

  async getRealtimeArrivalsForStop(
    stop: BusStop,
    lines: BusLineV2[],
    options?: {
      radiusMeters?: number;
      maxPerLine?: number;
      maxEtaMinutes?: number;
      maxDistanceToRoute?: number;
    }
  ): Promise<StopRealtimeArrivalsMap> {
    if (!stop || !isFinite(stop.latitude) || !isFinite(stop.longitude) || !Array.isArray(lines) || lines.length === 0) {
      return {};
    }

    const radiusMeters = options?.radiusMeters ?? 1500;
    const maxPerLine = options?.maxPerLine ?? 3;
    const maxEtaMinutes = options?.maxEtaMinutes ?? 90;
    const maxDistanceToRoute = options?.maxDistanceToRoute ?? 600;

    const bounds = this.createBoundsFromRadius(stop.latitude, stop.longitude, radiusMeters);
    const buses = await this.getBuses(bounds);

    if (!buses.length) {
      return {};
    }

    type LineMeta = {
      line: BusLineV2;
      coords: [number, number][];
      cumulative: number[];
      stopIndex: number;
      stopDistance: number;
      sentido: string;
      key: string;
    };

    const flattenLineCoordinates = (line: BusLineV2): [number, number][] => {
      const coords: [number, number][] = [];
      for (const geom of line.geolinhas) {
        if (!geom || !geom.coordinates) continue;

        if (geom.type === 'LineString' && Array.isArray(geom.coordinates)) {
          (geom.coordinates as any[]).forEach(point => {
            if (Array.isArray(point) && point.length >= 2) {
              coords.push([Number(point[0]), Number(point[1])]);
            }
          });
        } else if (geom.type === 'MultiLineString' && Array.isArray(geom.coordinates)) {
          (geom.coordinates as any[]).forEach((segment: any) => {
            if (Array.isArray(segment)) {
              segment.forEach((point: any) => {
                if (Array.isArray(point) && point.length >= 2) {
                  coords.push([Number(point[0]), Number(point[1])]);
                }
              });
            }
          });
        }
      }
      return coords;
    };

    const computeCumulativeDistances = (coords: [number, number][]): number[] => {
      const cumulative: number[] = [0];
      for (let i = 1; i < coords.length; i++) {
        const [prevLng, prevLat] = coords[i - 1];
        const [lng, lat] = coords[i];
        const segment = this.haversineDistance(prevLat, prevLng, lat, lng);
        cumulative[i] = cumulative[i - 1] + (isFinite(segment) ? segment : 0);
      }
      return cumulative;
    };

    const findNearestIndex = (coords: [number, number][], point: [number, number]) => {
      let bestIndex = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      coords.forEach(([lng, lat], index) => {
        const distance = this.haversineDistance(lat, lng, point[1], point[0]);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });
      return { index: bestIndex, distance: bestDistance };
    };

    const metas: LineMeta[] = lines
      .map(line => {
        const coords = flattenLineCoordinates(line);
        if (!coords || coords.length < 2) {
          return null;
        }

        const cumulative = computeCumulativeDistances(coords);
        const stopProjection = findNearestIndex(coords, [stop.longitude, stop.latitude]);

        if (stopProjection.index === -1 || stopProjection.distance > maxDistanceToRoute) {
          return null;
        }

        return {
          line,
          coords,
          cumulative,
          stopIndex: stopProjection.index,
          stopDistance: stopProjection.distance,
          sentido: normalizeSentido(line.sentido),
          key: buildLineKey(line.numero, line.sentido),
        } as LineMeta;
      })
      .filter((meta): meta is LineMeta => meta !== null);

    if (!metas.length) {
      return {};
    }

    const metaBuckets = new Map<string, LineMeta[]>();
    const registerMeta = (key: string, meta: LineMeta) => {
      if (!key) return;
      const list = metaBuckets.get(key) ?? [];
      if (!list.includes(meta)) {
        list.push(meta);
        metaBuckets.set(key, list);
      }
    };

    metas.forEach(meta => {
      const normalized = normalizeLineNumber(meta.line.numero);
      const digits = normalized.replace(/[^0-9]/g, '');
      const trimmedDigits = digits ? stripLeadingZeros(digits) : '';

      [normalized, digits, trimmedDigits].forEach(key => registerMeta(key, meta));
    });

    const result: StopRealtimeArrivalsMap = {};

    const pushArrival = (meta: LineMeta, etaMinutes: number, distance: number, bus: Bus, isApproaching: boolean, speedKmh: number) => {
      const existing = result[meta.key] ?? { line: meta.line, arrivals: [] };
      existing.arrivals.push({
        bus,
        etaMinutes,
        distanceMeters: distance,
        speedKmh,
        isApproaching,
      });
      result[meta.key] = existing;
    };

    buses.forEach(bus => {
      if (!bus || !isFinite(bus.latitude) || !isFinite(bus.longitude)) {
        return;
      }

      const normalized = normalizeLineNumber(bus.linha);
      const digits = normalized.replace(/[^0-9]/g, '');
      const trimmedDigits = digits ? stripLeadingZeros(digits) : '';

      const candidateMetas = new Set<LineMeta>();
      [normalized, digits, trimmedDigits].forEach(key => {
        const bucket = key ? metaBuckets.get(key) : undefined;
        bucket?.forEach(meta => candidateMetas.add(meta));
      });

      if (!candidateMetas.size) {
        return;
      }

      const busSentido = normalizeSentido(bus.sentido);

      candidateMetas.forEach(meta => {
        if (!matchesLineNumber(bus.linha, meta.line.numero)) {
          return;
        }

        if (busSentido && meta.sentido && busSentido !== meta.sentido) {
          return;
        }

        const projection = findNearestIndex(meta.coords, [bus.longitude, bus.latitude]);
        if (projection.index === -1 || projection.distance > maxDistanceToRoute) {
          return;
        }

        const busBeforeStop = projection.index <= meta.stopIndex;
        if (!busBeforeStop) {
          const gap = meta.cumulative[projection.index] - meta.cumulative[meta.stopIndex];
          if (gap > 120) {
            return;
          }
        }

        let distanceAlong = busBeforeStop
          ? meta.cumulative[meta.stopIndex] - meta.cumulative[projection.index]
          : meta.cumulative[projection.index] - meta.cumulative[meta.stopIndex];

        if (!isFinite(distanceAlong) || distanceAlong < 0) {
          distanceAlong = this.haversineDistance(stop.latitude, stop.longitude, bus.latitude, bus.longitude);
        }

        if (!isFinite(distanceAlong) || distanceAlong < 0) {
          return;
        }

        const speedKmh = typeof bus.velocidade === 'number'
          ? bus.velocidade
          : Number(bus.velocidade ?? 0);

        const speedMs = speedKmh > 0 ? (speedKmh * 1000) / 3600 : 0;

        let etaMinutes = speedMs > 0 ? distanceAlong / speedMs / 60 : null;
        if (speedMs === 0) {
          if (distanceAlong <= 60) {
            etaMinutes = 0;
          } else {
            return;
          }
        }

        if (etaMinutes == null || !isFinite(etaMinutes) || etaMinutes < 0) {
          return;
        }

        if (etaMinutes > maxEtaMinutes) {
          return;
        }

        const isApproaching = busBeforeStop || distanceAlong <= 60;
        if (!isApproaching && etaMinutes > 2) {
          return;
        }

        pushArrival(meta, etaMinutes, distanceAlong, bus, isApproaching, speedKmh);
      });
    });

    Object.values(result).forEach(entry => {
      entry.arrivals = entry.arrivals
        .filter(arrival => arrival.etaMinutes >= 0 && arrival.etaMinutes <= maxEtaMinutes)
        .sort((a, b) => a.etaMinutes - b.etaMinutes)
        .slice(0, maxPerLine);
    });

    return result;
  }

  // Cached version of getHorario
  async fetchHorario(): Promise<BusHorario[]> {
    const response = await this.makeRequest<HorarioApiProperties>(
      appConfig.api.endpoints.geoHorario,
      undefined,
      true // Use geoserver for horario
    );

    return response.features
      .map(feature => this.transformHorarioFromApi(feature))
      .filter(horario => horario !== null) as BusHorario[];
  }

  async fetchHorarioV2(): Promise<BusHorarioV2[]> {
    const response = await fetch(`${this.baseUrl}${appConfig.api.endpoints.dadosHorario}`, {
      headers: {
        'Accept': 'application/json',
      },
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new ApiError('API_ERROR', `HTTP ${response.status} - ${response.statusText}`, {
        status: response.status,
        statusText: response.statusText,
        url: `${this.baseUrl}${appConfig.api.endpoints.dadosHorario}`,
      });
    }

    // simple array, not GeoJSON
    const data: any[] = await response.json();
    // console.log('[HORARIOV2] Raw API response:', { itemCount: data.length, firstItem: data[0] });
    // Map to BusHorarioV2
    return data.map(item => ({
      numero_linha: item.numero,
      sentido: item.sentido,
      tempo_percurso: item.tempo_percurso || 0,
      horarios: item.horarios || [],
    }));
  }
  private transformHorarioFromApi(feature: ApiResponse<HorarioApiProperties>['features'][0]): BusHorario | null {
    const { properties } = feature;

    return {
      id_linha: properties.id_linha || 0,
      id_operadora: properties.id_operadora || 0,
      cd_linha: properties.cd_linha || '',
      nm_operadora: properties.nm_operadora || '',
      sentido: properties.sentido || '',
      hr_prevista: properties.hr_prevista || '',
      tempo_percurso: properties.tempo_percurso || 0,
      dias_semana: properties.dias_semana || '',
      dia_label: properties.dia_label || '',
      dt_inicio_vigencia: properties.dt_inicio_vigencia || '',
      dt_final_vigencia: properties.dt_final_vigencia || '',
    };
  }

  async getHorario(): Promise<BusHorario[]> {
    return getCachedOrFetch(
      CACHE_KEYS.BUS_HORARIO,
      () => this.fetchHorario(),
      { ttl: 30 * 60 * 1000 } // 30 minutes default TTL for horario
    );
  }

  async getHorarioV2(): Promise<BusHorarioV2[]> {
    return getCachedOrFetch(
      CACHE_KEYS.BUS_HORARIO_DADOS,
      () => this.fetchHorarioV2(),
      { ttl: 30 * 60 * 1000 } // 30 minutes default TTL for horario
    );
  }

  private transformFrotaFromApi(feature: ApiResponse<FrotaApiProperties>['features'][0]): FrotaOperadora | null {
    const { properties } = feature;

    return {
      id: properties.id_frota || '',
      dataReferencia: properties.data_referencia || '',
      servico: properties.servico || '',
      operadora: properties.operadora || '',
      numeroVeiculo: properties.numero_veiculo || '',
      tipoOnibus: properties.tipo_onibus || '',
    };
  }

  private transformBusFromApi(feature: ApiResponse<BusApiProperties>['features'][0]): Bus | null {
    const { properties, geometry } = feature;

    if (geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) {
      return null;
    }

    const [longitude, latitude] = geometry.coordinates as [number, number];

    if (!properties.prefixo) {
      return null;
    }

    return {
      id: properties.prefixo,
      prefixo: properties.prefixo,
      linha: properties.cd_linha || properties.linha || properties.servico || '',
      latitude,
      longitude,
      velocidade: properties.velocidade != null
        ? Number(String(properties.velocidade).replace(',', '.'))
        : 0,
      sentido: properties.sentido || '',
      direcao: properties.direcao || '',
      datalocal: properties.datalocal || '',
      dataregistro: properties.dataregistro || '',
      tarifa: properties.tarifa,
      active: Boolean(properties.cd_linha || properties.prefixo),
    };
  }

  private isBusInBounds(bus: Bus, bounds?: MapBounds): boolean {
    if (!bounds) return true;
    const { latitude, longitude } = bus;
    if (latitude == null || longitude == null) return false;

    const south = Math.min(bounds.south, bounds.north);
    const north = Math.max(bounds.south, bounds.north);
    const west = Math.min(bounds.west, bounds.east);
    const east = Math.max(bounds.west, bounds.east);

    if ([south, north, west, east].some(v => !isFinite(v))) return true;
    if (east === west || north === south) return true; // degenerate box: skip filtering

    return (
      latitude >= south &&
      latitude <= north &&
      longitude >= west &&
      longitude <= east
    );
  }

  private isStopInBounds(stop: BusStop, bounds?: MapBounds): boolean {
    if (!bounds) return true;
    const { latitude, longitude } = stop;
    if (latitude == null || longitude == null) return false;

    const south = Math.min(bounds.south, bounds.north);
    const north = Math.max(bounds.south, bounds.north);
    const west = Math.min(bounds.west, bounds.east);
    const east = Math.max(bounds.west, bounds.east);

    if ([south, north, west, east].some(v => !isFinite(v))) return true;
    if (east === west || north === south) return true; // degenerate box: skip filtering

    return (
      latitude >= south &&
      latitude <= north &&
      longitude >= west &&
      longitude <= east
    );
  }

  private createBoundsFromRadius(latitude: number, longitude: number, radiusMeters: number): MapBounds {
    const earthRadius = 6378137; // meters
    if (!isFinite(latitude) || !isFinite(longitude) || !isFinite(radiusMeters) || radiusMeters <= 0) {
      return {
        north: latitude,
        south: latitude,
        east: longitude,
        west: longitude,
      };
    }

    const dLat = (radiusMeters / earthRadius) * (180 / Math.PI);
    const cosLat = Math.cos((latitude * Math.PI) / 180);
    const dLng = cosLat === 0
      ? 0
      : (radiusMeters / earthRadius) * (180 / Math.PI) / cosLat;

    return {
      north: latitude + dLat,
      south: latitude - dLat,
      east: longitude + dLng,
      west: longitude - dLng,
    };
  }

  /**
   * Transform bus data from the new API format
   */
  private transformBusFromNewApi(feature: NewBusApiResponse['features'][0], operatorName: string): Bus | null {
    const { properties, geometry } = feature;

    if (geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) {
      // console.log('Invalid geometry:', geometry);
      return null;
    }

    const [longitude, latitude] = geometry.coordinates;

    if (!properties.veiculo?.prefixo) {
      // console.log('Missing prefixo:', properties);
      return null;
    }



    const transformedBus = {
      id: properties.veiculo.prefixo,
      prefixo: properties.veiculo.prefixo,
      linha: properties.veiculo.numero || '', // Changed from 'linha' to 'numero'
      latitude,
      longitude,
      velocidade: properties.velocidade ? Number(String(properties.velocidade).replace(',', '.')) : 0,
      sentido: properties.veiculo.sentido || '',
      datalocal: properties.datalocal || '',
      dataregistro: '', // Not available in new API
      tarifa: undefined, // Not available in new API
      active: Boolean(properties.veiculo.numero),
    };

    // Log first few buses for debugging
    // if (Math.random() < 0.001) { // Log ~0.1% of buses
    //   console.log('Transformed bus sample:', transformedBus);
    // }

    return transformedBus;
  }

  // private transformStopFromApi(feature: ApiResponse<StopApiProperties>['features'][0]): BusStop | null {
  //   const { properties, geometry } = feature;

  //   if (geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) {
  //     return null;
  //   }
  //   let [rawX, rawY] = geometry.coordinates as [number, number];
  //   let latitude: number;
  //   let longitude: number;

  //   // Detect UTM (EPSG:31983 – SIRGAS 2000 / UTM zone 23S)
  //   const looksLikeUtm = rawX > 100000 && rawX < 400000 && rawY > 8_000_000 && rawY < 9_200_000; // heuristic
  //   if (looksLikeUtm) {
  //     const { lat, lng } = this.utmToLatLngZone23S(rawX, rawY);
  //     latitude = lat;
  //     longitude = lng;
  //   } else {
  //     // Already lon/lat
  //     longitude = rawX;
  //     latitude = rawY;
  //   }

  //   // Validate plausible region (Central Brazil / DF)
  //   if (isNaN(latitude) || isNaN(longitude) || latitude < -35 || latitude > 10 || longitude < -75 || longitude > -25) {
  //     // Fallback: skip invalid
  //     return null;
  //   }

  //   const codigo = properties.parada || properties.cd_parada || properties.codigo || properties.id || '';
  //   const nome = properties.descricao || properties.ds_ponto || properties.nm_parada || properties.nome || properties.ds_descricao || 'Parada de ônibus';
  //   const situacao = properties.situacao || 'ATIVA'; // Default to active if not specified

  //   return {
  //     id: codigo || `${latitude}-${longitude}`,
  //     codigo,
  //     nome,
  //     descricao: nome,
  //     latitude,
  //     longitude,
  //     situacao,
  //   };
  // }

  private transformStop2025FromApi(feature: ApiResponse<Stop2025ApiProperties>['features'][0]): BusStop | null {
    const { properties, geometry } = feature;

    if (geometry.type !== 'Point' || !properties.latitude || !properties.longitude) {
      return null;
    }
    const latRaw = geometry.coordinates[1];
    const lngRaw = geometry.coordinates[0];

    if (typeof latRaw !== 'number' || typeof lngRaw !== 'number') {
        return null;
    }

    const latitude = latRaw;
    const longitude = lngRaw;
    const codigo = properties.cod_parada_v2025;
    const nome = properties.endereco; // to do, improve name from old api
    const situacao = properties.parada_ativa; // Default to active if not specified
    
    return {
      id: `${codigo}`,
      codigo,
      nome,
      descricao: nome,
      latitude,
      longitude,
      situacao,
    };
  }
  // Precise UTM zone 23S (WGS84/SIRGAS 2000) conversion
  private utmToLatLngZone23S(easting: number, northing: number): { lat: number; lng: number } {
    const k0 = 0.9996;
    const a = 6378137.0;
    const eccSquared = 0.00669438;
    const eccPrimeSquared = eccSquared / (1 - eccSquared);
    const e1 = (1 - Math.sqrt(1 - eccSquared)) / (1 + Math.sqrt(1 - eccSquared));
    const zoneNumber = 23;
    const longOrigin = (zoneNumber - 1) * 6 - 180 + 3; // -45°

    let x = easting - 500000.0; // remove false easting
    let y = northing - 10000000.0; // remove false northing (southern hemisphere)

    const M = y / k0;
    const mu = M / (a * (1 - eccSquared / 4 - 3 * eccSquared * eccSquared / 64 - 5 * eccSquared * eccSquared * eccSquared / 256));

    const J1 = (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32);
    const J2 = (21 * Math.pow(e1, 2) / 16 - 55 * Math.pow(e1, 4) / 32);
    const J3 = (151 * Math.pow(e1, 3) / 96);
    const J4 = (1097 * Math.pow(e1, 4) / 512);

    const fp = mu + J1 * Math.sin(2 * mu) + J2 * Math.sin(4 * mu) + J3 * Math.sin(6 * mu) + J4 * Math.sin(8 * mu);

    const sinfp = Math.sin(fp);
    const cosfp = Math.cos(fp);
    const tanfp = Math.tan(fp);

    const C1 = eccPrimeSquared * cosfp * cosfp;
    const T1 = tanfp * tanfp;
    const N1 = a / Math.sqrt(1 - eccSquared * sinfp * sinfp);
    const R1 = N1 * (1 - eccSquared) / (1 - eccSquared * sinfp * sinfp);
    const D = x / (N1 * k0);

    // Latitude
    let lat = fp - (N1 * tanfp / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * eccPrimeSquared) * Math.pow(D, 4) / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * eccPrimeSquared - 3 * C1 * C1) * Math.pow(D, 6) / 720);
    lat = lat * 180 / Math.PI;

    // Longitude
    let lng = (D - (1 + 2 * T1 + C1) * Math.pow(D, 3) / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * eccPrimeSquared + 24 * T1 * T1) * Math.pow(D, 5) / 120) / cosfp;
    lng = longOrigin + lng * 180 / Math.PI;

    return { lat, lng };
  }

  private transformLineFromApi(feature: ApiResponse<LineApiProperties>['features'][0]): BusLine | null {
    const { properties, geometry } = feature;

    if (!['LineString', 'MultiLineString'].includes(geometry.type)) {
      return null;
    }

    const codigo = properties.cd_linha || properties.linha || properties.servico || properties.codigo || properties.cod_linha || '';

    if (!codigo) {
      return null;
    }

    let coordinates: [number, number][] = [];

    if (geometry.type === 'LineString') {
      coordinates = geometry.coordinates as [number, number][];
    } else if (geometry.type === 'MultiLineString') {
      coordinates = (geometry.coordinates as [number, number][][]).flat();
    }

    // Conversion: Detect UTM and convert to lat/lng
    coordinates = coordinates.map(([x, y]) => {
      const looksLikeUtm = x > 100000 && x < 400000 && y > 8_000_000 && y < 9_200_000;
      if (looksLikeUtm) {
        const { lat, lng } = this.utmToLatLngZone23S(x, y);
        return [lng, lat];
      }
      return [x, y];
    });

    return {
      id: codigo,
      codigo,
      nome: codigo,
      servico: properties.servico || codigo,
      coordinates,
      tipo: geometry.type as 'LineString' | 'MultiLineString',
    };
  }

  private transformLineV2FromApi(feature: any): BusLineV2 | null {
    if (!feature) {
      return null;
    }

    // API returns properties with capital first letter: Numero, Sentido, GeoLinhas
    const numero = feature.Numero || feature.numero;
    const sentido = feature.Sentido || feature.sentido || '';
    const geoLinhasRaw = feature.GeoLinhas || feature.geolinhas;

    if (!numero) {
      return null;
    }

    // GeoLinhas can be a single LineString object or array
    let geolinhas: { type: string; coordinates: [number, number][] }[] = [];
    
    if (geoLinhasRaw) {
      if (Array.isArray(geoLinhasRaw)) {
        geolinhas = geoLinhasRaw
          .filter((item: any) => item && item.type && Array.isArray(item.coordinates))
          .map((item: any) => ({ type: item.type, coordinates: item.coordinates }));
      } else if (geoLinhasRaw.type && Array.isArray(geoLinhasRaw.coordinates)) {
        // Single LineString object
        geolinhas = [{ type: geoLinhasRaw.type, coordinates: geoLinhasRaw.coordinates }];
      }
    }

    return {
      numero,
      sentido,
      geolinhas,
    };
  }
}

export const apiService = new ApiService();
export { ApiError };
export default apiService;
