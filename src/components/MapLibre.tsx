import { MaterialIcons } from '@expo/vector-icons';
import {
  Camera,
  CircleLayer,
  Images,
  LineLayer,
  MapView,
  PointAnnotation,
  ShapeSource,
  SymbolLayer
} from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import type { Feature, FeatureCollection, Point } from 'geojson';
import React, { useCallback, useMemo, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useBusFavorites, useStopFavorites } from '../hooks/useFavorites';
import { useTrafficData } from '../hooks/useTrafficData';
import { useAppStore } from '../store';
import { TrafficJam } from '../types';

// Assets
import yellowBlackStripes from '../assets/images/pattern/yellow-black.png';
import BusStopIcon2 from '../assets/images/svg/bus-stop2.svg';
import BusIcon from '../assets/images/svg/bus.svg';

interface BusStopMarker {
  id: string;
  latitude: number;
  longitude: number;
  title?: string;
}

interface BusMarker {
  id: string;
  latitude: number;
  longitude: number;
  title?: string;
  prefixo?: string;
  linha?: string;
  velocidade?: number;
  sentido?: string;
  datalocal?: string;
  dataregistro?: string;
  operadora?: {
    nome: string;
    servico: string;
    tipoOnibus: string;
    dataReferencia: string;
  };
  corOperadora?: string;
}

interface MapLibreBasicProps {
  latitude?: number;
  longitude?: number;
  zoom?: number;
  style?: object;
  theme?: 'light' | 'dark';
  onRegionDidChange?: (bounds: { north: number, south: number, east: number, west: number }, center?: { latitude: number, longitude: number }, zoom?: number) => void;
  onBusStopMarkerPress?: (busStopMarker: BusStopMarker) => void;
  busStopMarker?: BusStopMarker[];
  showTraffic?: boolean;
  isFetchingBuses?: boolean; // blue loading bar
  fetchDuration?: number;
  buses?: BusMarker[];
  onBusMarkerPress?: (bus: BusMarker) => void;
}

type TrafficLabelProperties = {
  id: string;
  color: string;
  speedText: string;
};

type TrafficLabelFeature = Feature<Point, TrafficLabelProperties>;
type TrafficLabelCollection = FeatureCollection<Point, TrafficLabelProperties>;

const mapStyles = {
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  osm: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json', // fallback
};

const MapLibreBasic: React.FC<MapLibreBasicProps> = ({
  latitude,
  longitude,
  zoom,
  style = {},
  onRegionDidChange,
  showTraffic = false,
  // loading bar
  isFetchingBuses = false, // blue loading bar
  fetchDuration = 8000,
  // Bus stops
  busStopMarker = [],
  onBusStopMarkerPress,

  // Buses
  onBusMarkerPress,
  buses = [],
}) => {
  const mapTheme = useAppStore(state => state.style) as 'light' | 'dark' | 'osm';
  const appTheme = useAppStore(state => state.appTheme);
  const userLocation = useAppStore(state => state.userLocation);
  const [currentZoom, setCurrentZoom] = React.useState(zoom ?? 12);
  const [selectedBus, setSelectedBus] = useState<BusMarker | null>(null);
  const [currentBounds, setCurrentBounds] = useState<{ north: number, south: number, east: number, west: number } | null>(null);
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const [isFetching, setIsFetching] = React.useState(false);
  const progressAnim = React.useRef(new Animated.Value(0)).current;

  // Favorites using custom hook
  const { isFavorite: isBusFavorite, toggleFavorite: toggleBusFavorite } = useBusFavorites();
  const { isFavorite: isStopFavorite } = useStopFavorites();

  // User speed and direction
  const [userSpeed, setUserSpeed] = useState<number | null>(null);
  const [userHeading, setUserHeading] = useState<number | null>(null);

  // Debug logging
  // useEffect(() => {
  //   console.log(`MapLibre - Received ${buses?.length || 0} buses, zoom: ${currentZoom.toFixed(1)}`);
  // }, [buses, currentZoom]);

  // Function to toggle favorite for selected bus
  const toggleFavorite = useCallback(() => {
    //  console.warn('selectedBus:', selectedBus);
    if (!selectedBus?.linha) return;
    toggleBusFavorite(selectedBus.linha);
  }, [selectedBus?.linha, toggleBusFavorite]);

  // Verify if the current bus is a favorite
  const isFavorite = useMemo(() => {
    return selectedBus?.linha ? isBusFavorite(selectedBus.linha) : false;
  }, [selectedBus?.linha, isBusFavorite]);

  function headingToCardinal(heading: number | null): string {
    if (heading == null || isNaN(heading)) return '';
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'];
    return dirs[Math.round(((heading % 360) / 45))];
  }

  // Hook for traffic data
  const { traffic } = useTrafficData({
    enabled: showTraffic,
    bounds: currentBounds || undefined,
    updateInterval: 2, // Updates every 2 minutes
  });

  // Convert traffic data to GeoJSON
  const trafficGeoJSON = React.useMemo(() => {
    if (!traffic || traffic.length === 0) {
      return {
        type: 'FeatureCollection' as const,
        features: [],
      };
    }

    const validFeatures = traffic
      .filter((jam: TrafficJam) => {
        // Verify if it has valid coordinates
        return jam.lines &&
          Array.isArray(jam.lines) &&
          jam.lines.length >= 2 &&
          jam.lines.every(coord =>
            Array.isArray(coord) &&
            coord.length === 2 &&
            typeof coord[0] === 'number' &&
            typeof coord[1] === 'number'
          );
      })
      .map((jam: TrafficJam) => {
        const props: any = {
          id: jam.id,
          street: jam.street,
          level: jam.level,
          color: jam.color,
          speedKMH: jam.speedKMH,
        };
        if (jam.pattern) props.pattern = jam.pattern;
        return {
          type: 'Feature' as const,
          properties: props,
          geometry: {
            type: 'LineString' as const,
            coordinates: jam.lines,
          },
        };
      });

    return {
      type: 'FeatureCollection' as const,
      features: validFeatures,
    };
  }, [traffic]);

  const trafficLabelGeoJSON = React.useMemo<TrafficLabelCollection>(() => {
    const emptyCollection: TrafficLabelCollection = {
      type: 'FeatureCollection',
      features: [],
    };

    if (!traffic || traffic.length === 0) {
      return emptyCollection;
    }

    const features: TrafficLabelFeature[] = traffic
      .filter(jam =>
        !jam.pattern &&
        Array.isArray(jam.lines) &&
        jam.lines.length > 0 &&
        jam.lines.every(coord =>
          Array.isArray(coord) &&
          coord.length === 2 &&
          typeof coord[0] === 'number' &&
          typeof coord[1] === 'number'
        )
      )
      .map(jam => {
        const mid = Math.floor(jam.lines.length / 2);
        const coordinate = jam.lines[mid] as [number, number];

        const feature: TrafficLabelFeature = {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: coordinate,
          },
          properties: {
            id: String(jam.id ?? `${jam.street}-${mid}`),
            color: jam.color ?? '#FF9800',
            speedText: `${Math.round(jam.speedKMH ?? 0)} km/h`,
          },
        };

        return feature;
      });

    return {
      type: 'FeatureCollection',
      features,
    };
  }, [traffic]);

  // Atualiza o zoom quando a prop muda (ao recentralizar)
  React.useEffect(() => {
    if (zoom !== undefined) {
      setCurrentZoom(zoom);
    }
  }, [zoom]);

  // Handle region change
  const handleRegionDidChange = async (event: any) => {
    if (onRegionDidChange && event && event.properties && event.properties.visibleBounds) {
      const [[lng1, lat1], [lng2, lat2]] = event.properties.visibleBounds;
      const west = Math.min(lng1, lng2);
      const east = Math.max(lng1, lng2);
      const south = Math.min(lat1, lat2);
      const north = Math.max(lat1, lat2);
      // Extract center and zoom from event
      const center = event.geometry?.coordinates
        ? { longitude: event.geometry.coordinates[0], latitude: event.geometry.coordinates[1] }
        : undefined;
      const zoomLevel = event.properties.zoomLevel;
      setCurrentZoom(zoomLevel); // Updates local zoom

      // Update bounds for traffic
      const bounds = { north, south, east, west };
      setCurrentBounds(bounds);

      onRegionDidChange(bounds, center, zoomLevel);
    }
  };

  // Handle bus selection
  const handleBusSelect = (bus: BusMarker) => {
    if (selectedBus?.id === bus.id) {
      // Fade out
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => setSelectedBus(null));
    } else {
      setSelectedBus(bus);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();

      // Auto fade-out after 5 seconds
      setTimeout(() => {
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(() => setSelectedBus(null));
      }, 5000);
    }
  };

  // Handle data update timestamp
  const getAtualizadoTexto = (datalocal?: string, dataregistro?: string) => {
    // Prioritize dataregistro (UTC) over datalocal (local time)
    const timestamp = dataregistro || datalocal;
    if (!timestamp) return '';

    let dataBus: Date;
    if (dataregistro) {
      // dataregistro already in ISO UTC
      dataBus = new Date(dataregistro);
    } else {
      // datalocal is in local time
      const isoString = datalocal!.replace(' ', 'T');
      dataBus = new Date(isoString);
    }

    const agora = new Date();
    const diffMs = agora.getTime() - dataBus.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return 'Atualizado: agora';
    if (diffMin === 1) return 'Atualizado: há 1 minuto';
    return `Atualizado: há ${diffMin} minutos`;
  };

  // Blue loading bar
  React.useEffect(() => {
    let anim: Animated.CompositeAnimation | null = null;

    if (isFetchingBuses) {
      setIsFetching(true);
      progressAnim.setValue(0);
      anim = Animated.timing(progressAnim, {
        toValue: 1,
        duration: fetchDuration,
        easing: Easing.linear,
        useNativeDriver: false,
      });
      anim.start();
    } else {
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: false,
      }).start(() => {
        setIsFetching(false);
        progressAnim.setValue(0);
      });
    }

    return () => {
      if (anim) anim.stop();
    };
  }, [isFetchingBuses, fetchDuration, progressAnim]);

  // Obtem a velocidade do usuário
  React.useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 1, timeInterval: 1000 },
        (location) => {
          // location.coords.speed is in m/s
          setUserSpeed(location.coords.speed != null ? location.coords.speed * 3.6 : 0); // km/h
          setUserHeading(location.coords.heading ?? null);
        }
      );
    })();

    return () => {
      if (subscription) subscription.remove();
    };
  }, []);

  // Max number of stops and buses to render
  const MAX_STOPS = 50;
  const MAX_BUSES = 100;

  // Filter stops and buses to render based on current zoom
  const stopsToRender = useMemo(() => {
    return busStopMarker.filter((_, index) => index < MAX_STOPS);
  }, [busStopMarker]);

  const busesToRender = useMemo(() => {
    return buses.filter((_, index) => index < MAX_BUSES);
  }, [buses]);

  return (
    <View style={[styles.container, style]}>
      {/* Loading bar - blue for search */}
      {isFetching && (
        <Animated.View
          style={[
            styles.fetchBar,
            {
              width: progressAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}
        />
      )}
      <MapView
        style={{ flex: 1 }}
        mapStyle={mapStyles[mapTheme] || mapStyles.light}
        onRegionDidChange={handleRegionDidChange}
      >
        {/* Line pattern of line to closed roads */}
        <Images images={{
          'yellow-black': yellowBlackStripes,
        }} />

        {latitude !== undefined && longitude !== undefined && zoom !== undefined ? (
          <Camera
            centerCoordinate={[longitude, latitude]}
            zoomLevel={zoom}
          />
        ) : (
          <Camera />
        )}
        {/* <UserLocation
          visible={true}
          showsUserHeadingIndicator={true}
        /> */}

        {/* Traffic Lines WITHOUT pattern */}
        {showTraffic && trafficGeoJSON.features.length > 0 && (
          <ShapeSource
            id="traffic-source-normal"
            shape={{
              ...trafficGeoJSON,
              features: trafficGeoJSON.features.filter(f => !f.properties.pattern),
            }}
          >
            <LineLayer
              id="traffic-lines-normal"
              style={{
                lineColor: ['get', 'color'],
                lineWidth: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  10, 2,
                  15, 4,
                  18, 6
                ],
                lineOpacity: 0.8,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
        )}

        {/* Traffic Lines WITHOUT pattern */}
        {showTraffic && trafficGeoJSON.features.length > 0 && (
          <ShapeSource
            id="traffic-source-pattern"
            shape={{
              ...trafficGeoJSON,
              features: trafficGeoJSON.features.filter(f => !!f.properties.pattern),
            }}
          >
            <LineLayer
              id="traffic-lines-pattern"
              style={{
                lineColor: ['get', 'color'],
                linePattern: ['get', 'pattern'],
                lineWidth: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  10, 2,
                  15, 4,
                  18, 6
                ],
                lineOpacity: 0.8,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
        )}

        {/* Traffic labels */}
        {showTraffic && currentZoom >= 14 && trafficLabelGeoJSON.features.length > 0 && (
          <ShapeSource
            id="traffic-labels-source"
            shape={trafficLabelGeoJSON}
          >
            <CircleLayer
              id="traffic-labels-background"
              style={{
                circleColor: ['coalesce', ['get', 'color'], '#FF9800'],
                circleOpacity: 0.92,
                circleRadius: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  14, 12,
                  18, 16,
                ],
                circleStrokeColor: appTheme === 'dark' ? '#111' : '#ffffff',
                circleStrokeWidth: 1.2,
                circleSortKey: 1,
              }}
            />
            <SymbolLayer
              id="traffic-labels-text"
              style={{
                textField: ['get', 'speedText'],
                textSize: [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  14, 12,
                  18, 14,
                ],
                textColor: appTheme === 'dark' ? '#101010' : '#111111',
                textHaloColor: '#ffffff',
                textHaloWidth: 1.5,
                textAllowOverlap: true,
                textIgnorePlacement: true,
                textAnchor: 'center',
                textJustify: 'center',
              }}
            />
          </ShapeSource>
        )}

        {/* User location marker */}
        {userLocation && (
          <PointAnnotation
            key="user-location"
            id="user-location"
            coordinate={[userLocation.longitude, userLocation.latitude]}
          >
            <View style={{
              width: 20,
              height: 20,
              backgroundColor: '#007AFF',
              borderRadius: 10,
              borderWidth: 3,
              borderColor: '#fff',
              shadowColor: '#000',
              shadowOpacity: 0.3,
              shadowRadius: 3,
              shadowOffset: { width: 0, height: 1 },
            }} />
          </PointAnnotation>
        )}

        {/* Bus stop markers */}
        {currentZoom >= 14 && stopsToRender.map((busStop: BusStopMarker, index: number) => {
          const isFavoriteStop = isStopFavorite(busStop.id);
          return (
            <PointAnnotation
              key={`bus-stop-${busStop.id}-${index}`}
              id={`stop-${busStop.id}`}
              coordinate={[busStop.longitude, busStop.latitude]}
              onSelected={() => onBusStopMarkerPress?.(busStop)}
            >
              <View
                collapsable={false}
                style={{
                  position: 'relative',
                  width: 45,
                  height: 45,
                  alignItems: 'center',
                  justifyContent: 'center',
                  
                }}
              >
                {/* <BusStopIcon width={35} height={35} color="#007AFF" /> */}
                <BusStopIcon2 width={45} height={45} style={{ marginTop: 4 }}/>
                {/* Placeholder for bus stop icon */}
                {/* <View
                  style={{
                    width: 35,
                    height: 35,
                    backgroundColor: '#007AFF',
                    borderRadius: 9,
                    borderWidth: 2,
                    borderColor: '#fff',
                  }}
                /> */}

                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    top: -1,
                    right: 3,
                    backgroundColor: '#fff',
                    borderRadius: 7,
                    padding: 0.5,
                    opacity: isFavoriteStop ? 1 : 0,
                  }}
                >
                  <MaterialIcons name="star" size={14} color="#FFD600" />
                </View>
              </View>
            </PointAnnotation>
          );
        })}

        {/* Bus markers */}
        {currentZoom >= 13.8 && busesToRender.map((bus: BusMarker, index: number) => {
          const isFavoriteBus = isBusFavorite(bus.linha ?? '');
          const color = bus.corOperadora || '#5a4799';
          return (
            <PointAnnotation
              key={`bus-${bus.id}-${index}`}
              id={`bus-${bus.id}`}
              coordinate={[bus.longitude, bus.latitude]}
              onSelected={() => handleBusSelect(bus)}
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
                  <MaterialIcons name="star" size={14} color="#FFD600"
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
      </MapView>
      {/* Speedometer */}
      {typeof userSpeed === 'number' && (
        <View
          style={{
            position: 'absolute',
            left: 10,
            bottom: 5,
            zIndex: 20,
          }}
        >
          <View
            style={{
              width: 120,
              height: 50,
              borderRadius: 12,
              borderWidth: 1.5,
              borderColor: appTheme === 'dark' ? '#444' : '#ccc',
              backgroundColor: appTheme === 'dark' ? '#222' : '#fff',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 10,
              elevation: 4,
              shadowColor: '#000',
              shadowOpacity: 0.15,
              shadowRadius: 4,
              shadowOffset: { width: 0, height: 2 },
            }}
          >
            {/* Velocidade */}
            <View style={{ alignItems: 'center', justifyContent: 'center' }}>
              <Text
                style={{
                  color: appTheme === 'dark' ? '#fff' : '#222',
                  fontSize: 28,
                  fontWeight: 'bold',
                  textAlign: 'center',
                  lineHeight: 32,
                }}
              >
                {userSpeed?.toFixed(1)}
              </Text>
              <Text
                style={{
                  color: appTheme === 'dark' ? '#aaa' : '#666',
                  fontSize: 12,
                  textAlign: 'center',
                }}
              >
                km/h
              </Text>
            </View>
            {/* Compass */}
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: appTheme === 'dark' ? '#444' : '#ccc',
                backgroundColor: appTheme === 'dark' ? '#222' : '#fff',
                justifyContent: 'center',
                alignItems: 'center',
                marginLeft: 8,
              }}
            >
              <Animated.View
                style={{
                  transform: [{ rotate: `${userHeading ?? 0}deg` }],
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{
                  fontSize: 20,
                  color: appTheme === 'dark' ? '#fff' : '#222',
                  fontWeight: 'bold',
                  marginBottom: -2,
                }}>↑</Text>
              </Animated.View>
              <Text style={{
                fontSize: 10,
                color: appTheme === 'dark' ? '#aaa' : '#666',
                position: 'absolute',
                bottom: 2,
                alignSelf: 'center',
              }}>
                {headingToCardinal(userHeading)}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Custom popup outside the map */}
      {selectedBus && (
        <Animated.View style={[
          styles.customPopup,
          { opacity: fadeAnim },
          { backgroundColor: appTheme === 'dark' ? '#333' : 'white' }
        ]}>
          <View style={styles.popupContent}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.popupTitle, { color: appTheme === 'dark' ? '#fff' : '#333' }]}>
                Linha {selectedBus.linha}
              </Text>
              <Text style={[styles.popupSubtitle, { color: appTheme === 'dark' ? '#ccc' : '#666' }]}>
                Prefixo: {selectedBus.prefixo}
              </Text>
              {selectedBus.operadora && (
                <Text style={[styles.popupOperator, { color: appTheme === 'dark' ? '#fff' : '#444' }]}>
                  Operadora: {selectedBus.operadora.nome}
                </Text>
              )}
              {selectedBus.velocidade && (
                <Text style={[styles.popupInfo, { color: appTheme === 'dark' ? '#ddd' : '#444' }]}>
                  Velocidade: {selectedBus.velocidade.toFixed(1)} km/h
                </Text>
              )}
              {selectedBus.sentido && (
                <Text style={[styles.popupInfo, { color: appTheme === 'dark' ? '#ddd' : '#444' }]}>
                  Sentido: {selectedBus.sentido === '1' ? 'Ida' : selectedBus.sentido === '2' ? 'Volta' : selectedBus.sentido}
                </Text>
              )}
              {(selectedBus.datalocal || selectedBus.dataregistro) && (
                <Text style={[styles.popupTimestamp, { color: appTheme === 'dark' ? '#aaa' : '#888' }]}>
                  {getAtualizadoTexto(selectedBus.datalocal, selectedBus.dataregistro)}
                </Text>
              )}
            </View>
            <TouchableOpacity
              onPress={toggleFavorite}
              style={[
                styles.favoriteButton,
                isFavorite
                  ? { backgroundColor: '#FFD600', borderColor: '#FFD600' }
                  : { backgroundColor: 'transparent', borderColor: '#007AFF', borderWidth: 2 }
              ]}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <MaterialIcons
                name={isFavorite ? "bookmark" : "bookmark-outline"}
                size={28}
                color={isFavorite ? '#fff' : '#007AFF'}
              />
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 300,
    borderRadius: 10,
    overflow: 'hidden',
  },
  customPopup: {
    position: 'absolute',
    top: 20,
    left: 20,
    right: 20,
    borderRadius: 8,
    elevation: 5,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  popupContent: {
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  popupTitle: {
    fontWeight: 'bold',
    fontSize: 16,
  },
  popupSubtitle: {
    fontSize: 12,
    marginTop: 4,
  },
  popupOperator: {
    fontSize: 13,
    marginTop: 4,
    fontWeight: '600',
  },
  popupInfo: {
    fontSize: 12,
    marginTop: 2,
  },
  popupTimestamp: {
    fontSize: 10,
    marginTop: 4,
    fontStyle: 'italic',
  },
  fetchBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: 4,
    backgroundColor: '#2196F3',
    zIndex: 10,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  favoriteButton: {
    marginLeft: 12,
    borderRadius: 20,
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 44,
    minHeight: 44,
  },
});

export default MapLibreBasic;