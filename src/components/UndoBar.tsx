import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../context/AppContext';
import { UNDO_ANIM_MS } from '../constants/undo';
import { colors } from '../theme/colors';

/** Barra discreta de desfazer, com fade/slide suave. */
export function UndoBar() {
  const insets = useSafeAreaInsets();
  const { undoSnapshot, undoLastChange } = useApp();
  const [visible, setVisible] = useState(false);
  const [label, setLabel] = useState('');
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;
  const snapshotId = undoSnapshot?.id ?? null;

  useEffect(() => {
    if (snapshotId && undoSnapshot) {
      setLabel(undoSnapshot.label);
      setVisible(true);
      opacity.setValue(0);
      translateY.setValue(14);
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: UNDO_ANIM_MS,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: UNDO_ANIM_MS,
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }

    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: UNDO_ANIM_MS,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 10,
        duration: UNDO_ANIM_MS,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setVisible(false);
    });
  }, [snapshotId, undoSnapshot, opacity, translateY]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.wrap,
        {
          bottom: Math.max(insets.bottom, 8) + 64,
          opacity,
          transform: [{ translateY }],
        },
      ]}
      pointerEvents={undoSnapshot ? 'auto' : 'none'}
    >
      <Text style={styles.text} numberOfLines={1}>
        Salvo: {label}
      </Text>
      <Pressable
        onPress={() => {
          if (!undoSnapshot) return;
          void undoLastChange();
        }}
        hitSlop={8}
      >
        <Text style={styles.action}>Desfazer</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: colors.ink,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  text: {
    flex: 1,
    fontFamily: 'DMSans_400Regular',
    fontSize: 13,
    color: '#fff',
  },
  action: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: colors.accentSoft,
  },
});
