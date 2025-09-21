import { MaterialIcons } from '@expo/vector-icons';
import {
  Camera,
  Images,
  LineLayer,
  MapView,
  PointAnnotation,
  ShapeSource
} from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import React, { useCallback, useMemo, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useBusFavorites, useStopFavorites } from '../hooks/useFavorites';
import { useTrafficData } from '../hooks/useTrafficData';
import { useAppStore } from '../store';
import { TrafficJam } from '../types';

// Assets
import yellowBlackStripes from '../assets/images/pattern/yellow-black.png';
import BusStopIcon from '../assets/images/svg/bus-stop.svg';
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

  // Function to toggle favorite for selected bus
  const toggleFavorite = useCallback(() => {
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

  // Atualiza o zoom quando a prop muda (ao recentralizar)
  React.useEffect(() => {
    if (zoom !== undefined) {
      setCurrentZoom(zoom);
    }
  }, [zoom]);

  // Handle region change
  const handleRegionDidChange = async (event: any) => {
    if (onRegionDidChange && event && event.properties && event.properties.visibleBounds) {
      const [[west, south], [east, north]] = event.properties.visibleBounds;
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
        <Images images={{ 'yellow-black': yellowBlackStripes }} />

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
        {currentZoom >= 14 && busStopMarker.map((busStop: BusStopMarker) => {
          const isFavoriteStop = isStopFavorite(busStop.id);
          return (
            <PointAnnotation
              key={busStop.id}
              id={busStop.id}
              coordinate={[busStop.longitude, busStop.latitude]}
              onSelected={() => onBusStopMarkerPress?.(busStop)}
            >
              <View
                collapsable={false}
                style={{
                  position: 'relative',
                  width: 35,
                  height: 35,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <BusStopIcon width={35} height={35} color="#007AFF" />
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
                    top: 1,
                    right: 1,
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
        {currentZoom >= 13 && buses && buses.map((bus: BusMarker) => {
          const isFavoriteBus = isBusFavorite(bus.linha ?? '');
          const color = bus.corOperadora || '#5a4799';
          return (
            <PointAnnotation
              key={bus.id}
              id={bus.id}
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
                }}
              >
                <BusIcon width={30} height={30} color={color} />
                {/* Placeholder for bus icon */}
                {/* <View
                  style={{
                    width: 30,
                    height: 30,
                    backgroundColor: bus.corOperadora || '#5a4799',
                    borderRadius: 15,
                    borderWidth: 2,
                    borderColor: '#fff',
                    justifyContent: 'center',
                    alignItems: 'center',
                    shadowColor: '#000',
                    shadowOpacity: 0.3,
                    shadowRadius: 3,
                    shadowOffset: { width: 0, height: 1 },
                  }}
                /> */}
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    top: -5,
                    right: 2,
                    backgroundColor: '#fff',
                    borderRadius: 8,
                    padding: 0.5,
                    opacity: isFavoriteBus ? 1 : 0,
                    overflow: 'visible',
                    elevation: 2,
                  }}
                >
                  <MaterialIcons name="star" size={16} color="#FFD600" />
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
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
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
                  : { backgroundColor: 'transparent' }
              ]}
              activeOpacity={0.7}
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
    backgroundColor: 'red'
  },
  popupTitle: {
    fontWeight: 'bold',
    fontSize: 16,
    marginLeft: 6,
  },
  popupSubtitle: {
    fontSize: 12,
    marginLeft: 6,
    marginTop: 4,
  },
  popupOperator: {
    fontSize: 13,
    marginTop: 4,
    marginLeft: 6,
    fontWeight: '600',
  },
  popupInfo: {
    fontSize: 12,
    marginTop: 2,
    marginLeft: 6,
  },
  popupTimestamp: {
    fontSize: 10,
    marginTop: 4,
    fontStyle: 'italic',
    marginLeft: 6,
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
    //borderWidth: 2,
    borderRadius: 20,
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default MapLibreBasic;