import SettingsOptions from '@/src/components/SettingsComponent/settings.component';
import { useAppStore } from '@/src/store';
import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import DeveloperOptions from '../components/SettingsComponent/developer-settings.component';

const Settings = () => {
  const appTheme = useAppStore(state => state.appTheme);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: appTheme === 'dark' ? '#000' : '#fff' }]}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <View style={styles.brandHeader}>
            <Text style={[styles.brandTitle, { color: appTheme === 'dark' ? '#fff' : '#102a43' }]}>
              Brasília <Text style={{ color: '#007AFF' }}>Mob</Text>
            </Text>
          </View>

          <Text style={[styles.title, { color: appTheme === 'dark' ? '#fff' : '#000' }]}>Configurações</Text>
          <Text style={[styles.subtitle, { color: appTheme === 'dark' ? '#ccc' : '#666' }]}>Configurações do aplicativo</Text>
          <Text style={{ marginTop: 10 }}></Text>
          <SettingsOptions />
          <DeveloperOptions />

          <View style={styles.footerContainer}>
            <Text style={[styles.footerText, { color: appTheme === 'dark' ? '#666' : '#999' }]}>
              Brasília Mob • v1.0.0
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
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
    padding: 20,
  },
  brandHeader: {
    alignItems: 'center',
    marginTop: 15,
    marginBottom: 8,
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    letterSpacing: 0.3,
  },
  title: {
    marginTop: 15,
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
  },
  footerContainer: {
    alignItems: 'center',
    marginTop: 32,
    marginBottom: 20,
  },
  footerText: {
    fontSize: 13,
  },
});

export default Settings;
