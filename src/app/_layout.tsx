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

  const renderActiveScreen = () => {
    switch (activeTab) {
      case 'settings':
        return <Settings />;
      case 'stops':
        return <StopsMenu />;
      default:
        return <Index />;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style={appTheme === 'dark' ? 'light' : 'dark'} hidden={false} />
      <View style={styles.content}>
        {renderActiveScreen()}
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
});

export default RootLayout;