import SkeletonPlaceholder from '@/src/components/common/SkeletonPlaceholder';
import { useAppStore } from '@/src/store';
import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';


const StopsMenu = () => {
  const { appTheme, loading, stops } = useAppStore(state => ({
    appTheme: state.appTheme,
    loading: state.loading,
    stops: state.stops,
  }));
  const isLoading = loading.stops || stops.length === 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: appTheme === 'dark' ? '#000' : '#fff' }]}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <Text style={[styles.title, { color: appTheme === 'dark' ? '#fff' : '#000' }]}>Paradas</Text>
          <Text style={[styles.subtitle, { color: appTheme === 'dark' ? '#ccc' : '#666' }]}>Paradas de onibus</Text>
          <Text style={{ marginTop: 10 }}></Text>
          {isLoading ? (
            <View style={{ marginTop: 12 }}>
              {Array.from({ length: 6 }).map((_, index) => (
                <View
                  key={`stops-skeleton-${index}`}
                  style={{
                    padding: 16,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: appTheme === 'dark' ? '#222' : '#ededed',
                    backgroundColor: appTheme === 'dark' ? '#111' : '#f7f8f9',
                    marginBottom: 12,
                  }}
                >
                  <SkeletonPlaceholder width="50%" height={18} isDark={appTheme === 'dark'} />
                  <SkeletonPlaceholder
                    width="30%"
                    height={14}
                    style={{ marginTop: 8 }}
                    isDark={appTheme === 'dark'}
                  />
                  <SkeletonPlaceholder
                    width="70%"
                    height={12}
                    style={{ marginTop: 12 }}
                    isDark={appTheme === 'dark'}
                  />
                </View>
              ))}
            </View>
          ) : (
            <View style={{ marginTop: 16 }}>
              <Text style={{ color: appTheme === 'dark' ? '#aaa' : '#666', fontSize: 14 }}>
                Selecione uma parada no mapa para ver detalhes.
              </Text>
            </View>
          )}
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

export default StopsMenu;
