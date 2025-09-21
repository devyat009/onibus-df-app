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
          <Text style={[styles.title, { color: appTheme === 'dark' ? '#fff' : '#000' }]}>Configurações</Text>
          <Text style={[styles.subtitle, { color: appTheme === 'dark' ? '#ccc' : '#666' }]}>Configurações do aplicativo</Text>
          <Text style={{ marginTop: 10 }}></Text>
          <SettingsOptions />
          <DeveloperOptions />
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
  title: {
    marginTop: 25,
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
  },
});

export default Settings;
