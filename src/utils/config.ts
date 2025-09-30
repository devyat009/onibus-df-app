import { AppConfig } from '../types';

const isDevelopment = __DEV__;

export const config: AppConfig = {
  // geo is different than dados 
  api: {
    baseUrl: 'https://dados.semob.df.gov.br',
    geoserverUrl: 'http://geoserver.semob.df.gov.br/geoserver/semob/ows',
    endpoints: {
      // dados endpoints
      dadosOnibusPosicao: '/posicao',
      dadosParadas: '/parada',
      dadosHorario: '/horario',
      dadosOperadora: '/operadora',
      dadosLinhasEspaciais: '/espaciais',
      dadosNumeros: '/numeros',
      // Geo endpoints
      geoOnibusPosicao: 'service=WFS&version=1.0.0&request=GetFeature&typeName=semob%3AÚltima posição da frota&outputFormat=application%2Fjson&maxFeatures=400',
      geoParadas: 'service=WFS&version=1.0.0&request=GetFeature&typeName=semob%3AParadas%20de%20onibus&outputFormat=application%2Fjson&maxFeatures=200',
      geoLinhasEspaciais: 'service=WFS&version=1.0.0&request=GetFeature&typeName=semob%3ALinhas%20de%20onibus&outputFormat=application%2Fjson',
      geoFrotaOperadora: 'service=WFS&version=1.0.0&request=GetFeature&typeName=semob%3AFrota%20por%20Operadora&outputFormat=application%2Fjson',
      geoHorario: 'service=WFS&version=1.0.0&request=GetFeature&typeName=semob%3AHorários%20das%20Linhas&outputFormat=application%2Fjson'
    },
  },
  cache: {
    ttl: 5 * 60 * 1000, // 5 minutes
    maxSize: 100, // Maximum number of cached items
  },
};

// Environment-specific overrides
export const getConfig = (): AppConfig => {
  if (isDevelopment) {
    return {
      ...config,
      // Development-specific settings
      cache: {
        ...config.cache,
        ttl: 30 * 1000, // 30 seconds for faster development
      },
    };
  }

  return config;
};

export default getConfig();
