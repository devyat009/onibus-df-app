import { useBusFavorites, useStopFavorites } from '@/src/hooks/useFavorites';
import { busService, stopService } from '@/src/services/api';
import { useAppStore } from '@/src/store';
import { BusLine, BusStop, StopRealtimeArrivalsMap, StopScheduleV2 } from '@/src/types';
import { getStopProgressAlongRoute } from '@/src/utils/geoUtils';
import { buildLineKey, formatSentidoLabel, normalizeSentido } from '@/src/utils/lineUtils';
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
import LineRouteMap from './lineRouteMap.component';

interface StopDetailProps {
  stop: BusStop;
  onBack: () => void;
}

type DisplayItem = {
  label: string;
  unit?: string;
  isRealtime: boolean;
  isNow: boolean;
  isPast?: boolean;
};

const StopDetail: React.FC<StopDetailProps> = ({ stop, onBack }) => {
  const appTheme = useAppStore(state => state.appTheme);
  const [scheduleData, setScheduleData] = useState<StopScheduleV2 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [realtimeArrivals, setRealtimeArrivals] = useState<StopRealtimeArrivalsMap>({});
  const [realtimeLoading, setRealtimeLoading] = useState(false);
  const [hasInitialRealtimeLoaded, setHasInitialRealtimeLoaded] = useState(false);
  const [realtimeError, setRealtimeError] = useState<string | null>(null);
  
  // Route map view state
  const [selectedLineForMap, setSelectedLineForMap] = useState<BusLine | null>(null);

  // Favorites using custom hook
  const { isFavorite, toggleFavorite } = useStopFavorites();
  const { isFavorite: isBusFavorite, toggleFavorite: toggleBusFavorite } = useBusFavorites();

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
      const data = await stopService.getStopScheduleV2(stop);
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

        const data = await stopService.getStopScheduleV2(stop);
        // console.warn('[STOPDETAIL2] Loaded stop schedule V2:', data.lines[0]);
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

  useEffect(() => {
    let isMounted = true;
    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
    setHasInitialRealtimeLoaded(false);

    const fetchRealtime = async () => {
      if (!scheduleData || !scheduleData.lines?.length) {
        if (isMounted) {
          setRealtimeArrivals({});
          setRealtimeError(null);
          setHasInitialRealtimeLoaded(true);
        }
        return;
      }

      try {
        if (isMounted) {
          setRealtimeLoading(true);
          setRealtimeError(null);
        }

        const lines = scheduleData.lines.map(item => item.line);
        const tempoPercursoByLineKey: Record<string, number> = {};
        for (const item of scheduleData.lines) {
          const tp = item.schedules.find(s => s.tempo_percurso > 0)?.tempo_percurso ?? 0;
          if (tp > 0) {
            tempoPercursoByLineKey[buildLineKey(item.line.linha, item.line.sentido)] = tp;
          }
        }

        const realtime = await busService.getRealtimeArrivalsForStop(stop, lines, {
          radiusMeters: 25000,
          maxPerLine: 3,
          maxEtaMinutes: 90,
          tempoPercursoByLineKey,
        });

        if (isMounted) {
          setRealtimeArrivals(realtime);
        }
      } catch (err) {
        console.error('[STOPDETAIL] Erro ao carregar dados em tempo real:', err);
        if (isMounted) {
          setRealtimeArrivals({});
          setRealtimeError('Dados em tempo real indisponíveis no momento');
        }
      } finally {
        if (isMounted) {
          setRealtimeLoading(false);
          setHasInitialRealtimeLoaded(true);
          if (refreshTimeout) {
            clearTimeout(refreshTimeout);
          }
          refreshTimeout = setTimeout(fetchRealtime, 15000);
        }
      }
    };

    fetchRealtime();

    return () => {
      isMounted = false;
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
      }
    };
  }, [stop, scheduleData]);

  const formatSchedule = (time: string) => {
    return time.substring(0, 5); // Remove seconds if present
  };

  const formatMinutesOfDay = (totalMinutes: number): string => {
    const wrapped = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
    const hh = String(Math.floor(wrapped / 60)).padStart(2, '0');
    const mm = String(wrapped % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  /**
   * Computes how many minutes after terminal departure (`hr_prevista`) a bus reaches `stop`
   * along `line.coordinates` using `tempo_percurso` (or 22 km/h urban commercial speed fallback).
   */
  const computeStopTravelOffsetMinutes = (line: BusLine, tempoPercursoMinutes: number): number => {
    if (!isFinite(stop.longitude) || !isFinite(stop.latitude)) return 0;
    const progress = getStopProgressAlongRoute(
      [stop.longitude, stop.latitude],
      line.coordinates
    );
    if (!progress || progress.distanceFromStartMeters <= 250) {
      return 0;
    }
    if (tempoPercursoMinutes > 0) {
      return Math.round(tempoPercursoMinutes * progress.progressFraction);
    }
    return Math.round((progress.distanceFromStartMeters / 1000 / 22) * 60);
  };

  type NormalizedSchedule = {
    horario: string;
    dias_semana: string;
    dia_label?: string;
  };

  const getNextSchedules = (horarios: any[], limit = 6, stopOffsetMinutes = 0) => {
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();
    const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

    // Map day of week to dias_semana index: "SSSSSNN" (Mon..Sun)
    const dayIndex = currentDay === 0 ? 6 : currentDay - 1;
    const prevDayIndex = (dayIndex + 6) % 7;

    const normalizedSchedules = horarios
      .map((item): NormalizedSchedule | null => {
        if (!item) {
          return null;
        }

        if (typeof item === 'string') {
          return {
            horario: item,
            dias_semana: 'SSSSSSS',
            dia_label: '',
          };
        }

        if (typeof item === 'object') {
          const horario = item.horario || item.hr_prevista;
          if (!horario) {
            return null;
          }
          return {
            horario,
            dias_semana: typeof item.dias_semana === 'string' && item.dias_semana.length === 7
              ? item.dias_semana
              : 'SSSSSSS',
            dia_label: item.dia_label || '',
          };
        }

        return null;
      })
      .filter((schedule): schedule is NormalizedSchedule => schedule !== null);

    const candidateEntries: {
      hr_prevista: string;
      scheduleTime: number;
      diffMinutes: number;
      dia_label?: string;
      dias_semana: string;
      isPast: boolean;
    }[] = [];

    for (const schedule of normalizedSchedules) {
      const [hours, minutes] = schedule.horario.split(':').map(Number);
      if (isNaN(hours) || isNaN(minutes)) continue;
      const depMinutes = hours * 60 + minutes;
      const arrivalMinutesRaw = depMinutes + stopOffsetMinutes;

      const runsToday = schedule.dias_semana.length === 7 ? schedule.dias_semana[dayIndex] === 'S' : true;
      const runsPrevDay = schedule.dias_semana.length === 7 ? schedule.dias_semana[prevDayIndex] === 'S' : true;

      // 1. Late-night departure from yesterday whose travel offset rolls past midnight into today
      if (runsPrevDay && arrivalMinutesRaw >= 1440) {
        const todayArrivalMin = arrivalMinutesRaw - 1440;
        const diff = todayArrivalMin - currentTime;
        candidateEntries.push({
          hr_prevista: formatMinutesOfDay(todayArrivalMin),
          scheduleTime: todayArrivalMin,
          diffMinutes: diff,
          dia_label: schedule.dia_label,
          dias_semana: schedule.dias_semana,
          isPast: diff < -1,
        });
      }

      // 2. Today's departures (including ones whose stop arrival rolls slightly past midnight tonight)
      if (runsToday) {
        const diff = arrivalMinutesRaw - currentTime;
        candidateEntries.push({
          hr_prevista: formatMinutesOfDay(arrivalMinutesRaw),
          scheduleTime: arrivalMinutesRaw,
          diffMinutes: diff,
          dia_label: schedule.dia_label,
          dias_semana: schedule.dias_semana,
          isPast: diff < -1,
        });
      }
    }

    // Deduplicate identical arrival minutes and sort chronologically
    candidateEntries.sort((a, b) => a.scheduleTime - b.scheduleTime);
    const uniqueEntries = candidateEntries.filter(
      (item, idx, arr) => idx === 0 || item.scheduleTime !== arr[idx - 1].scheduleTime
    );

    const futureSchedules = uniqueEntries.filter(s => !s.isPast);
    const pastSchedules = uniqueEntries.filter(s => s.isPast);

    if (futureSchedules.length > 0) {
      return futureSchedules.slice(0, limit);
    }

    return pastSchedules.slice(-limit);
  };

  const buildDisplayItems = (
    lineNumber: string,
    lineSentido: string,
    fallbackSchedules: ReturnType<typeof getNextSchedules>,
  ): DisplayItem[] => {
    const items: DisplayItem[] = [];
    const lineKey = buildLineKey(lineNumber, lineSentido);
    const realtimeItems = realtimeArrivals[lineKey]?.arrivals ?? [];

    let maxRealtimeEta = -Infinity;
    realtimeItems.forEach(arrival => {
      const eta = Math.max(0, arrival.etaMinutes);
      if (eta > maxRealtimeEta) maxRealtimeEta = eta;
      const isNow = eta < 0.75;
      const minutes = Math.max(1, Math.round(eta));
      items.push({
        label: isNow ? 'Agora' : String(minutes),
        unit: isNow ? undefined : 'min',
        isRealtime: true,
        isNow,
      });
    });

    fallbackSchedules.forEach(schedule => {
      if (!schedule) return;
      if (items.length >= 3) return;

      const diffMinutes = Math.round(schedule.diffMinutes);
      const isPast = Boolean(schedule.isPast);

      // When live GPS buses are already displayed, skip scheduled slots that correspond to
      // (or precede) the already-tracked live vehicles so secondary times strictly increase!
      if (realtimeItems.length > 0) {
        if (isPast || diffMinutes <= Math.round(maxRealtimeEta) + 5) {
          return;
        }
      }

      const isMinutes = diffMinutes >= 0 && diffMinutes <= 60 && !isPast;

      items.push({
        label: isMinutes ? String(Math.max(1, diffMinutes)) : formatSchedule(schedule.hr_prevista),
        unit: isMinutes ? 'min' : undefined,
        isRealtime: false,
        isNow: false,
        isPast,
      });
    });

    return items.slice(0, 3);
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

  // If a line is selected for map view, show the route map
  if (selectedLineForMap) {
    return (
      <LineRouteMap
        line={selectedLineForMap}
        currentStop={stop}
        onBack={() => setSelectedLineForMap(null)}
      />
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
        {((realtimeLoading && !hasInitialRealtimeLoaded) || realtimeError) && (
          <View
            style={[
              styles.realtimeBanner,
              {
                backgroundColor: appTheme === 'dark' ? '#1a1a1a' : '#eef9f1',
                borderColor: appTheme === 'dark' ? '#2f2f2f' : '#c7ebd3',
              },
            ]}
          >
            <MaterialIcons
              name={realtimeError ? 'wifi-off' : 'sync'}
              size={18}
              color={realtimeError ? '#ff6b6b' : '#00C853'}
            />
            <Text
              style={[
                styles.realtimeBannerText,
                { color: realtimeError ? '#ff6b6b' : '#00C853' },
              ]}
            >
              {realtimeError ? realtimeError : 'Atualizando horários em tempo real...'}
            </Text>
          </View>
        )}
        {scheduleData && scheduleData.lines.length > 0 ? (
          (() => {
            // Group lines by composite key (line number + normalized sentido) so IDA and VOLTA remain distinct
            const lineGroups = new Map<string, typeof scheduleData.lines>();
            scheduleData.lines.forEach(lineData => {
              const groupKey = `${lineData.line.linha}_${normalizeSentido(lineData.line.sentido)}`;
              if (!lineGroups.has(groupKey)) {
                lineGroups.set(groupKey, []);
              }
              lineGroups.get(groupKey)!.push(lineData);
            });

            // Process each unique line+direction
            const linesWithSchedules = Array.from(lineGroups.entries()).map(([, lineDatas], groupIdx) => {
              const quantidadeHorarios = 6;
              // Use the first lineData as representative
              const lineData = lineDatas[0];
              const tempoPercurso =
                lineDatas.flatMap(ld => ld.schedules).find(s => s.tempo_percurso > 0)?.tempo_percurso ?? 0;
              const stopOffsetMinutes = computeStopTravelOffsetMinutes(lineData.line, tempoPercurso);

              // Merge schedules belonging to this specific line+direction
              const allHorarios = lineDatas.flatMap(ld => 
                ld.schedules.flatMap(schedule => schedule.horarios)
              );
              const nextSchedules = getNextSchedules(allHorarios, quantidadeHorarios, stopOffsetMinutes);
              const firstSchedule = nextSchedules[0];
              const hasFutureSchedules = !!firstSchedule && !firstSchedule.isPast;
              
              // Build display items to check if has realtime
              const lineKey = buildLineKey(lineData.line.linha, lineData.line.sentido);
              const realtimeItems = realtimeArrivals[lineKey]?.arrivals ?? [];
              const hasRealtime = realtimeItems.length > 0;
              
              // Check if line is favorite
              const isFavorite = isBusFavorite(lineData.line.linha);
              
              // Get the minimum ETA for sorting
              let minEta = Infinity;
              if (hasRealtime) {
                minEta = Math.min(...realtimeItems.map(a => a.etaMinutes));
              } else if (hasFutureSchedules && firstSchedule) {
                minEta = Math.max(0, Math.round(firstSchedule.diffMinutes));
              }

              
              return {
                lineData,
                index: groupIdx,
                nextSchedules,
                hasFutureSchedules,
                hasRealtime,
                minEta,
                isFavorite,
              };
            });

            // Sort by priority:
            // 1. Favorite lines (if they have realtime or future schedules)
            // 2. Has realtime data
            // 3. Minimum ETA (smaller first)
            // 4. Has future schedules
            const sortedLines = linesWithSchedules.sort((a, b) => {
              // Priority 1: Favorites first (but only if active/upcoming)
              const aFavoriteAndActive = a.isFavorite && (a.hasRealtime || a.hasFutureSchedules);
              const bFavoriteAndActive = b.isFavorite && (b.hasRealtime || b.hasFutureSchedules);
              if (aFavoriteAndActive && !bFavoriteAndActive) return -1;
              if (!aFavoriteAndActive && bFavoriteAndActive) return 1;
              
              // Priority 2: Realtime first
              if (a.hasRealtime && !b.hasRealtime) return -1;
              if (!a.hasRealtime && b.hasRealtime) return 1;
              
              // Priority 3: Sort by minimum ETA
              if (a.minEta !== b.minEta) {
                return a.minEta - b.minEta;
              }
              
              // Priority 4: Future schedules before past
              if (a.hasFutureSchedules && !b.hasFutureSchedules) return -1;
              if (!a.hasFutureSchedules && b.hasFutureSchedules) return 1;
              
              return 0;
            });

            return sortedLines.map(({ lineData, index, nextSchedules, isFavorite }) => (
              <View
                key={`line-${lineData.line.linha}-${lineData.line.sentido}-${index}`}
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
                      Linha {lineData.line.linha}{lineData.line.nome ? ` - ${lineData.line.nome}` : ''}
                    </Text>
                    {Boolean(lineData.line.sentido) && (
                      <Text style={{ fontSize: 12, color: appTheme === 'dark' ? '#aaa' : '#666', marginTop: 2 }}>
                        Sentido: {formatSentidoLabel(lineData.line.sentido)}
                      </Text>
                    )}
                  </View>

                  <View style={styles.schedulesContainer}>
                    {(() => {
                      const displayItems = buildDisplayItems(
                        lineData.line.linha,
                        lineData.line.sentido,
                        nextSchedules,
                      );

                      if (displayItems.length === 0) {
                        return (
                          <View style={styles.noSchedulesContainer}>
                            <Text style={[styles.noSchedulesText, { color: appTheme === 'dark' ? '#aaa' : '#666' }]}>
                              Nenhum horário disponível
                            </Text>
                          </View>
                        );
                      }

                      const mainItem = displayItems[0];
                      const secondaryItems = displayItems.slice(1);
                      const isRealtimeMain = Boolean(mainItem?.isRealtime);
                      const isPastMain = Boolean(mainItem?.isPast);

                      const mainNumber = mainItem?.label ?? '--';
                      const mainUnit = mainItem?.unit;
                      const mainNumberColor = isRealtimeMain
                        ? '#00C853'
                        : (isPastMain ? '#999' : '#666');
                      const mainUnitColor = isRealtimeMain ? '#00C853' : '#666';
                      const mainBackgroundColor = isRealtimeMain
                        ? (appTheme === 'dark' ? '#0f2d1b' : '#dff6e9')
                        : (isPastMain
                          ? (appTheme === 'dark' ? '#1a1a1a' : '#e8e8e8')
                          : (appTheme === 'dark' ? '#242424ff' : '#f0f0f0'));

                      const showPastLabel = !isRealtimeMain && isPastMain;
                      const hasSecondary = secondaryItems.length > 0;

                      return (
                        <View style={styles.compactScheduleCard}>
                          <View style={styles.scheduleRowContainer}>
                            {/* Favorite button */}
                            <View style={styles.routeButtonBox}>
                              <TouchableOpacity
                                style={[
                                  styles.routeIconSquare,
                                  isFavorite
                                    ? { backgroundColor: '#FFD600', borderColor: '#FFD600' }
                                    : { backgroundColor: appTheme === 'dark' ? '#242424ff' : '#f0f0f0' }
                                ]}
                                onPress={() => toggleBusFavorite(lineData.line.linha)}
                                activeOpacity={0.7}
                              >
                                <MaterialIcons
                                  name={isFavorite ? "bookmark" : "bookmark-outline"}
                                  size={22}
                                  color={isFavorite ? '#fff' : '#007AFF'}
                                />
                              </TouchableOpacity>
                            </View>

                            {/* Route button */}
                            <View style={styles.routeButtonBox}>
                              <TouchableOpacity
                                style={[
                                  styles.routeIconSquare,
                                  { backgroundColor: appTheme === 'dark' ? '#242424ff' : '#f0f0f0' }
                                ]}
                                onPress={() => {
                                  setSelectedLineForMap(lineData.line);
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
                                  backgroundColor: mainBackgroundColor,
                                }
                              ]}>
                                <Text style={[
                                  styles.mainTimeNumber, 
                                  { color: mainNumberColor }
                                ]}>
                                  {mainNumber}
                                </Text>
                                {mainUnit && (
                                  <Text style={[styles.mainTimeUnit, { color: mainUnitColor }]}>{mainUnit}</Text>
                                )}
                              </View>
                              
                              {/* Label if past schedule */}
                              {showPastLabel && (
                                <View style={styles.pastScheduleLabelContainer}>
                                  <Text style={[styles.pastScheduleLabel, { color: '#999' }]}>
                                    já passou
                                  </Text>
                                </View>
                              )}
                              
                              {/* Next schedules below */}
                              {hasSecondary && !showPastLabel && (
                                <View style={styles.nextSchedulesContainer}>
                                  <Text style={[styles.nextScheduleText, { color: '#666' }]}>
                                    {(() => {
                                      const allMinutes = secondaryItems.every(item => item.unit === 'min');
                                      const anyRealtime = secondaryItems.some(item => item.isRealtime);
                                      const labels = secondaryItems.map(item => item.label).join(', ');
                                      return allMinutes && !anyRealtime
                                        ? `${labels} min`
                                        : secondaryItems.map((item, idx) => (
                                            <Text
                                              key={`${lineData.line.linha}-${idx}`}
                                              style={[
                                                styles.nextScheduleText,
                                                item.isRealtime ? { color: '#00C853' } : null,
                                              ]}
                                            >
                                              {idx > 0 ? ', ' : ''}
                                              {item.label}
                                              {item.unit ? ` ${item.unit}` : ''}
                                            </Text>
                                          ));
                                    })()}
                                  </Text>
                                </View>
                              )}
                            </View>
                          </View>
                        </View>
                      );
                    })()}
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
  realtimeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
  },
  realtimeBannerText: {
    marginLeft: 8,
    fontSize: 13,
    fontWeight: '600',
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    //borderWidth: 1,
    //borderColor: '#e1c10dff',
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
    padding: 6,
    marginBottom: 10,
    borderWidth: 1,
    //borderColor: '#9d0f81ff',
  },
  lineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    //marginBottom: 10,
    //borderColor: '#9d0f0fff',
    //borderWidth: 1,
  },
  lineInfo: {
    marginLeft: 8,
    flex: 1,
  },
  lineTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    //borderColor: '#0fadbeff',
    //borderWidth: 1,
  },
  lineSubtitle: {
    fontSize: 14,
    marginTop: 2,
    //borderColor: '#1e0bcaff',
    //borderWidth: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    //borderWidth: 1,
    //borderColor: '#0f9d58ff',
  },
  schedulesContainer: {
    //marginBottom: 12,
    //borderWidth: 1,
    //borderColor: '#9706eaff',
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
