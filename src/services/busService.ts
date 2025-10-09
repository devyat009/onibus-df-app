import { useAppStore } from "../store";
import { ApiResponse, Bus, BusApiProperties, BusLine, BusLineV2, BusStop, DadosNumerosVeiculos, EnhancedBus, FrotaOperadora, LineApiProperties, MapBounds, NewBusGeoApiResponse, StopRealtimeArrivalsMap } from "../types";
import { CACHE_KEYS, CacheOptions, getCachedOrFetch } from "../utils/cacheManager";
import appConfig from "../utils/config";
import { createBoundsFromRadius, haversineDistance, utmToLatLngZone23S } from "../utils/geoUtils";
import { buildLineKey, matchesLineNumber, normalizeLineNumber, normalizeSentido, stripLeadingZeros } from "../utils/lineUtils";
import { ApiError, ApiService } from "./api";
import { FrotaService } from "./frotaService";

export class BusService {

	private baseUrl: string;

	constructor(
		private apiService: ApiService,
		private frotaService: FrotaService
	) {
		this.baseUrl = appConfig.api.baseUrl;
	}

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

		// console.log('[RealtimeArrivals] Fetching realtime arrivals', {
		// 	stopId: stop.codigo,
		// 	stopName: stop.nome,
		// 	linesCount: lines.length,
		// 	radiusMeters,
		// 	maxPerLine,
		// 	maxEtaMinutes
		// });

		const bounds = createBoundsFromRadius(stop.latitude, stop.longitude, radiusMeters);
		//console.log('[RealtimeArrivals] Calculated bounds for stop', bounds);
		const buses = await this.getBuses(bounds);
		// console.log('[RealtimeArrivals] Buses fetched for bounds', {
		// 	totalBuses: buses.length,
		// 	bounds
		// });

		if (!buses.length) {
			// console.log('[RealtimeArrivals] No buses returned within bounds');
			return {};
		}

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
			// console.warn('[RealtimeArrivals] Failed to build descriptors for lines', {
			// 	stopId: stop.codigo,
			// 	lines
			// });
			return {};
		}

		// console.log('[RealtimeArrivals] Built line descriptors', {
		// 	descriptorCount: descriptors.length,
		// 	descriptorKeys: descriptors.map(descriptor => descriptor.key)
		// });

		const descriptorBuckets = new Map<string, LineDescriptor[]>();
		const registerDescriptor = (key: string, descriptor: LineDescriptor) => {
			if (!key) return;
			const list = descriptorBuckets.get(key) ?? [];
			if (!list.includes(descriptor)) {
				list.push(descriptor);
				descriptorBuckets.set(key, list);
			}
		};

		descriptors.forEach(descriptor => {
			[descriptor.normalized, descriptor.digits, descriptor.trimmed].forEach(key => registerDescriptor(key, descriptor));
		});

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
		const samples: {
			noDescriptor: any[];
			lineMismatch: any[];
			sentidoMismatch: any[];
			speedZeroTooFar: any[];
		} = {
			noDescriptor: [],
			lineMismatch: [],
			sentidoMismatch: [],
			speedZeroTooFar: [],
		};

		const pushArrival = (descriptor: LineDescriptor, etaMinutes: number, distance: number, bus: Bus, isApproaching: boolean, speedKmh: number) => {
			const existing = result[descriptor.key] ?? { line: descriptor.line, arrivals: [] };
			existing.arrivals.push({
				bus,
				etaMinutes,
				distanceMeters: distance,
				speedKmh,
				isApproaching,
			});
			result[descriptor.key] = existing;
		};

		buses.forEach(bus => {
			if (!bus || !isFinite(bus.latitude) || !isFinite(bus.longitude)) {
				stats.missingCoords += 1;
				return;
			}

			const normalized = normalizeLineNumber(bus.linha);
			const digits = normalized.replace(/[^0-9]/g, '');
			const trimmedDigits = digits ? stripLeadingZeros(digits) : '';

			const candidateDescriptors = new Set<LineDescriptor>();
			[normalized, digits, trimmedDigits].forEach(key => {
				const bucket = key ? descriptorBuckets.get(key) : undefined;
				bucket?.forEach(descriptor => candidateDescriptors.add(descriptor));
			});

			if (!candidateDescriptors.size) {
				const fallbackMatches = descriptors.filter(descriptor => {
					if (!descriptor.digits && !descriptor.trimmed) return false;
					const descriptorDigits = descriptor.digits || '';
					const descriptorTrimmed = descriptor.trimmed || '';
					const busDigitsVariants = [digits, trimmedDigits]
						.filter(Boolean) as string[];

					return busDigitsVariants.some(busDigitsValue => {
						if (!busDigitsValue) return false;
						if (descriptorDigits === busDigitsValue) return true;
						if (descriptorTrimmed && descriptorTrimmed === busDigitsValue) return true;
						if (busDigitsValue.length >= 3 && descriptorDigits.endsWith(busDigitsValue)) return true;
						if (descriptorDigits.length >= 3 && busDigitsValue.endsWith(descriptorDigits)) return true;
						if (busDigitsValue.length >= 3 && descriptorTrimmed.endsWith(busDigitsValue)) return true;
						if (descriptorTrimmed.length >= 3 && busDigitsValue.endsWith(descriptorTrimmed)) return true;
						return false;
					});
				});

				if (fallbackMatches.length === 1) {
					const [chosenDescriptor] = fallbackMatches;
					stats.fallbackMatches += 1;
					candidateDescriptors.add(chosenDescriptor);
					// console.log('[RealtimeArrivals] Using fallback match for bus line', JSON.stringify({
					// 	busId: bus.prefixo,
					// 	rawLinha: bus.linha,
					// 	normalized,
					// 	digits,
					// 	trimmedDigits,
					// 	chosenDescriptor: {
					// 		numero: chosenDescriptor.line.numero,
					// 		sentido: chosenDescriptor.line.sentido,
					// 		key: chosenDescriptor.key,
					// 		digits: chosenDescriptor.digits,
					// 		trimmed: chosenDescriptor.trimmed,
					// 	}
					// }));
				} else {
					stats.noDescriptor += 1;
					if (samples.noDescriptor.length < 5) {
						samples.noDescriptor.push({
							busId: bus.prefixo,
							rawLinha: bus.linha,
							normalized,
							digits,
							trimmedDigits,
							sentido: bus.sentido,
							fallbackMatches: fallbackMatches.map(match => ({
								numero: match.line.linha,
								sentido: match.line.sentido,
								key: match.key,
								digits: match.digits,
							}))
						});
						// console.warn('[RealtimeArrivals] No descriptor candidate', JSON.stringify(samples.noDescriptor[samples.noDescriptor.length - 1]));
					}
					return;
				}
			}

			const busSentido = normalizeSentido(bus.sentido);
			const distanceToStop = haversineDistance(stop.latitude, stop.longitude, bus.latitude, bus.longitude);
			if (!isFinite(distanceToStop) || distanceToStop > radiusMeters) {
				stats.outsideRadius += 1;
				return;
			}

			const speedKmh = typeof bus.velocidade === 'number'
				? bus.velocidade
				: Number(bus.velocidade ?? 0);
			const speedMs = speedKmh > 0 ? (speedKmh * 1000) / 3600 : 0;

			let etaMinutes: number | null;
			if (speedMs <= 0.3) {
				// Very low or zero speed: treat as arrived if extremely close
				if (distanceToStop <= 80) {
					etaMinutes = 0;
				} else {
					stats.speedZeroTooFar += 1;
					if (samples.speedZeroTooFar.length < 5) {
						samples.speedZeroTooFar.push({
							busId: bus.prefixo,
							rawLinha: bus.linha,
							distanceToStop: Math.round(distanceToStop),
							speedKmh,
							sentido: bus.sentido
						});
						// console.warn('[RealtimeArrivals] Slow bus too far from stop', JSON.stringify(samples.speedZeroTooFar[samples.speedZeroTooFar.length - 1]));
					}
					return;
				}
			} else {
				etaMinutes = distanceToStop / speedMs / 60;
			}

			if (etaMinutes == null || !isFinite(etaMinutes) || etaMinutes < 0 || etaMinutes > maxEtaMinutes) {
				stats.etaOutOfRange += 1;
				return;
			}

			const etaValue = etaMinutes;
			const isApproaching = distanceToStop <= 120 || etaValue <= 2;

			candidateDescriptors.forEach(descriptor => {
				if (!matchesLineNumber(bus.linha, descriptor.line.linha)) {
					stats.lineMismatch += 1;
					if (samples.lineMismatch.length < 5) {
						samples.lineMismatch.push({
							busId: bus.prefixo,
							rawLinha: bus.linha,
							normalizedLinha: normalized,
							descriptorNumero: descriptor.line.linha,
							descriptorKey: descriptor.key
						});
						// console.warn('[RealtimeArrivals] Line mismatch candidate', JSON.stringify(samples.lineMismatch[samples.lineMismatch.length - 1]));
					}
					return;
				}

				if (busSentido && descriptor.sentido && busSentido !== descriptor.sentido) {
					stats.sentidoMismatch += 1;
					if (samples.sentidoMismatch.length < 5) {
						samples.sentidoMismatch.push({
							busId: bus.prefixo,
							rawLinha: bus.linha,
							busSentido,
							descriptorSentido: descriptor.sentido,
							descriptorKey: descriptor.key
						});
						// console.warn('[RealtimeArrivals] Sentido mismatch', JSON.stringify(samples.sentidoMismatch[samples.sentidoMismatch.length - 1]));
					}
					return;
				}

				pushArrival(descriptor, etaValue, distanceToStop, bus, isApproaching, speedKmh);
				stats.matched += 1;
			});
		});

		Object.values(result).forEach(entry => {
			entry.arrivals = entry.arrivals
				.filter(arrival => arrival.etaMinutes >= 0 && arrival.etaMinutes <= maxEtaMinutes)
				.sort((a, b) => a.etaMinutes - b.etaMinutes)
				.slice(0, maxPerLine);
		});

		// console.log('[RealtimeArrivals] Matching summary', {
		// 	stopId: stop.codigo,
		// 	linesEvaluated: descriptors.length,
		// 	resultLineCount: Object.keys(result).length,
		// 	stats,
		// 	samples
		// });
		// console.log('[RealtimeArrivals] Matching summary (json)', JSON.stringify({
		// 	stopId: stop.codigo,
		// 	linesEvaluated: descriptors.length,
		// 	resultLineCount: Object.keys(result).length,
		// 	stats,
		// 	samples
		// }, null, 2));

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