import { useStopFavorites } from '@/src/hooks/useFavorites';
import { apiService } from '@/src/services/api';
import { useAppStore } from '@/src/store';
import { BusStop, StopScheduleV2 } from '@/src/types';
import { FontAwesome5, MaterialIcons } from '@expo/vector-icons';
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
  const [scheduleData, setScheduleData] = useState<StopScheduleV2 | null>(null);
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
      const data = await apiService.getStopScheduleV2(stop);
      // console.log('[STOPDETAIL] Loaded stop schedule V2:', data);
      setScheduleData(data);
    } catch (err) {
      console.error('Erro ao carregar horários da parada (loadStopSchedule):', err);
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

        const data = await apiService.getStopScheduleV2(stop);
        console.warn('[STOPDETAIL2] Loaded stop schedule V2:', data.lines[0]);
        setScheduleData(data);
      } catch (err) {
        console.error('Erro ao carregar horários da parada (loadData):', err);
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

  const getNextSchedules = (horarios: any[], limit = 5) => {
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();
    const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

    // Map day of week to dias_semana index
    // dias_semana format: "SSSSSNN" (Mon, Tue, Wed, Thu, Fri, Sat, Sun)
    const dayIndex = currentDay === 0 ? 6 : currentDay - 1;

    // Filter and process all schedules for today
    const todaySchedules = horarios
      .filter(schedule => {
        // Check if schedule object is valid
        if (!schedule || typeof schedule !== 'object' || !schedule.horario) {
          return false;
        }
        // Check if this schedule applies to the current day
        if (schedule.dias_semana && schedule.dias_semana.length === 7) {
          return schedule.dias_semana[dayIndex] === 'S';
        }
        return false; // If no dias_semana info, exclude it to ensure only today's schedules
      })
      .map(schedule => {
        const timeStr = schedule.horario;
        const [hours, minutes] = timeStr.split(':').map(Number);
        const scheduleTime = hours * 60 + minutes;
        return { 
          hr_prevista: timeStr, 
          scheduleTime, 
          dia_label: schedule.dia_label,
          isPast: scheduleTime <= currentTime 
        };
      })
      .filter(schedule => !isNaN(schedule.scheduleTime))
      .sort((a, b) => a.scheduleTime - b.scheduleTime);

    // Separate future and past schedules
    const futureSchedules = todaySchedules.filter(s => !s.isPast);
    const pastSchedules = todaySchedules.filter(s => s.isPast);

    // If we have future schedules, return them
    if (futureSchedules.length > 0) {
      return futureSchedules.slice(0, limit);
    }

    // If no future schedules, return the last past schedules (showing what already passed)
    return pastSchedules.slice(-limit);
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
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 }}>
                {/* Bus icon */}
                <SkeletonPlaceholder width={24} height={24} borderRadius={4} isDark={isDark} />
                
                {/* Line title */}
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <SkeletonPlaceholder width="40%" height={16} isDark={isDark} />
                </View>

                {/* Route icon and time squares side by side */}
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                  {/* Route button skeleton */}
                  <View style={{ alignItems: 'center' }}>
                    <SkeletonPlaceholder width={60} height={40} borderRadius={12} isDark={isDark} />
                  </View>

                  {/* Time square and next schedules skeleton */}
                  <View style={{ alignItems: 'center' }}>
                    <SkeletonPlaceholder width={60} height={40} borderRadius={12} isDark={isDark} />
                    <View style={{ marginTop: 8 }}>
                      <SkeletonPlaceholder width={80} height={12} borderRadius={6} isDark={isDark} />
                    </View>
                  </View>
                </View>
              </View>
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
          (() => {
            // Process all lines and their schedules
            const linesWithSchedules = scheduleData.lines.map((lineData, index) => {
              const quantidadeHorarios = 3;
              const allHorarios = lineData.schedules.flatMap(schedule => schedule.horarios);
              const nextSchedules = getNextSchedules(allHorarios, quantidadeHorarios);
              const hasFutureSchedules = nextSchedules.length > 0 && !nextSchedules[0].isPast;
              
              return {
                lineData,
                index,
                nextSchedules,
                hasFutureSchedules,
              };
            });

            // Sort: lines with future schedules first, then lines with past schedules
            const sortedLines = linesWithSchedules.sort((a, b) => {
              if (a.hasFutureSchedules && !b.hasFutureSchedules) return -1;
              if (!a.hasFutureSchedules && b.hasFutureSchedules) return 1;
              return 0;
            });

            return sortedLines.map(({ lineData, index, nextSchedules }) => (
              <View
                key={`line-${lineData.line.numero}-${lineData.line.sentido}-${index}`}
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
                      Linha {lineData.line.numero}
                    </Text>
                  </View>

                  <View style={styles.schedulesContainer}>
                    {nextSchedules.length > 0 ? (
                      <View style={styles.compactScheduleCard}>
                        {/* Route icon and Main schedule - side by side */}
                        {(() => {
                          const schedule = nextSchedules[0];
                          const now = new Date();
                          const [h, m] = schedule.hr_prevista.split(':').map(Number);
                          const scheduleDate = new Date(now);
                          scheduleDate.setHours(h, m, 0, 0);
                          let diff = Math.round((scheduleDate.getTime() - now.getTime()) / 60000);
                          let isMinutes = diff >= 0 && diff <= 60;
                          let isPast = schedule.isPast || false;
                          let mainNumber = isMinutes ? diff.toString() : formatSchedule(schedule.hr_prevista);

                          return (
                            <>
                              <View style={styles.scheduleRowContainer}>
                                {/* Route button */}
                                <View style={styles.routeButtonBox}>
                                  <TouchableOpacity
                                    style={[
                                      styles.routeIconSquare,
                                      { backgroundColor: appTheme === 'dark' ? '#242424ff' : '#f0f0f0' }
                                    ]}
                                    onPress={() => {
                                      console.log('see route:', lineData.line.numero);
                                    }}
                                  >
                                    <FontAwesome5 name="route" size={18} color="#007AFF" solid />
                                  </TouchableOpacity>
                                </View>

                                {/* Time square */}
                                <View style={styles.mainScheduleBox}>
                                  <View style={[
                                    styles.mainTimeSquare,
                                    { 
                                      backgroundColor: isPast 
                                        ? (appTheme === 'dark' ? '#1a1a1a' : '#e8e8e8')
                                        : (appTheme === 'dark' ? '#242424ff' : '#f0f0f0')
                                    }
                                  ]}>
                                    <Text style={[
                                      styles.mainTimeNumber, 
                                      { color: isPast ? '#999' : '#666' }
                                    ]}>
                                      {mainNumber}
                                    </Text>
                                    {isMinutes && !isPast && (
                                      <Text style={[styles.mainTimeUnit, { color: '#666' }]}>min</Text>
                                    )}
                                  </View>
                                  
                                  {/* Label if past schedule */}
                                  {isPast && (
                                    <View style={styles.pastScheduleLabelContainer}>
                                      <Text style={[styles.pastScheduleLabel, { color: '#999' }]}>
                                        já passou
                                      </Text>
                                    </View>
                                  )}
                                  
                                  {/* Next schedules below */}
                                  {nextSchedules.length > 1 && !isPast && (
                                    <View style={styles.nextSchedulesContainer}>
                                      <Text style={[styles.nextScheduleText, { color: '#666' }]}>
                                        {(() => {
                                          const nextItems = nextSchedules.slice(1, 3);
                                          let allAreMinutes = true;
                                          
                                          const displays = nextItems.map((nextSchedule, idx) => {
                                            const [nh, nm] = nextSchedule.hr_prevista.split(':').map(Number);
                                            const nextDate = new Date(now);
                                            nextDate.setHours(nh, nm, 0, 0);
                                            let nextDiff = Math.round((nextDate.getTime() - now.getTime()) / 60000);
                                            let nextIsMinutes = nextDiff >= 0 && nextDiff <= 60;
                                            
                                            if (!nextIsMinutes) {
                                              allAreMinutes = false;
                                            }
                                            
                                            return {
                                              display: nextIsMinutes ? `${nextDiff}` : formatSchedule(nextSchedule.hr_prevista),
                                              isMinutes: nextIsMinutes
                                            };
                                          });

                                          return (
                                            <>
                                              {displays.map((item, idx) => (
                                                <React.Fragment key={idx}>
                                                  {idx > 0 && ', '}
                                                  {item.display}
                                                </React.Fragment>
                                              ))}
                                              {allAreMinutes && <Text style={styles.nextScheduleUnit}> min</Text>}
                                            </>
                                          );
                                        })()}
                                      </Text>
                                    </View>
                                  )}
                                </View>
                              </View>
                            </>
                          );
                        })()}
                      </View>
                    ) : (
                      <View style={styles.noSchedulesContainer}>
                        <Text style={[styles.noSchedulesText, { color: appTheme === 'dark' ? '#aaa' : '#666' }]}>
                          Nenhum horário disponível
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
            ));
          })()
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
  compactScheduleCard: {
    alignItems: 'center',
  },
  scheduleRowContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  routeButtonBox: {
    alignItems: 'center',
  },
  routeIconSquare: {
    width: 60,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mainScheduleBox: {
    alignItems: 'center',
  },
  mainTimeSquare: {
    width: 60,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
  },
  mainTimeNumber: {
    fontSize: 17,
    fontWeight: 'bold',
  },
  mainTimeUnit: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
  },
  pastScheduleLabelContainer: {
    marginTop: 6,
    alignItems: 'center',
  },
  pastScheduleLabel: {
    fontSize: 10,
    fontWeight: '500',
    fontStyle: 'italic',
  },
  nextSchedulesContainer: {
    marginTop: 8,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  nextScheduleText: {
    fontSize: 12,
    fontWeight: '500',
  },
  nextScheduleUnit: {
    fontSize: 10,
    fontWeight: '500',
  },
  seeRouteButton: {
    padding: 6,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default StopDetail;
