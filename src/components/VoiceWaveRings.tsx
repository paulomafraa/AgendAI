import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

type Props = {
  active: boolean;
  /** Volume from speech module: roughly -2..10 (≤0 quiet). */
  volume: number;
};

const RING_COUNT = 3;

/**
 * Anéis pulsando em volta do mic, reagindo ao volume da fala.
 */
export function VoiceWaveRings({ active, volume }: Props) {
  const rings = useRef(
    Array.from({ length: RING_COUNT }, () => new Animated.Value(0)),
  ).current;
  const level = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const n = Math.min(1, Math.max(0, (volume + 1) / 8));
    Animated.timing(level, {
      toValue: active ? n : 0,
      duration: 70,
      useNativeDriver: true,
    }).start();
  }, [active, volume, level]);

  useEffect(() => {
    if (!active) {
      rings.forEach((r) => {
        r.stopAnimation();
        r.setValue(0);
      });
      return;
    }

    const loops = rings.map((ring, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 320),
          Animated.timing(ring, {
            toValue: 1,
            duration: 1500,
            useNativeDriver: true,
          }),
          Animated.timing(ring, {
            toValue: 0,
            duration: 1,
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => {
      loops.forEach((l) => l.stop());
      rings.forEach((r) => r.setValue(0));
    };
  }, [active, rings]);

  if (!active) return null;

  return (
    <View style={styles.wrap} pointerEvents="none">
      {rings.map((ring, index) => {
        const minScale = 1 + index * 0.2;
        const maxScale = minScale + 0.55;
        const scale = Animated.multiply(
          ring.interpolate({
            inputRange: [0, 1],
            outputRange: [minScale, maxScale],
          }),
          level.interpolate({
            inputRange: [0, 1],
            outputRange: [0.9, 1.15],
          }),
        );
        const opacity = Animated.multiply(
          ring.interpolate({
            inputRange: [0, 0.25, 1],
            outputRange: [0.55, 0.4, 0],
          }),
          level.interpolate({
            inputRange: [0, 1],
            outputRange: [0.4, 1],
          }),
        );
        return (
          <Animated.View
            key={index}
            style={[
              styles.ring,
              {
                transform: [{ scale }],
                opacity,
                borderColor:
                  index === 0
                    ? 'rgba(255,255,255,0.85)'
                    : 'rgba(204,251,241,0.55)',
              },
            ]}
          />
        );
      })}
      <Animated.View
        style={[
          styles.glow,
          {
            transform: [
              {
                scale: level.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 1.45],
                }),
              },
            ],
            opacity: level.interpolate({
              inputRange: [0, 1],
              outputRange: [0.18, 0.48],
            }),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 2.5,
  },
  glow: {
    position: 'absolute',
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(204,251,241,0.95)',
  },
});
