import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';

import App from './App';

registerRootComponent(App);

if (Platform.OS === 'android') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { registerWidgetTaskHandler } = require('react-native-android-widget');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { widgetTaskHandler } = require('./src/widgets/taskHandler');
    registerWidgetTaskHandler(widgetTaskHandler);
  } catch {
    // Expo Go / ambiente sem módulo nativo
  }
}
