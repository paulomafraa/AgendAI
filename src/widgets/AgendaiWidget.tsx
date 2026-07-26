import React from 'react';
import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';
import type { WidgetSnapshot } from './snapshot';

export type WidgetKind = 'tasks' | 'events' | 'home';

const C = {
  bg: '#F3F6F8',
  surface: '#FFFFFF',
  ink: '#12202B',
  muted: '#5A6B78',
  line: '#D5DEE5',
  accent: '#0F766E',
  accentDeep: '#115E59',
};

const MIC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
  <rect x="9" y="2.5" width="6" height="11" rx="3" fill="#FFFFFF"/>
  <path d="M6 11.5a6 6 0 0 0 12 0" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/>
  <path d="M12 17.5v3" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/>
  <path d="M9.5 20.5h5" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/>
</svg>`;

function Header({ title, count }: { title: string; count: number }) {
  return (
    <FlexWidget
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: 'match_parent',
        paddingBottom: 6,
      }}
    >
      <TextWidget
        text={title}
        style={{
          fontSize: 15,
          fontWeight: '600',
          color: C.ink,
        }}
      />
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
        <TextWidget
          text={String(count)}
          style={{
            fontSize: 14,
            fontWeight: '700',
            color: C.accentDeep,
            marginRight: 8,
          }}
        />
        <FlexWidget
          clickAction="OPEN_URI"
          clickActionData={{ uri: 'agendai://voice' }}
          style={{
            backgroundColor: C.accent,
            borderRadius: 18,
            width: 36,
            height: 36,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <SvgWidget
            svg={MIC_SVG}
            style={{ width: 18, height: 18 }}
          />
        </FlexWidget>
      </FlexWidget>
    </FlexWidget>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <TextWidget text={text} style={{ fontSize: 12, color: C.muted, marginTop: 4 }} />
  );
}

function TaskLines({ tasks }: { tasks: WidgetSnapshot['tasks'] }) {
  if (tasks.length === 0) {
    return <EmptyLine text="Nenhuma tarefa aberta" />;
  }
  return (
    <FlexWidget style={{ width: 'match_parent', flexGap: 4 }}>
      {tasks.slice(0, 5).map((t, i) => (
        <TextWidget
          key={`${i}-${t.title}`}
          text={`• ${t.title}`}
          truncate="END"
          maxLines={1}
          style={{ fontSize: 12, color: C.ink }}
        />
      ))}
    </FlexWidget>
  );
}

function EventLines({ events }: { events: WidgetSnapshot['events'] }) {
  if (events.length === 0) {
    return <EmptyLine text="Nenhum compromisso próximo" />;
  }
  return (
    <FlexWidget style={{ width: 'match_parent', flexGap: 5 }}>
      {events.slice(0, 5).map((e, i) => (
        <FlexWidget
          key={`${i}-${e.title}`}
          style={{
            flexDirection: 'row',
            width: 'match_parent',
            alignItems: 'flex-start',
          }}
        >
          <TextWidget
            text={e.when}
            style={{
              fontSize: 11,
              fontWeight: '700',
              color: C.accentDeep,
              marginRight: 6,
            }}
          />
          <TextWidget
            text={e.title}
            truncate="END"
            maxLines={2}
            style={{ fontSize: 12, color: C.ink }}
          />
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}

export function AgendaiWidget({
  kind,
  snapshot,
}: {
  kind: WidgetKind;
  snapshot: WidgetSnapshot;
}) {
  const showTasks = kind === 'tasks' || kind === 'home';
  const showEvents = kind === 'events' || kind === 'home';
  const title =
    kind === 'tasks' ? 'Tarefas' : kind === 'events' ? 'Agenda' : 'AgendAI';

  const count =
    kind === 'tasks'
      ? snapshot.tasks.length
      : kind === 'events'
        ? snapshot.events.length
        : snapshot.tasks.length + snapshot.events.length;

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: C.bg,
        borderRadius: 18,
        padding: 12,
        flexDirection: 'column',
      }}
    >
      <Header title={title} count={count} />

      <FlexWidget
        style={{
          flex: 1,
          width: 'match_parent',
          backgroundColor: C.surface,
          borderRadius: 14,
          padding: 10,
          flexDirection: 'column',
        }}
      >
        {kind === 'home' ? (
          <FlexWidget
            style={{
              flex: 1,
              width: 'match_parent',
              flexDirection: 'row',
              flexGap: 10,
            }}
          >
            <FlexWidget
              style={{
                flex: 1,
                flexDirection: 'column',
              }}
            >
              <TextWidget
                text="Tarefas"
                style={{
                  fontSize: 11,
                  fontWeight: '600',
                  color: C.muted,
                  marginBottom: 4,
                }}
              />
              <TaskLines tasks={snapshot.tasks.slice(0, 3)} />
            </FlexWidget>
            <FlexWidget
              style={{
                width: 1,
                height: 'match_parent',
                backgroundColor: C.line,
              }}
            />
            <FlexWidget
              style={{
                flex: 1,
                flexDirection: 'column',
              }}
            >
              <TextWidget
                text="Agenda"
                style={{
                  fontSize: 11,
                  fontWeight: '600',
                  color: C.muted,
                  marginBottom: 4,
                }}
              />
              <EventLines events={snapshot.events.slice(0, 3)} />
            </FlexWidget>
          </FlexWidget>
        ) : showTasks ? (
          <TaskLines tasks={snapshot.tasks} />
        ) : showEvents ? (
          <EventLines events={snapshot.events.slice(0, 4)} />
        ) : (
          <EmptyLine text="Sem dados" />
        )}
      </FlexWidget>
    </FlexWidget>
  );
}
