import apiService from '@/src/services/api';
import { useAppStore } from '@/src/store';
import { BusStop } from '@/src/types';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from "react";
import {
  Alert,
  Animated,
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
  const [stops, setStops] = useState<any[]>([]);
  const [buses, setBuses] = useState<any[]>([]);
  // loading bar
  const [isFetchingBuses, setIsFetchingBuses] = useState(false); // blue loading bar
  const [intervalMs, setIntervalMs] = useState(8000);
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
  const [userMapZoom, setUserMapZoom] = useState(Number);

  // Settings modal
  const [showSettings, setShowSettings] = useState(false);

  // Estado para controlar o painel de paradas
  const [panelOpen, setPanelOpen] = useState(false);
  const panelAnim = useState(new Animated.Value(0))[0]; // 0 = fechado, 1 = aberto
  const [selectedStopFromMap, setSelectedStopFromMap] = useState<BusStop | null>(null);
  const [selectedStopForDetail, setSelectedStopForDetail] = useState<BusStop | null>(null);

    // Estado para altura do painel (0 = fechado, 1 = médio, 2 = máximo)
  const [panelState, setPanelState] = useState(0); // 0: fechado, 1: médio, 2: máximo
  //const panelAnim = useState(new Animated.Value(0))[0];

  const SCREEN_HEIGHT = Dimensions.get('window').height;
  const PANEL_MIN_HEIGHT = 60;
  const PANEL_MID_HEIGHT = 300;
  const PANEL_MAX_HEIGHT = SCREEN_HEIGHT;
  // Safe area insets 
  const insets = useSafeAreaInsets();

   // Animação de abrir/fechar
  const togglePanel = () => {
    const newPanelState = panelOpen ? 0 : 1;
    setPanelState(newPanelState);
    setPanelOpen(!panelOpen);
  };
  // Atualiza altura do painel conforme estado
  useEffect(() => {
    let toValue = 0;
    if (panelState === 1) toValue = 1;
    if (panelState === 2) toValue = 2;
    Animated.spring(panelAnim, {
      toValue,
      useNativeDriver: false,
      friction: 10, // ajuste para suavidade
      tension: 5, // ajuste para suavidade
    }).start();
  }, [panelState, panelAnim]);

  // Altura do painel
  const panelHeight = panelAnim.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [PANEL_MIN_HEIGHT, PANEL_MID_HEIGHT, PANEL_MAX_HEIGHT],
    extrapolate: 'clamp',
  });

  // Espaço para empurrar o mapa para cima
  const mapPaddingBottom = panelAnim.interpolate({
    inputRange: [0, 1, 2],
    outputRange: [0, PANEL_MID_HEIGHT, PANEL_MAX_HEIGHT],
    extrapolate: 'clamp',
  });

  // PanResponder para arrastar o painel
  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) => {
      return Math.abs(gestureState.dy) > 10;
    },
    onPanResponderMove: (_, gestureState) => {
      // Atualiza altura do painel durante o arrasto
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
      // Decide para qual estado vai ao soltar
      if (panelState === 2 && gestureState.dy > 50) {
        // Se estava no máximo e arrastou para baixo, volta para médio
        setPanelState(1);
        setPanelOpen(true);
      } else if (panelState === 1 && gestureState.dy > 50) {
        // Se estava no médio e arrastou para baixo, fecha
        setPanelState(0);
        setPanelOpen(false);
      } else if (panelState === 1 && gestureState.dy < -50) {
        // Se estava no médio e arrastou para cima, vai para máximo
        setPanelState(2);
        setPanelOpen(true);
      } else if (panelState === 2 && gestureState.dy < -50) {
        // Se já está no máximo e arrasta mais pra cima, mantém no máximo
        setPanelState(2);
        setPanelOpen(true);
      } else if (panelState === 0 && gestureState.dy < -50) {
        // Se fechado e arrasta pra cima, abre médio
        setPanelState(1);
        setPanelOpen(true);
      } else {
        // Mantém o estado atual
        setPanelState(panelState);
        setPanelOpen(panelState !== 0);
      }
    },
  });

  // Solicitar permissão ao montar e iniciar watch de localização
  useEffect(() => {
    let subscription: any = null;
    
    const startLocationWatch = async () => {
      await requestPermission();
      subscription = await watchLocation();
    };
    
    startLocationWatch();
    
    return () => {
      if (subscription) {
        subscription.remove();
      }
    };
  }, [requestPermission, watchLocation]);

  // Centralizar no usuário ao iniciar
  useEffect(() => {
    if (userLocation && !initialized) {
      setMapCenter({
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        zoom: 16,
      });
      setCameraMode('auto');
      setInitialized(true);
    }
  }, [userLocation, initialized]);

  // Centralizar no usuário
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

  // Configuracoes
  const handleConfigPress = async () => {
    setShowSettings(true);
  }
  
  // Atualiza os bounds quando move o mapa
  const handleRegionDidChange = (
    bounds: { north: number; south: number; east: number; west: number; },
    center?: { latitude: number; longitude: number },
    zoom?: number
  ) => {
    setBounds(bounds);
    if (cameraMode === 'auto') {
      setCameraMode('free');
    }
    if (zoom !== undefined) {
      setUserMapZoom(zoom); // zoom do usuario ao mover no mapa
    }
  };

  // Buscar paradas ao mudar os bounds
  useEffect(() => {
    if (!bounds) return;
    apiService.getStops(bounds)
      .then(setStops)
      .catch((error) => {
        //Alert.alert('Erro', 'Não foi possível carregar as paradas.');
        console.error('error ao buscar paradas', error);
      });
  }, [bounds]);

  // Buscar os onibus
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    let currentInterval = 8000;

    const fetchBuses = async () => {
      setIsFetchingBuses(true);
      if (!bounds) {
        timeout = setTimeout(fetchBuses, currentInterval);
        setIsFetchingBuses(false);
        return;
      }
      try {
        const result = await apiService.getEnhancedBuses(bounds);
        const filteredBuses = showOnlyActiveBuses
          ? result.filter(bus => bus.linha && bus.linha.trim())
          : result;

        setBuses(filteredBuses.map(bus => ({
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
        })));
        currentInterval = 8000; // Reset tempo ao sucesso
      } catch (error) {
        console.warn('Erro ao buscar ônibus', error);
        currentInterval += 1000; // Aumenta 1s a cada falha
        if (currentInterval > 30000) currentInterval = 30000; // Limite máximo de 30s (opcional)
        // debug error
        // if(error instanceof ApiError) {
        //   console.error('ApiError:', error.message, error.details);
        //   // ou
        //   // alert(JSON.stringify(error.details, null, 2));
        // } else {
        //   console.error(error);
        // }
      }
      setIsFetchingBuses(false);
      timeout = setTimeout(fetchBuses, currentInterval);
    };
    
    return () => clearTimeout(timeout);
  }, [bounds, showOnlyActiveBuses]);
  
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
          { backgroundColor: appTheme === "dark" ? "#000" : "#fff" },
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
        {/* Botões no topo direito */}
        <View style={styles.topRightButtons}>
          {/* Botão de configurações */}
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
          {/* Botão de localização */}
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
          theme={mapTheme as "light" | "dark"} // Usar tema do mapa do store
          isFetchingBuses={isFetchingBuses} // blue loading bar
          fetchDuration={intervalMs}
          // Paradas de onibus
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
            // Encontra a parada completa no array de paradas
            const fullStop = stops.find(stop => stop.id === marker.id);
            if (fullStop) {
              // Define a parada selecionada
              setSelectedStopFromMap(fullStop);
              setSelectedStopForDetail(fullStop);
              // Abre o painel se estiver fechado
              if (panelState === 0) {
                setPanelState(2);
                setPanelOpen(true);
              }
              console.log('Parada clicada no mapa:', fullStop);
            } else {
              Alert.alert("Parada", marker.title || marker.id);
            }
          }}
          // Map change
          onRegionDidChange={handleRegionDidChange}
          // Traffic
          showTraffic={showTraffic}
          // Onibus
          buses={buses}
          onBusMarkerPress={(bus) => Alert.alert("Ônibus", bus.title || bus.id)}
        />
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

      {/* Painel flutuante */}
      {panelOpen && (
        <Animated.View
          style={[
            styles.floatingPanel,
            {
              height: panelHeight,
              backgroundColor: appTheme === "dark" ? "#000" : "#fff", // Corrige cor do painel
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
              paddingTop: panelState === 2 ? insets.top + 50 : 0,
            },
          ]}
          {...panResponder.panHandlers}
        >
          {/* Só mostra o handle se NÃO estiver em tela cheia */}
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
            <View
              style={{
                flex: 1,
                justifyContent: "center",
                alignItems: "center",
                backgroundColor: appTheme === "dark" ? "#000" : "#fff",
              }}
            >
              {/* <Text style={{ color: appTheme === 'dark' ? '#fff' : '#333' }}>
                Conteúdo do painel aqui!
              </Text> */}
              <StopsPainelMenu
                stops={userMapZoom >= 15.4 ? stops : []}
                selectedStopFromMap={selectedStopFromMap}
                onStopSelected={() => setSelectedStopFromMap(null)}
              />
            </View>
          )}
        </Animated.View>
      )}

      {/* Modal de Configurações */}
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

      {/* Modal de Detalhe da Parada */}
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
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  title: {
    marginTop: 25,
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  mapContainer: {
    flex: 1,
    padding: 8,
  },
  // Botoes config e local
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
  // Botão de localização
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
  // Botão de configurações e modal
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

  // Animação do painel flutuante
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