import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '../theme/colors';

export type OrganizeOption<T extends string> = {
  id: T;
  label: string;
};

type Props<T extends string> = {
  /** Botão discreto no header, ex.: "Organizar" */
  triggerLabel?: string;
  title: string;
  options: Array<OrganizeOption<T>>;
  value: T;
  onChange: (id: T) => void;
  secondaryTitle?: string;
  secondaryOptions?: Array<OrganizeOption<string>>;
  secondaryValue?: string;
  onSecondaryChange?: (id: string) => void;
};

/**
 * Abre um sheet na parte de baixo. Não empurra a lista.
 */
export function OrganizeSheet<T extends string>({
  triggerLabel = 'Organizar',
  title,
  options,
  value,
  onChange,
  secondaryTitle,
  secondaryOptions,
  secondaryValue,
  onSecondaryChange,
}: Props<T>) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={8}>
        <Text style={styles.trigger}>{triggerLabel}</Text>
      </Pressable>

      <Modal
        transparent
        animationType="fade"
        visible={open}
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setOpen(false)}>
          <Pressable
            style={styles.sheet}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>{title}</Text>
            <View style={styles.options}>
              {options.map((opt) => {
                const on = opt.id === value;
                return (
                  <Pressable
                    key={opt.id}
                    style={[styles.option, on && styles.optionOn]}
                    onPress={() => {
                      onChange(opt.id);
                      if (!secondaryOptions) setOpen(false);
                    }}
                  >
                    <Text style={[styles.optionText, on && styles.optionTextOn]}>
                      {opt.label}
                    </Text>
                    {on ? <Text style={styles.check}>✓</Text> : null}
                  </Pressable>
                );
              })}
            </View>

            {secondaryOptions &&
            secondaryValue != null &&
            onSecondaryChange ? (
              <>
                <Text style={styles.sheetTitleSecondary}>
                  {secondaryTitle ?? 'Ordenar'}
                </Text>
                <View style={styles.options}>
                  {secondaryOptions.map((opt) => {
                    const on = opt.id === secondaryValue;
                    return (
                      <Pressable
                        key={opt.id}
                        style={[styles.option, on && styles.optionOn]}
                        onPress={() => onSecondaryChange(opt.id)}
                      >
                        <Text
                          style={[
                            styles.optionText,
                            on && styles.optionTextOn,
                          ]}
                        >
                          {opt.label}
                        </Text>
                        {on ? <Text style={styles.check}>✓</Text> : null}
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            <Pressable
              style={styles.done}
              onPress={() => setOpen(false)}
            >
              <Text style={styles.doneText}>Pronto</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: colors.accent,
  },
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
    maxHeight: '72%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.line,
    marginBottom: 14,
  },
  sheetTitle: {
    fontFamily: 'Fraunces_600SemiBold',
    fontSize: 22,
    color: colors.ink,
    marginBottom: 12,
  },
  sheetTitleSecondary: {
    fontFamily: 'Fraunces_600SemiBold',
    fontSize: 18,
    color: colors.ink,
    marginTop: 18,
    marginBottom: 10,
  },
  options: { gap: 8 },
  option: {
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgSoft,
  },
  optionOn: {
    backgroundColor: colors.accentSoft,
  },
  optionText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: colors.ink,
  },
  optionTextOn: {
    color: colors.accentDeep,
  },
  check: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: colors.accentDeep,
  },
  done: {
    marginTop: 16,
    backgroundColor: colors.ink,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  doneText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 16,
    color: '#fff',
  },
});
