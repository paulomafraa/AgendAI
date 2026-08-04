const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

const SERVICE_NAME = 'com.asterinet.react.bgactions.RNBackgroundActionsTask';

/**
 * Declara foregroundServiceType=dataSync no serviço do
 * react-native-background-actions (obrigatório no Android 14+).
 */
function withBackgroundActions(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    if (!application.service) {
      application.service = [];
    }
    const services = Array.isArray(application.service)
      ? application.service
      : [application.service];

    let service = services.find((s) => s?.$?.['android:name'] === SERVICE_NAME);
    if (!service) {
      service = {
        $: {
          'android:name': SERVICE_NAME,
          'android:foregroundServiceType': 'dataSync',
          'android:exported': 'false',
        },
      };
      services.push(service);
      application.service = services;
    } else {
      service.$ = service.$ || {};
      service.$['android:foregroundServiceType'] = 'dataSync';
      if (service.$['android:exported'] == null) {
        service.$['android:exported'] = 'false';
      }
    }
    return config;
  });
}

module.exports = withBackgroundActions;
