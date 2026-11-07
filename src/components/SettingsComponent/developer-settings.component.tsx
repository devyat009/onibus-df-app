import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { LayoutAnimation, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, UIManager, View } from 'react-native';
import { busService, frotaService, stopService } from '../../services/api';
import { wazeTrafficService } from '../../services/wazeApi';
import { useAppStore } from '../../store';
import { clearAllCache } from '../../utils/cacheManager';
import SkeletonPlaceholder from '../common/SkeletonPlaceholder';

type UrlKey = 'buses' | 'stops' | 'lines' | 'frota' | 'busesEnhanced' | 'wazeTraffic';
interface UrlItem {
  key: UrlKey;
  label: string;
  description?: string;
  requiresBounds?: boolean;
}

// Boundaries of Distrito Federal, Brazil
const DEFAULT_BOUNDS = {
  north: -15.4300, // Extreme north of DF
  south: -16.0600, // Extreme south of DF
  east: -47.3300,  // Extreme east of DF
  west: -48.1200,  // Extreme west of DF
};

const URLS: UrlItem[] = [
  {
    key: 'buses',
    label: 'Ônibus (Filtrado)',
    description: 'Ônibus filtrados por tempo (30min ou sem filtro)',
  },
  {
    key: 'busesEnhanced',
    label: 'Ônibus Enhanced',
    description: 'Ônibus com dados de operadora',
  },
  {
    key: 'stops',
    label: 'Paradas',
    description: 'Paradas de ônibus da região',
    requiresBounds: true,
  },
  {
    key: 'lines',
    label: 'Linhas',
    description: 'Rotas/linhas de ônibus',
  },
  {
    key: 'frota',
    label: 'Frota (Cached)',
    description: 'Dados da frota de operadoras',
  },
  {
    key: 'wazeTraffic',
    label: 'Waze Trânsito',
    description: 'Dados de trânsito do Waze',
    requiresBounds: true,
  },
];

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const DeveloperOptions = () => {
  const appTheme = useAppStore(state => state.appTheme);
  const busTimeFilter = useAppStore(state => state.busTimeFilter);
  const setBusTimeFilter = useAppStore(state => state.setBusTimeFilter);
  const [expanded, setExpanded] = useState(false);
  const [results, setResults] = useState<Partial<Record<UrlKey, 'success' | 'error' | 'loading'>>>({});
  const [logs, setLogs] = useState<Partial<Record<UrlKey, string>>>({});
  const [previewData, setPreviewData] = useState<Partial<Record<UrlKey, any>>>({});
  const [showPreview, setShowPreview] = useState<{ key: UrlKey | null, visible: boolean }>({ key: null, visible: false });

  const toggleExpand = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(!expanded);
  };

  const fetchAndPreview = async (key: UrlKey) => {
    setResults(r => ({ ...r, [key]: 'loading' }));
    setLogs(l => ({ ...l, [key]: '' }));
    try {
      let data: any;
      const startTime = Date.now();

      switch (key) {
        case 'buses':
          // Use the store value to determine the filter
          data = await busService.getBuses(undefined, busTimeFilter);
          break;

        case 'busesEnhanced':
          // Use the store value to determine the filter
          data = await busService.getEnhancedBuses(undefined, busTimeFilter);
          break;

        case 'stops':
          data = await stopService.getStops(DEFAULT_BOUNDS);
          break;

        case 'lines':
          data = await busService.getLinesCached();
          break;

        case 'frota':
          data = await frotaService.getFrotaCached();
          break;

        case 'wazeTraffic':
          data = await wazeTrafficService.getTrafficJams(DEFAULT_BOUNDS);
          break;

        default:
          throw new Error('Endpoint não implementado');
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      setResults(r => ({ ...r, [key]: 'success' }));

      // Create detailed message based on data type
      let logMessage = `Sucesso! ${Array.isArray(data) ? data.length : 'N/A'} items em ${duration}ms`;
      if (key === 'buses') {
        logMessage += ` (Filtro: ${busTimeFilter})`;
      }

      setLogs(l => ({ ...l, [key]: logMessage }));
      setPreviewData(d => ({ ...d, [key]: data }));

    } catch (e) {
      setResults(r => ({ ...r, [key]: 'error' }));
      setLogs(l => ({ ...l, [key]: String(e) }));
      setPreviewData(d => ({ ...d, [key]: null }));
    }
  };

  const getPreviewTitle = (key: UrlKey | null) => {
    switch (key) {
      case 'buses': return 'Preview dos Ônibus';
      case 'busesEnhanced': return 'Preview dos Ônibus (Enhanced)';
      case 'stops': return 'Preview das Paradas';
      case 'lines': return 'Preview das Linhas';
      case 'frota': return 'Preview da Frota';
      case 'wazeTraffic': return 'Preview do Trânsito (Waze)';
      default: return 'Preview';
    }
  };

  return (
    <View>
      {/* Developer Options */}
      <TouchableOpacity onPress={toggleExpand} style={[styles.option, {
        borderBottomColor: appTheme === 'dark' ? '#333' : '#eee',
        backgroundColor: appTheme === 'dark' ? '#000' : '#fff'
      }]}>
        <Text style={[styles.optionText, { color: appTheme === 'dark' ? '#fff' : '#333' }]}>Opções de Desenvolvedor</Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={24}
          color={appTheme === 'dark' ? '#ccc' : '#666'}
        />
      </TouchableOpacity>
      {expanded && (
        <View style={[styles.expandedContent, { backgroundColor: appTheme === 'dark' ? '#111' : '#f9f9f9' }]}>

          {/* Toggle for bus filter */}
          <View style={styles.toggleRow}>
            <Text style={[styles.toggleText, { color: appTheme === 'dark' ? '#fff' : '#333' }]}>
              Filtro Ônibus: {busTimeFilter === '30min' ? '30 minutos' : 'Sem filtro'}
            </Text>
            <Switch
              value={busTimeFilter === '30min'}
              onValueChange={(value) => setBusTimeFilter(value ? '30min' : '24h')}
              trackColor={{
                false: "#767577",
                true: appTheme === 'dark' ? "#81b0ff" : "#81b0ff",
              }}
              thumbColor={busTimeFilter === '30min' ? "#007AFF" : "#f4f3f4"}
            />
          </View>

          {URLS.map(({ key, label, description }) => (
            <View key={key} style={styles.urlRow}>
              <View style={styles.buttonContainer}>
                <TouchableOpacity
                  style={[
                    styles.urlButton,
                    { backgroundColor: appTheme === 'dark' ? '#333' : '#007AFF' }
                  ]}
                  onPress={() => fetchAndPreview(key)}
                >
                  <Text style={styles.urlButtonText}>{label}</Text>
                </TouchableOpacity>
                {description && (
                  <Text style={[styles.descriptionText, { color: appTheme === 'dark' ? '#aaa' : '#666' }]}>
                    {description}
                  </Text>
                )}
              </View>
              <View style={styles.statusContainer}>
                {results[key] === 'loading' ? (
                  <View style={{ width: 120, alignItems: 'flex-end' }}>
                    <SkeletonPlaceholder
                      width="80%"
                      height={12}
                      isDark={appTheme === 'dark'}
                    />
                  </View>
                ) : (
                  <Text style={{
                    color: results[key] === 'success' ? '#4CAF50' : results[key] === 'error' ? '#F44336' : (appTheme === 'dark' ? '#ccc' : '#888'),
                    fontSize: 12,
                    textAlign: 'right',
                  }}>
                    {results[key] === 'success' && logs[key]}
                    {results[key] === 'error' && 'Erro'}
                  </Text>
                )}
                {results[key] === 'error' && (
                  <TouchableOpacity onPress={() => alert(logs[key])}>
                    <Text style={[styles.logLink, { color: appTheme === 'dark' ? '#ff6b6b' : '#c30505' }]}>Ver log</Text>
                  </TouchableOpacity>
                )}
                {results[key] === 'success' && previewData[key] && (
                  <TouchableOpacity onPress={() => setShowPreview({ key, visible: true })}>
                    <Text style={[styles.logLink, { color: appTheme === 'dark' ? '#64B5F6' : '#1976D2' }]}>Preview</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}

          {/* Button to clear cache */}
          <TouchableOpacity
            style={[
              styles.clearCacheButton,
              { backgroundColor: appTheme === 'dark' ? '#c30505' : '#ff5252' }
            ]}
            onPress={async () => {
              await clearAllCache();
              alert('Cache limpo com sucesso!');
            }}
          >
            <Ionicons name="trash-outline" size={18} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.clearCacheButtonText}>Limpar Cache</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Preview modal */}
      <Modal
        visible={showPreview.visible && !!showPreview.key}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowPreview({ key: null, visible: false })}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: appTheme === 'dark' ? '#222' : '#fff' }]}>
            <Text style={[styles.modalTitle, { color: appTheme === 'dark' ? '#fff' : '#000' }]}>{getPreviewTitle(showPreview.key)}</Text>
            <ScrollView style={{ maxHeight: 400 }}>
              {Array.isArray(previewData[showPreview.key as UrlKey]) ? (
                previewData[showPreview.key as UrlKey]?.slice(0, 5).map((item: any, idx: number) => (
                  <View key={idx} style={[styles.featureBox, { backgroundColor: appTheme === 'dark' ? '#333' : '#f3f3f3' }]}>
                    <Text style={[styles.featureTitle, { color: appTheme === 'dark' ? '#fff' : '#000' }]}>
                      {`${getPreviewTitle(showPreview.key).replace('Preview ', '').replace('dos ', '').replace('das ', '').replace('da ', '')} #${idx + 1}`}
                    </Text>
                    <Text style={[styles.featureText, { color: appTheme === 'dark' ? '#ccc' : '#222' }]}>
                      {JSON.stringify(item, null, 2)}
                    </Text>
                  </View>
                ))
              ) : (
                <View style={[styles.featureBox, { backgroundColor: appTheme === 'dark' ? '#333' : '#f3f3f3' }]}>
                  <Text style={[styles.featureTitle, { color: appTheme === 'dark' ? '#fff' : '#000' }]}>Dados completos</Text>
                  <Text style={[styles.featureText, { color: appTheme === 'dark' ? '#ccc' : '#222' }]}>
                    {JSON.stringify(previewData[showPreview.key as UrlKey], null, 2)}
                  </Text>
                </View>
              )}
              {Array.isArray(previewData[showPreview.key as UrlKey]) && !previewData[showPreview.key as UrlKey]?.length && (
                <Text style={[styles.featureText, { color: appTheme === 'dark' ? '#ccc' : '#222' }]}>Nenhum dado encontrado.</Text>
              )}
            </ScrollView>
            <Pressable style={styles.closeButton} onPress={() => setShowPreview({ key: null, visible: false })}>
              <Text style={styles.closeButtonText}>Fechar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  option: {
    padding: 12,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  optionText: {
    fontSize: 16,
  },
  expandedContent: {
    padding: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 8,
  },
  toggleText: {
    fontSize: 16,
    fontWeight: '500',
  },
  urlRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 12,
  },
  buttonContainer: {
    flex: 1,
  },
  urlButton: {
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 6,
    alignItems: 'center',
    marginBottom: 4,
    width: '50%',
  },
  urlButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  descriptionText: {
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 2,
  },
  statusContainer: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    minWidth: 120,
  },
  logLink: {
    marginTop: 4,
    textDecorationLine: 'underline',
    fontSize: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    borderRadius: 12,
    padding: 20,
    width: '90%',
    maxWidth: 400,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  featureBox: {
    marginBottom: 14,
    borderRadius: 8,
    padding: 8,
  },
  featureTitle: {
    fontWeight: 'bold',
    marginBottom: 2,
  },
  featureText: {
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  closeButton: {
    marginTop: 16,
    alignSelf: 'center',
    backgroundColor: '#1f6feb',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 24,
  },
  closeButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  clearCacheButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  clearCacheButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default DeveloperOptions;