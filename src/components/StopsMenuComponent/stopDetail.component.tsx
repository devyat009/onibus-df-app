import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAppStore } from '@/src/store';
import { apiService } from '@/src/services/api';
import { BusStop, StopSchedule } from '@/src/types';

interface StopDetailProps {
  stop: BusStop;
  onBack: () => void;
}

const StopDetail: React.FC<StopDetailProps> = ({ stop, onBack }) => {
  const appTheme = useAppStore(state => state.appTheme);
  const [scheduleData, setScheduleData] = useState<StopSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        console.log('Loading schedule for stop:', stop);
        
        // Test individual data loading
        const [lines, horarios] = await Promise.all([
          apiService.getLinesCached(),
          apiService.getHorarioCached()
        ]);
        
        console.log('Lines loaded:', lines.length);
        console.log('Horarios loaded:', horarios.length);
        console.log('Sample line:', lines[0]);
        console.log('Sample horario:', horarios[0]);
        
        const data = await apiService.getStopSchedule(stop);
        console.log('Schedule data received:', data);
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
          <Text style={[styles.headerTitle, { color: appTheme === 'dark' ? '#fff' : '#000' }]}>
            Carregando...
          </Text>
        </View>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={[styles.loadingText, { color: appTheme === 'dark' ? '#aaa' : '#666' }]}>
            Buscando horários...
          </Text>
        </View>
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
          <Text style={[styles.headerTitle, { color: appTheme === 'dark' ? '#fff' : '#000' }]}>
            Erro
          </Text>
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
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {scheduleData && scheduleData.lines.length > 0 ? (
          scheduleData.lines.map((lineData, index) => {
            const nextSchedules = getNextSchedules(lineData.schedules);
            
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
                    <Text style={[styles.lineSubtitle, { color: appTheme === 'dark' ? '#aaa' : '#666' }]}>
                      {lineData.line.nome}
                    </Text>
                  </View>
                </View>

                {nextSchedules.length > 0 ? (
                  <View style={styles.schedulesContainer}>
                    <Text style={[styles.sectionTitle, { color: appTheme === 'dark' ? '#fff' : '#000' }]}>
                      Próximos horários hoje:
                    </Text>
                    {nextSchedules.map((schedule, scheduleIndex) => (
                      <View key={scheduleIndex} style={styles.scheduleItem}>
                        <View style={styles.timeContainer}>
                          <Text style={[styles.scheduleTime, { color: '#007AFF' }]}>
                            {formatSchedule(schedule.hr_prevista)}
                          </Text>
                          <Text style={[styles.scheduleDirection, { color: appTheme === 'dark' ? '#aaa' : '#666' }]}>
                            {schedule.sentido}
                          </Text>
                        </View>
                        <Text style={[styles.scheduleDays, { color: appTheme === 'dark' ? '#aaa' : '#666' }]}>
                          {schedule.dia_label}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : lineData.schedules.length > 0 ? (
                  <View style={styles.schedulesContainer}>
                    <Text style={[styles.sectionTitle, { color: appTheme === 'dark' ? '#fff' : '#000' }]}>
                      Todos os horários ({lineData.schedules.length}):
                    </Text>
                    {lineData.schedules.slice(0, 5).map((schedule, scheduleIndex) => (
                      <View key={scheduleIndex} style={styles.scheduleItem}>
                        <View style={styles.timeContainer}>
                          <Text style={[styles.scheduleTime, { color: '#007AFF' }]}>
                            {formatSchedule(schedule.hr_prevista)}
                          </Text>
                          <Text style={[styles.scheduleDirection, { color: appTheme === 'dark' ? '#aaa' : '#666' }]}>
                            {schedule.sentido}
                          </Text>
                        </View>
                        <Text style={[styles.scheduleDays, { color: appTheme === 'dark' ? '#aaa' : '#666' }]}>
                          {schedule.dia_label}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <View style={styles.noSchedulesContainer}>
                    <Text style={[styles.noSchedulesText, { color: appTheme === 'dark' ? '#aaa' : '#666' }]}>
                      Nenhum horário disponível para esta linha
                    </Text>
                  </View>
                )}

                <TouchableOpacity 
                  style={styles.viewAllButton}
                  onPress={() => {
                    console.log('Ver todos os horários para linha:', lineData.line.codigo);
                  }}
                >
                  <Text style={styles.viewAllButtonText}>Ver todos os horários</Text>
                  <MaterialIcons name="chevron-right" size={20} color="#007AFF" />
                </TouchableOpacity>
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
    padding: 16,
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
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
  },
  lineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  lineInfo: {
    marginLeft: 12,
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
});

export default StopDetail;
