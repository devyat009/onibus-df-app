import { useAppStore } from "../store";
import { ApiResponse, Bus, BusApiProperties, BusLine, BusLineV2, BusStop, DadosNumerosVeiculos, EnhancedBus, FrotaOperadora, LineApiProperties, MapBounds, NewBusGeoApiResponse, StopRealtimeArrivalsMap } from "../types";
import { CACHE_KEYS, CacheOptions, getCachedOrFetch } from "../utils/cacheManager";
import appConfig from "../utils/config";
import { calculateBearing, calculateRouteDistanceToStop, createBoundsFromRadius, haversineDistance, parseBusHeading, utmToLatLngZone23S } from "../utils/geoUtils";
import { areSentidosCompatible, buildLineKey, getLineLookupKeys, matchesLineNumber, normalizeLineNumber, normalizeSentido, stripLeadingZeros } from "../utils/lineUtils";
import { ApiError } from "./apiError";
import type { ApiService } from "./api";
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

	private get baseUrl(): string {
		return appConfig.api.baseUrl;
	}
	private telemetryHistory = new Map<string, TelemetrySample[]>();
	private telemetryInterval: ReturnType<typeof setInterval> | null = null;
	private telemetryFetchInFlight = false;
	private telemetryIntervalMs = 30000;

	constructor(
		private apiService: ApiService,
		private frotaService: FrotaService
	) {
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

	/**
	 * Parses the true vehicle GPS fix timestamp.
	 * IMPORTANT: Always prioritize `datalocal` (vehicle onboard GPS timestamp in Brasilia -03:00)
	 * over `dataregistro` (SEMOB backend batch-upsert timestamp, which updates to NOW even on
	 * stale/offline vehicles whose GPS stopped days ago).
	 */
	public parseBusTimestamp(datalocal?: string, dataregistro?: string, fallbackNow: number = Date.now()): number {
		if (datalocal) {
			const trimmed = datalocal.trim();
			if (trimmed) {
				let isoString = trimmed.includes('T')
					? trimmed
					: trimmed.replace(' ', 'T');
				if (!/[Zz]|[+-]\d{2}:?\d{2}$/.test(isoString)) {
					isoString += '-03:00';
				}
				const parsed = new Date(isoString).getTime();
				if (Number.isFinite(parsed) && parsed > 946684800000) {
					return parsed;
				}
			}
		}
		if (dataregistro) {
			const parsed = new Date(dataregistro).getTime();
			if (Number.isFinite(parsed) && parsed > 946684800000) {
				return parsed;
			}
		}
		return fallbackNow;
	}

	public recordTelemetrySnapshot(buses: Bus[]): void {
		this.updateTelemetryHistory(buses);
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
			const busTimestamp = this.parseBusTimestamp(bus.datalocal, bus.dataregistro, now);
			if (now - busTimestamp > TELEMETRY_MAX_AGE_MS) {
				continue;
			}
			const sample: TelemetrySample = {
				timestamp: busTimestamp,
				latitude,
				longitude,
				speedKmh,
			};

			const history = this.telemetryHistory.get(key) ?? [];
			const lastSample = history[history.length - 1];
			// Avoid pushing duplicate GPS snapshot if timestamp & coordinates did not change
			if (
				lastSample &&
				lastSample.timestamp === sample.timestamp &&
				lastSample.latitude === sample.latitude &&
				lastSample.longitude === sample.longitude
			) {
				continue;
			}
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
		const raw = Number(String(bus.velocidade ?? 0).replace(',', '.'));
		return Number.isFinite(raw) && raw >= 0 ? Math.min(raw, 110) : 0;
	}

	public getEffectiveBusHeading(bus: Bus, speedKmh?: number): number | null {
		const speed = speedKmh ?? this.extractBusSpeed(bus);
		const key = this.getTelemetryKey(bus);
		const history = key ? this.telemetryHistory.get(key) : undefined;

		// Prefer actual displacement vector when the bus moved >= 15m recently
		if (history && history.length >= 2) {
			const curr = history[history.length - 1];
			for (let i = history.length - 2; i >= 0; i--) {
				const prev = history[i];
				const dt = curr.timestamp - prev.timestamp;
				if (dt > 0 && dt <= 3 * 60 * 1000) {
					const movedMeters = haversineDistance(
						prev.latitude,
						prev.longitude,
						curr.latitude,
						curr.longitude
					);
					if (movedMeters >= 15) {
						return calculateBearing(
							[prev.longitude, prev.latitude],
							[curr.longitude, curr.latitude]
						);
					}
				}
			}
		}

		return parseBusHeading(bus.direcao, speed);
	}

	private getTelemetrySpeed(bus: Bus, fallbackSpeedKmh: number): number {
		// If current GPS Doppler speed reports the bus is currently stopped, do not resurrect an old cruising speed
		if (fallbackSpeedKmh <= 1.2) {
			return fallbackSpeedKmh;
		}

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
			let weightedSum = 0;
			let weightTotal = 0;
			for (let i = 1; i < samples.length; i++) {
				const previous = samples[i - 1];
				const current = samples[i];
				const timeDiff = current.timestamp - previous.timestamp;
				// Require at least 5s between distinct fixes to prevent GPS jitter velocity spikes
				if (timeDiff < 5000 || timeDiff > 3 * 60 * 1000) {
					continue;
				}
				const distanceMeters = haversineDistance(
					previous.latitude,
					previous.longitude,
					current.latitude,
					current.longitude
				);
				if (!isFinite(distanceMeters) || distanceMeters < 5) {
					continue;
				}
				const speedMs = distanceMeters / (timeDiff / 1000);
				const segSpeedKmh = Math.min(90, speedMs * 3.6);
				if (isFinite(segSpeedKmh) && segSpeedKmh > 0) {
					const weight = i; // weight newer segments higher
					weightedSum += segSpeedKmh * weight;
					weightTotal += weight;
				}
			}
			if (weightTotal > 0) {
				const displacementSpeedKmh = weightedSum / weightTotal;
				return 0.5 * fallbackSpeedKmh + 0.5 * displacementSpeedKmh;
			}
		}

		return fallbackSpeedKmh;
	}

	/**
	 * Unified, realistic urban ETA calculator used by both StopDetail and LineRouteMap.
	 * Accounts for:
	 * - True GPS timestamp freshness (`datalocal`) & conservative signal-age dead reckoning
	 * - Heading-aware route polyline projection (handles Brasilia's looping/overlapping corridors & circular routes)
	 * - Two-zone speed damping (near-term smoothed speed blended into corridor commercial speed over distance)
	 */
	public estimateBusArrivalAtStop(
		bus: Bus,
		stop: BusStop,
		line: BusLine,
		options?: {
			maxEtaMinutes?: number;
			maxBusAgeMs?: number;
			tempoPercursoMinutes?: number;
		}
	): {
		etaMinutes: number;
		distanceMeters: number;
		speedKmh: number;
		isApproachingAlongRoute: boolean;
		isApproachingSoon: boolean;
		isStale: boolean;
	} {
		const now = Date.now();
		const maxBusAgeMs = options?.maxBusAgeMs ?? 8 * 60 * 1000; // 8 minutes strict real-time freshness
		const maxEtaMinutes = options?.maxEtaMinutes ?? 90;

		const busTimestamp = this.parseBusTimestamp(bus.datalocal, bus.dataregistro, NaN);
		const ageMs = Number.isFinite(busTimestamp) ? now - busTimestamp : 0;
		const isStale = !Number.isFinite(busTimestamp) || ageMs > maxBusAgeMs || ageMs < -5 * 60 * 1000;

		const rawSpeedKmh = this.extractBusSpeed(bus);
		const smoothedSpeedKmh = this.getTelemetrySpeed(bus, rawSpeedKmh);
		const headingDeg = this.getEffectiveBusHeading(bus, rawSpeedKmh);

		const stopCoord: [number, number] = [stop.longitude, stop.latitude];
		const busCoord: [number, number] = [bus.longitude, bus.latitude];
		const routeCoords = (line.coordinates || []) as [number, number][];
		const hasRouteGeometry = routeCoords.length >= 2;
		const isCircular = normalizeSentido(line.sentido) === 'C';

		const routeCheck = calculateRouteDistanceToStop(
			busCoord,
			stopCoord,
			hasRouteGeometry ? routeCoords : undefined,
			isCircular,
			headingDeg,
			rawSpeedKmh
		);

		let isApproachingAlongRoute = routeCheck.isApproachingAlongRoute;

		// Additional telemetry history check when no route geometry is available
		if (!hasRouteGeometry && isApproachingAlongRoute && routeCheck.distanceMeters > 150) {
			const telemetryKey = this.getTelemetryKey(bus);
			const history = telemetryKey ? this.telemetryHistory.get(telemetryKey) : undefined;
			if (history && history.length >= 2) {
				const prevSample = history[history.length - 2];
				const prevDist = haversineDistance(
					stop.latitude,
					stop.longitude,
					prevSample.latitude,
					prevSample.longitude
				);
				if (isFinite(prevDist) && routeCheck.distanceMeters - prevDist > 35) {
					isApproachingAlongRoute = false;
				}
			}
		}

		const distanceMeters = routeCheck.distanceMeters;
		if (!isApproachingAlongRoute || isStale || !isFinite(distanceMeters)) {
			return {
				etaMinutes: Infinity,
				distanceMeters,
				speedKmh: smoothedSpeedKmh,
				isApproachingAlongRoute: false,
				isApproachingSoon: false,
				isStale,
			};
		}

		// Arriving right now within 75m along the route
		if (distanceMeters <= 75) {
			return {
				etaMinutes: 0,
				distanceMeters,
				speedKmh: smoothedSpeedKmh,
				isApproachingAlongRoute: true,
				isApproachingSoon: true,
				isStale: false,
			};
		}

		// Reference commercial speed (includes intermediate stops & traffic signals)
		let vRefKmh = 22;
		const tempoPercurso = options?.tempoPercursoMinutes ?? 0;
		if (tempoPercurso > 0 && routeCheck.totalRouteMeters > 1000) {
			const scheduledKmh = (routeCheck.totalRouteMeters / 1000) / (tempoPercurso / 60);
			if (Number.isFinite(scheduledKmh)) {
				vRefKmh = Math.max(15, Math.min(36, scheduledKmh));
			}
		}

		const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
		const dNear = Math.min(distanceMeters, 800);
		const dFar = Math.max(0, distanceMeters - 800);

		let dwellSeconds = 0;
		let vNearKmh: number;
		let vFarKmh: number;

		if (rawSpeedKmh <= 1.5) {
			// Stopped at origin terminal vs stopped mid-route (traffic light / boarding)
			const atOriginTerminal =
				routeCheck.totalRouteMeters > 500 && routeCheck.busDistanceFromStartMeters <= 200;
			dwellSeconds = atOriginTerminal ? 90 : 25;
			vNearKmh = Math.max(15, vRefKmh * 0.82);
			vFarKmh = vRefKmh;
		} else {
			vNearKmh = clamp(smoothedSpeedKmh, 12, 48);
			vFarKmh = 0.3 * clamp(smoothedSpeedKmh, 15, 45) + 0.7 * vRefKmh;
		}

		let travelSeconds =
			dwellSeconds +
			dNear / (vNearKmh / 3.6) +
			dFar / (vFarKmh / 3.6);

		// Compensate conservatively for the elapsed seconds since `datalocal` was recorded on a moving bus
		if (rawSpeedKmh > 5 && ageMs > 0) {
			const ageSec = Math.min(ageMs / 1000, 90);
			travelSeconds = Math.max(0, travelSeconds - 0.55 * ageSec);
		}

		const etaMinutes = travelSeconds <= 35 ? 0 : Math.max(0, travelSeconds / 60);
		if (!isFinite(etaMinutes) || etaMinutes > maxEtaMinutes) {
			return {
				etaMinutes: Infinity,
				distanceMeters,
				speedKmh: smoothedSpeedKmh,
				isApproachingAlongRoute: false,
				isApproachingSoon: false,
				isStale: false,
			};
		}

		return {
			etaMinutes,
			distanceMeters,
			speedKmh: smoothedSpeedKmh,
			isApproachingAlongRoute: true,
			isApproachingSoon: distanceMeters <= 450 || etaMinutes <= 2,
			isStale: false,
		};
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
    //console.log('debug - getBuses', { bounds, filterToUse, options });
		try {
			const geoserverEndpoint = appConfig.api.endpoints.geoOnibusPosicao || appConfig.api.endpoints.dadosOnibusPosicao;
      console.log("geoserverEndpoint", geoserverEndpoint);
			const response = await this.apiService.makeRequest<BusApiProperties>(
				geoserverEndpoint,
				bounds,
				true // Prefer geoserver data when available
			);
      // console.log('[ DEV BUSES ]:', response);

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

		const parseTimestamp = (dl?: string, dr?: string) => this.parseBusTimestamp(dl, dr, NaN);
		function filterActiveBusesRecent(buses: Bus[], filter: '30min' | '24h' = '30min'): Bus[] {
			const now = Date.now();
			const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
			const THIRTY_MINUTES = 30 * 60 * 1000;
			const TOLERANCE_FUTURE_MS = 5 * 60 * 1000; // 5 min tolerance for server/tracker clock drift

			const timeLimit = filter === '24h' ? TWENTY_FOUR_HOURS : THIRTY_MINUTES;

			const validBuses = buses.filter(bus => {
				if (!bus.datalocal && !bus.dataregistro) return false;

				const busTime = parseTimestamp(bus.datalocal, bus.dataregistro);

				if (isNaN(busTime)) return false;
				const timeDiff = now - busTime;
				return timeDiff >= -TOLERANCE_FUTURE_MS && timeDiff <= timeLimit;
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
				this.frotaService.getFrotaCached().catch(err => {
					console.warn('[BusService] Failed to load frota in getEnhancedBuses, continuing without operator enhancement:', err);
					return [] as FrotaOperadora[];
				}),
				this.frotaService.getNumerosVeiculosCached().catch(err => {
					console.warn('[BusService] Failed to load numeros in getEnhancedBuses, continuing without numeroDados:', err);
					return [] as DadosNumerosVeiculos[];
				}),
			]);

		console.warn(`[DEV] Enhanced buses - got ${buses.length} buses from getBuses`);
		console.warn(`[DEV] Enhanced buses - got ${frota.length} frota entries`);

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
			tempoPercursoByLineKey?: Record<string, number>;
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

		const radiusMeters = options?.radiusMeters ?? 20000;
		const maxPerLine = options?.maxPerLine ?? 3;
		const maxEtaMinutes = options?.maxEtaMinutes ?? 90;
		const tempoPercursoByLineKey = options?.tempoPercursoByLineKey;

		const bounds = createBoundsFromRadius(stop.latitude, stop.longitude, radiusMeters);
		const buses = await this.getBuses(bounds, '30min');

		if (!buses.length) {
			return {};
		}
		this.updateTelemetryHistory(buses);

		type LineDescriptor = {
			line: BusLine;
			sentido: string;
			key: string;
			lookupKeys: string[];
		};
		const descriptors: LineDescriptor[] = lines.map(line => ({
			line,
			sentido: normalizeSentido(line.sentido),
			key: buildLineKey(line.linha, line.sentido),
			lookupKeys: getLineLookupKeys(line.linha),
		}));

		if (!descriptors.length) {
			return {};
		}

		// Build canonical lookup map without cross-ramal suffix collisions
		const descriptorBuckets = new Map<string, LineDescriptor[]>();
		for (const descriptor of descriptors) {
			for (const key of descriptor.lookupKeys) {
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

		const result: StopRealtimeArrivalsMap = {};

		for (const bus of buses) {
			if (!bus || !isFinite(bus.latitude) || !isFinite(bus.longitude) || !bus.linha) {
				continue;
			}

			// Find matching candidate descriptors via canonical line keys
			const busKeys = getLineLookupKeys(bus.linha);
			const candidateSet = new Set<LineDescriptor>();
			for (const bKey of busKeys) {
				const bucket = descriptorBuckets.get(bKey);
				if (bucket) {
					for (const d of bucket) candidateSet.add(d);
				}
			}
			if (candidateSet.size === 0) {
				continue;
			}

			const directDistanceToStop = haversineDistance(
				stop.latitude,
				stop.longitude,
				bus.latitude,
				bus.longitude
			);
			if (!isFinite(directDistanceToStop) || directDistanceToStop > radiusMeters * 1.25) {
				continue;
			}

			for (const descriptor of candidateSet) {
				if (!matchesLineNumber(bus.linha, descriptor.line.linha)) {
					continue;
				}
				if (!areSentidosCompatible(bus.sentido, descriptor.line.sentido)) {
					continue;
				}

				const tempoPercurso = tempoPercursoByLineKey?.[descriptor.key];
				const estimate = this.estimateBusArrivalAtStop(bus, stop, descriptor.line, {
					maxEtaMinutes,
					tempoPercursoMinutes: tempoPercurso,
				});

				if (!estimate.isApproachingAlongRoute || !isFinite(estimate.etaMinutes)) {
					continue;
				}

				let entry = result[descriptor.key];
				if (!entry) {
					entry = { line: descriptor.line, arrivals: [] };
					result[descriptor.key] = entry;
				}

				// Deduplicate by vehicle prefixo/id within the same line+direction
				const existingIdx = entry.arrivals.findIndex(
					a => (a.bus.prefixo && a.bus.prefixo === bus.prefixo) || (a.bus.id && a.bus.id === bus.id)
				);
				const arrivalRecord = {
					bus,
					etaMinutes: estimate.etaMinutes,
					distanceMeters: estimate.distanceMeters,
					speedKmh: estimate.speedKmh,
					isApproaching: estimate.isApproachingSoon,
				};
				if (existingIdx >= 0) {
					if (arrivalRecord.etaMinutes < entry.arrivals[existingIdx].etaMinutes) {
						entry.arrivals[existingIdx] = arrivalRecord;
					}
				} else {
					entry.arrivals.push(arrivalRecord);
				}
			}
		}

		// Sort and limit arrivals per line
		for (const entry of Object.values(result)) {
			entry.arrivals.sort((a, b) => a.etaMinutes - b.etaMinutes || a.distanceMeters - b.distanceMeters);
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
			direcao: properties.direcao || '',
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

		const linha = properties.linha || properties.cd_linha || '';

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
				return [Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5];
			}
			return [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5];
		});

		return {
			id: properties.id ?? properties.id_linha ?? 0,
			linha,
      nome: properties.nome || properties.tx_linha || '',
      sentido: properties.sentido || properties.lin_sentido || '',
      tarifa: properties.tarifa ?? properties.vl_tarifa ?? 0,
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