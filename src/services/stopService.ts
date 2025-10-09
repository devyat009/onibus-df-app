import { ApiResponse, BusHorario, BusHorarioV2, BusLine, BusLineV2, BusStop, BusStopDados, HorarioApiProperties, MapBounds, Stop2025ApiProperties, StopScheduleV2 } from "../types";
import { CACHE_KEYS, CacheOptions, getCachedOrFetch } from "../utils/cacheManager";
import appConfig from "../utils/config";
import { getLineBounds, pointToLineDistance } from "../utils/geoUtils";
import { ApiError, ApiService } from "./api";
import { BusService } from "./busService";

export class StopService {
  private baseUrl: string;
  constructor(
    private apiService: ApiService,
    private busService: BusService,
  ) {
    this.baseUrl = appConfig.api.baseUrl;
  }

  // #region Requests Stops

  /**
   * Fetches bus stops from the API.
   * @param bounds - Optional geographical bounds to filter stops.
   * @returns An array of BusStop objects.
   */
  async getStops(bounds?: MapBounds): Promise<BusStop[]> {
    let endpoint = appConfig.api.endpoints.geoParadas2025;

    const response = await this.apiService.makeRequest<Stop2025ApiProperties>(
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

  /**
   * Fetches additional data for each bus stop, the new fallback api.
   * @returns Array of BusStopDados with line info for each stop.
   */
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

  // #endregion

  // #region Cache Stops
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

  /**
   * Cached version of getStopDados (fallback api) - data persists for 3 days
   * @param options - Cache options (ttl, maxSize)
   * @returns Array of BusStopDados with line info for each stop.
   */
  async getStopDadosCached(options?: CacheOptions): Promise<BusStopDados[]> {
    return getCachedOrFetch(
      CACHE_KEYS.STOP_DADOS,
      () => this.getStopDados(),
      options
    );
  }
  // #endregion

  // #region Transformations Stops

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


  // #endregion

  // #region Helpers Stops

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

  // #endregion

  // #region Requests Horarios

  /**
   * Fetch bus schedules from the GeoServer API
   * @returns Array of BusHorario
   */
  async fetchHorario(): Promise<BusHorario[]> {
    const response = await this.apiService.makeRequest<HorarioApiProperties>(
      appConfig.api.endpoints.geoHorario,
      undefined,
      true // Use geoserver for horario
    );

    return response.features
      .map(feature => this.transformHorarioFromApi(feature))
      .filter(horario => horario !== null) as BusHorario[];
  }

  /**
   * Fetch bus schedules from the Dados API
   * @returns Array of BusHorarioV2
   */
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

  // /**
  // * Get the bus schedules for a specific stop, with caching from GeoServer
  // * @param stop BusStop object
  // * @returns Array of BusHorario
  // */
  // async getStopSchedule(stop: BusStop): Promise<StopSchedule> {
  //   // console.log(`Getting schedule for stop: ${stop.codigo} - ${stop.nome}`);

  //   const [lines, horarios] = await Promise.all([
  //     this.busService.getLinesCached(),
  //     this.getHorario()
  //   ]);

  //   // console.log(`Loaded ${lines.length} lines and ${horarios.length} schedules`);

  //   let relevantLines: BusLine[] = [];


  //   // If still no matches, try proximity algorithm with multiple tolerances
  //   if (relevantLines.length === 0) {
  //     // console.log('Strategy 2 failed, trying strategy 3: Proximity algorithm...');
  //     const tolerances = [100, 300, 500, 1000, 2000]; // Try increasing distances

  //     for (const tolerance of tolerances) {
  //       console.log(`Trying proximity with ${tolerance}m tolerance...`);
  //       relevantLines = lines.filter(line => {
  //         const passesThrough = this.doesLinePassThroughStop(line, stop, tolerance);
  //         if (passesThrough) {
  //           console.log(`Strategy 3: Line ${line.codigo} passes through stop ${stop.codigo} with ${tolerance}m tolerance`);
  //         }
  //         return passesThrough;
  //       });

  //       if (relevantLines.length > 0) {
  //         console.log(`Found ${relevantLines.length} lines with ${tolerance}m tolerance`);
  //         break;
  //       }
  //     }
  //   }

  //   // console.log(`Found ${relevantLines.length} lines that might serve stop ${stop.codigo}`);

  //   // Group schedules by line
  //   const linesWithSchedules = relevantLines.map(line => {
  //     const lineSchedules = horarios.filter(horario =>
  //       horario.cd_linha === line.linha
  //     );

  //     console.log(`Line ${line.linha} has ${lineSchedules.length} schedules`);

  //     return {
  //       line,
  //       schedules: lineSchedules.sort((a, b) => a.hr_prevista.localeCompare(b.hr_prevista))
  //     };
  //   }).filter(item => item.schedules.length > 0);

  //   // console.log(`Final result: ${linesWithSchedules.length} lines with schedules`);

  //   return {
  //     stop,
  //     lines: linesWithSchedules
  //   };
  // }

  /**
   * Get the schedule for a specific bus stop
   * @param stop BusStop object
   * @returns 
   */
  async getStopScheduleV2(stop: BusStop): Promise<StopScheduleV2> {
    // console.log(`[GETSTOPSCHEDULEV2] Getting V2 schedule for stop: ${stop.codigo} - ${stop.nome}`);
    const lines = await this.busService.getLines();
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

    let relevantLines: BusLine[] = [];

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
              line => line.linha === numero && line.sentido === sentido
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
        horario => horario.numero_linha === line.linha && horario.sentido === sentidoAbbrev
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

  async getLinesDados(): Promise<BusLineV2[]> {
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
      .map((feature: any) => this.busService.transformLineV2FromApi(feature))
      .filter((line: BusLineV2 | null): line is BusLineV2 => line !== null);

    return lines;
  }

  // #endregion

  // #region Cache Horarios
  /**
   * Get the bus schedules, cached for 30 minutes by default, if not fetch new data from GeoServer
   * @returns Array of BusHorarioV2
   */
  async getHorario(): Promise<BusHorario[]> {
    return getCachedOrFetch(
      CACHE_KEYS.BUS_HORARIO,
      () => this.fetchHorario(),
      { ttl: 30 * 60 * 1000 } // 30 minutes default TTL for horario
    );
  }

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
   * Get the bus schedules, cached for 30 minutes by default, if not fetch new data from Dados API
   * @returns Array of BusHorarioV2
   */
  async getHorarioV2(): Promise<BusHorarioV2[]> {
    return getCachedOrFetch(
      CACHE_KEYS.BUS_HORARIO_DADOS,
      () => this.fetchHorarioV2(),
      { ttl: 30 * 60 * 1000 } // 30 minutes default TTL for horario
    );
  }
  // #endregion

  // #region Transformations Horarios

  /**
   * Transform a GeoServer API response feature into a BusHorario object
   * @param feature 
   * @returns BusHorario object or null if transformation fails
   */
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
  // #endregion

  // #region Helpers Horarios

  /**
   * Calculate if a bus line passes through a stop using proximity analysis (old api)
   * Both coordinates should be in the same projection system
   * @param line - The bus line object to check.
   * @param stop - The bus stop object to check against.
   * @param tolerance - Distance in meters to consider "passing through".
   * @returns True if the line passes through the stop within the tolerance, false otherwise.
   */
  private doesLinePassThroughStop(line: BusLine, stop: BusStop, tolerance: number = 500): boolean {
    if (!line.coordinates || line.coordinates.length === 0) {
      return false;
    }

    // Check if any segment of the line is within tolerance distance of the stop
    const stopCoords = [stop.longitude, stop.latitude];


    // Quick bounds check first to avoid expensive calculations
    const lineBounds = getLineBounds(line.coordinates);
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

      const distance = pointToLineDistance(stopCoords, point1, point2);
      if (distance <= tolerance) {
        return true;
      }
    }

    return false;
  }

  // #endregion

}