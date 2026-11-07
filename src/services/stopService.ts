import { ApiResponse, BusHorario, BusHorarioV2, BusLine, BusLineV2, BusStop, BusStopDados, HorarioApiProperties, MapBounds, Stop2025ApiProperties, StopScheduleV2 } from "../types";
import { CACHE_KEYS, CacheOptions, getCachedOrFetch } from "../utils/cacheManager";
import appConfig from "../utils/config";
import { getLineBounds, pointToLineDistance } from "../utils/geoUtils";
import { matchesLineNumber, normalizeSentido } from "../utils/lineUtils";
import { ApiError } from "./apiError";
import type { ApiService } from "./api";
import { BusService } from "./busService";

export class StopService {
  private get baseUrl(): string {
    return appConfig.api.baseUrl;
  }

  constructor(
    private apiService: ApiService,
    private busService: BusService,
  ) {
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
    const roundCoord = (n: number) => n.toFixed(2);
    const cacheKey = bounds
      ? `${CACHE_KEYS.STOPS}_${roundCoord(bounds.north)}_${roundCoord(bounds.south)}_${roundCoord(bounds.east)}_${roundCoord(bounds.west)}`
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
    // Map to BusHorarioV2
    return data.map(item => ({
      numero_linha: item.numero,
      sentido: item.sentido,
      tempo_percurso: item.tempo_percurso || 0,
      horarios: item.horarios || [],
    }));
  }

  /**
   * Get the schedule for a specific bus stop
   * @param stop BusStop object
   * @returns StopScheduleV2
   */
  async getStopScheduleV2(stop: BusStop): Promise<StopScheduleV2> {
    const [lines, horarios, paradas] = await Promise.all([
      this.busService.getLinesCached().catch(err => {
        console.warn('[StopService] Failed to load lines in getStopScheduleV2, continuing with fallback:', err);
        return [] as BusLine[];
      }),
      this.getHorarioV2Cached(),
      this.getStopDadosCached(),
    ]);

    let relevantLines: BusLine[] = [];
    let usedProximityFallback = false;

    if (Array.isArray(paradas)) {
      for (const parada of paradas) {
        if (parada.id === Number(stop.codigo)) {
          for (const bus of parada.linParadas) {
            // Parse "0.011 - CIRCULAR" -> numero: "0.011", sentido: "CIRCULAR"
            const parts = bus.split(' - ');
            if (parts.length < 2) continue;

            const numero = parts[0].trim();
            const sentido = parts[1].trim();
            const upperSentido = sentido.toUpperCase();
            const targetNormSentido = normalizeSentido(upperSentido);

            let matchedLine = lines.find(
              line =>
                (line.linha.trim() === numero || matchesLineNumber(line.linha, numero)) &&
                normalizeSentido(line.sentido) === targetNormSentido
            );

            // Fallback: if line is in parada.linParadas but missing that specific direction in GeoServer lines,
            // construct a BusLine entry WITHOUT borrowing opposite-direction coordinates (which would invert ETA!).
            if (!matchedLine) {
              const sameNumberLine = lines.find(
                line => line.linha.trim() === numero || matchesLineNumber(line.linha, numero)
              );
              const canShareCoords =
                sameNumberLine &&
                (!targetNormSentido ||
                  targetNormSentido === 'C' ||
                  normalizeSentido(sameNumberLine.sentido) === 'C' ||
                  normalizeSentido(sameNumberLine.sentido) === targetNormSentido);

              matchedLine = {
                id: sameNumberLine?.id ?? 0,
                linha: sameNumberLine?.linha || numero,
                nome: sameNumberLine?.nome || '',
                sentido: upperSentido,
                tarifa: sameNumberLine?.tarifa ?? 0,
                coordinates: canShareCoords ? (sameNumberLine?.coordinates ?? []) : [],
                tipo: sameNumberLine?.tipo ?? 'LineString',
              };
            }

            if (
              matchedLine &&
              !relevantLines.some(
                l =>
                  matchesLineNumber(l.linha, matchedLine!.linha) &&
                  normalizeSentido(l.sentido) === normalizeSentido(matchedLine!.sentido)
              )
            ) {
              relevantLines.push(matchedLine);
            }
          }
        }
      }
    }

    if (relevantLines.length === 0 && lines.length > 0) {
      usedProximityFallback = true;
      const tolerances = [60, 120, 250];
      for (const tolerance of tolerances) {
        relevantLines = lines.filter(line => this.doesLinePassThroughStop(line, stop, tolerance));
        if (relevantLines.length > 0) break;
      }
    }

    const linesWithSchedules = relevantLines.map(line => {
      const sentidoAbbrev = normalizeSentido(line.sentido);

      let matchingSchedules = horarios.filter(
        horario =>
          (horario.numero_linha === line.linha || matchesLineNumber(horario.numero_linha, line.linha)) &&
          (!sentidoAbbrev || normalizeSentido(horario.sentido) === sentidoAbbrev)
      );

      // Fallback if sentido was missing on a proximity-matched line
      if (matchingSchedules.length === 0 && !sentidoAbbrev) {
        matchingSchedules = horarios.filter(
          horario => horario.numero_linha === line.linha || matchesLineNumber(horario.numero_linha, line.linha)
        );
      }

      return {
        line,
        schedules: matchingSchedules
      };
    }).filter(item => !usedProximityFallback || item.schedules.length > 0);

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
