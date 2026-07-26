import React from 'react';
import { Platform } from 'react-native';
import type { CalendarEventItem, TodoItem } from '../types';
import {
  buildWidgetSnapshot,
  loadWidgetSnapshot,
  saveWidgetSnapshot,
} from './snapshot';
import { AgendaiWidget, type WidgetKind } from './AgendaiWidget';

const WIDGET_NAMES: Array<{ name: string; kind: WidgetKind }> = [
  { name: 'AgendaiTasks', kind: 'tasks' },
  { name: 'AgendaiEvents', kind: 'events' },
  { name: 'AgendaiHome', kind: 'home' },
];

export async function syncWidgetsFromData(
  todos: TodoItem[],
  events: CalendarEventItem[],
): Promise<void> {
  if (Platform.OS !== 'android') return;

  const snapshot = buildWidgetSnapshot(todos, events);
  await saveWidgetSnapshot(snapshot);

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-android-widget') as {
      requestWidgetUpdate: (args: {
        widgetName: string;
        renderWidget: () => React.ReactElement;
      }) => Promise<void>;
    };

    await Promise.all(
      WIDGET_NAMES.map(({ name, kind }) =>
        mod.requestWidgetUpdate({
          widgetName: name,
          renderWidget: () => (
            <AgendaiWidget kind={kind} snapshot={snapshot} />
          ),
        }),
      ),
    );
  } catch {
    // Expo Go / build sem plugin
  }
}

export async function refreshWidgetsFromStorage(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const snapshot = await loadWidgetSnapshot();
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-android-widget') as {
      requestWidgetUpdate: (args: {
        widgetName: string;
        renderWidget: () => React.ReactElement;
      }) => Promise<void>;
    };
    await Promise.all(
      WIDGET_NAMES.map(({ name, kind }) =>
        mod.requestWidgetUpdate({
          widgetName: name,
          renderWidget: () => (
            <AgendaiWidget kind={kind} snapshot={snapshot} />
          ),
        }),
      ),
    );
  } catch {
    // ignore
  }
}
