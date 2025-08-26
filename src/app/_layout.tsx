import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from "react";
import { SafeAreaView, StyleSheet, View } from "react-native";
import BottomNavbar from "../components/NavBarComponent/bottom-navbar.component";
import { apiService } from '../services/api';
import { useAppStore } from "../store";
import Index from "./index";
import Settings from "./settings";
import StopsMenu from './stopsMenu';

const RootLayout = () => {
  const [activeTab, setActiveTab] = useState('map');
  const { appTheme } = useAppStore();

  // Cache stuff
  useEffect(() => {
    const fetchLines = async () => {
      await apiService.getLinesCached().catch(console.error);
    };
    fetchLines();
  }, []);
  useEffect(() => {
    apiService.getStopsCached().catch(console.error);
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