import { useAppStore } from '../store';
import {
  ApiResponse,
  Bus,
  BusApiProperties,
  BusHorario,
  BusLine,
  BusStop,
  EnhancedBus,
  ErrorCode,
  FrotaApiProperties,
  FrotaOperadora,
  HorarioApiProperties,
  LineApiProperties,
  MapBounds,
  StopApiProperties,
  StopSchedule
} from '../types';
//import { CACHE_KEYS, CacheOptions, getCachedOrFetch } from '../utils/asyncStorage';
import { CACHE_KEYS, CacheOptions, getCachedOrFetch } from "@/src/utils/cacheManager";
import appConfig from '../utils/config';

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

  private async makeRequest<T>(endpoint: string, bounds?: MapBounds): Promise<ApiResponse<T>> {
    try {
      let url = `${this.baseUrl}?${endpoint}`;
      
      if (bounds) {
        const minX = Math.min(bounds.west, bounds.east);
        const maxX = Math.max(bounds.west, bounds.east);
        const minY = Math.min(bounds.south, bounds.north);
        const maxY = Math.max(bounds.south, bounds.north);

        const bbox = `${minX},${minY},${maxX},${maxY},EPSG:4326`;
        url += `&bbox=${bbox}&srsName=EPSG:4326`;
      }
      
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
        },
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new ApiError('API_ERROR', `HTTP ${response.status}`, {
          status: response.status,
          statusText: response.statusText,
          url,
        });
      }

      const data = await response.json();
      return data as ApiResponse<T>;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      
      throw new ApiError('NETWORK_ERROR', 'Failed to fetch data', error);
    }
  }

  async getBuses(bounds?: MapBounds, timeFilter?: '30min' | '24h'): Promise<Bus[]> {
    const response = await this.makeRequest<BusApiProperties>(
      appConfig.api.endpoints.buses,
      bounds
    );
    const allBuses = response.features
      .map(feature => this.transformBusFromApi(feature))
      .filter(bus => bus !== null) as Bus[];

    // Use filter from store if not provided as parameter
    const filterToUse = timeFilter || useAppStore.getState().busTimeFilter;

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
    
    const filteredBuses = filterActiveBusesRecent(allBuses, filterToUse);
    // console.log(`buses on last ${filterToUse}: `, filteredBuses.length);
    return filteredBuses;
    //return allBuses;
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
    
    // Debug: contar por operadora
    const operadoraCounts = new Map<string, number>();
    enhancedBuses.forEach(bus => {
      const operadora = bus.operadora?.nome || 'SEM_OPERADORA';
      operadoraCounts.set(operadora, (operadoraCounts.get(operadora) || 0) + 1);
    });
    
    // console.log('Onibus por operadora:', Object.fromEntries(operadoraCounts));
    
    return enhancedBuses;
  }

  /**
   * Enhance a single bus with operator information
   */
  private enhanceBusWithOperator(bus: Bus, frotaMap: Map<string, FrotaOperadora>): EnhancedBus {
    const frotaInfo = frotaMap.get(bus.prefixo);
    
    // Mapeamento das operadoras principais e suas cores
    const operadorasPrincipais: { [key: string]: { nome: string; cor: string } } = {
      'URBI': { nome: 'URBI', cor: '#00bfffff' }, // Azul claro
      'PIONEIRA': { nome: 'PIONEIRA', cor: '#ffff00' }, // Amarelo
      'PIRACICABANA': { nome: 'PIRACICABANA', cor: '#006400' }, // Verde escuro
      'MARECHAL': { nome: 'MARECHAL', cor: '#fb6900' }, // Laranja
      'SÃO JOSÉ': { nome: 'SÃO JOSÉ', cor: '#938326' }, // #938326
      'UNIÃO TRANSPORTE BRASÍLIA': { nome: 'UNIÃO TRANSPORTE BRASÍLIA', cor: '#00ffff' }, // Azul cyano
    };

    let nomeOperadora = frotaInfo?.operadora || '';
    let corOperadora: string | undefined = undefined;

    // Detecta e reduz o nome se for uma das principais
    let found = false;
    for (const key in operadorasPrincipais) {
      if (nomeOperadora.toUpperCase().includes(key)) {
        nomeOperadora = operadorasPrincipais[key].nome;
        corOperadora = operadorasPrincipais[key].cor;
        found = true;
        break;
      }
    }
    // Se não encontrou, mantém nome completo e cor padrão
    if (!found && nomeOperadora) {
      corOperadora = '#5a4799';
    }
    
    // Garante que sempre há uma cor, mesmo sem operadora
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
    let endpoint = appConfig.api.endpoints.stops;
    
    // Force EPSG:4326 output for stops
    if (!endpoint.includes('srsName=')) {
      endpoint += '&srsName=EPSG:4326';
    }
    
    const response = await this.makeRequest<StopApiProperties>(
      endpoint,
      bounds
    );

    return response.features
      .map(feature => this.transformStopFromApi(feature))
      .filter((stop): stop is BusStop => !!stop && stop.situacao !== "DESATIVADA");
  }

  async getLines(): Promise<BusLine[]> {
    const response = await this.makeRequest<LineApiProperties>(
      appConfig.api.endpoints.lines
    );

    return response.features
      .map(feature => this.transformLineFromApi(feature))
      .filter(line => line !== null) as BusLine[];
  }

  // Cached version of getLines - data persists for 3 days
  async getLinesCached(options?: CacheOptions): Promise<BusLine[]> {
    return getCachedOrFetch(
      CACHE_KEYS.LINES,
      () => this.getLines(),
      options
    );
  }

  async getFrota(): Promise<FrotaOperadora[]> {
    const response = await this.makeRequest<FrotaOperadora>(
      appConfig.api.endpoints.frota
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

  // Cached version of getHorario
  async getHorarioCached(options?: CacheOptions): Promise<BusHorario[]> {
    return getCachedOrFetch(
      CACHE_KEYS.BUS_HORARIO,
      () => this.getHorario(),
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
    
    console.log(`Checking line ${line.codigo} with ${line.coordinates.length} coordinates against stop ${stop.codigo}`);
    
    // Quick bounds check first to avoid expensive calculations
    const lineBounds = this.getLineBounds(line.coordinates);
    const stopBuffer = tolerance / 111320; // Convert meters to degrees (approximate)
    
    if (stopCoords[1] < lineBounds.minLat - stopBuffer || 
        stopCoords[1] > lineBounds.maxLat + stopBuffer ||
        stopCoords[0] < lineBounds.minLng - stopBuffer || 
        stopCoords[0] > lineBounds.maxLng + stopBuffer) {
      console.log(`Line ${line.codigo} is outside bounds for stop ${stop.codigo}`);
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
      
      const distance = this.pointToLineDistance(stopCoords, point1, point2);
      if (distance <= tolerance) {
        console.log(`Line ${line.codigo} passes through stop ${stop.codigo} - distance: ${distance}m`);
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

    const [px, py] = point;
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
      return this.haversineDistance(py, px, y1, x1);
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
    return this.haversineDistance(py, px, yy, xx);
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

    // Strategy 1: Try exact code matching first (fastest and most reliable)
    console.log('Trying strategy 1: Exact code matching...');
    relevantLines = lines.filter(line => {
      // Check if stop code appears in any line property or if line code matches stop
      const lineCode = line.codigo?.toString().toLowerCase();
      const stopCode = stop.codigo?.toString().toLowerCase();
      
      if (lineCode && stopCode && (lineCode.includes(stopCode) || stopCode.includes(lineCode))) {
        console.log(`Strategy 1: Line ${line.codigo} matches stop ${stop.codigo} by code`);
        return true;
      }
      return false;
    });

    // Strategy 2: If no exact matches, try horarios matching
    if (relevantLines.length === 0) {
      console.log('Strategy 1 failed, trying strategy 2: Horarios code matching...');
      const stopCodesInHorarios = new Set<string>();
      
      // Find all line codes that have schedules
      horarios.forEach(horario => {
        if (horario.cd_linha) {
          stopCodesInHorarios.add(horario.cd_linha);
        }
      });
      
      console.log(`Found ${stopCodesInHorarios.size} unique line codes in horarios`);
      
      // Match lines that have schedules
      relevantLines = lines.filter(line => {
        const hasSchedule = stopCodesInHorarios.has(line.codigo);
        if (hasSchedule) {
          console.log(`Strategy 2: Line ${line.codigo} has schedules available`);
        }
        return hasSchedule;
      });
      
      // Limit to first 10 lines to avoid overwhelming the user
      if (relevantLines.length > 10) {
        console.log(`Limiting from ${relevantLines.length} to 10 lines`);
        relevantLines = relevantLines.slice(0, 10);
      }
    }

    // Strategy 3: If still no matches, try proximity algorithm with multiple tolerances
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

    // Strategy 4: Ultimate fallback - show a sample of lines with schedules
    if (relevantLines.length === 0) {
      console.log('All strategies failed, using fallback: showing sample lines with schedules...');
      const linesWithSchedules = lines.filter(line => {
        return horarios.some(horario => horario.cd_linha === line.codigo);
      });
      
      if (linesWithSchedules.length > 0) {
        // Take first 5 lines that have schedules
        relevantLines = linesWithSchedules.slice(0, 5);
        console.log(`Fallback: showing ${relevantLines.length} sample lines with schedules`);
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

  // Cached version of getHorario
  async fetchHorario(): Promise<BusHorario[]> {
    const response = await this.makeRequest<HorarioApiProperties>(
      appConfig.api.endpoints.horario
    );

    return response.features
      .map(feature => this.transformHorarioFromApi(feature))
      .filter(horario => horario !== null) as BusHorario[];
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
      velocidade: properties.velocidade ? Number(String(properties.velocidade).replace(',', '.')) : 0,
      sentido: properties.sentido || '',
      datalocal: properties.datalocal || '',
      dataregistro: properties.dataregistro || '',
      tarifa: properties.tarifa,
      active: Boolean(properties.cd_linha || properties.prefixo),
    };
  }

  private transformStopFromApi(feature: ApiResponse<StopApiProperties>['features'][0]): BusStop | null {
    const { properties, geometry } = feature;
    
    if (geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) {
      return null;
    }
    let [rawX, rawY] = geometry.coordinates as [number, number];
    let latitude: number;
    let longitude: number;

    // Detect UTM (EPSG:31983 – SIRGAS 2000 / UTM zone 23S)
    const looksLikeUtm = rawX > 100000 && rawX < 400000 && rawY > 8_000_000 && rawY < 9_200_000; // heuristic
    if (looksLikeUtm) {
      const { lat, lng } = this.utmToLatLngZone23S(rawX, rawY);
      latitude = lat;
      longitude = lng;
    } else {
      // Already lon/lat
      longitude = rawX;
      latitude = rawY;
    }

    // Validate plausible region (Central Brazil / DF)
    if (isNaN(latitude) || isNaN(longitude) || latitude < -35 || latitude > 10 || longitude < -75 || longitude > -25) {
      // Fallback: skip invalid
      return null;
    }
    
    const codigo = properties.parada || properties.cd_parada || properties.codigo || properties.id || '';
    const nome = properties.descricao || properties.ds_ponto || properties.nm_parada || properties.nome || properties.ds_descricao || 'Parada de ônibus';
    const situacao = properties.situacao || 'ATIVA'; // Default to active if not specified

    return {
      id: codigo || `${latitude}-${longitude}`,
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
      // Flatten MultiLineString into a single LineString
      coordinates = (geometry.coordinates as [number, number][][]).flat();
    }

    return {
      id: codigo,
      codigo,
      nome: codigo,
      servico: properties.servico || codigo,
      coordinates,
      tipo: geometry.type as 'LineString' | 'MultiLineString',
    };
  }
}

export const apiService = new ApiService();
export { ApiError };
export default apiService;
