import { useAppStore } from "@/src/store";
import React from "react";
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
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
      ></ScrollView>
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
