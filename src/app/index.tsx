import { busService, stopService } from '@/src/services/api';
import { useAppStore } from '@/src/store';
import { BusStop } from '@/src/types';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  BackHandler,
  Dimensions,
  Modal,
  PanResponder,
  SafeAreaView, StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapLibreBasic from '../components/MapLibre';
import StopDetail from '../components/StopsMenuComponent/stopDetail.component';
import StopsPainelMenu from '../components/StopsMenuComponent/stopsPainel.component';
import { useLocation } from "../hooks/useLocation";

export default function Index() {
  // Location hook
  const { userLocation, getCurrentLocation, requestPermission, watchLocation } = useLocation();
  // Api Service
  const [bounds, setBounds] = useState<any>(null);
  const [pendingBounds, setPendingBounds] = useState<any>(null);
  const [stops, setStops] = useState<any[]>([]);
  const [buses, setBuses] = useState<any[]>([]);
  // loading bar
  const [isFetchingBuses, setIsFetchingBuses] = useState(false); // blue loading bar
  const intervalMs = 10000;
  const fetchingBusesRef = useRef(false);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renderTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const loadIdRef = useRef(0);
  // Store
  const {
    loading,
    style: mapTheme,
    appTheme,
    showOnlyActiveBuses,
    showStops: showStopsStore,
    showTraffic,
    setShowOnlyActiveBuses,
    setShowStops: setShowStopsStore,
    setShowTraffic
  } = useAppStore();

  // Map center state
  const [mapCenter, setMapCenter] = useState({
    latitude: -15.793889,
    longitude: -47.882778,
    zoom: 12,
  });

  // Map initialization state
  const [initialized, setInitialized] = useState(false);

  // Map Camera
  const [cameraMode, setCameraMode] = useState<'auto' | 'free'>('auto');
  const [userMapZoom, setUserMapZoom] = useState<number | undefined>(undefined);
  const BUS_ZOOM_THRESHOLD = 13.4;
  const STOPS_ZOOM_THRESHOLD = 15.4;

  // Settings modal
  const [showSettings, setShowSettings] = useState(false);

  // Bus stop panel controll
  const [panelOpen, setPanelOpen] = useState(false);
  const panelAnim = useState(new Animated.Value(0))[0]; // 0 = fechado, 1 = aberto
  const [selectedStopFromMap, setSelectedStopFromMap] = useState<BusStop | null>(null);
  const [selectedStopForDetail, setSelectedStopForDetail] = useState<BusStop | null>(null);

  // Bus stop panel state  (0 = closed, 1 = half-way open, 2 = open fully)
  const [panelState, setPanelState] = useState(0); // 0: closed, 1: half-way open, 2: open fully
  //const panelAnim = useState(new Animated.Value(0))[0];

  const SCREEN_HEIGHT = Dimensions.get('window').height;
  const PANEL_MIN_HEIGHT = 60;
  const PANEL_MID_HEIGHT = 300;
  const PANEL_MAX_HEIGHT = SCREEN_HEIGHT;

  // Safe area insets 
  const insets = useSafeAreaInsets();

  // Animation to open/close
  const togglePanel = () => {
    const newPanelState = panelOpen ? 0 : 1;
    setPanelState(newPanelState);
    setPanelOpen(!panelOpen);
  };

  // Updates panel height according to state
  useEffect(() => {
    let toValue = 0;
    if (panelState === 1) toValue = 1;
    if (panelState === 2) toValue = 2;
    Animated.spring(panelAnim, {
      toValue,
      useNativeDriver: false,
      friction: 10, // adjust for smoothness
      tension: 5, // adjust for smoothness
    }).start();
  }, [panelState, panelAnim]);

  // Panel height
  const panelHeight = panelAnim.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [PANEL_MIN_HEIGHT, PANEL_MID_HEIGHT, PANEL_MAX_HEIGHT],
    extrapolate: 'clamp',
  });

  // Space to push the map up
  const mapPaddingBottom = panelAnim.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [0, PANEL_MID_HEIGHT, PANEL_MAX_HEIGHT],
    extrapolate: 'clamp',
  });

  // PanResponder for dragging the panel
  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) => {
      return Math.abs(gestureState.dy) > 10;
    },
    onPanResponderMove: (_, gestureState) => {
      // Update panel height according to drag
      let newHeight =
        (panelState === 2 ? PANEL_MAX_HEIGHT : panelState === 1 ? PANEL_MID_HEIGHT : PANEL_MIN_HEIGHT)
        - gestureState.dy;
      if (newHeight < PANEL_MIN_HEIGHT) newHeight = PANEL_MIN_HEIGHT;
      if (newHeight > PANEL_MAX_HEIGHT) newHeight = PANEL_MAX_HEIGHT;
      panelAnim.setValue(
        newHeight < PANEL_MID_HEIGHT
          ? 0
          : newHeight < (PANEL_MAX_HEIGHT - 100)
            ? 1
            : 2
      );
    },
    onPanResponderRelease: (_, gestureState) => {
      // Decide which state to go to on release
      if (panelState === 2 && gestureState.dy > 50) {
        // If it was at maximum and dragged down, go back to medium
        setPanelState(1);
        setPanelOpen(true);
      } else if (panelState === 1 && gestureState.dy > 50) {
        // If it was at medium and dragged down, close it
        setPanelState(0);
        setPanelOpen(false);
      } else if (panelState === 1 && gestureState.dy < -50) {
        // If it was at medium and dragged up, go to maximum
        setPanelState(2);
        setPanelOpen(true);
      } else if (panelState === 2 && gestureState.dy < -50) {
        // If it was at maximum and dragged up, stay at maximum
        setPanelState(2);
        setPanelOpen(true);
      } else if (panelState === 0 && gestureState.dy < -50) {
        // If it was closed and dragged up, go to medium
        setPanelState(1);
        setPanelOpen(true);
      } else {
        // Keep current state
        setPanelState(panelState);
        setPanelOpen(panelState !== 0);
      }
    },
  });

  // Request permission on mount and start location watch
  useEffect(() => {
    let subscription: any = null;
    let isCancelled = false;

    (async () => {
      try {
        const permission = await requestPermission();
        if (!permission || isCancelled) return;

        await getCurrentLocation();
        if (isCancelled) return;

        subscription = await watchLocation();
      } catch (e) {
        console.warn('Location watch failed:', e);
      }
    })();

    return () => {
      isCancelled = true;
      if (subscription && typeof subscription.remove === 'function') {
        subscription.remove();
      }
    };
  }, [getCurrentLocation, requestPermission, watchLocation]);

  // Initialize camera once when first userLocation arrives
  useEffect(() => {
    if (!initialized && userLocation) {
      setMapCenter({
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        zoom: 16,
      });
      setCameraMode('auto');
      setInitialized(true);
    }
  }, [userLocation, initialized]);

  // BackHandler for Android - detects when panel is expanded or modal is open
  useEffect(() => {
    const backAction = () => {
      // If settings modal is open, close it
      if (showSettings) {
        setShowSettings(false);
        return true;
      }

      // If details modal is open, close it
      if (selectedStopForDetail) {
        setSelectedStopForDetail(null);
        return true;
      }

      if (panelState === 2) {
        // If it was at maximum, go back to medium
        setPanelState(1);
        return true;
      } else if (panelState === 1) {
        // If it was at medium, close it completely
        setPanelState(0);
        setPanelOpen(false);
        return true;
      }
      // If panel is closed, let default behavior happen (close app)
      return false;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [panelState, selectedStopForDetail, showSettings]);

  // Center on user at start
  const handleLocatePress = async () => {
    try {
      const permission = await requestPermission();
      if (!permission) {
        console.warn('Permissão de localização negada');
        return;
      }
      const location = await getCurrentLocation();
      if (location) {
        setMapCenter({
          latitude: location.latitude,
          longitude: location.longitude,
          zoom: 16,
        });
        setCameraMode('auto');
      }
    } catch (error) {
      console.error('Failed to get location:', error);
    }
  };

  // Map settings menu
  const handleConfigPress = async () => {
    setShowSettings(true);
  }

  // Update bounds when moving the map
  const handleRegionDidChange = (
    bounds: { north: number; south: number; east: number; west: number; },
    center?: { latitude: number; longitude: number },
    zoom?: number
  ) => {
    // Cancel any ongoing incremental rendering when user moves the map
    renderTimeoutsRef.current.forEach(t => clearTimeout(t));
    renderTimeoutsRef.current = [];
    loadIdRef.current++;
    setPendingBounds(bounds);
    if (cameraMode === 'auto') {
      setCameraMode('free');
    }
    if (zoom !== undefined) {
      setUserMapZoom(zoom); // user's zoom level when moving the map
    }
  };

  // Debounce bounds updates: only set real bounds 0.7s after map stops moving, fixes too many requests to API while moving map
  useEffect(() => {
    if (!pendingBounds) return;
    const t = setTimeout(() => setBounds(pendingBounds), 700);
    return () => clearTimeout(t);
  }, [pendingBounds]);

  // Fetch stops when changing bounds
  useEffect(() => {
    if (!bounds || (userMapZoom ?? 0) < STOPS_ZOOM_THRESHOLD) return;
    stopService.getStops(bounds)
      .then(setStops)
      .catch((error) => {
        console.error('Error fetching bus stops:', error);
      });
  }, [bounds, userMapZoom]);

  // Fetch buses periodically
  useEffect(() => {
    let currentInterval = intervalMs;

    const fetchBuses = async () => {
      // Skip fetching if no bounds or below zoom threshold
      if (!bounds || (userMapZoom ?? 0) < BUS_ZOOM_THRESHOLD) {
        if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
        // Re-check soon so we start fetching quickly after user zooms in
        refreshTimeoutRef.current = setTimeout(fetchBuses, 1000);
        return;
      }
      if (fetchingBusesRef.current) return;
      fetchingBusesRef.current = true;
      setIsFetchingBuses(true);
      try {
        const result = await busService.getEnhancedBuses(bounds);
        const filteredBuses = showOnlyActiveBuses
          ? result.filter(bus => bus.linha && bus.linha.trim())
          : result;

        // Cancel any pending incremental rendering from previous load
        renderTimeoutsRef.current.forEach(t => clearTimeout(t));
        renderTimeoutsRef.current = [];
        const myLoadId = ++loadIdRef.current;

        // Incremental rendering in chunks to avoid blocking UI
        const chunkSize = 200;
        const total = filteredBuses.length;

        const mapBus = (bus: any) => ({
          id: bus.id,
          latitude: bus.latitude,
          longitude: bus.longitude,
          title: `Linha ${bus.linha} - ${bus.prefixo}`,
          prefixo: bus.prefixo,
          linha: bus.linha,
          velocidade: bus.velocidade,
          sentido: bus.sentido,
          datalocal: bus.datalocal,
          dataregistro: bus.dataregistro,
          operadora: bus.operadora,
          corOperadora: bus.corOperadora,
        });

        const firstCount = Math.min(chunkSize, total);
        const firstChunk = filteredBuses.slice(0, firstCount).map(mapBus);
        setBuses(firstChunk);

        const pushNext = (startIndex: number) => {
          if (loadIdRef.current !== myLoadId) return; // canceled by new load
          if (startIndex >= total) return;
          const nextChunk = filteredBuses.slice(startIndex, startIndex + chunkSize).map(mapBus);
          setBuses(prev => prev.concat(nextChunk));
          if (startIndex + chunkSize < total) {
            const t = setTimeout(() => pushNext(startIndex + chunkSize), 16);
            renderTimeoutsRef.current.push(t);
          }
        };
        if (firstCount < total) {
          const t = setTimeout(() => pushNext(firstCount), 16);
          renderTimeoutsRef.current.push(t);
        }
        currentInterval = intervalMs; // reset on success
      } catch (error) {
        console.warn('Error fetching buses:', error);
        currentInterval = Math.min(currentInterval + 1000, 30000);
      } finally {
        setIsFetchingBuses(false);
        fetchingBusesRef.current = false;
      }

      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = setTimeout(fetchBuses, currentInterval);
    };

    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    fetchBuses();

    return () => {
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
      renderTimeoutsRef.current.forEach(t => clearTimeout(t));
      renderTimeoutsRef.current = [];
    };
  }, [bounds, showOnlyActiveBuses, userMapZoom, intervalMs]);

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: appTheme === "dark" ? "#000" : "#fff" },
      ]}
    >
      <View
        style={[
          styles.header,
          { backgroundColor: appTheme === "dark" ? "#000" : "#fff", borderBottomColor: appTheme === "dark" ? "#333" : "#ccc", borderBottomWidth: 1, },
        ]}
      >
        <Text
          style={[
            styles.title,
            { color: appTheme === "dark" ? "#fff" : "#333" },
          ]}
        >
          {/**<ÔnibusDF /> */}
        </Text>
      </View>
      <Animated.View
        style={[
          styles.mapContainer,
          { paddingBottom: mapPaddingBottom, marginBottom: 5 },
        ]}
      >
        {/* Buttons of config and locate */}
        <View style={styles.topRightButtons}>
          {/* Config button */}
          <TouchableOpacity
            style={[
              styles.configButton,
              { backgroundColor: appTheme === "dark" ? "#333" : "#fff" },
            ]}
            onPress={handleConfigPress}
          >
            <Ionicons
              name="settings"
              size={28}
              color={appTheme === "dark" ? "#999" : "#007AFF"}
            />
          </TouchableOpacity>
          {/* Locate button */}
          <TouchableOpacity
            style={[
              styles.locateButton,
              {
                backgroundColor: appTheme === "dark" ? "#333" : "#fff",
                marginBottom: 12,
              },
            ]}
            onPress={handleLocatePress}
            disabled={loading.location}
          >
            <Ionicons
              name={loading.location ? "hourglass" : "locate"}
              size={28}
              color={loading.location ? "#999" : "#007AFF"}
            />
          </TouchableOpacity>
        </View>

        <MapLibreBasic
          latitude={cameraMode === "auto" ? mapCenter.latitude : undefined}
          longitude={cameraMode === "auto" ? mapCenter.longitude : undefined}
          zoom={cameraMode === "auto" ? mapCenter.zoom : undefined}
          style={{ flex: 1 }}
          theme={mapTheme as "light" | "dark"} // Use map theme from store
          isFetchingBuses={isFetchingBuses} // blue loading bar
          fetchDuration={intervalMs}
          // Bus stops
          busStopMarker={
            showStopsStore
              ? stops.map((stop) => ({
                id: stop.id,
                latitude: stop.latitude,
                longitude: stop.longitude,
                title: stop.nome,
              }))
              : []
          }
          onBusStopMarkerPress={(marker) => {
            // Find the full stop in the stops array
            const fullStop = stops.find(stop => stop.id === marker.id);
            if (fullStop) {
              // Set the selected stop
              setSelectedStopFromMap(fullStop);
              setSelectedStopForDetail(fullStop);
              // Open the panel if it's closed
              if (panelState === 0) {
                setPanelState(2);
                setPanelOpen(true);
              }
              // console.log('Bus stop clicked on map:', fullStop);
            } else {
              Alert.alert("Parada", marker.title || marker.id);
            }
          }}
          // Map change
          onRegionDidChange={handleRegionDidChange}
          // Traffic
          showTraffic={showTraffic}
          // Buses
          buses={buses}
          onBusMarkerPress={(bus) => Alert.alert("Ônibus", bus.title || bus.id)}
        />
        {/* skeleton loading in main map */}
        {/* {(loading.buses || loading.stops || !initialized) && (
          <View
            pointerEvents="none"
            style={[
              styles.mapSkeletonOverlay,
              {
                backgroundColor: appTheme === 'dark' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.82)',
              },
            ]}
          >
            <SkeletonPlaceholder width="60%" height={20} isDark={appTheme === 'dark'} />
            <SkeletonPlaceholder
              width="42%"
              height={14}
              style={{ marginTop: 12 }}
              isDark={appTheme === 'dark'}
            />
            <View style={styles.mapSkeletonRow}>
              {Array.from({ length: 3 }).map((_, index) => (
                <SkeletonPlaceholder
                  key={`map-skeleton-card-${index}`}
                  width="28%"
                  height={78}
                  borderRadius={16}
                  isDark={appTheme === 'dark'}
                />
              ))}
            </View>
          </View>
        )} */}
      </Animated.View>

      {!panelOpen && (
        <TouchableOpacity
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 24,
            alignItems: "center",
            zIndex: 20,
          }}
          onPress={togglePanel}
          activeOpacity={0.85}
        >
          <View
            style={{
              backgroundColor: appTheme === "dark" ? "#222" : "#fff",
              borderRadius: 24,
              paddingHorizontal: 28,
              paddingVertical: 14,
              elevation: 8,
              shadowColor: "#000",
              shadowOpacity: 0.15,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 2 },
              borderWidth: 1,
              borderColor: appTheme === "dark" ? "#333" : "#eee",
            }}
          >
            <Text
              style={{ color: "#007AFF", fontWeight: "bold", fontSize: 16 }}
            >
              Ver paradas
            </Text>
          </View>
        </TouchableOpacity>
      )}

      {/* Floating bus stop panel */}
      {panelOpen && (
        <Animated.View
          style={[
            styles.floatingPanel,
            {
              height: panelHeight,
              backgroundColor: appTheme === "dark" ? "#000" : "#fff", // Fix panel color
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
              paddingTop: panelState === 2 ? insets.top + 50 : 0,
            },
          ]}
          {...panResponder.panHandlers}
        >
          {/* Only show the handle if the panel is NOT at maximum */}
          {panelState !== 2 && (
            <TouchableOpacity
              style={[
                styles.panelHandle,
                { backgroundColor: appTheme === "dark" ? "#222" : "#f2f2f2" },
              ]}
              onPress={togglePanel}
              activeOpacity={0.7}
            >
              <Text style={{ color: "#007AFF", fontWeight: "bold" }}>
                {panelOpen ? "Fechar" : "Abrir"} painel
              </Text>
            </TouchableOpacity>
          )}
          {panelOpen && (
            <SafeAreaView
              style={{
                flex: 1,
                justifyContent: "center",
                alignItems: "center",
                backgroundColor: appTheme === "dark" ? "#000" : "#fff",
              }}
            >
              <StopsPainelMenu
                stops={(userMapZoom ?? 0) >= STOPS_ZOOM_THRESHOLD ? stops : []}
                selectedStopFromMap={selectedStopFromMap}
                onStopSelected={() => setSelectedStopFromMap(null)}
              />
            </SafeAreaView>
          )}
        </Animated.View>
      )}

      {/* Floating map settings modal */}
      <Modal
        visible={showSettings}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowSettings(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              { backgroundColor: appTheme === "dark" ? "#333" : "#fff" },
            ]}
          >
            <Text
              style={[
                styles.modalTitle,
                { color: appTheme === "dark" ? "#fff" : "#333" },
              ]}
            >
              Configurações
            </Text>

            <View style={styles.settingRow}>
              <Text
                style={[
                  styles.settingLabel,
                  { color: appTheme === "dark" ? "#fff" : "#333" },
                ]}
              >
                Apenas ônibus ativos
              </Text>
              <Switch
                value={showOnlyActiveBuses}
                onValueChange={setShowOnlyActiveBuses}
                trackColor={{
                  false: "#767577",
                  true: appTheme === "dark" ? "#81b0ff" : "#81b0ff",
                }}
                thumbColor={
                  showOnlyActiveBuses
                    ? appTheme === "dark"
                      ? "#007AFF"
                      : "#007AFF"
                    : "#f4f3f4"
                }
              />
            </View>

            <View style={styles.settingRow}>
              <Text
                style={[
                  styles.settingLabel,
                  { color: appTheme === "dark" ? "#fff" : "#333" },
                ]}
              >
                Mostrar paradas
              </Text>
              <Switch
                value={showStopsStore}
                onValueChange={setShowStopsStore}
                trackColor={{
                  false: "#767577",
                  true: appTheme === "dark" ? "#81b0ff" : "#81b0ff",
                }}
                thumbColor={
                  showStopsStore
                    ? appTheme === "dark"
                      ? "#007AFF"
                      : "#007AFF"
                    : "#f4f3f4"
                }
              />
            </View>

            <View style={styles.settingRow}>
              <Text
                style={[
                  styles.settingLabel,
                  { color: appTheme === "dark" ? "#fff" : "#333" },
                ]}
              >
                Mostrar trânsito
              </Text>
              <Switch
                value={showTraffic}
                onValueChange={setShowTraffic}
                trackColor={{
                  false: "#767577",
                  true: appTheme === "dark" ? "#81b0ff" : "#81b0ff",
                }}
                thumbColor={
                  showTraffic
                    ? appTheme === "dark"
                      ? "#007AFF"
                      : "#007AFF"
                    : "#f4f3f4"
                }
              />
            </View>

            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowSettings(false)}
            >
              <Text style={styles.closeButtonText}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Floating bus stop detail modal */}
      <Modal
        visible={selectedStopForDetail !== null}
        transparent={false}
        animationType="slide"
        onRequestClose={() => setSelectedStopForDetail(null)}
      >
        <SafeAreaView style={{ flex: 1 }}>
          {selectedStopForDetail && (
            <StopDetail
              stop={selectedStopForDetail}
              onBack={() => setSelectedStopForDetail(null)}
            />
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 5,
    borderBottomWidth: 1,
  },
  title: {
    marginTop: 5,
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  mapContainer: {
    flex: 1,
    padding: 8,
  },
  mapSkeletonOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 15,
    paddingHorizontal: 24,
    paddingVertical: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapSkeletonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 28,
  },
  // buttons config e local
  topRightButtons: {
    height: 125,
    position: 'absolute',
    top: 24,
    right: 14,
    zIndex: 10,
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    flexDirection: 'column',
  },
  // Button localize
  locateButton: {
    //position: 'absolute',
    //bottom: 24,
    //right: 24,
    borderRadius: 24,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    marginTop: 10,
  },
  // Button config and modal
  configButton: {
    //position: 'absolute',
    //bottom: 84,
    //right: 24,
    marginTop: 110,
    borderRadius: 24,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    margin: 20,
    borderRadius: 10,
    padding: 20,
    width: '80%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  settingLabel: {
    fontSize: 16,
  },
  closeButton: {
    backgroundColor: '#007AFF',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },

  // Animation of floating bus stop panel
  floatingPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    //backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
    overflow: 'hidden',
  },
  panelHandle: {
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: '#f2f2f2',
  },
});