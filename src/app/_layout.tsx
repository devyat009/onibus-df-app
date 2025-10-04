import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from "react";
import { SafeAreaView, StyleSheet, View } from "react-native";
import BottomNavbar from "../components/NavBarComponent/bottom-navbar.component";
import { busService, frotaService, stopService } from '../services/api';
import { useAppStore } from "../store";
import Index from "./index";
import Settings from "./settings";
import StopsMenu from './stopsMenu';

const RootLayout = () => {
  const [activeTab, setActiveTab] = useState('map');
  // Lazy mounting flags so we only mount other tabs when first accessed
  const [mountedSettings, setMountedSettings] = useState(false);
  const [mountedStops, setMountedStops] = useState(false);
  const { appTheme } = useAppStore();

  // Pre-fetch essential data on mount and cache it
  useEffect(() => {
    const fetchData = async () => {
      await Promise.all([
        busService.getLinesV2Cached().catch(console.error),
        stopService.getHorarioV2Cached().catch(console.error),
        frotaService.getFrotaCached().catch(console.error),
      ]);
    };
    fetchData();
  }, []);

  // Mark tabs as mounted when user first visits them
  useEffect(() => {
    if (activeTab === 'settings' && !mountedSettings) setMountedSettings(true);
    if (activeTab === 'stops' && !mountedStops) setMountedStops(true);
  }, [activeTab, mountedSettings, mountedStops]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style={appTheme === 'dark' ? 'light' : 'dark'} hidden={false} />
      <View style={styles.content}>
        {/* Keep screens mounted to preserve internal state (Map, etc.) */}
        <View style={[styles.screen, activeTab === 'map' && styles.screenVisible]}>
          <Index />
        </View>
        <View style={[styles.screen, activeTab === 'settings' && styles.screenVisible]}>
          {mountedSettings && <Settings />}
        </View>
        <View style={[styles.screen, activeTab === 'stops' && styles.screenVisible]}>
          {mountedStops && <StopsMenu />}
        </View>
      </View>
      <BottomNavbar onTabChange={setActiveTab} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  content: {
    flex: 1,
  },
  screen: {
    flex: 1,
    display: 'none',
  },
  screenVisible: {
    display: 'flex',
  },
});

export default RootLayout;