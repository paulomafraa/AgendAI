import React from 'react';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { AgendaiWidget, type WidgetKind } from './AgendaiWidget';
import { loadWidgetSnapshot } from './snapshot';

const NAME_TO_KIND: Record<string, WidgetKind> = {
  AgendaiTasks: 'tasks',
  AgendaiEvents: 'events',
  AgendaiHome: 'home',
};

export async function widgetTaskHandler(
  props: WidgetTaskHandlerProps,
): Promise<void> {
  const kind = NAME_TO_KIND[props.widgetInfo.widgetName] ?? 'home';
  const snapshot = await loadWidgetSnapshot();

  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
      props.renderWidget(<AgendaiWidget kind={kind} snapshot={snapshot} />);
      break;
    case 'WIDGET_DELETED':
      break;
    case 'WIDGET_CLICK':
      // OPEN_APP / OPEN_URI handled natively; refresh UI after other clicks
      props.renderWidget(<AgendaiWidget kind={kind} snapshot={snapshot} />);
      break;
    default:
      props.renderWidget(<AgendaiWidget kind={kind} snapshot={snapshot} />);
  }
}
