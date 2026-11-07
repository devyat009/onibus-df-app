import type { MapBounds } from "../types";
/**
* Calculate distance between two points using Haversine formula (returns distance in meters)
*/
export const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
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

// Haversine distance between two [lng, lat] points
export const haversineDistance2 = ([lng1, lat1]: [number, number], [lng2, lat2]: [number, number]) => {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const R = 6371000; // Raio da Terra em metros
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate distance from a point to a line segment using Haversine formula for geographic coordinates
 */
export const pointToLineDistance = (point: number[], lineStart: number[], lineEnd: number[]): number => {
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

	// Scale longitude by cos(latitude) so the dot-product projection is isotropic in meters
	const cosLat = Math.cos(((py + y1 + y2) / 3) * (Math.PI / 180));
	const A = (px - x1) * cosLat;
	const B = py - y1;
	const C = (x2 - x1) * cosLat;
	const D = y2 - y1;

	const dot = A * C + B * D;
	const lenSq = C * C + D * D;

	if (lenSq === 0) {
		// Line segment is actually a point - calculate distance using Haversine
		return haversineDistance(y1, x1, py, px); // latitude, longitude
	}

	let param = dot / lenSq;

	if (param < 0) {
		param = 0;
	} else if (param > 1) {
		param = 1;
	}

	const xx = x1 + param * (x2 - x1);
	const yy = y1 + param * D;

	// Use Haversine distance for geographic coordinates
	return haversineDistance(yy, xx, py, px); // latitude, longitude
}

/**
 * Calculate compass bearing in degrees [0, 360) from [lng1, lat1] to [lng2, lat2].
 */
export const calculateBearing = (
	[lng1, lat1]: [number, number],
	[lng2, lat2]: [number, number]
): number => {
	const toRad = (x: number) => (x * Math.PI) / 180;
	const toDeg = (x: number) => (x * 180) / Math.PI;
	const dLng = toRad(lng2 - lng1);
	const rLat1 = toRad(lat1);
	const rLat2 = toRad(lat2);

	const y = Math.sin(dLng) * Math.cos(rLat2);
	const x =
		Math.cos(rLat1) * Math.sin(rLat2) -
		Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLng);
	return (toDeg(Math.atan2(y, x)) + 360) % 360;
};

/**
 * Smallest angular difference between two compass headings in degrees [0, 180].
 */
export const angleDifference = (a: number, b: number): number => {
	const diff = Math.abs(a - b) % 360;
	return diff > 180 ? 360 - diff : diff;
};

/**
 * Parse SEMOB `direcao` string/number (e.g. "168,85" or "146.31") into degrees [0, 360),
 * returning null when missing or unreliable (e.g. "0,00" while stationary).
 */
export const parseBusHeading = (
	direcao?: string | number | null,
	speedKmh: number = 0
): number | null => {
	if (direcao == null || direcao === '') return null;
	const cleaned = String(direcao).trim().replace(',', '.');
	const num = Number(cleaned);
	if (!Number.isFinite(num) || num < 0 || num > 360) return null;
	// Stationary trackers in SEMOB default to "0,00" when no heading is locked
	if (num === 0 && speedKmh <= 2) return null;
	return num % 360;
};

/**
 * Project a [lng, lat] point onto a polyline and return segment index, parameter t,
 * projected point, and perpendicular distance in meters.
 */
export const projectPointOnPolyline = (
	point: [number, number],
	routeCoords: [number, number][],
	preferredHeadingDeg?: number | null
): {
	segmentIndex: number;
	t: number;
	projectedPoint: [number, number];
	perpDistanceMeters: number;
	segmentBearingDeg: number;
} => {
	const [px, py] = point;
	let bestSegment = 0;
	let bestT = 0;
	let bestPoint: [number, number] = routeCoords[0] || point;
	let bestDist = Infinity;
	let bestScore = Infinity;
	let bestBearing = 0;

	for (let i = 0; i < routeCoords.length - 1; i++) {
		const p1 = routeCoords[i];
		const p2 = routeCoords[i + 1];
		if (!p1 || !p2) continue;

		const [x1, y1] = p1;
		const [x2, y2] = p2;
		const cosLat = Math.cos(((py + y1 + y2) / 3) * (Math.PI / 180));
		const A = (px - x1) * cosLat;
		const B = py - y1;
		const C = (x2 - x1) * cosLat;
		const D = y2 - y1;
		const lenSq = C * C + D * D;

		let t = lenSq === 0 ? 0 : (A * C + B * D) / lenSq;
		if (t < 0) t = 0;
		else if (t > 1) t = 1;

		const projLng = x1 + t * (x2 - x1);
		const projLat = y1 + t * D;
		const dist = haversineDistance(projLat, projLng, py, px);
		const segBearing = lenSq === 0 ? 0 : calculateBearing(p1, p2);

		let score = dist;
		if (preferredHeadingDeg != null && Number.isFinite(preferredHeadingDeg) && lenSq > 0) {
			const hDiff = angleDifference(preferredHeadingDeg, segBearing);
			if (hDiff > 35) {
				score += ((hDiff - 35) / 145) * 180;
			}
		}

		if (score < bestScore) {
			bestScore = score;
			bestDist = dist;
			bestSegment = i;
			bestT = t;
			bestPoint = [projLng, projLat];
			bestBearing = segBearing;
		}
	}

	return {
		segmentIndex: bestSegment,
		t: bestT,
		projectedPoint: bestPoint,
		perpDistanceMeters: bestDist,
		segmentBearingDeg: bestBearing,
	};
};

/**
 * Computes how far along a route polyline (from start terminal = 0 to end terminal = 1)
 * a stop is located. Used to adjust terminal departure timetables to stop passage times.
 */
export const getStopProgressAlongRoute = (
	stopCoord: [number, number],
	routeCoords?: [number, number][]
): {
	distanceFromStartMeters: number;
	totalRouteMeters: number;
	progressFraction: number;
	perpDistanceMeters: number;
} | null => {
	if (!routeCoords || routeCoords.length < 2) return null;

	const cumDist = new Array<number>(routeCoords.length).fill(0);
	for (let i = 0; i < routeCoords.length - 1; i++) {
		cumDist[i + 1] = cumDist[i] + haversineDistance2(routeCoords[i], routeCoords[i + 1]);
	}
	const totalRouteMeters = cumDist[routeCoords.length - 1];
	if (!Number.isFinite(totalRouteMeters) || totalRouteMeters < 50) return null;

	const proj = projectPointOnPolyline(stopCoord, routeCoords);
	if (proj.perpDistanceMeters > 350) return null;

	const segOffset = haversineDistance2(routeCoords[proj.segmentIndex], proj.projectedPoint);
	const distanceFromStartMeters = Math.min(totalRouteMeters, cumDist[proj.segmentIndex] + segOffset);

	return {
		distanceFromStartMeters,
		totalRouteMeters,
		progressFraction: Math.max(0, Math.min(1, distanceFromStartMeters / totalRouteMeters)),
		perpDistanceMeters: proj.perpDistanceMeters,
	};
};

/**
 * Calculate route-aware distance from a bus to a stop along the polyline.
 * Handles linear (IDA/VOLTA), self-overlapping/looping avenues (via compass heading),
 * and circular (CIRCULAR) routes.
 */
export const calculateRouteDistanceToStop = (
	busCoord: [number, number],
	stopCoord: [number, number],
	routeCoords?: [number, number][],
	isCircular: boolean = false,
	busHeadingDeg?: number | null,
	busSpeedKmh: number = 0
): {
	distanceMeters: number;
	totalRouteMeters: number;
	busDistanceFromStartMeters: number;
	isApproachingAlongRoute: boolean;
	busOffRouteMeters: number;
} => {
	const directDist = haversineDistance2(busCoord, stopCoord);

	const fallbackNoGeometry = () => {
		let approaching = true;
		if (
			busHeadingDeg != null &&
			Number.isFinite(busHeadingDeg) &&
			busSpeedKmh > 5 &&
			directDist > 120
		) {
			const bearingToStop = calculateBearing(busCoord, stopCoord);
			if (angleDifference(busHeadingDeg, bearingToStop) > 115) {
				approaching = false;
			}
		}
		return {
			distanceMeters: directDist,
			totalRouteMeters: 0,
			busDistanceFromStartMeters: 0,
			isApproachingAlongRoute: approaching,
			busOffRouteMeters: 0,
		};
	};

	if (!routeCoords || routeCoords.length < 2) {
		return fallbackNoGeometry();
	}

	const n = routeCoords.length;
	const cumDist = new Array<number>(n).fill(0);
	for (let i = 0; i < n - 1; i++) {
		const p1 = routeCoords[i];
		const p2 = routeCoords[i + 1];
		const segLen = p1 && p2 ? haversineDistance2(p1, p2) : 0;
		cumDist[i + 1] = cumDist[i] + (Number.isFinite(segLen) ? segLen : 0);
	}
	const totalRouteMeters = cumDist[n - 1];
	if (!Number.isFinite(totalRouteMeters) || totalRouteMeters < 20) {
		return fallbackNoGeometry();
	}

	// 1. Project stop onto polyline and find valid curb-side candidate passes
	const [sx, sy] = stopCoord;
	const [bx, by] = busCoord;
	let minStopPerpDist = Infinity;
	const rawStopProjections: { s: number; perpDist: number }[] = [];

	let minBusPerpDist = Infinity;
	let bestBusScore = Infinity;
	let bestBusS = 0;
	let bestBusPerpDist = Infinity;
	let bestBusSegBearing = 0;

	const useHeading = busHeadingDeg != null && Number.isFinite(busHeadingDeg) && busSpeedKmh > 3;

	for (let i = 0; i < n - 1; i++) {
		const p1 = routeCoords[i];
		const p2 = routeCoords[i + 1];
		if (!p1 || !p2) continue;

		const [x1, y1] = p1;
		const [x2, y2] = p2;
		const segLen = cumDist[i + 1] - cumDist[i];
		if (segLen <= 0.05) continue;

		const cosLat = Math.cos(((y1 + y2) * 0.5) * (Math.PI / 180));
		const C = (x2 - x1) * cosLat;
		const D = y2 - y1;
		const lenSq = C * C + D * D;
		if (lenSq === 0) continue;

		// Stop projection on segment i
		let ts = (((sx - x1) * cosLat) * C + (sy - y1) * D) / lenSq;
		if (ts < 0) ts = 0;
		else if (ts > 1) ts = 1;
		const sProjLng = x1 + ts * (x2 - x1);
		const sProjLat = y1 + ts * D;
		const sPerp = haversineDistance(sProjLat, sProjLng, sy, sx);
		if (sPerp < minStopPerpDist) minStopPerpDist = sPerp;
		if (sPerp <= 120) {
			rawStopProjections.push({ s: cumDist[i] + ts * segLen, perpDist: sPerp });
		}

		// Bus projection on segment i
		let tb = (((bx - x1) * cosLat) * C + (by - y1) * D) / lenSq;
		if (tb < 0) tb = 0;
		else if (tb > 1) tb = 1;
		const bProjLng = x1 + tb * (x2 - x1);
		const bProjLat = y1 + tb * D;
		const bPerp = haversineDistance(bProjLat, bProjLng, by, bx);
		if (bPerp < minBusPerpDist) minBusPerpDist = bPerp;

		const segBearing = calculateBearing(p1, p2);
		let bScore = bPerp;
		if (useHeading) {
			const hDiff = angleDifference(busHeadingDeg!, segBearing);
			if (hDiff > 35) {
				bScore += ((hDiff - 35) / 145) * 180;
			}
		}

		if (bScore < bestBusScore) {
			bestBusScore = bScore;
			bestBusPerpDist = bPerp;
			bestBusS = cumDist[i] + tb * segLen;
			bestBusSegBearing = segBearing;
		}
	}

	// If the polyline does not pass near the stop at all (e.g. outdated geometry), fallback
	if (minStopPerpDist > 300) {
		return fallbackNoGeometry();
	}

	// If the bus is > 350m away from every segment of the polyline, it is off-route (deadheading / garage)
	if (minBusPerpDist > 350) {
		return {
			distanceMeters: directDist,
			totalRouteMeters,
			busDistanceFromStartMeters: bestBusS,
			isApproachingAlongRoute: false,
			busOffRouteMeters: minBusPerpDist,
		};
	}

	// On linear routes, if the bus is clearly driving backwards (> 125 deg off segment bearing at speed), reject
	if (
		!isCircular &&
		useHeading &&
		busSpeedKmh > 6 &&
		directDist > 80 &&
		angleDifference(busHeadingDeg!, bestBusSegBearing) > 125
	) {
		return {
			distanceMeters: directDist,
			totalRouteMeters,
			busDistanceFromStartMeters: bestBusS,
			isApproachingAlongRoute: false,
			busOffRouteMeters: bestBusPerpDist,
		};
	}

	// Deduplicate stop candidate passes along the polyline (keeps same-curb passes within +14m of best curb match)
	const stopMaxAllowedPerp = Math.min(90, minStopPerpDist + 14);
	const filteredStopPasses = rawStopProjections
		.filter(p => p.perpDist <= stopMaxAllowedPerp)
		.sort((a, b) => a.s - b.s);

	const stopCandidatesS: number[] = [];
	if (filteredStopPasses.length === 0) {
		// Stop was between 90m and 300m of route; single global minimum projection
		const singleProj = projectPointOnPolyline(stopCoord, routeCoords);
		const segOffset = haversineDistance2(routeCoords[singleProj.segmentIndex], singleProj.projectedPoint);
		stopCandidatesS.push(cumDist[singleProj.segmentIndex] + segOffset);
	} else {
		let clusterBest = filteredStopPasses[0];
		for (let i = 1; i < filteredStopPasses.length; i++) {
			const curr = filteredStopPasses[i];
			if (curr.s - clusterBest.s <= 150) {
				if (curr.perpDist < clusterBest.perpDist) {
					clusterBest = curr;
				}
			} else {
				stopCandidatesS.push(clusterBest.s);
				clusterBest = curr;
			}
		}
		stopCandidatesS.push(clusterBest.s);
	}

	const startCoord = routeCoords[0];
	const endCoord = routeCoords[n - 1];
	const wrapGap = haversineDistance2(endCoord, startCoord);
	const canWrap = isCircular || wrapGap <= 800;

	let bestForwardDist = Infinity;
	for (const stopS of stopCandidatesS) {
		if (bestBusS <= stopS) {
			const candidateDist = (stopS - bestBusS) + Math.min(bestBusPerpDist, 50);
			if (candidateDist < bestForwardDist) {
				bestForwardDist = candidateDist;
			}
		} else if (bestBusS - stopS <= 45 && directDist <= 65 && busSpeedKmh < 28) {
			// Bus is stopped or pulling into/out of the stop platform itself
			if (directDist < bestForwardDist) {
				bestForwardDist = directDist;
			}
		} else if (canWrap) {
			const wrappedDist = (totalRouteMeters - bestBusS) + wrapGap + stopS + Math.min(bestBusPerpDist, 50);
			if (wrappedDist < bestForwardDist) {
				bestForwardDist = wrappedDist;
			}
		}
	}

	if (Number.isFinite(bestForwardDist)) {
		return {
			distanceMeters: Math.max(directDist * 0.85, bestForwardDist),
			totalRouteMeters,
			busDistanceFromStartMeters: bestBusS,
			isApproachingAlongRoute: true,
			busOffRouteMeters: bestBusPerpDist,
		};
	}

	return {
		distanceMeters: directDist,
		totalRouteMeters,
		busDistanceFromStartMeters: bestBusS,
		isApproachingAlongRoute: false,
		busOffRouteMeters: bestBusPerpDist,
	};
};

/**
 * Get bounds of a line for quick filtering
 */
export const getLineBounds = (coordinates: [number, number][]): { minLat: number, maxLat: number, minLng: number, maxLng: number } => {
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

export const createBoundsFromRadius = (latitude: number, longitude: number, radiusMeters: number): MapBounds => {
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

// Precise UTM zone 23S (WGS84/SIRGAS 2000) conversion
export const utmToLatLngZone23S = (easting: number, northing: number): { lat: number; lng: number } => {
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

/**
 * Check if given [lng, lat] is a valid coordinate
 */
export const isValidCoordinate = ([lng, lat]: [number, number]) => {
  return (
    typeof lng === 'number' &&
    typeof lat === 'number' &&
    lng >= -180 && lng <= 180 &&
    lat >= -90 && lat <= 90
  );
}

/**
 * Calculate the distance between two geographical points.
 * @param lat1 Latitude of the first point
 * @param lon1 Longitude of the first point
 * @param lat2 Latitude of the second point
 * @param lon2 Longitude of the second point
 * @returns Distance in meters
 */
export const distanceInMeters = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  return haversineDistance(lat1, lon1, lat2, lon2);
}

/**
 * Shallow compare arrays of objects by id, latitude, longitude that may move slightly (within minDistance), exemple bus positions
 * @param arr1 First array to compare
 * @param arr2 Second array to compare
 * @param minDistance Minimum distance to consider
 * @returns True if arrays are equal, false otherwise
 */
export const shallowEqualArrayWithDistanceMovingLatLng = (arr1: any[], arr2: any[], minDistance = 5) => {
  if (arr1.length !== arr2.length) return false;
  for (let i = 0; i < arr1.length; i++) {
    if (
      arr1[i].id !== arr2[i].id ||
      distanceInMeters(arr1[i].latitude, arr1[i].longitude, arr2[i].latitude, arr2[i].longitude) > minDistance
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Shallow compare arrays of objects by id, latitude, longitude for not moving objects, exemple bus stops
 * @param arr1 First array to compare
 * @param arr2 Second array to compare
 * @returns True if arrays are equal, false otherwise
 */
export const shallowEqualArray = (arr1: any[], arr2: any[]) => {
  if (arr1.length !== arr2.length) return false;
  for (let i = 0; i < arr1.length; i++) {
    if (arr1[i].id !== arr2[i].id ||
      arr1[i].latitude !== arr2[i].latitude ||
      arr1[i].longitude !== arr2[i].longitude) {
      return false;
    }
  }
  return true;
}