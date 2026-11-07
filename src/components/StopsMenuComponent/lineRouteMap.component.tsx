import { busService, stopService } from '@/src/services/api';
import { useAppStore } from '@/src/store';
import { BusLine, BusStop, EnhancedBus } from '@/src/types';
import { haversineDistance2, pointToLineDistance, utmToLatLngZone23S } from '@/src/utils/geoUtils';
import { matchesLineNumber } from '@/src/utils/lineUtils';
import { MaterialIcons } from '@expo/vector-icons';
import MapLibreGL from '@maplibre/maplibre-react-native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import BusIcon from '../../assets/images/svg/bus.svg';
import { useBusFavorites } from '../../hooks/useFavorites';

const { MapView, Camera, ShapeSource, LineLayer, CircleLayer, MarkerView } = MapLibreGL;

interface LineRouteMapProps {
  line: BusLine;
  currentStop?: BusStop | null;
  onBack: () => void;
}

const normalizeSentido = (raw?: string): string => {
  const s = String(raw ?? '').trim().toUpperCase();
  if (s === '1' || s === 'I' || s === 'IDA') return 'IDA';
  if (s === '2' || s === 'V' || s === 'VOLTA') return 'VOLTA';
  if (s === 'C' || s === 'CIRCULAR') return 'CIRCULAR';
  return s;
};

const mapStyles = {
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
};

const LineRouteMap: React.FC<LineRouteMapProps> = ({ line, currentStop = null, onBack }) => {
  const appTheme = useAppStore(state => state.appTheme);
  const mapTheme = useAppStore(state => state.style) as 'light' | 'dark';
  const mapStyleUrl = mapStyles[mapTheme] || mapStyles.light;
  const [resolvedLine, setResolvedLine] = useState<BusLine>(line);
  const [loading, setLoading] = useState(true);
  const [stops, setStops] = useState<BusStop[]>([]);
  const [buses, setBuses] = useState<EnhancedBus[]>([]);
  const [selectedStop, setSelectedStop] = useState<BusStop | null>(currentStop ?? null);
  const [showCurrentStop, setShowCurrentStop] = useState(true);
  const [showOtherStops, setShowOtherStops] = useState(true);
  const [cameraBounds, setCameraBounds] = useState<{
    ne: [number, number];
    sw: [number, number];
  } | null>(null);
  // controls whether we should auto-fit bounds on region change
  const [shouldFitBounds, setShouldFitBounds] = useState(true);
  // Timestamp para diferenciar animação programática vs gesto do usuário
  const fitAppliedAtRef = useRef<number | null>(null);
  // Handler for region change events
  const handleRegionDidChange = (event: any) => {
    if (shouldFitBounds) {
      const appliedAt = fitAppliedAtRef.current;
      if (appliedAt && Date.now() - appliedAt < 700) {
        // Inside programmatic animation window; do not disable yet
        return;
      }
      // User interacted after animation -> release camera
      setShouldFitBounds(false);
      return;
    }
  };

  // Route geographic bounds for scoped bus fetching
  const routeBoundsRef = useRef<{ north: number; south: number; east: number; west: number } | null>(null);
  const resolvedCoordsRef = useRef<[number, number][]>((line.coordinates || []) as [number, number][]);
  // Track temporary missing buses to avoid flicker removals
  const missingCyclesRef = useRef<Record<string, number>>({});
  const LAST_SEEN_MAX_MISSING_CYCLES = 3; // drop bus only after N consecutive misses
  const MOVEMENT_THRESHOLD_METERS = 5; // minimal movement to count as an update

  const { isFavorite: isBusFavorite } = useBusFavorites();

  // Load route stops and buses
  useEffect(() => {
    const loadRouteData = async () => {
      try {
        setLoading(true);

        // Get all stops data to find which ones are on this route
        const [allStopsData, allStops, enhancedBuses, cachedLines] = await Promise.all([
          stopService.getStopDadosCached(),
          stopService.getStopsCached(),
          busService.getEnhancedBuses(undefined, '30min'),
          !line.coordinates || line.coordinates.length === 0
            ? busService.getLinesCached().catch(() => [] as BusLine[])
            : Promise.resolve([] as BusLine[]),
        ]);

        let activeLine = line;
        if ((!activeLine.coordinates || activeLine.coordinates.length === 0) && cachedLines.length > 0) {
          const targetNum = String(line.linha).trim().toUpperCase();
          const targetSentido = normalizeSentido(line.sentido);
          const candidates = cachedLines.filter(
            l =>
              matchesLineNumber(l.linha, line.linha) ||
              String(l.linha).trim().toUpperCase() === targetNum
          );
          const matched =
            candidates.find(
              l =>
                targetSentido &&
                normalizeSentido(l.sentido) === targetSentido &&
                l.coordinates &&
                l.coordinates.length > 0
            ) ||
            candidates.find(l => l.coordinates && l.coordinates.length > 0) ||
            candidates[0];
          if (matched) {
            activeLine = {
              ...matched,
              sentido: matched.sentido || targetSentido || line.sentido,
            };
          }
        }
        setResolvedLine(activeLine);

        const routeCoords = (activeLine.coordinates || []) as [number, number][];
        resolvedCoordsRef.current = routeCoords;
        const targetNumero = String(activeLine.linha).trim().toUpperCase();
        const targetSentido = normalizeSentido(activeLine.sentido);

        // Find stops that have this line and direction in Dados API (/parada)
        let routeStopIds = new Set(
          allStopsData
            .filter(stopData =>
              stopData.linParadas.some(lp => {
                const [numero, sentido] = lp.split(' - ').map(s => s.trim().toUpperCase());
                return (
                  (numero === targetNumero || matchesLineNumber(numero, activeLine.linha)) &&
                  (!targetSentido || normalizeSentido(sentido) === targetSentido)
                );
              })
            )
            .map(stopData => Number(stopData.id))
        );

        // If direction didn't match any stop in Dados API, fallback to matching by line number only
        if (routeStopIds.size === 0) {
          routeStopIds = new Set(
            allStopsData
              .filter(stopData =>
                stopData.linParadas.some(lp => {
                  const [numero] = lp.split(' - ').map(s => s.trim().toUpperCase());
                  return numero === targetNumero || matchesLineNumber(numero, activeLine.linha);
                })
              )
              .map(stopData => Number(stopData.id))
          );
        }

        let routeStops = allStops.filter(stop => routeStopIds.has(Number(stop.codigo)));

        // Fallback: if Dados API had no stop mappings for this line+direction, filter stops near the route polyline
        if (routeStops.length === 0 && routeCoords.length > 1) {
          const FALLBACK_MAX_DISTANCE_METERS = 150;
          routeStops = allStops.filter(stop => {
            const stopCoord = [stop.longitude, stop.latitude];
            for (let i = 0; i < routeCoords.length - 1; i++) {
              const p1 = routeCoords[i];
              const p2 = routeCoords[i + 1];
              if (!p1 || !p2) continue;
              if (
                Math.abs(p1[0] - stopCoord[0]) > 0.02 &&
                Math.abs(p2[0] - stopCoord[0]) > 0.02 &&
                Math.abs(p1[1] - stopCoord[1]) > 0.02 &&
                Math.abs(p2[1] - stopCoord[1]) > 0.02
              ) {
                continue;
              }
              if (pointToLineDistance(stopCoord, p1, p2) <= FALLBACK_MAX_DISTANCE_METERS) {
                return true;
              }
            }
            return false;
          });
        }

        // Always ensure currentStop is included so the yellow marker is always rendered
        if (
          currentStop &&
          isFinite(currentStop.latitude) &&
          isFinite(currentStop.longitude) &&
          !routeStops.some(s => String(s.codigo) === String(currentStop.codigo))
        ) {
          routeStops = [...routeStops, currentStop];
        }

        setStops(routeStops);

        // Initial bus filtering (relaxed: matches or includes line numero substring)
        let lineBuses = enhancedBuses.filter(bus => matchesLineNumber(bus.linha, activeLine.linha) || bus.linha?.includes(String(activeLine.linha)));
        if (lineBuses.length === 0 && enhancedBuses.length > 0) {
          // fallback: any bus within 60m of route polyline (heuristic)
          lineBuses = enhancedBuses.filter(b => {
            const busCoord: [number, number] = [b.longitude, b.latitude];
            let min = Infinity;
            for (let i = 0; i < routeCoords.length; i++) {
              const c = routeCoords[i];
              const d = haversineDistance2(busCoord, c as [number, number]);
              if (d < min) min = d;
              if (min < 60) break;
            }
            return min < 60;
          });
        }
        setBuses(lineBuses);
        
        const hasValidCurrentStop = Boolean(
          currentStop && isFinite(currentStop.longitude) && isFinite(currentStop.latitude)
        );
        if (
          (routeCoords && routeCoords.length > 0) ||
          routeStops.length > 0 ||
          lineBuses.length > 0 ||
          hasValidCurrentStop
        ) {
          let minLng = Infinity, maxLng = -Infinity;
          let minLat = Infinity, maxLat = -Infinity;

          // Include route coordinates
          routeCoords.forEach(([lng, lat]) => {
            if (!isFinite(lng) || !isFinite(lat)) return;
            minLng = Math.min(minLng, lng);
            maxLng = Math.max(maxLng, lng);
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
          });

          // If routeCoords was empty, include routeStops and lineBuses
          if (routeCoords.length === 0) {
            routeStops.forEach(s => {
              if (!isFinite(s.longitude) || !isFinite(s.latitude)) return;
              minLng = Math.min(minLng, s.longitude);
              maxLng = Math.max(maxLng, s.longitude);
              minLat = Math.min(minLat, s.latitude);
              maxLat = Math.max(maxLat, s.latitude);
            });
            lineBuses.forEach(b => {
              if (!isFinite(b.longitude) || !isFinite(b.latitude)) return;
              minLng = Math.min(minLng, b.longitude);
              maxLng = Math.max(maxLng, b.longitude);
              minLat = Math.min(minLat, b.latitude);
              maxLat = Math.max(maxLat, b.latitude);
            });
          }

          // Include current stop to ensure it's visible
          if (currentStop && isFinite(currentStop.longitude) && isFinite(currentStop.latitude)) {
            minLng = Math.min(minLng, currentStop.longitude);
            maxLng = Math.max(maxLng, currentStop.longitude);
            minLat = Math.min(minLat, currentStop.latitude);
            maxLat = Math.max(maxLat, currentStop.latitude);
          }

          const lngDiff = maxLng - minLng;
          const latDiff = maxLat - minLat;
          
          if (lngDiff > 0.5 || latDiff > 0.5) {
            const padding = 0.01;
            const refLng =
              currentStop && isFinite(currentStop.longitude)
                ? currentStop.longitude
                : lineBuses[0]?.longitude ?? routeCoords[0]?.[0] ?? -47.882778;
            const refLat =
              currentStop && isFinite(currentStop.latitude)
                ? currentStop.latitude
                : lineBuses[0]?.latitude ?? routeCoords[0]?.[1] ?? -15.793889;
            minLng = refLng - padding;
            maxLng = refLng + padding;
            minLat = refLat - padding;
            maxLat = refLat + padding;
          }

          if (isFinite(minLng) && isFinite(maxLng) && isFinite(minLat) && isFinite(maxLat)) {
            const lngPadding = Math.max((maxLng - minLng) * 0.05, 0.005);
            const latPadding = Math.max((maxLat - minLat) * 0.05, 0.005);

            const bounds = {
              ne: [maxLng + lngPadding, maxLat + latPadding] as [number, number],
              sw: [minLng - lngPadding, minLat - latPadding] as [number, number],
            };
            setCameraBounds(bounds);
            setShouldFitBounds(true); // only fit on initial load
            fitAppliedAtRef.current = Date.now();
            routeBoundsRef.current = {
              north: maxLat + latPadding,
              south: minLat - latPadding,
              east: maxLng + lngPadding,
              west: minLng - lngPadding,
            };
          }
        }
      } catch (error) {
        console.error('Error loading route data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadRouteData();

    const interval = setInterval(async () => {
      try {
        const boundsParam = routeBoundsRef.current || undefined;
        const enhancedBuses = await busService.getEnhancedBuses(boundsParam, '30min');
        let lineBuses = enhancedBuses.filter(bus => matchesLineNumber(bus.linha, line.linha) || bus.linha?.includes(String(line.linha)));
        const currentRouteCoords = resolvedCoordsRef.current;
        if (lineBuses.length === 0 && enhancedBuses.length > 0 && currentRouteCoords.length > 0) {
          lineBuses = enhancedBuses.filter(b => {
            const busCoord: [number, number] = [b.longitude, b.latitude];
            let min = Infinity;
            for (let i = 0; i < currentRouteCoords.length; i++) {
              const c = currentRouteCoords[i];
              const d = haversineDistance2(busCoord, c as [number, number]);
              if (d < min) min = d;
              if (min < 60) break;
            }
            return min < 60;
          });
        }
        if (__DEV__) {
          console.log('[LineRouteMap] raw buses:', enhancedBuses.length, 'filtered:', lineBuses.length, 'bounds?', !!boundsParam);
        }
        if (lineBuses.length === 0) return; // keep previous to avoid flicker
        // Stabilize updates with movement threshold & missing cycles retention
        setBuses(prev => {
          if (prev.length === 0) return lineBuses;
          const byId: Record<string, EnhancedBus> = {};
          lineBuses.forEach(b => { if (b.id) byId[b.id] = b; });
          const merged: EnhancedBus[] = [];
          prev.forEach(oldBus => {
            const upd = oldBus.id ? byId[oldBus.id] : undefined;
            if (upd) {
              if (oldBus.id) missingCyclesRef.current[oldBus.id] = 0;
              const moved = haversineDistance2([oldBus.longitude, oldBus.latitude], [upd.longitude, upd.latitude]) > MOVEMENT_THRESHOLD_METERS;
              merged.push(moved ? upd : oldBus);
              if (oldBus.id) delete byId[oldBus.id];
            } else if (oldBus.id) {
              const miss = (missingCyclesRef.current[oldBus.id] || 0) + 1;
              missingCyclesRef.current[oldBus.id] = miss;
              if (miss < LAST_SEEN_MAX_MISSING_CYCLES) merged.push(oldBus);
            }
          });
          Object.values(byId).forEach(n => { if (n.id) missingCyclesRef.current[n.id] = 0; merged.push(n); });
          return merged;
        });
      } catch (error) {
        console.error('Error refreshing buses:', error);
      }
    }, 8000);

    return () => clearInterval(interval);
  }, [line, currentStop]);
  
  // Convert route to GeoJSON
  const routeGeoJSON = useMemo(() => {
    const coords = (resolvedLine.coordinates || []) as [number, number][];
    if (!coords || coords.length === 0) {
      return {
        type: 'FeatureCollection' as const,
        features: [],
      };
    }
    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: { id: 'route-0' },
          geometry: {
            type: 'LineString' as const,
            coordinates: coords,
          },
        },
      ],
    };
  }, [resolvedLine]);

  // Convert other stops to GeoJSON (excluding currentStop)
  const otherStopsGeoJSON = useMemo(() => {
    const features = stops
      .filter(stop => (!currentStop || String(stop.codigo) !== String(currentStop.codigo)) && isFinite(stop.longitude) && isFinite(stop.latitude))
      .map(stop => ({
        type: 'Feature' as const,
        properties: {
          id: stop.id,
          codigo: String(stop.codigo),
          name: stop.nome,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [stop.longitude, stop.latitude],
        },
      }));

    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }, [stops, currentStop]);

  // Convert current stop to GeoJSON so it always renders regardless of filter evaluation
  const currentStopGeoJSON = useMemo(() => {
    if (!currentStop || !isFinite(currentStop.longitude) || !isFinite(currentStop.latitude)) {
      return {
        type: 'FeatureCollection' as const,
        features: [],
      };
    }
    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: {
            id: String(currentStop.id ?? currentStop.codigo),
            codigo: String(currentStop.codigo),
            name: currentStop.nome,
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [currentStop.longitude, currentStop.latitude],
          },
        },
      ],
    };
  }, [currentStop]);

  // Buses already come in WGS84 (lat/lon) like main map; remove unnecessary conversion that caused invalid coords & flicker
  const visibleBuses = useMemo(() => {
    const isLikelyUtm = (lon: number, lat: number) => {
      // UTM Zone 23S (Brazil) typical ranges: easting ~ 180000-820000, northing ~ 7,000,000-10,000,000
      return lon > 90000 && lon < 900000 && lat > 7000000 && lat < 10000000;
    };

    return buses
      .map(bus => {
        let lon = bus.longitude;
        let lat = bus.latitude;
        if (typeof lon === 'number' && typeof lat === 'number' && isLikelyUtm(lon, lat)) {
          try {
            const { lng, lat: convLat } = utmToLatLngZone23S(lon, lat);
            lon = lng; lat = convLat;
          } catch (e) {
            if (__DEV__) console.warn('[LineRouteMap] UTM conversion failed for bus', bus.id, e);
          }
        }
        return { ...bus, longitude: lon, latitude: lat };
      })
      .filter(bus => isValidCoordinate([bus.longitude, bus.latitude]));
  }, [buses]);

  function isValidCoordinate([lng, lat]: [number, number]) {
    return (
      typeof lng === 'number' &&
      typeof lat === 'number' &&
      lng >= -180 && lng <= 180 &&
      lat >= -90 && lat <= 90
    );
  }

  // Handle click on any stop circle (current or other stops)
  const handleStopShapePress = (event: any) => {
    const feature = event?.features?.[0];
    if (!feature) return;
    const clickedCodigo = String(feature.properties?.codigo ?? feature.properties?.id ?? '');
    if (!clickedCodigo) return;

    if (selectedStop && String(selectedStop.codigo) === clickedCodigo) {
      setSelectedStop(null);
      return;
    }

    if (currentStop && String(currentStop.codigo) === clickedCodigo) {
      setSelectedStop(currentStop);
      return;
    }

    const found = stops.find(s => String(s.codigo) === clickedCodigo || String(s.id) === clickedCodigo);
    if (found) {
      setSelectedStop(found);
    }
  };

  // Calculate ETA from closest approaching visible bus to selectedStop
  const selectedStopEta = useMemo(() => {
    if (!selectedStop || !isFinite(selectedStop.longitude) || !isFinite(selectedStop.latitude)) {
      return null;
    }
    if (!visibleBuses.length) {
      return {
        hasBus: false,
        etaText: 'Sem ônibus na rota',
        subText: 'Parada ' + selectedStop.codigo,
        isNow: false,
      };
    }

    const stopCoord: [number, number] = [selectedStop.longitude, selectedStop.latitude];
    const routeCoords = (resolvedLine.coordinates || []) as [number, number][];

    // Helper to find closest vertex index on polyline
    const findClosestIndex = (pt: [number, number]) => {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < routeCoords.length; i++) {
        const d = haversineDistance2(pt, routeCoords[i]);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      return bestIdx;
    };

    const hasRoute = routeCoords.length > 1;
    const stopIdx = hasRoute ? findClosestIndex(stopCoord) : 0;

    type Candidate = {
      bus: EnhancedBus;
      distanceMeters: number;
      etaMinutes: number;
      isApproachingAlongRoute: boolean;
    };

    const candidates: Candidate[] = visibleBuses.map(bus => {
      const busCoord: [number, number] = [bus.longitude, bus.latitude];
      const directDist = haversineDistance2(busCoord, stopCoord);
      let distanceMeters = directDist;
      let isApproachingAlongRoute = true;

      if (hasRoute) {
        const busIdx = findClosestIndex(busCoord);
        if (busIdx <= stopIdx) {
          let polyDist = 0;
          for (let i = busIdx; i < stopIdx; i++) {
            polyDist += haversineDistance2(routeCoords[i], routeCoords[i + 1]);
          }
          distanceMeters = Math.max(directDist, polyDist);
          isApproachingAlongRoute = true;
        } else {
          isApproachingAlongRoute = directDist <= 200;
        }
      }

      const rawSpeed = typeof bus.velocidade === 'number' && bus.velocidade > 5 ? bus.velocidade : 22;
      const speedMs = (rawSpeed * 1000) / 3600;
      const etaMinutes = distanceMeters <= 120 ? 0 : Math.max(1, Math.round(distanceMeters / speedMs / 60));

      return {
        bus,
        distanceMeters,
        etaMinutes,
        isApproachingAlongRoute,
      };
    });

    const approaching = candidates.filter(c => c.isApproachingAlongRoute);
    const pool = approaching.length > 0 ? approaching : candidates;
    pool.sort((a, b) => a.etaMinutes - b.etaMinutes || a.distanceMeters - b.distanceMeters);

    const best = pool[0];
    const isNow = best.etaMinutes <= 0 || best.distanceMeters <= 150;
    const distLabel = best.distanceMeters >= 1000
      ? (best.distanceMeters / 1000).toFixed(1) + ' km'
      : Math.round(best.distanceMeters) + ' m';

    return {
      hasBus: true,
      etaText: isNow ? 'Chegando agora' : best.etaMinutes + ' min',
      subText: 'Parada ' + selectedStop.codigo + ' • ' + distLabel,
      prefixo: best.bus.prefixo,
      isNow,
    };
  }, [selectedStop, visibleBuses, resolvedLine.coordinates]);

  // Calcular pontos de início e fim da rota
  const routeEndpoints = useMemo(() => {
    const coords = (resolvedLine.coordinates || []) as [number, number][];
    if (!coords || coords.length === 0) return null;
    const start = coords[0];
    const end = coords[coords.length - 1];
    
    // Validar se as coordenadas estão dentro de uma região razoável (DF)
    const isValidCoord = (coord: [number, number]) => {
      const [lng, lat] = coord;
      return lng >= -48.2 && lng <= -47.2 && lat >= -16.1 && lat <= -15.4;
    };
    
    if (!isValidCoord(start) || !isValidCoord(end)) {
      return null;
    }
    
    return { start, end };
  }, [resolvedLine]);

  return (
    <View style={[styles.container, { backgroundColor: appTheme === 'dark' ? '#000' : '#fff' }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: appTheme === 'dark' ? '#333' : '#eee' }]}> 
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <MaterialIcons
            name="arrow-back"
            size={24}
            color={appTheme === 'dark' ? '#fff' : '#000'}
          />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={[styles.headerTitle, { color: appTheme === 'dark' ? '#fff' : '#000' }]}>
            Linha {resolvedLine.linha}
          </Text>
          <Text style={[styles.headerSubtitle, { color: appTheme === 'dark' ? '#aaa' : '#666' }]}>
            {resolvedLine.sentido}
          </Text>
        </View>
        {/* Bus counter */}
        {visibleBuses.length > 0 && (
          <View style={[styles.busCounter, { backgroundColor: appTheme === 'dark' ? '#1a1a1a' : '#f0f0f0' }]}> 
            <MaterialIcons name="directions-bus" size={16} color="#007AFF" />
            <Text style={[styles.busCounterText, { color: appTheme === 'dark' ? '#fff' : '#000' }]}>
              {visibleBuses.length}
              {buses.length > visibleBuses.length && (
                <Text style={{ fontSize: 10, opacity: 0.7 }}>
                  /{buses.length}
                </Text>
              )}
            </Text>
          </View>
        )}
      </View>

      {/* Map */}
      {/* Map */}
      <View style={styles.mapContainer}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={[styles.loadingText, { color: appTheme === 'dark' ? '#aaa' : '#666' }]}>
              Carregando rota...
            </Text>
          </View>
        ) : (
          <MapView
            style={styles.map}
            mapStyle={mapStyleUrl}
            onRegionDidChange={handleRegionDidChange}
          >
            {cameraBounds && shouldFitBounds && (
              <Camera
                bounds={{
                  ne: cameraBounds.ne,
                  sw: cameraBounds.sw,
                }}
                padding={{ paddingTop: 50, paddingBottom: 50, paddingLeft: 50, paddingRight: 50 }}
                animationDuration={800}
              />
            )}
            {/* when shouldFitBounds is false, let free the camera */}
            {!shouldFitBounds && <Camera />}


            {/* 1. Route line - adicionada primeiro sem waitForLayer para evitar deadlock no MLRNLayer */}
            <ShapeSource id='route-source' shape={routeGeoJSON}>
              <LineLayer
                id='route-line'
                style={{
                  lineColor: '#007AFF',
                  lineWidth: 4,
                  lineOpacity: 0.8,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            </ShapeSource>

            {/* 2. Bus stops (exceto a parada atual) - encadeado acima de route-line */}
            <ShapeSource id='stops-source' shape={otherStopsGeoJSON} onPress={handleStopShapePress} hitbox={{ width: 24, height: 24 }}>
              <CircleLayer
                id='stops-circle'
                aboveLayerID='route-line'
                style={{
                  visibility: showOtherStops ? 'visible' : 'none',
                  circleColor: '#007AFF',
                  circleRadius: 6,
                  circleStrokeColor: '#fff',
                  circleStrokeWidth: 2,
                  circleOpacity: 0.95,
                }}
              />
            </ShapeSource>

            {/* 3. Parada atual (amarela) - encadeado acima de stops-circle */}
            <ShapeSource id='current-stop-source' shape={currentStopGeoJSON} onPress={handleStopShapePress} hitbox={{ width: 28, height: 28 }}>
              <CircleLayer
                id='current-stop-circle'
                aboveLayerID='stops-circle'
                style={{
                  visibility: showCurrentStop ? 'visible' : 'none',
                  circleColor: '#FFD600',
                  circleRadius: 10,
                  circleStrokeColor: '#fff',
                  circleStrokeWidth: 3,
                  circleOpacity: 1,
                }}
              />
            </ShapeSource>

            {/* 4. Marcadores de início e fim da rota - MarkerView (sempre acima do canvas GL) */}
            {routeEndpoints && (
              <>
                <MarkerView
                  key='route-start'
                  coordinate={routeEndpoints.start}
                  anchor={{ x: 0.5, y: 0.5 }}
                  allowOverlap={true}
                >
                  <View
                    collapsable={false}
                    style={{
                      width: 36,
                      height: 36,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: '#4CAF50',
                      borderRadius: 18,
                      borderWidth: 3,
                      borderColor: '#fff',
                      shadowColor: '#000',
                      shadowOpacity: 0.5,
                      shadowRadius: 4,
                      shadowOffset: { width: 0, height: 2 },
                      zIndex: 20,
                      elevation: 8,
                    }}
                  >
                    <MaterialIcons name='play-arrow' size={18} color='#fff' />
                  </View>
                </MarkerView>

                <MarkerView
                  key='route-end'
                  coordinate={routeEndpoints.end}
                  anchor={{ x: 0.5, y: 0.5 }}
                  allowOverlap={true}
                >
                  <View
                    collapsable={false}
                    style={{
                      width: 36,
                      height: 36,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: '#F44336',
                      borderRadius: 18,
                      borderWidth: 3,
                      borderColor: '#fff',
                      shadowColor: '#000',
                      shadowOpacity: 0.5,
                      shadowRadius: 4,
                      shadowOffset: { width: 0, height: 2 },
                      zIndex: 20,
                      elevation: 8,
                    }}
                  >
                    <MaterialIcons name='flag' size={18} color='#fff' />
                  </View>
                </MarkerView>
              </>
            )}

            {/* 5. Ônibus - MarkerView (sempre acima das linhas e paradas) */}
            {visibleBuses.map((bus, index) => {
              const isFavoriteBus = isBusFavorite(bus.linha ?? '');
              const color = bus.corOperadora || '#5a4799';
              const coord: [number, number] = [bus.longitude, bus.latitude];
              if (!isValidCoordinate(coord)) return null;
              return (
                <MarkerView
                  key={'bus-' + bus.id + '-' + index}
                  coordinate={[bus.longitude, bus.latitude]}
                  anchor={{ x: 0.5, y: 0.5 }}
                  allowOverlap={true}
                >
                  <View
                    collapsable={false}
                    style={{
                      position: 'relative',
                      width: 40,
                      height: 40,
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'visible',
                      zIndex: 30,
                      elevation: 10,
                    }}
                  >
                    <BusIcon width={30} height={30} color={color} />
                    <View
                      pointerEvents='none'
                      style={{
                        position: 'absolute',
                        top: 4,
                        right: 3,
                        backgroundColor: '#fff',
                        borderRadius: 8,
                        padding: 0.5,
                        opacity: isFavoriteBus ? 1 : 0,
                        overflow: 'visible',
                        elevation: 2,
                        height: 14,
                        width: 14,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <MaterialIcons
                        name='star'
                        size={14}
                        color='#FFD600'
                        style={{
                          marginBottom: 1,
                          marginRight: 1,
                        }}
                      />
                    </View>
                  </View>
                </MarkerView>
              );
            })}

            {/* 6. Mini card acima da parada selecionada mostrando ETA - MarkerView */}
            {selectedStop && selectedStopEta && ((Boolean(currentStop && String(selectedStop.codigo) === String(currentStop.codigo)) && showCurrentStop) || (!Boolean(currentStop && String(selectedStop.codigo) === String(currentStop.codigo)) && showOtherStops)) && isValidCoordinate([selectedStop.longitude, selectedStop.latitude]) && (
              <MarkerView
                key={'stop-eta-card-' + selectedStop.codigo}
                coordinate={[selectedStop.longitude, selectedStop.latitude]}
                anchor={{ x: 0.5, y: 1.18 }}
                allowOverlap={true}
              >
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => setSelectedStop(null)}
                  style={styles.stopMiniCardWrapper}
                >
                  <View
                    style={[
                      styles.stopMiniCard,
                      {
                        backgroundColor: appTheme === 'dark' ? '#1e1e1e' : '#ffffff',
                        borderColor: selectedStopEta.hasBus
                          ? (selectedStopEta.isNow ? '#00C853' : '#007AFF')
                          : (appTheme === 'dark' ? '#444' : '#ccc'),
                      },
                    ]}
                  >
                    <View style={styles.stopMiniCardTopRow}>
                      <MaterialIcons
                        name='directions-bus'
                        size={14}
                        color={selectedStopEta.hasBus ? (selectedStopEta.isNow ? '#00C853' : '#007AFF') : '#888'}
                      />
                      <Text
                        style={[
                          styles.stopMiniCardEtaText,
                          {
                            color: selectedStopEta.hasBus
                              ? (selectedStopEta.isNow ? '#00C853' : (appTheme === 'dark' ? '#4da3ff' : '#007AFF'))
                              : (appTheme === 'dark' ? '#aaa' : '#666'),
                          },
                        ]}
                      >
                        {selectedStopEta.etaText}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.stopMiniCardSubText,
                        { color: appTheme === 'dark' ? '#ccc' : '#555' },
                      ]}
                    >
                      {selectedStopEta.subText}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.stopMiniCardArrow,
                      {
                        borderTopColor: selectedStopEta.hasBus
                          ? (selectedStopEta.isNow ? '#00C853' : '#007AFF')
                          : (appTheme === 'dark' ? '#444' : '#ccc'),
                      },
                    ]}
                  />
                </TouchableOpacity>
              </MarkerView>
            )}
          </MapView>
        )}
      </View>
      {/* Botão para recentralizar/ajustar bounds novamente */}
      {cameraBounds && (
        <TouchableOpacity
          onPress={() => { setShouldFitBounds(true); fitAppliedAtRef.current = Date.now(); }}
          style={[styles.refitButton, { backgroundColor: appTheme === 'dark' ? '#1a1a1a' : '#fff', borderColor: appTheme === 'dark' ? '#333' : '#ddd' }]}
          activeOpacity={0.8}
        >
          <MaterialIcons name="my-location" size={22} color={appTheme === 'dark' ? '#fff' : '#007AFF'} />
        </TouchableOpacity>
      )}

      {/* Info footer */}
      <View style={[styles.footer, { backgroundColor: appTheme === 'dark' ? '#1a1a1a' : '#f9f9f9' }]}>
        {currentStop && (
          <TouchableOpacity
            style={[
              styles.legendItem,
              styles.legendToggleItem,
              {
                opacity: showCurrentStop ? 1 : 0.45,
                backgroundColor: showCurrentStop
                  ? (appTheme === 'dark' ? '#2a2612' : '#fff9db')
                  : 'transparent',
                borderColor: showCurrentStop ? '#FFD600' : (appTheme === 'dark' ? '#444' : '#ddd'),
              },
            ]}
            onPress={() => setShowCurrentStop(prev => !prev)}
            activeOpacity={0.7}
          >
            <View style={[styles.legendDot, { backgroundColor: showCurrentStop ? '#FFD600' : '#888' }]} />
            <Text
              style={[
                styles.legendText,
                {
                  color: appTheme === 'dark' ? '#fff' : '#000',
                  textDecorationLine: showCurrentStop ? 'none' : 'line-through',
                },
              ]}
            >
              Parada atual
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[
            styles.legendItem,
            styles.legendToggleItem,
            {
              opacity: showOtherStops ? 1 : 0.45,
              backgroundColor: showOtherStops
                ? (appTheme === 'dark' ? '#122238' : '#e8f2ff')
                : 'transparent',
              borderColor: showOtherStops ? '#007AFF' : (appTheme === 'dark' ? '#444' : '#ddd'),
            },
          ]}
          onPress={() => setShowOtherStops(prev => !prev)}
          activeOpacity={0.7}
        >
          <View style={[styles.legendDot, { backgroundColor: showOtherStops ? '#007AFF' : '#888' }]} />
          <Text
            style={[
              styles.legendText,
              {
                color: appTheme === 'dark' ? '#fff' : '#000',
                textDecorationLine: showOtherStops ? 'none' : 'line-through',
              },
            ]}
          >
            Outras paradas
          </Text>
        </TouchableOpacity>
        {buses.length > 0 && (
          <View style={styles.legendItem}>
            <MaterialIcons name="directions-bus" size={16} color={appTheme === 'dark' ? '#aaa' : '#666'} />
            <Text style={[styles.legendText, { color: appTheme === 'dark' ? '#fff' : '#000' }]}>
              Ônibus (visíveis)
            </Text>
          </View>
        )}
        <View style={styles.legendItem}>
          <MaterialIcons name="play-arrow" size={16} color="#4CAF50" />
          <Text style={[styles.legendText, { color: appTheme === 'dark' ? '#fff' : '#000' }]}>
            Início
          </Text>
        </View>
        <View style={styles.legendItem}>
          <MaterialIcons name="flag" size={16} color="#F44336" />
          <Text style={[styles.legendText, { color: appTheme === 'dark' ? '#fff' : '#000' }]}>
            Fim
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  refitButton: {
    position: 'absolute',
    top: 100,
    right: 16,
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    borderWidth: 1,
    zIndex: 50,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    fontSize: 14,
    marginTop: 2,
  },
  busCounter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
  },
  busCounterText: {
    fontSize: 14,
    fontWeight: '600',
  },
  mapContainer: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    padding: 8,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    flexWrap: 'wrap',
    gap: 4,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendToggleItem: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#fff',
  },
  legendText: {
    fontSize: 12,
  },
  stopMiniCardWrapper: {
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 60,
      elevation: 12,
    },
    stopMiniCard: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 10,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 },
      elevation: 6,
      minWidth: 110,
    },
    stopMiniCardTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    stopMiniCardEtaText: {
      fontSize: 13,
      fontWeight: 'bold',
    },
    stopMiniCardSubText: {
      fontSize: 10,
      marginTop: 2,
      fontWeight: '500',
    },
    stopMiniCardArrow: {
      width: 0,
      height: 0,
      borderLeftWidth: 6,
      borderRightWidth: 6,
      borderTopWidth: 6,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
    },
});

export default LineRouteMap;
