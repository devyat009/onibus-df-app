import { MapBounds } from "@/src/types";
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

	// Calculate the distance from point to line segment
	const A = px - x1;
	const B = py - y1;
	const C = x2 - x1;
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

	const xx = x1 + param * C;
	const yy = y1 + param * D;

	// Use Haversine distance for geographic coordinates
	return haversineDistance(yy, xx, py, px); // latitude, longitude
}

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