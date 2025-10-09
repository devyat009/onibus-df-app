import { ApiResponse, CacheOptions, DadosNumerosVeiculos, FrotaApiProperties, FrotaOperadora } from '../types';
import { CACHE_KEYS, getCachedOrFetch } from '../utils/cacheManager';
import appConfig from '../utils/config';
import { ApiService } from './api';

export class FrotaService {
  private baseUrl = appConfig.api.baseUrl;
  constructor(
    private apiService: ApiService
  ) {
  }

  // ## Requests

  /**
   * Fetches the fleet (frota) data from the geoserver API.
   * @returns An array of FrotaOperadora objects.
   */
  async getFrota(): Promise<FrotaOperadora[]> {
    const response = await this.apiService.makeRequest<FrotaOperadora>(
      appConfig.api.endpoints.geoFrotaOperadora,
      undefined,
      true // Use geoserver for frota
    );

    return response.features
      .map(feature => this.transformFrotaFromApi(feature))
      .filter(frota => frota !== null) as FrotaOperadora[];
  }

  /**
  * Cached version of getFrota - data persists for 3 days
  * @param options - Cache options (ttl, maxSize)
  * @returns An array of FrotaOperadora objects.
  */
  async getFrotaCached(options?: CacheOptions): Promise<FrotaOperadora[]> {
    return getCachedOrFetch(
      CACHE_KEYS.FROTA,
      () => this.getFrota(),
      options
    );
  }

  async getNumerosVeiculos(): Promise<DadosNumerosVeiculos[]> {
    const response = await fetch(`${this.baseUrl}${appConfig.api.endpoints.dadosNumeros}`, {
      headers: {
        'Accept': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch numeros veiculos: ${response.statusText}`);
    }

    const data = await response.json();

    // API returns array directly, not wrapped in features
    const rawFeatures = Array.isArray(data) ? data : [];

    const numerosBuses = rawFeatures
      .map((feature: any) => this.transformNumerosVeiculosFromApi(feature))
      .filter((num) => num !== null) as DadosNumerosVeiculos[];

    return numerosBuses;

  };

  async getNumerosVeiculosCached(options?: CacheOptions): Promise<DadosNumerosVeiculos[]> {
      return getCachedOrFetch(
        CACHE_KEYS.NUMEROS_BUS_DADOS,
        () => this.getNumerosVeiculos(),
        options
      );
    }


  // ## Helpers

  /**
   * Transform API response to FrotaOperadora object
   * @param feature - The API response feature to transform.
   * @returns The transformed FrotaOperadora object or null if the feature is invalid.
   */
  private transformFrotaFromApi(feature: ApiResponse<FrotaApiProperties>['features'][0]): FrotaOperadora | null {
    const { properties } = feature;

    return {
      id: properties.id_frota || '',
      dataReferencia: properties.data_referencia || '',
      servico: properties.servico || '',
      operadora: properties.operadora || '',
      numeroVeiculo: properties.numero_veiculo || '',
      tipoOnibus: properties.tipo_onibus || '',
    } as FrotaOperadora;
  }

  private transformNumerosVeiculosFromApi(feature: any): DadosNumerosVeiculos | null {
      if (!feature) return null;
      return {
        numero: feature.numero,
        descricao: feature.descricao,
        sentido: feature.sentido,
        tarifa: feature.tarifa,
        operadoras: feature.operadoras?.map((op: any) => ({
          id_operadora: op.id_operadora,
          nome: op.nome,
        })) ?? [],
      };
  }
}