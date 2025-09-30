import { useStopFavorites } from '@/src/hooks/useFavorites';
import { apiService } from '@/src/services/api';
import { useAppStore } from '@/src/store';
import { BusStop, StopSchedule } from '@/src/types';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import SkeletonPlaceholder from '../common/SkeletonPlaceholder';

interface StopDetailProps {
  stop: BusStop;
  onBack: () => void;
}

const StopDetail: React.FC<StopDetailProps> = ({ stop, onBack }) => {
  const appTheme = useAppStore(state => state.appTheme);
  const [scheduleData, setScheduleData] = useState<StopSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Favorites using custom hook
  const { isFavorite, toggleFavorite } = useStopFavorites();

  // Check if the current stop is a favorite
  const isCurrentStopFavorite = stop?.id ? isFavorite(stop.id) : false;

  // Function to toggle favorite for the current stop
  const handleToggleFavorite = () => {
    if (stop?.id) {
      toggleFavorite(stop.id);
    }
  };

  const loadStopSchedule = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiService.getStopSchedule(stop);
      setScheduleData(data);
    } catch (err) {
      console.error('Erro ao carregar horários da parada:', err);
      setError('Erro ao carregar horários da parada');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        const data = await apiService.getStopSchedule(stop);
        setScheduleData(data);
      } catch (err) {
        console.error('Erro ao carregar horários da parada:', err);
        setError('Erro ao carregar horários da parada');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [stop]);

  const formatSchedule = (time: string) => {
    return time.substring(0, 5); // Remove seconds if present
  };

  const getCurrentDaySchedules = (schedules: any[]) => {
    const now = new Date();
    const currentDayIndex = now.getDay(); // 0 = Sunday, 1 = Monday, etc.

    return schedules.filter(schedule =>
      schedule.dias_semana[currentDayIndex] === 'S'
    );
  };

  const getNextSchedules = (schedules: any[], limit = 5) => {
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();

    const todaySchedules = getCurrentDaySchedules(schedules)
      .map(schedule => {
        const [hours, minutes] = schedule.hr_prevista.split(':').map(Number);
        const scheduleTime = hours * 60 + minutes;
        return { ...schedule, scheduleTime };
      })
      .filter(schedule => schedule.scheduleTime > currentTime)
      .sort((a, b) => a.scheduleTime - b.scheduleTime);

    return todaySchedules.slice(0, limit);
  };

  if (loading) {
    const isDark = appTheme === 'dark';

    return (
      <View style={[styles.container, { backgroundColor: isDark ? '#000' : '#fff' }]}> 
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <MaterialIcons
              name="arrow-back"
              size={24}
              color={isDark ? '#fff' : '#000'}
            />
          </TouchableOpacity>
          <View style={styles.headerInfo}>
            <SkeletonPlaceholder width="70%" height={18} isDark={isDark} />
            <SkeletonPlaceholder width="45%" height={14} style={{ marginTop: 6 }} isDark={isDark} />
          </View>
          <SkeletonPlaceholder width={40} height={40} borderRadius={20} isDark={isDark} />
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {Array.from({ length: 4 }).map((_, index) => (
            <View
              key={`skeleton-line-${index}`}
              style={{
                padding: 12,
                borderRadius: 12,
                marginBottom: 12,
                borderWidth: 1,
                borderColor: isDark ? '#222' : '#eee',
                backgroundColor: isDark ? '#131313' : '#f6f7f8',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                <SkeletonPlaceholder width={32} height={32} borderRadius={8} isDark={isDark} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <SkeletonPlaceholder width="50%" height={16} isDark={isDark} />
                  <SkeletonPlaceholder width="35%" height={14} style={{ marginTop: 6 }} isDark={isDark} />
                </View>
              </View>
              <SkeletonPlaceholder width="100%" height={44} borderRadius={10} isDark={isDark} />
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: appTheme === 'dark' ? '#000' : '#fff' }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <MaterialIcons
              name="arrow-back"
              size={24}
              color={appTheme === 'dark' ? '#fff' : '#000'}
            />
          </TouchableOpacity>
          <View style={styles.headerInfo}>
            <Text style={[styles.headerTitle, { color: appTheme === 'dark' ? '#fff' : '#000' }]}>
              {stop.nome || stop.descricao}
            </Text>
            <Text style={[styles.headerSubtitle, { color: appTheme === 'dark' ? '#aaa' : '#666' }]}>
              Código: {stop.codigo}
            </Text>
          </View>
          <TouchableOpacity
            onPress={handleToggleFavorite}
            style={[
              styles.favoriteButton,
              isCurrentStopFavorite
                ? { backgroundColor: '#FFD600', borderColor: '#FFD600' }
                : { backgroundColor: 'transparent', borderColor: '#007AFF', borderWidth: 2 }
            ]}
            activeOpacity={0.7}
          >
            <MaterialIcons
              name={isCurrentStopFavorite ? "bookmark" : "bookmark-outline"}
              size={28}
              color={isCurrentStopFavorite ? '#fff' : '#007AFF'}
            />
          </TouchableOpacity>
        </View>
        <View style={styles.centerContent}>
          <MaterialIcons name="error" size={48} color="#ff4444" />
          <Text style={[styles.errorText, { color: appTheme === 'dark' ? '#aaa' : '#666' }]}>
            {error}
          </Text>
          <TouchableOpacity onPress={loadStopSchedule} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Tentar novamente</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: appTheme === 'dark' ? '#000' : '#fff' }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <MaterialIcons
            name="arrow-back"
            size={24}
            color={appTheme === 'dark' ? '#fff' : '#000'}
          />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={[styles.headerTitle, { color: appTheme === 'dark' ? '#fff' : '#000' }]}>
            {stop.nome || stop.descricao}
          </Text>
          <Text style={[styles.headerSubtitle, { color: appTheme === 'dark' ? '#aaa' : '#666' }]}>
            Código: {stop.codigo}
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleToggleFavorite}
          style={[
            styles.favoriteButton,
            isCurrentStopFavorite
              ? { backgroundColor: '#FFD600', borderColor: '#FFD600' }
              : { backgroundColor: 'transparent', borderColor: '#007AFF', borderWidth: 2 }
          ]}
          activeOpacity={0.7}
        >
          <MaterialIcons
            name={isCurrentStopFavorite ? "bookmark" : "bookmark-outline"}
            size={28}
            color={isCurrentStopFavorite ? '#fff' : '#007AFF'}
          />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {scheduleData && scheduleData.lines.length > 0 ? (
          scheduleData.lines.map((lineData, index) => {
            const quantidadeHorarios = 1;
            const nextSchedules = getNextSchedules(lineData.schedules, quantidadeHorarios);
            return (
              <View
                key={index}
                style={[
                  styles.lineCard,
                  {
                    backgroundColor: appTheme === 'dark' ? '#181818' : '#f9f9f9',
                    borderColor: appTheme === 'dark' ? '#333' : '#eee'
                  }
                ]}
              >
                <View style={styles.lineHeader}>
                  <MaterialIcons name="directions-bus" size={24} color="#007AFF" />
                  <View style={styles.lineInfo}>
                    <Text style={[styles.lineTitle, { color: appTheme === 'dark' ? '#fff' : '#000' }]}>
                      Linha {lineData.line.codigo}
                    </Text>
                  </View>
                  <View style={styles.schedulesContainer}>
                    {nextSchedules.length > 0 ? (
                      nextSchedules.map((schedule, scheduleIndex) => {
                        // Calculate time difference
                        const now = new Date();
                        const [h, m] = schedule.hr_prevista.split(':').map(Number);
                        const scheduleDate = new Date(now);
                        scheduleDate.setHours(h, m, 0, 0);
                        let diff = Math.round((scheduleDate.getTime() - now.getTime()) / 60000);
                        let displayTime = '';
                        if (diff > 60) {
                          displayTime = formatSchedule(schedule.hr_prevista);
                        } else if (diff >= 0) {
                          displayTime = `${diff} min`;
                        } else {
                          displayTime = formatSchedule(schedule.hr_prevista);
                        }

                        return (
                          <View key={scheduleIndex} style={styles.scheduleRow}>
                            <View style={styles.timeBox}>
                              <Text style={styles.timeBoxText}>{displayTime}</Text>
                            </View>
                          </View>
                        );
                      })
                    ) : (
                      <View style={styles.noSchedulesContainer}>
                        <Text style={[styles.noSchedulesText, { color: appTheme === 'dark' ? '#aaa' : '#666' }]}>
                          Nenhum horário disponível para esta linha
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* <TouchableOpacity 
                  style={styles.viewAllButton}
                  onPress={() => {
                    console.log('Ver todos os horários para linha:', lineData.line.codigo);
                  }}
                >
                  <Text style={styles.viewAllButtonText}>Ver todos os horários</Text>
                  <MaterialIcons name="chevron-right" size={20} color="#007AFF" />
                </TouchableOpacity> */}
              </View>
            );
          })
        ) : (
          <View style={styles.centerContent}>
            <MaterialIcons name="info" size={48} color="#007AFF" />
            <Text style={[styles.noDataText, { color: appTheme === 'dark' ? '#aaa' : '#666' }]}>
              {scheduleData ?
                `Nenhuma linha encontrada para a parada ${stop.codigo}` :
                'Carregando dados de horários...'
              }
            </Text>
            <Text style={[styles.noDataSubtext, { color: appTheme === 'dark' ? '#777' : '#999' }]}>
              {scheduleData ?
                'Pode ser que esta parada não tenha linhas ativas ou os dados de proximidade precisem ser ajustados.' :
                'Aguarde enquanto verificamos as linhas e horários...'
              }
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    fontSize: 14,
    marginTop: 2,
  },
  content: {
    flex: 1,
    padding: 10,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  errorText: {
    marginTop: 16,
    fontSize: 16,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#007AFF',
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  lineCard: {
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
  },
  lineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  lineInfo: {
    marginLeft: 8,
    flex: 1,
  },
  lineTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  lineSubtitle: {
    fontSize: 14,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  schedulesContainer: {
    marginBottom: 12,
  },
  scheduleItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  timeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  scheduleTime: {
    fontSize: 18,
    fontWeight: 'bold',
    marginRight: 8,
  },
  scheduleDirection: {
    fontSize: 14,
  },
  scheduleDays: {
    fontSize: 12,
  },
  noSchedulesContainer: {
    padding: 16,
    alignItems: 'center',
  },
  noSchedulesText: {
    fontSize: 14,
    fontStyle: 'italic',
  },
  viewAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  viewAllButtonText: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '600',
    marginRight: 4,
  },
  noDataText: {
    fontSize: 18,
    textAlign: 'center',
    marginTop: 16,
  },
  noDataSubtext: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  lineInfoLeft: {
    flex: 1,
  },
  timeBox: {
    minWidth: 56,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#007AFF',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeBoxText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  favoriteButton: {
    marginLeft: 12,
    borderWidth: 2,
    borderRadius: 20,
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default StopDetail;
