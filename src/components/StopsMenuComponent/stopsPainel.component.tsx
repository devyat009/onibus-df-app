import { useAppStore } from "@/src/store";
import { CACHE_KEYS, getCacheData } from "@/src/utils/cacheManager";
import { MaterialIcons } from "@expo/vector-icons";
import React, { useEffect } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

interface StopsPainelMenuBasicProps {
  stops?: any[];
}
const StopsPainelMenu: React.FC<StopsPainelMenuBasicProps> = ({
  stops,
}) => {
  const appTheme = useAppStore((state) => state.appTheme);
  const [activeTab, setActiveTab] = React.useState<"nearby" | "favorites">(
    "nearby"
  );

  const isNearbyActive = activeTab === "nearby";
  const isFavoritesActive = activeTab === "favorites";

  const setTab = (tab: "nearby" | "favorites") => setActiveTab(tab);
  const tabBackground = appTheme === "dark" ? "#222" : "#f2f2f2";

  const [busLines, setBusLines] = React.useState<any[]>([]);
  const [busHorarios, setBusHorarios] = React.useState<any[]>([]);

  // Get horarios from cache
  useEffect(() => {
    async function fetchHorariosFromCache() {
      const horarios = await getCacheData(CACHE_KEYS.BUS_HORARIO);
      setBusHorarios(Array.isArray(horarios) ? horarios : []);
    }

    fetchHorariosFromCache();
  }, []);

  // Get lines from Cache
  useEffect(() => {
    async function fetchLinesFromCache() {
      const lines = await getCacheData(CACHE_KEYS.LINES);
      setBusLines(Array.isArray(lines) ? lines : []);
      //console.log('lines from cache:', lines);
    }
    fetchLinesFromCache();
  }, []);

  useEffect(() => {
    console.log('stops from index:', stops?.length);
    console.log('horarios:', busHorarios?.length);
  }, [stops, busHorarios]);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: appTheme === "dark" ? "#000" : "#fff" },
      ]}
    >
      <View style={[styles.tabsContainer, { backgroundColor: tabBackground }]}>
        <TouchableOpacity
          style={[styles.tab, isNearbyActive && styles.tabActive]}
          onPress={() => setTab("nearby")}
        >
          <Text
            style={[
              styles.tabText,
              { color: appTheme === "dark" ? "#aaa" : "#666" },
              isNearbyActive && styles.tabTextActive,
            ]}
          >
            Proximas
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, isFavoritesActive && styles.tabActive]}
          onPress={() => setTab("favorites")}
        >
          <Text
            style={[
              styles.tabText,
              { color: appTheme === "dark" ? "#aaa" : "#666" },
              isFavoritesActive && styles.tabTextActive,
            ]}
          >
            Favoritas
          </Text>
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {isNearbyActive && stops && stops.length > 0 ? (
          stops.map((stop) => {
            // Bus lines for this stop (ajuste conforme sua estrutura)
            const stopLines = busLines
              .filter((line) => line.paradas?.includes(stop.codigo))
              .map((line) => line.linha)
              .join(", ");

            return (
              <View
                key={stop.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  padding: 14,
                  borderBottomWidth: 1,
                  backgroundColor: appTheme === "dark" ? "#181818" : "#f9f9f9",
                  borderColor: 'none',
                  borderRadius: 8,
                  marginHorizontal: 8,
                  marginVertical: 6,
                  shadowColor: "#000",
                  shadowOpacity: 0.05,
                  shadowRadius: 2,
                  elevation: 1,
                }}
              >
                <MaterialIcons name="directions-bus" size={32} color="#007AFF" style={{ marginRight: 12 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "bold", fontSize: 16, color: appTheme === "dark" ? "#fff" : "#222" }}>
                    {stop.nome || stop.descricao}
                  </Text>
                  <Text style={{ color: "#888", fontSize: 13, marginTop: 2 }}>
                    Código: {String(stop.codigo)}
                  </Text>
                  {stop.descricao && (
                    <Text style={{ color: "#aaa", fontSize: 12, marginTop: 2 }}>
                      {stop.descricao}
                    </Text>
                  )}
                  {stopLines && (
                    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4 }}>
                      <MaterialIcons name="confirmation-number" size={16} color="#007AFF" />
                      <Text style={{ color: "#007AFF", fontSize: 13, marginLeft: 4 }}>
                        {stopLines}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })
        ) : isNearbyActive && busLines.length === 0 ? (
          <Text style={{ padding: 16, color: "#888" }}>Carregando linhas...</Text>
        ) : isNearbyActive ? (
          <Text style={{ padding: 16, color: "#888" }}>Nenhuma parada próxima encontrada, aproxime mais o mapa.</Text>
        ) : null}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    flex: 1,
    //padding: 20,
  },
  tabsContainer: {
    flexDirection: "row",
    // borderTopLeftRadius: 12,
    // borderTopRightRadius: 12,
    overflow: "hidden",
    //marginTop: 25,
    minHeight: 48, // garante altura mínima
    width: "100%",
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  tabActive: {
    borderBottomWidth: 3,
    borderBottomColor: "#007AFF", // cor da barra ativa
  },
  tabText: {
    fontWeight: "bold",
    fontSize: 16,
  },
  tabTextActive: {
    color: "#007AFF",
  },
});

export default StopsPainelMenu;
