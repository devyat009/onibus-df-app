## Ônibus DF (Brasília) — App Mobile

Este projeto é um aplicativo desenvolvido em React Native (Expo) para visualização em tempo real de ônibus e paradas do Distrito Federal (Brasília, Brasil). O objetivo é fornecer uma interface intuitiva e moderna para acompanhamento do transporte público, utilizando mapas interativos e recursos avançados de filtragem.


### Mapa e visualização de paradas proximas
| ![map](https://raw.githubusercontent.com/devyat009/image-repo-for-my-repo/refs/heads/main/bus-tracker/map.png) | ![map-options](https://raw.githubusercontent.com/devyat009/image-repo-for-my-repo/refs/heads/main/bus-tracker/paradas-proximas.png) |
|:---:|:---:|

### Configurações de mapa
Opções como mostrar onibus ativos que estão se locomovendo, mostrar paradas e trânsito em tempo real.
| ![map-all-options](https://raw.githubusercontent.com/devyat009/image-repo-for-my-repo/refs/heads/main/bus-tracker/map-all-options.png) | ![map-options](https://raw.githubusercontent.com/devyat009/image-repo-for-my-repo/refs/heads/main/bus-tracker/map-options.png) |
|:---:|:---:|

### Configurações (tema escuro e claro)
| ![configuracoes](https://raw.githubusercontent.com/devyat009/image-repo-for-my-repo/refs/heads/main/bus-tracker/configuracoes.png) | ![configuracoes-white](https://raw.githubusercontent.com/devyat009/image-repo-for-my-repo/refs/heads/main/bus-tracker/configuracoes-white.png) |
|:---:|:---:|


## Instalação

### Requisitos

- Node.js LTS (18+ recomendado)
- npm (ou pnpm/yarn)
- Expo CLI (via `npx`) e app Expo Go (opcional para testar no dispositivo)
- Para Android (emulador/compilar local): Android Studio + SDKs


1) Clonar e instalar dependências

```bash
git clone https://github.com/devyat009/bus-tracker
cd bus-tracker
npm install
```

2) Iniciar em modo desenvolvimento

Inicialize o expo para gerar seus arquivos:
```
npx expo start
```
depois:
```bash
npm run android:dev
```

Abra no:
- Emulador Android (Android Studio)
- Dispositivo físico com Expo Go (escaneando o QR code)

Observação: conceda permissão de localização quando solicitado para que o botão “me encontrar” funcione e o mapa recentrali-ze na sua posição.

## Compilação (Build)

Build local para Android com Expo:

Pré-requisitos: Android Studio instalado e variáveis do SDK configuradas.

```bash
npx expo prebuild
npx expo run:android
```

Isso cria e instala um build de desenvolvimento no emulador/dispositivo conectado.

Observação (iOS): `npx expo run:ios` requer macOS com Xcode.

ou
```bash
npx expo prebuild
```

### Altere o AndroidManifest para poder habilitar requisições do tipo HTTP

Abra o arquivo `/android/app/src/main/AndroidManifest.xml`

Em `<Application>` adicione a seguinte linha: `android:usesCleartextTraffic="true"`

### Para instalar utilize o comando:

```bash
cd android && ./gradlew assembleRelease && cd .. && adb install -r android/app/build/outputs/apk/release/app-release.apk
```

## Erros:

### Android SDK:
Caso não compile por conta do ANDROID_HOME não ser encontrado:

Adicione ao path do sistema o ANDROID_HOME
```
set ANDROID_HOME=C:\Users\YOUR_USER\AppData\Local\Android\Sdk

set PATH=%PATH%;%ANDROID_HOME%\tools %ANDROID_HOME%\platform-tools
```

#### Crie o arquivo em `/android` com o nome `local.properties`
```
nano android/local.properties
```
#### Adicione a seguinte linha:
```
sdk.dir=C:\\Users\\YOUR_USER\\AppData\\Local\\Android\\Sdk
```
`ctrl+O` para salvar, `Enter` e depois `ctrl-X` para sair.


## Licença

Este repositório é para fins educacionais/demonstração.
