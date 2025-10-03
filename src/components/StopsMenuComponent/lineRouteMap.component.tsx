import { apiService } from '@/src/services/api';
import { useAppStore } from '@/src/store';
import { BusLineV2, BusStop, EnhancedBus } from '@/src/types';
import { matchesLineNumber } from '@/src/utils/lineUtils';
import { MaterialIcons } from '@expo/vector-icons';
import MapLibreGL from '@maplibre/maplibre-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import BusIcon from '../../assets/images/svg/bus.svg';
import { useBusFavorites } from '../../hooks/useFavorites';

const { MapView, Camera, ShapeSource, LineLayer, CircleLayer, PointAnnotation } = MapLibreGL;

interface LineRouteMapProps {
  line: BusLineV2;
  currentStop: BusStop;
  onBack: () => void;
}

const mapStyles = {
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
};

const LineRouteMap: React.FC<LineRouteMapProps> = ({ line, currentStop, onBack }) => {
  const appTheme = useAppStore(state => state.appTheme);
  const mapTheme = useAppStore(state => state.style) as 'light' | 'dark';
  const mapStyleUrl = mapStyles[mapTheme] || mapStyles.light;
  const [loading, setLoading] = useState(true);
  const [stops, setStops] = useState<BusStop[]>([]);
  const [buses, setBuses] = useState<EnhancedBus[]>([]);
  const [cameraBounds, setCameraBounds] = useState<{
    ne: [number, number];
    sw: [number, number];
  } | null>(null);

  const { isFavorite: isBusFavorite } = useBusFavorites();

  // Load route stops and buses
  useEffect(() => {
    const loadRouteData = async () => {
      try {
        setLoading(true);

        // Get all stops data to find which ones are on this route
        const [allStopsData, allStops, enhancedBuses] = await Promise.all([
          apiService.getStopDadosCached(),
          apiService.getStops(),
          apiService.getEnhancedBuses(undefined, '30min'),
        ]);

        // Find stops that have this line
        const routeStopIds = allStopsData
          .filter(stopData => stopData.linParadas.some(lp => lp.includes(line.numero)))
          .map(stopData => stopData.id);

        // Filter actual stop objects
        const routeStops = allStops.filter(stop => 
          routeStopIds.includes(Number(stop.codigo))
        );

        setStops(routeStops);
        
        const lineBuses = enhancedBuses.filter(bus => matchesLineNumber(bus.linha, line.numero));
        
        setBuses(lineBuses);
        
        if (line.geolinhas && line.geolinhas.length > 0) {
          let minLng = Infinity, maxLng = -Infinity;
          let minLat = Infinity, maxLat = -Infinity;

          // Include route coordinates
          line.geolinhas.forEach(geo => {
            geo.coordinates.forEach(([lng, lat]) => {
              minLng = Math.min(minLng, lng);
              maxLng = Math.max(maxLng, lng);
              minLat = Math.min(minLat, lat);
              maxLat = Math.max(maxLat, lat);
            });
          });

          // Include current stop to ensure it's visible
          minLng = Math.min(minLng, currentStop.longitude);
          maxLng = Math.max(maxLng, currentStop.longitude);
          minLat = Math.min(minLat, currentStop.latitude);
          maxLat = Math.max(maxLat, currentStop.latitude);

          const lngDiff = maxLng - minLng;
          const latDiff = maxLat - minLat;
          
          if (lngDiff > 0.5 || latDiff > 0.5) {
            const padding = 0.01;
            minLng = currentStop.longitude - padding;
            maxLng = currentStop.longitude + padding;
            minLat = currentStop.latitude - padding;
            maxLat = currentStop.latitude + padding;
          }

          const lngPadding = Math.max((maxLng - minLng) * 0.05, 0.005);
          const latPadding = Math.max((maxLat - minLat) * 0.05, 0.005);

          const bounds = {
            ne: [maxLng + lngPadding, maxLat + latPadding] as [number, number],
            sw: [minLng - lngPadding, minLat - latPadding] as [number, number],
          };
          setCameraBounds(bounds);
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
        const enhancedBuses = await apiService.getEnhancedBuses(undefined, '30min');
        
        const lineBuses = enhancedBuses.filter(bus => matchesLineNumber(bus.linha, line.numero));
        
        setBuses(lineBuses);
      } catch (error) {
        console.error('Error refreshing buses:', error);
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [line, currentStop]);
  
  // Convert route to GeoJSON
  const routeGeoJSON = useMemo(() => {
    if (!line.geolinhas || line.geolinhas.length === 0) {
      return {
        type: 'FeatureCollection' as const,
        features: [],
      };
    }

    const features = line.geolinhas.map((geo, index) => ({
      type: 'Feature' as const,
      properties: {
        id: `route-${index}`,
      },
      geometry: {
        type: geo.type as 'LineString',
        coordinates: geo.coordinates,
      },
    }));

    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }, [line]);

  // Convert stops to GeoJSON
  const stopsGeoJSON = useMemo(() => {
    const features = stops.map(stop => ({
      type: 'Feature' as const,
      properties: {
        id: stop.id,
        name: stop.nome,
        isCurrentStop: stop.codigo === currentStop.codigo,
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

  const visibleBuses = useMemo(() => {
    return buses.filter(bus => {
      if (!Number.isFinite(bus.longitude) || !Number.isFinite(bus.latitude)) {
        return false;
      }
      return true;
    });
  }, [buses]);

  // Calcular pontos de início e fim da rota
  const routeEndpoints = useMemo(() => {
    if (!line.geolinhas || line.geolinhas.length === 0) return null;
    
    const firstRoute = line.geolinhas[0];
    const lastRoute = line.geolinhas[line.geolinhas.length - 1];
    
    if (!firstRoute.coordinates || firstRoute.coordinates.length === 0) return null;
    if (!lastRoute.coordinates || lastRoute.coordinates.length === 0) return null;
    
    const start = firstRoute.coordinates[0];
    const end = lastRoute.coordinates[lastRoute.coordinates.length - 1];
    
    // Validar se as coordenadas estão dentro de uma região razoável (DF)
    const isValidCoord = (coord: [number, number]) => {
      const [lng, lat] = coord;
      return lng >= -48.2 && lng <= -47.2 && lat >= -16.1 && lat <= -15.4;
    };
    
    if (!isValidCoord(start) || !isValidCoord(end)) {
      return null;
    }
    
    return { start, end };
  }, [line]);

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
            Linha {line.numero}
          </Text>
          <Text style={[styles.headerSubtitle, { color: appTheme === 'dark' ? '#aaa' : '#666' }]}>
            {line.sentido}
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
          >
            {cameraBounds && (
              <Camera
                bounds={{
                  ne: cameraBounds.ne,
                  sw: cameraBounds.sw,
                }}
                padding={{ paddingTop: 50, paddingBottom: 50, paddingLeft: 50, paddingRight: 50 }}
                animationDuration={1000}
              />
            )}


            {/* 1. Route line - renderizada PRIMEIRO (z-index mais baixo) */}
            {routeGeoJSON.features.length > 0 && (
              <ShapeSource id="route-source" shape={routeGeoJSON}>
                <LineLayer
                  id="route-line"
                  style={{
                    lineColor: '#007AFF',
                    lineWidth: 4,
                    lineOpacity: 0.8,
                    lineCap: 'round',
                    lineJoin: 'round',
                  }}
                />
              </ShapeSource>
            )}

            {/* 2. Bus stops (exceto a parada atual) - ShapeSource CircleLayer */}
            {stopsGeoJSON.features.length > 0 && (
              <ShapeSource id="stops-source" shape={stopsGeoJSON}>
                <CircleLayer
                  id="stops-circle"
                  filter={['!=', ['get', 'isCurrentStop'], true]}
                  style={{
                    circleColor: appTheme === 'dark' ? '#fff' : '#333',
                    circleRadius: 6,
                    circleStrokeColor: '#007AFF',
                    circleStrokeWidth: 2,
                    circleOpacity: 0.9,
                  }}
                />
              </ShapeSource>
            )}

            {/* 3. Marcadores de início e fim da rota - PointAnnotation */}
            {routeEndpoints && (
              <>
                {/* Marcador de início */}
                <PointAnnotation
                  key="route-start"
                  id="route-start"
                  coordinate={routeEndpoints.start}
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
                    <MaterialIcons name="play-arrow" size={18} color="#fff" />
                  </View>
                </PointAnnotation>

                {/* Marcador de fim */}
                <PointAnnotation
                  key="route-end"
                  id="route-end"
                  coordinate={routeEndpoints.end}
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
                    <MaterialIcons name="flag" size={18} color="#fff" />
                  </View>
                </PointAnnotation>
              </>
            )}

            {/* 4. Ônibus - PointAnnotation */}
            {visibleBuses.map((bus, index) => {
              const isFavoriteBus = isBusFavorite(bus.linha ?? '');
              const color = bus.corOperadora || '#5a4799';
              return (
                <PointAnnotation
                  key={`bus-${bus.id}-${index}`}
                  id={`bus-${bus.id}`}
                  coordinate={[bus.longitude, bus.latitude]}
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
                      pointerEvents="none"
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
                        name="star"
                        size={14}
                        color="#FFD600"
                        style={{
                          marginBottom: 1,
                          marginRight: 1,
                        }}
                      />
                    </View>
                  </View>
                </PointAnnotation>
              );
            })}

            {/* 5. Parada atual (amarela) - renderizada POR ÚLTIMO (z-index mais alto) */}
            {stopsGeoJSON.features.length > 0 && (
              <ShapeSource id="current-stop-source" shape={stopsGeoJSON}>
                <CircleLayer
                  id="current-stop-circle"
                  filter={['==', ['get', 'isCurrentStop'], true]}
                  style={{
                    circleColor: '#FFD600',
                    circleRadius: 10,
                    circleStrokeColor: '#fff',
                    circleStrokeWidth: 3,
                    circleOpacity: 1,
                  }}
                />
              </ShapeSource>
            )}
          </MapView>
        )}
      </View>

      {/* Info footer */}
      <View style={[styles.footer, { backgroundColor: appTheme === 'dark' ? '#1a1a1a' : '#f9f9f9' }]}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#FFD600' }]} />
          <Text style={[styles.legendText, { color: appTheme === 'dark' ? '#fff' : '#000' }]}>
            Parada atual
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#007AFF' }]} />
          <Text style={[styles.legendText, { color: appTheme === 'dark' ? '#fff' : '#000' }]}>
            Outras paradas
          </Text>
        </View>
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
    gap: 8,
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
  // Toggle styles removed
});

export default LineRouteMap;
