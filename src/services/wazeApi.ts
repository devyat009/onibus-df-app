import { MapBounds, TrafficJam } from '../types';
import { CacheManager } from '../utils/cacheManager';

interface WazeJamRaw {
  uuid?: string;
  id?: string;
  pubMillis: number;
  street?: string;
  line?: ({x: number; y: number} | [number, number])[]; // Pode ser {x,y} ou [lon,lat]
  speedKMH?: number;
  speed?: number; // Fallback field
  level?: number;
  blockDescription?: string; // Descricao do bloqueio
  blockType?: string; // tipo de bloqueio
  [key: string]: any; // Para outros campos que possam existir
}

interface WazeApiResponse {
  jams: WazeJamRaw[];
  [key: string]: any;
}

class WazeTrafficService {
  private baseUrl = 'https://www.waze.com/live-map/api/georss';
  private cacheKey = 'WAZE_TRAFFIC';
  private cacheTTL = 2 * 60 * 1000; // 2 minutos

  /**
   * Get traffic color based on level
   */
  private getTrafficColor(level: number): string {
    if (level === 1) return '#00C851'; // Verde
    if (level >= 2 && level <= 3) return '#FFB347'; // Amarelo claro
    if (level >= 4 && level <= 5) return '#FF4444'; // Vermelho
    return '#666666'; // Cinza para valores desconhecidos
  }

  /**
   * Transform raw Waze jam data to our TrafficJam interface
   */
  private transformWazeJam(jam: WazeJamRaw): TrafficJam | null {
    // Usar uuid como ID primário, fallback para id ou gerar um baseado em outros campos
    const id = jam.uuid || jam.id || `${jam.pubMillis}-${jam.street || 'unknown'}`;
    
    if (!jam.line || !Array.isArray(jam.line)) {
      return null; // Dados inválidos
    }

    // Converter coordenadas de {x, y} para [longitude, latitude]
    const convertedLines = jam.line.map((coord: any) => {
      if (coord && typeof coord.x === 'number' && typeof coord.y === 'number') {
        return [coord.x, coord.y]; // [longitude, latitude]
      }
      // Se já estiver no formato [lon, lat]
      if (Array.isArray(coord) && coord.length === 2 && 
          typeof coord[0] === 'number' && typeof coord[1] === 'number') {
        return coord;
      }
      return null;
    }).filter(Boolean);

    // Precisa de pelo menos 2 pontos para formar uma linha
    if (convertedLines.length < 2) {
      console.warn(`Traffic jam ${id} has insufficient valid coordinates:`, jam.line);
      return null;
    }

    const isClosed = jam.blockType === 'ROAD_CLOSED_EVENT';

    return {
      id,
      street: jam.street || 'Rua desconhecida',
      lines: convertedLines as [number, number][],
      speedKMH: jam.speedKMH || 0,
      level: jam.level || 1,
      color: this.getTrafficColor(jam.level || 1),
      pattern: isClosed ? 'yellow-black' : undefined, // pattern de linha
      pubMillis: jam.pubMillis,
      blockDescription: jam.blockDescription || '',
      blockType: jam.blockType || ''
    };
  }

  /**
   * Build Waze API URL with bounds
   */
  private buildWazeUrl(bounds: MapBounds): string {
    const params = new URLSearchParams({
      top: bounds.north.toString(),
      bottom: bounds.south.toString(),
      left: bounds.west.toString(),
      right: bounds.east.toString(),
      env: 'row',
      types: 'traffic'
    });
    
    return `${this.baseUrl}?${params.toString()}`;
  }

  /**
   * Fetch traffic data from Waze API
   */
  private async fetchTrafficData(bounds: MapBounds): Promise<TrafficJam[]> {
    try {
      const url = this.buildWazeUrl(bounds);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
      });

      if (!response.ok) {
        throw new Error(`Waze API error: ${response.status}`);
      }

      const data: WazeApiResponse = await response.json();
      
      if (!data.jams || !Array.isArray(data.jams)) {
        return [];
      }

      // Transform and filter valid jams
      return data.jams
        .map(jam => this.transformWazeJam(jam))
        .filter((jam): jam is TrafficJam => jam !== null);

    } catch (error) {
      console.error('Erro ao buscar dados de trânsito do Waze:', error);
      return [];
    }
  }

  /**
   * Get traffic data with caching (2 minutes TTL)
   */
  async getTrafficJams(bounds: MapBounds): Promise<TrafficJam[]> {
    // Create cache key based on bounds to cache per region
    const boundsKey = `${this.cacheKey}_${bounds.north}_${bounds.south}_${bounds.east}_${bounds.west}`;
    
    return CacheManager.getCachedOrFetch(
      boundsKey,
      () => this.fetchTrafficData(bounds),
      { ttl: this.cacheTTL }
    );
  }

  /**
   * Clear traffic cache (useful for manual refresh)
   */
  clearCache(): void {
    // This would require implementing a method in cacheManager to clear by pattern
    console.log('Traffic cache clear requested');
  }
}

export const wazeTrafficService = new WazeTrafficService();
export default wazeTrafficService;
