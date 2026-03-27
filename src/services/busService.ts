import { useAppStore } from "../store";
import { ApiResponse, Bus, BusApiProperties, BusLine, BusLineV2, BusStop, DadosNumerosVeiculos, EnhancedBus, FrotaOperadora, LineApiProperties, MapBounds, NewBusGeoApiResponse, StopRealtimeArrivalsMap } from "../types";
import { CACHE_KEYS, CacheOptions, getCachedOrFetch } from "../utils/cacheManager";
import appConfig from "../utils/config";
import { createBoundsFromRadius, haversineDistance, utmToLatLngZone23S } from "../utils/geoUtils";
import { buildLineKey, matchesLineNumber, normalizeLineNumber, normalizeSentido, stripLeadingZeros } from "../utils/lineUtils";
import { ApiError, ApiService } from "./api";
import { FrotaService } from "./frotaService";

type TelemetrySample = {
	timestamp: number;
	latitude: number;
	longitude: number;
	speedKmh: number;
};

const TELEMETRY_HISTORY_LIMIT = 3;
const TELEMETRY_MAX_AGE_MS = 6 * 60 * 1000;

export class BusService {

	private baseUrl: string;
	private telemetryHistory = new Map<string, TelemetrySample[]>();
	private telemetryInterval: ReturnType<typeof setInterval> | null = null;
	private telemetryFetchInFlight = false;
	private telemetryIntervalMs = 30000;

	constructor(
		private apiService: ApiService,
		private frotaService: FrotaService
	) {
		this.baseUrl = appConfig.api.baseUrl;
	}

	// #region Telemetry

	public startGlobalTelemetry(intervalMs: number = 30000) {
		this.telemetryIntervalMs = intervalMs;
		if (this.telemetryInterval) {
			return;
		}
		void this.runTelemetryFetch();
		this.telemetryInterval = setInterval(() => {
			void this.runTelemetryFetch();
		}, this.telemetryIntervalMs);
	}

	public stopGlobalTelemetry() {
		if (!this.telemetryInterval) {
			return;
		}
		clearInterval(this.telemetryInterval);
		this.telemetryInterval = null;
	}

	public async refreshGlobalTelemetry(): Promise<void> {
		await this.runTelemetryFetch();
	}

	private async runTelemetryFetch(): Promise<void> {
		if (this.telemetryFetchInFlight) {
			return;
		}
		this.telemetryFetchInFlight = true;
		try {
			const buses = await this.getBuses();
			this.updateTelemetryHistory(buses);
		} catch (error) {
			console.warn('[BusTelemetry] Failed to refresh telemetry', error);
		} finally {
			this.telemetryFetchInFlight = false;
		}
	}

	private updateTelemetryHistory(buses: Bus[]): void {
		const now = Date.now();
		for (const bus of buses) {
			const key = this.getTelemetryKey(bus);
			if (!key) {
				continue;
			}

			const latitude = typeof bus.latitude === 'number' ? bus.latitude : Number(bus.latitude ?? NaN);
			const longitude = typeof bus.longitude === 'number' ? bus.longitude : Number(bus.longitude ?? NaN);
			if (!isFinite(latitude) || !isFinite(longitude)) {
				continue;
			}

			const speedKmh = this.extractBusSpeed(bus);
			const sample: TelemetrySample = {
				timestamp: now,
				latitude,
				longitude,
				speedKmh,
			};

			const history = this.telemetryHistory.get(key) ?? [];
			history.push(sample);
			if (history.length > TELEMETRY_HISTORY_LIMIT) {
				history.splice(0, history.length - TELEMETRY_HISTORY_LIMIT);
			}
			this.telemetryHistory.set(key, history);
		}

		this.pruneTelemetry(now);
	}

	private pruneTelemetry(now: number): void {
		for (const [key, samples] of this.telemetryHistory.entries()) {
			const recent = samples.filter(sample => now - sample.timestamp <= TELEMETRY_MAX_AGE_MS && isFinite(sample.speedKmh));
			if (!recent.length) {
				this.telemetryHistory.delete(key);
				continue;
			}
			if (recent.length > TELEMETRY_HISTORY_LIMIT) {
				this.telemetryHistory.set(key, recent.slice(-TELEMETRY_HISTORY_LIMIT));
			} else if (recent.length !== samples.length) {
				this.telemetryHistory.set(key, recent);
			}
		}
	}

	private getTelemetryKey(bus: Bus): string | null {
		if (bus?.id && typeof bus.id === 'string') {
			return bus.id;
		}
		if (bus?.prefixo && typeof bus.prefixo === 'string') {
			return bus.prefixo;
		}
		return null;
	}

	private extractBusSpeed(bus: Bus): number {
		const raw = Number(bus.velocidade ?? 0);
		return Number.isFinite(raw) ? raw : 0;
	}

	private getTelemetrySpeed(bus: Bus, fallbackSpeedKmh: number): number {
		const key = this.getTelemetryKey(bus);
		if (!key) {
			return fallbackSpeedKmh;
		}
		const history = this.telemetryHistory.get(key);
		if (!history || history.length === 0) {
			return fallbackSpeedKmh;
		}
		const samples = history.slice(-TELEMETRY_HISTORY_LIMIT);
		if (samples.length >= 2) {
			let aggregate = 0;
			let segments = 0;
			for (let i = 1; i < samples.length; i++) {
				const previous = samples[i - 1];
				const current = samples[i];
				const timeDiff = current.timestamp - previous.timestamp;
				if (timeDiff <= 0) {
					continue;
				}
				const distanceMeters = haversineDistance(
					previous.latitude,
					previous.longitude,
					current.latitude,
					current.longitude
				);
				if (!isFinite(distanceMeters) || distanceMeters <= 0) {
					continue;
				}
				const speedMs = distanceMeters / (timeDiff / 1000);
				if (!isFinite(speedMs) || speedMs <= 0) {
					continue;
				}
				const speedKmh = speedMs * 3.6;
				aggregate += speedKmh;
				segments += 1;
			}
			if (segments > 0) {
				const averageFromPositions = aggregate / segments;
				if (averageFromPositions > 0) {
					return averageFromPositions;
				}
			}
		}
		const fallbackSamples = samples
			.map(sample => sample.speedKmh)
			.filter(speed => isFinite(speed) && speed > 0);
		if (!fallbackSamples.length) {
			return fallbackSpeedKmh;
		}
		const average = fallbackSamples.reduce((sum, speed) => sum + speed, 0) / fallbackSamples.length;
		return average > 0 ? average : fallbackSpeedKmh;
	}

	// #endregion

	// #region Requests Bus

	/**
	 * Fetches buses from the API, it switches between geoserver and new API, if geoserver fails.
	 * @param bounds - The geographical bounds to filter the buses.
	 * @param timeFilter - The time filter to apply (e.g., '30min' or '24h').
	 * @returns An array of Bus objects.
	 */
	async getBuses(bounds?: MapBounds, timeFilter?: '30min' | '24h',
		options?: {
			radiusMeters?: number;
		}
	): Promise<Bus[]> {
		// Use filter from store if not provided as parameter
		const filterToUse = timeFilter || useAppStore.getState().busTimeFilter;

		let allBuses: Bus[] = [];
		let shouldUseFallback = false;

		try {
			const geoserverEndpoint = appConfig.api.endpoints.geoOnibusPosicao || appConfig.api.endpoints.dadosOnibusPosicao;
			const response = await this.apiService.makeRequest<BusApiProperties>(
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
			allBuses = await this.getBusesDadosApi();
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
	 * 	Fetches buses from the new API endpoint (dadosOnibusPosicao).
	 */
	async getBusesDadosApi(): Promise<Bus[]> {
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

			const data: NewBusGeoApiResponse[] = await response.json();
			// console.log('Raw API response:', { operatorCount: data.length, firstOperator: data[0] });
			const allBuses: Bus[] = [];

			// Process each operator's data
			data.forEach(operatorData => {
				if (operatorData.features && Array.isArray(operatorData.features)) {
					const buses = operatorData.features
						.map(feature => this.transformBusFromNewGeoApi(feature, operatorData.NomeOperadora))
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

			// Get buses, frota and numeros data in parallel
			const [buses, frota, numeros] = await Promise.all([
				this.getBuses(bounds, filterToUse),
				this.frotaService.getFrotaCached(), // Use cached frota data
				this.frotaService.getNumerosVeiculosCached(),
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
			const enhancedWithOperator = buses.map(bus => this.enhanceBusWithOperator(bus, frotaMap));

			// Build a fast lookup for dados numeros by normalized numero+sentido
			const numerosMap = new Map<string, DadosNumerosVeiculos>();
			const makeKey = (numero?: string, sentido?: string) => {
				const n = numero ? normalizeLineNumber(stripLeadingZeros(numero)) : '';
				const s = sentido ? normalizeSentido(sentido) : '';
				return `${n}|${s}`;
			};
			numeros.forEach(n => {
				if (!n?.numero) return;
				numerosMap.set(makeKey(n.numero, n.sentido), n);
			});

			// Attach numeroDados info directly into EnhancedBus
			const enhancedBuses = enhancedWithOperator.map(bus => {
				const key = makeKey(bus.linha, bus.sentido);
				const numeroDados = numerosMap.get(key);
				return numeroDados ? { ...bus, numeroDados } : bus;
			});

		// console.log(`Enhanced buses - returning ${enhancedBuses.length} enhanced buses`);

		return enhancedBuses;
	}

	/**
	 * Fetches real-time arrivals for a specific bus stop.
	 * @param stop - The bus stop to fetch arrivals for.
	 * @param lines - The bus lines to filter the arrivals.
	 * @param options - Additional options for the request.
	 * @returns A promise that resolves to a map of real-time arrivals for the stop.
	 */
	async getRealtimeArrivalsForStop(
		stop: BusStop,
		lines: BusLine[],
		options?: {
			radiusMeters?: number;
			maxPerLine?: number;
			maxEtaMinutes?: number;
		}
	): Promise<StopRealtimeArrivalsMap> {
		if (!stop || !isFinite(stop.latitude) || !isFinite(stop.longitude)) {
			// console.warn('[RealtimeArrivals] Invalid stop data provided', {
			// 	stopId: stop?.codigo,
			// 	hasLatitude: isFinite(stop?.latitude ?? NaN),
			// 	hasLongitude: isFinite(stop?.longitude ?? NaN),
			// 	linesCount: Array.isArray(lines) ? lines.length : 'unknown'
			// });
			return {};
		}

		if (!Array.isArray(lines) || lines.length === 0) {
			// console.warn('[RealtimeArrivals] No lines provided for realtime lookup', {
			// 	stopId: stop.codigo,
			// 	linesType: typeof lines,
			// 	received: lines
			// });
			return {};
		}

		const radiusMeters = options?.radiusMeters ?? 1500;
		const maxPerLine = options?.maxPerLine ?? 3;
		const maxEtaMinutes = options?.maxEtaMinutes ?? 90;


		const bounds = createBoundsFromRadius(stop.latitude, stop.longitude, radiusMeters);
		const buses = await this.getBuses(bounds);

		if (!buses.length) {
			return {};
		}
		this.updateTelemetryHistory(buses);

		type LineDescriptor = {
			line: BusLine;
			sentido: string;
			key: string;
			normalized: string;
			digits: string;
			trimmed: string;
		};
		const descriptors: LineDescriptor[] = lines.map(line => {
			const normalized = normalizeLineNumber(line.linha);
			const digits = normalized.replace(/[^0-9]/g, '');
			const trimmed = digits ? stripLeadingZeros(digits) : '';
			return {
				line,
				sentido: normalizeSentido(line.sentido),
				key: buildLineKey(line.linha, line.sentido),
				normalized,
				digits,
				trimmed,
			};
		});

		if (!descriptors.length) {
			return {};
		}


		// Build lookup maps
  const descriptorBuckets = new Map<string, LineDescriptor[]>();
  
  for (const descriptor of descriptors) {
    for (const key of [descriptor.normalized, descriptor.digits, descriptor.trimmed]) {
      if (!key) continue;
      
      let list = descriptorBuckets.get(key);
      if (!list) {
        list = [];
        descriptorBuckets.set(key, list);
      }
      if (!list.includes(descriptor)) {
        list.push(descriptor);
      }
    }
  }

  // Pre-build fallback lookup structure (only if needed)
  const buildFallbackMap = () => {
    const fallbackMap = new Map<string, LineDescriptor[]>();
    
		for (const descriptor of descriptors) {
			if (!descriptor.digits && !descriptor.trimmed) continue;
			
			const descriptorDigits = descriptor.digits || '';
			const descriptorTrimmed = descriptor.trimmed || '';
			
			// Store by suffix patterns for digits variant
			if (descriptorDigits.length >= 3) {
				for (let i = 3; i <= descriptorDigits.length; i++) {
					const suffix = descriptorDigits.slice(-i);
					let list = fallbackMap.get(suffix);
					if (!list) {
						list = [];
						fallbackMap.set(suffix, list);
					}
					if (!list.includes(descriptor)) {
						list.push(descriptor);
					}
				}
			}

			// Store by suffix patterns for trimmed variant
			if (descriptorTrimmed.length >= 3 && descriptorTrimmed !== descriptorDigits) {
				for (let i = 3; i <= descriptorTrimmed.length; i++) {
					const suffix = descriptorTrimmed.slice(-i);
					let list = fallbackMap.get(suffix);
					if (!list) {
						list = [];
						fallbackMap.set(suffix, list);
					}
					if (!list.includes(descriptor)) {
						list.push(descriptor);
					}
				}
			}
		}
    
    return fallbackMap;
  };

  let fallbackMap: Map<string, LineDescriptor[]> | null = null;

  const result: StopRealtimeArrivalsMap = {};
  const stats = {
    totalBuses: buses.length,
    missingCoords: 0,
    noDescriptor: 0,
    outsideRadius: 0,
    speedZeroTooFar: 0,
    etaOutOfRange: 0,
    sentidoMismatch: 0,
    lineMismatch: 0,
    matched: 0,
    fallbackMatches: 0,
  };
  // Pre-cache normalized bus data
	const normalizedBuses = buses.map(bus => {
    if (!bus || !isFinite(bus.latitude) || !isFinite(bus.longitude)) {
      return null;
    }

    const normalized = normalizeLineNumber(bus.linha);
    const digits = normalized.replace(/[^0-9]/g, '');
    const trimmedDigits = digits ? stripLeadingZeros(digits) : '';
    const busSentido = normalizeSentido(bus.sentido);
		const baseSpeedKmh = typeof bus.velocidade === 'number' ? bus.velocidade : Number(bus.velocidade ?? 0);
		const speedKmh = this.getTelemetrySpeed(bus, baseSpeedKmh);

    return {
      bus,
      normalized,
      digits,
      trimmedDigits,
      busSentido,
      speedKmh,
    };
  }).filter((item): item is NonNullable<typeof item> => item !== null);

  stats.missingCoords = buses.length - normalizedBuses.length;

  // Main processing loop
  for (const busData of normalizedBuses) {
    const { bus, normalized, digits, trimmedDigits, busSentido, speedKmh } = busData;

    // Find matching descriptors
    let candidateDescriptors: LineDescriptor[] | null = null;

    // Try direct lookup first
    for (const key of [normalized, digits, trimmedDigits]) {
      const bucket = key ? descriptorBuckets.get(key) : undefined;
      if (bucket && bucket.length > 0) {
        candidateDescriptors = bucket;
        break;
      }
    }

    // Fallback matching (lazy initialization)
    if (!candidateDescriptors) {
      if (!fallbackMap) {
        fallbackMap = buildFallbackMap();
      }

      const matches = new Set<LineDescriptor>();
      
      for (const busDigitsValue of [digits, trimmedDigits]) {
        if (!busDigitsValue || busDigitsValue.length < 3) continue;
        
        // Check suffix patterns
        for (let i = 3; i <= busDigitsValue.length; i++) {
          const suffix = busDigitsValue.slice(-i);
          const descriptorList = fallbackMap.get(suffix);
          if (descriptorList) {
            descriptorList.forEach(d => matches.add(d));
          }
        }
      }

      if (matches.size === 1) {
        candidateDescriptors = Array.from(matches);
        stats.fallbackMatches += 1;
      } else {
        stats.noDescriptor += 1;
        continue;
      }
    }

    // Calculate distance (only after we have candidates)
    const distanceToStop = haversineDistance(
      stop.latitude,
      stop.longitude,
      bus.latitude,
      bus.longitude
    );

    if (!isFinite(distanceToStop) || distanceToStop > radiusMeters) {
      stats.outsideRadius += 1;
      continue;
    }

    // Calculate ETA
    const speedMs = speedKmh > 0 ? (speedKmh * 1000) / 3600 : 0;
    let etaMinutes: number;

    // Special case for slow or stopped buses
    if (speedMs <= 0.3) {
      // 200 meters distance threshold for "approaching"
      if (distanceToStop <= 200) {
        etaMinutes = 0;
      } else {
        stats.speedZeroTooFar += 1;
        continue;
      }
    } else {
      etaMinutes = distanceToStop / speedMs / 60;
      etaMinutes = Math.max(0, etaMinutes - 1); // subtract 1 minute for stop dwell time, due to uncertainty of GPS
    }

    if (!isFinite(etaMinutes) || etaMinutes < 0 || etaMinutes > maxEtaMinutes) {
      stats.etaOutOfRange += 1;
      continue;
    }

    // 500 meters distance threshold for "approaching"
    const isApproaching = distanceToStop <= 500 || etaMinutes <= 2;

    // Match against candidates
    for (const descriptor of candidateDescriptors) {
      // Validate line match
      if (!matchesLineNumber(bus.linha, descriptor.line.linha)) {
        stats.lineMismatch += 1;
        continue;
      }

      // Validate sentido match
      if (busSentido && descriptor.sentido && busSentido !== descriptor.sentido) {
        stats.sentidoMismatch += 1;
        continue;
      }

      // Add arrival
      let entry = result[descriptor.key];
      if (!entry) {
        entry = { line: descriptor.line, arrivals: [] };
        result[descriptor.key] = entry;
      }

      entry.arrivals.push({
        bus,
        etaMinutes,
        distanceMeters: distanceToStop,
        speedKmh,
        isApproaching,
      });

      stats.matched += 1;
    }
  }

  // Sort and limit arrivals per line
  for (const entry of Object.values(result)) {
    entry.arrivals.sort((a, b) => a.etaMinutes - b.etaMinutes);
    entry.arrivals = entry.arrivals.slice(0, maxPerLine);
  }

  return result;
	}

	// #endregion

	// #region Transformations Bus
	/**
	 * Transform API response to Bus object
	 * @param feature 
	 * @returns 
	 */
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

	/**
	 * Transform bus data from the new Geo API data structure 09/2025
	 */
	private transformBusFromNewGeoApi(feature: NewBusGeoApiResponse['features'][0], operatorName: string): Bus | null {
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
		} as Bus;

		// Log first few buses for debugging
		// if (Math.random() < 0.001) { // Log ~0.1% of buses
		//   console.log('Transformed bus sample:', transformedBus);
		// }

		return transformedBus;
	}
	// #endregion

	// #region Helpers Bus

	/**
	 * Enhance a single bus with operator information(if available) and colors
	 * @param BusObject 
	 * @param frotaMap 
	 * @returns EnhancedBus Object
	 */
	private enhanceBusWithOperator(bus: Bus, frotaMap: Map<string, FrotaOperadora>): EnhancedBus {
		const frotaInfo = frotaMap.get(bus.prefixo);

		// Map of main operators and their colors
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


	/**
	 * Checks if a bus is within the specified geographical bounds.
	 * @param bus - The BusObject to check.
	 * @param bounds - The geographical bounds to check against.
	 * @returns True if the bus is within the bounds, false otherwise.
	 */
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

	// #endregion


	// #region Requests BusGeoLines

	/**
	 * Fetch bus lines from the GeoServer.
	 * @returns List of bus lines from the API
	 */
	async getLines(): Promise<BusLine[]> {
		const response = await this.apiService.makeRequest<LineApiProperties>(
			appConfig.api.endpoints.geoLinhasEspaciais,
			undefined,
			true // Use geoserver for lines
		);

		return response.features
			.map(feature => this.transformLineFromApi(feature))
			.filter(line => line !== null) as BusLine[];
	}
	/**
	 * Fetch bus lines from the dados endpoint (V2 format).
	 * @returns BusLines object
	 */
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

	// #endregion

	// #region Cache BusGeoLines

	/**
	 * Fetch cached bus lines.
	 * @param options Cache options
	 * @returns List of bus lines from cache or Geo api
	 */
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

	// #endregion

	// #region Transformations BusGeoLines
	public transformLineFromApi(feature: ApiResponse<LineApiProperties>['features'][0]): BusLine | null {
		const { properties, geometry } = feature;

		if (!['LineString', 'MultiLineString'].includes(geometry.type)) {
			return null;
		}

		const linha = properties.linha || '';

		if (!linha) {
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
				const { lat, lng } = utmToLatLngZone23S(x, y);
				return [lng, lat];
			}
			return [x, y];
		});

		return {
			id: properties.id,
			linha,
      nome: properties.nome || '',
      sentido: properties.sentido || '',
      tarifa: properties.tarifa || 0,
			coordinates,
			tipo: geometry.type as 'LineString' | 'MultiLineString',
		};
	}

	/**
	 * Transforms a V2 API response feature into a BusLineV2 object.
	 * @param feature - The API response feature to transform.
	 * @returns The transformed BusLineV2 object or null if the feature is invalid.
	 */
	public transformLineV2FromApi(feature: any): BusLineV2 | null {
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
	// #endregion

	// #region Helpers BusGeoLines

	// #endregion

}