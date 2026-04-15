import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  SafeAreaView,
  Animated,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';
import {
  useVoiceConversation,
  type ConversationState,
} from '@/hooks/use-voice-conversation';
import { VoiceWaveform } from '@/components/voice/voice-waveform';
import type { Theme } from '@/constants/themes';

// ----------------------------------------------------------------
// Status Dot colors
// ----------------------------------------------------------------

function statusDotColor(state: ConversationState, c: Theme): string {
  switch (state) {
    case 'listening':
      return '#EF4444'; // red
    case 'processing':
      return '#F59E0B'; // yellow
    case 'speaking':
      return c.success;
    default:
      return c.textMuted;
  }
}

function statusLabel(state: ConversationState): string {
  switch (state) {
    case 'listening':
      return 'Слушаю... (остановлюсь сам)';
    case 'processing':
      return 'Думаю...';
    case 'speaking':
      return 'Говорю...';
    case 'confirming':
      return 'Жду ответа';
    default:
      return '';
  }
}

// ----------------------------------------------------------------
// Component
// ----------------------------------------------------------------

export default function VoiceConversationScreen() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const navigation = useNavigation();
  const scrollRef = useRef<ScrollView>(null);
  const [inputText, setInputText] = useState('');

  const {
    state,
    mode,
    session,
    isThinking,
    suggestions,
    amplitude,
    startConversation,
    stopListening,
    endConversation,
    sendText,
    sendSuggestion,
    toggleMode,
  } = useVoiceConversation();

  // Animated pulse ring for mic button (driven by amplitude)
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (state === 'listening') {
      // Scale ring based on voice amplitude (0-1)
      const targetScale = 1 + amplitude * 0.6;
      Animated.spring(pulseAnim, {
        toValue: targetScale,
        friction: 6,
        tension: 80,
        useNativeDriver: true,
      }).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [amplitude, state, pulseAnim]);

  // Auto-start conversation on mount
  useEffect(() => {
    startConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const timer = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 100);
    return () => clearTimeout(timer);
  }, [session?.messages.length, isThinking]);

  const handleClose = useCallback(() => {
    endConversation();
    navigation.goBack();
  }, [endConversation, navigation]);

  const handleMicPress = useCallback(() => {
    if (state === 'idle') {
      startConversation();
    } else {
      stopListening();
    }
  }, [state, startConversation, stopListening]);

  const handleSendText = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    setInputText('');
    sendText(text);
  }, [inputText, sendText]);

  const handleSuggestionPress = useCallback(
    (text: string) => {
      sendSuggestion(text);
    },
    [sendSuggestion],
  );

  const isActive = state !== 'idle';
  const isListening = state === 'listening';

  const handleStartContinuous = useCallback(() => {
    startConversation('continuous');
  }, [startConversation]);

  const isContinuous = mode === 'continuous';

  // ---- IDLE state ----
  if (!isActive && !session) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.idleContainer}>
          <Text style={styles.idleTitle}>Привет, я LifeOS</Text>
          <Text style={styles.idleSubtitle}>
            Нажми на микрофон для разговора{'\n'}или активируй режим общения
          </Text>
          <TouchableOpacity
            style={styles.idleMicButton}
            onPress={handleMicPress}
            activeOpacity={0.7}
          >
            <Feather name="mic" size={40} color={c.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.continuousButton, { borderColor: c.primary }]}
            onPress={handleStartContinuous}
            activeOpacity={0.7}
          >
            <Feather name="radio" size={18} color={c.primary} />
            <Text style={[styles.continuousButtonText, { color: c.primary }]}>
              Режим общения
            </Text>
          </TouchableOpacity>
          <Text style={[styles.continuousHint, { color: c.textSecondary }]}>
            AI слушает постоянно, скажи «стоп» чтобы выключить
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ---- ACTIVE state ----
  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: isContinuous ? c.success : statusDotColor(state, c) },
              ]}
            />
            <Text style={styles.headerStatus}>
              {isContinuous ? 'Режим общения' : statusLabel(state)}
            </Text>
            {isContinuous && (
              <View style={[styles.liveTag, { backgroundColor: c.success + '20', borderColor: c.success }]}>
                <Text style={[styles.liveTagText, { color: c.success }]}>LIVE</Text>
              </View>
            )}
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={[styles.modeToggle, isContinuous && { backgroundColor: c.primary + '20' }]}
              onPress={toggleMode}
              activeOpacity={0.7}
            >
              <Feather name={isContinuous ? 'radio' : 'mic'} size={16} color={isContinuous ? c.primary : c.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={handleClose}
              activeOpacity={0.7}
            >
              <Feather name="x" size={24} color={c.text} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Messages */}
        <ScrollView
          ref={scrollRef}
          style={styles.messagesContainer}
          contentContainerStyle={styles.messagesContent}
          showsVerticalScrollIndicator={false}
        >
          {session?.messages.map((msg) => (
            <View key={msg.id}>
              {/* Text bubble */}
              {msg.text ? (
                <View
                  style={[
                    styles.bubbleRow,
                    msg.role === 'user'
                      ? styles.bubbleRowUser
                      : styles.bubbleRowAssistant,
                  ]}
                >
                  {msg.role === 'assistant' && (
                    <View style={styles.avatarDot}>
                      <Feather name="cpu" size={14} color={c.primary} />
                    </View>
                  )}
                  <View
                    style={[
                      styles.bubble,
                      msg.role === 'user'
                        ? styles.bubbleUser
                        : styles.bubbleAssistant,
                    ]}
                  >
                    <Text
                      style={[
                        styles.bubbleText,
                        msg.role === 'user'
                          ? styles.bubbleTextUser
                          : styles.bubbleTextAssistant,
                      ]}
                    >
                      {msg.text}
                    </Text>
                  </View>
                </View>
              ) : null}

              {/* Action badge */}
              {msg.action && (
                <View
                  style={[
                    styles.actionBadge,
                    msg.action.status === 'success'
                      ? styles.actionBadgeSuccess
                      : styles.actionBadgeError,
                  ]}
                >
                  <Text style={styles.actionBadgeIcon}>
                    {msg.action.status === 'success' ? '\u2705' : '\u274C'}
                  </Text>
                  <Text style={styles.actionBadgeText}>
                    {msg.action.message}
                  </Text>
                </View>
              )}
            </View>
          ))}

          {/* Thinking indicator */}
          {isThinking && (
            <View style={[styles.bubbleRow, styles.bubbleRowAssistant]}>
              <View style={styles.avatarDot}>
                <Feather name="cpu" size={14} color={c.primary} />
              </View>
              <View style={[styles.bubble, styles.bubbleAssistant]}>
                <ActivityIndicator size="small" color={c.textSecondary} />
              </View>
            </View>
          )}
        </ScrollView>

        {/* Waveform visualizer when listening */}
        {isListening && (
          <View style={styles.waveformContainer}>
            <VoiceWaveform
              amplitude={amplitude}
              isActive={isListening}
              color={c.danger}
              height={32}
              width={120}
            />
            <Text style={styles.waveformHint}>
              {isContinuous ? 'Слушаю... скажи «стоп» чтобы выключить' : 'Говорите — я остановлюсь автоматически'}
            </Text>
          </View>
        )}

        {/* Suggestions */}
        {suggestions.length > 0 && !isListening && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.suggestionsContent}
            style={styles.suggestionsContainer}
          >
            {suggestions.map((s) => (
              <TouchableOpacity
                key={s}
                style={styles.suggestionChip}
                onPress={() => handleSuggestionPress(s)}
                activeOpacity={0.7}
              >
                <Text style={styles.suggestionText}>{s}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Input area */}
        <View style={styles.inputArea}>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.textInput}
              value={inputText}
              onChangeText={setInputText}
              placeholder="Напишите сообщение..."
              placeholderTextColor={c.textMuted}
              returnKeyType="send"
              onSubmitEditing={handleSendText}
              editable={state !== 'processing' && state !== 'idle'}
            />
            {inputText.trim() ? (
              <TouchableOpacity
                style={styles.sendButton}
                onPress={handleSendText}
                activeOpacity={0.7}
              >
                <Feather name="send" size={20} color={c.text} />
              </TouchableOpacity>
            ) : (
              <View style={styles.micWrapper}>
                {isListening && (
                  <Animated.View
                    style={[
                      styles.micPulseRing,
                      {
                        transform: [{ scale: pulseAnim }],
                        borderColor: c.danger,
                      },
                    ]}
                  />
                )}
                <TouchableOpacity
                  style={[
                    styles.micButton,
                    isListening && styles.micButtonActive,
                  ]}
                  onPress={handleMicPress}
                  activeOpacity={0.7}
                >
                  {state === 'processing' ? (
                    <ActivityIndicator size="small" color={c.primary} />
                  ) : (
                    <Feather
                      name="mic"
                      size={22}
                      color={isListening ? c.text : c.textSecondary}
                    />
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ----------------------------------------------------------------
// Styles
// ----------------------------------------------------------------

type C = Theme;

function createStyles(c: C) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    flex: {
      flex: 1,
    },

    // ---- Idle state ----
    idleContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
    },
    idleTitle: {
      fontSize: fontSize.xxl,
      fontWeight: '700',
      color: c.text,
      marginBottom: spacing.sm,
    },
    idleSubtitle: {
      fontSize: fontSize.md,
      color: c.textSecondary,
      textAlign: 'center',
      marginBottom: spacing.xl * 2,
    },
    idleMicButton: {
      width: 96,
      height: 96,
      borderRadius: 48,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: c.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.4,
      shadowRadius: 12,
      elevation: 8,
    },
    continuousButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm + 2,
      borderRadius: borderRadius.xl,
      borderWidth: 1.5,
      marginTop: spacing.lg,
    },
    continuousButtonText: {
      fontSize: fontSize.sm,
      fontWeight: '600',
    },
    continuousHint: {
      fontSize: fontSize.xs,
      marginTop: spacing.sm,
      textAlign: 'center',
    },

    // ---- Header ----
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    modeToggle: {
      padding: spacing.xs + 2,
      borderRadius: borderRadius.sm,
    },
    liveTag: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: borderRadius.sm,
      borderWidth: 1,
    },
    liveTagText: {
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 1,
    },
    statusDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    headerStatus: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      fontWeight: '500',
    },
    closeButton: {
      padding: spacing.xs,
    },

    // ---- Messages ----
    messagesContainer: {
      flex: 1,
    },
    messagesContent: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      paddingBottom: spacing.md,
    },
    bubbleRow: {
      flexDirection: 'row',
      marginVertical: spacing.xs,
      maxWidth: '85%',
    },
    bubbleRowUser: {
      alignSelf: 'flex-end',
    },
    bubbleRowAssistant: {
      alignSelf: 'flex-start',
    },
    avatarDot: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.xs,
      marginTop: 2,
    },
    bubble: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      borderRadius: borderRadius.lg,
      maxWidth: '100%',
      flexShrink: 1,
    },
    bubbleUser: {
      backgroundColor: c.primary,
      borderBottomRightRadius: borderRadius.sm,
    },
    bubbleAssistant: {
      backgroundColor: c.surface,
      borderBottomLeftRadius: borderRadius.sm,
    },
    bubbleText: {
      fontSize: fontSize.md,
      lineHeight: 22,
    },
    bubbleTextUser: {
      color: '#FFFFFF',
    },
    bubbleTextAssistant: {
      color: c.text,
    },

    // ---- Action badges ----
    actionBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      marginLeft: 36,
      marginTop: spacing.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: borderRadius.sm,
      gap: spacing.xs,
    },
    actionBadgeSuccess: {
      backgroundColor: 'rgba(34,197,94,0.15)',
    },
    actionBadgeError: {
      backgroundColor: 'rgba(239,68,68,0.15)',
    },
    actionBadgeIcon: {
      fontSize: fontSize.sm,
    },
    actionBadgeText: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
    },

    // ---- Waveform ----
    waveformContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.sm,
      gap: spacing.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    waveformHint: {
      fontSize: fontSize.xs,
      color: c.textMuted,
    },

    // ---- Suggestions ----
    suggestionsContainer: {
      maxHeight: 52,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    suggestionsContent: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
    },
    suggestionChip: {
      backgroundColor: c.surface,
      borderRadius: borderRadius.xl,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      borderWidth: 1,
      borderColor: c.border,
    },
    suggestionText: {
      fontSize: fontSize.sm,
      color: c.text,
    },

    // ---- Input area ----
    inputArea: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      backgroundColor: c.background,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    textInput: {
      flex: 1,
      backgroundColor: c.surface,
      borderRadius: borderRadius.xl,
      paddingHorizontal: spacing.md,
      paddingVertical: Platform.OS === 'ios' ? spacing.sm + 2 : spacing.sm,
      fontSize: fontSize.md,
      color: c.text,
      maxHeight: 100,
    },
    sendButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    micWrapper: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    micPulseRing: {
      position: 'absolute',
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 2,
      opacity: 0.4,
    },
    micButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    micButtonActive: {
      backgroundColor: c.danger,
    },
  });
}
