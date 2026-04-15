import { useState, useRef, useEffect, useCallback, memo, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  type ListRenderItemInfo,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useChatStore, type ChatMessage, type ChatAction } from '@/stores/chat-store';
import { useVoice } from '@/hooks/use-voice';
import { useColors } from '@/hooks/use-colors';
import { hapticLight } from '@/services/haptics';
import { spacing, fontSize, borderRadius } from '@/constants';
const ACTION_LABELS: Record<string, { icon: string; label: string }> = {
  create_task: { icon: '\u2705', label: 'Создать задачу' },
  complete_task: { icon: '\u2611\uFE0F', label: 'Завершить задачу' },
  complete_habit: { icon: '\uD83D\uDD01', label: 'Отметить привычку' },
  add_expense: { icon: '\uD83D\uDCB0', label: 'Записать расход' },
  add_income: { icon: '\uD83D\uDCB5', label: 'Записать доход' },
};

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

interface ChatBubbleProps {
  message: ChatMessage;
  onAction: (action: ChatAction) => void;
}

const ChatBubble = memo(function ChatBubble({ message, onAction }: ChatBubbleProps) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const isUser = message.role === 'user';

  return (
    <View style={[styles.bubbleRow, isUser ? styles.bubbleRowUser : styles.bubbleRowAssistant]}>
      {!isUser && (
        <View style={styles.avatarContainer}>
          <Feather name="cpu" size={16} color={c.primary} />
        </View>
      )}
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        <Text style={[styles.bubbleText, isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant]}>
          {message.content}
        </Text>
        <Text style={[styles.timestamp, isUser ? styles.timestampUser : styles.timestampAssistant]}>
          {formatTime(message.createdAt)}
        </Text>
        {message.actions && message.actions.length > 0 && (
          <View style={styles.actionsContainer}>
            {message.actions.map((action, index) => {
              const actionInfo = ACTION_LABELS[action.type];
              if (!actionInfo) return null;
              return (
                <TouchableOpacity
                  key={`${action.type}-${index}`}
                  style={styles.actionButton}
                  onPress={() => onAction(action)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.actionButtonText}>
                    {actionInfo.icon} {actionInfo.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
});

const SUGGESTIONS = [
  { emoji: '\uD83D\uDCCB', text: 'Какие у меня задачи на сегодня?' },
  { emoji: '\u2795', text: 'Создай задачу: купить продукты' },
  { emoji: '\uD83D\uDCB0', text: 'Сколько я потратил за неделю?' },
  { emoji: '\uD83D\uDCCA', text: 'Покажи мою статистику' },
  { emoji: '\uD83D\uDCA1', text: 'Как улучшить продуктивность?' },
  { emoji: '\uD83C\uDF0D', text: 'Последние новости в мире технологий' },
];

function EmptyState({ onSuggestion }: { onSuggestion?: (text: string) => void }) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  return (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconContainer}>
        <Feather name="message-circle" size={48} color={c.primary} />
      </View>
      <Text style={styles.emptyTitle}>AI Чат</Text>
      <Text style={styles.emptyText}>
        Спросите меня о чём угодно — от задач и финансов до любых вопросов!
      </Text>
      <View style={styles.suggestionsContainer}>
        <Text style={styles.suggestionsTitle}>Попробуйте:</Text>
        {SUGGESTIONS.map((s) => (
          <TouchableOpacity
            key={s.text}
            style={styles.suggestionChip}
            onPress={() => onSuggestion?.(s.text)}
            activeOpacity={0.7}
          >
            <Text style={styles.suggestionItem}>{`${s.emoji} ${s.text}`}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const { messages, isLoading, hasMore, sendMessage, fetchHistory, executeAction, clearHistory } = useChatStore();
  const { isRecording, isProcessing, lastResult, startRecording, stopRecording, amplitude } = useVoice();

  useEffect(() => {
    fetchHistory(0);
  }, [fetchHistory]);

  // When voice result arrives, send it as chat message
  useEffect(() => {
    if (lastResult?.transcript) {
      sendMessage(lastResult.transcript, true);
    }
  }, [lastResult, sendMessage]);

  const handleSend = useCallback(() => {
    const trimmed = inputText.trim();
    if (!trimmed || isLoading) return;
    setInputText('');
    sendMessage(trimmed, true);
  }, [inputText, isLoading, sendMessage]);

  const navigation = useNavigation<any>();
  const handleAction = useCallback((action: ChatAction) => {
    // Handle navigation actions from AI (e.g., "open kanban", "show pet")
    if (action.type === 'navigate' && action.data.screen) {
      hapticLight();
      navigation.navigate(String(action.data.screen), action.data.params ?? undefined);
      return;
    }
    executeAction(action);
  }, [executeAction, navigation]);

  const handleLoadMore = useCallback(() => {
    if (!isLoading && hasMore) {
      fetchHistory();
    }
  }, [isLoading, hasMore, fetchHistory]);

  const renderItem = useCallback(({ item }: ListRenderItemInfo<ChatMessage>) => (
    <ChatBubble message={item} onAction={handleAction} />
  ), [handleAction]);

  const keyExtractor = useCallback((item: ChatMessage, index: number) => `${item.id}-${index}`, []);

  const handleSuggestion = useCallback((text: string) => {
    sendMessage(text, true);
  }, [sendMessage]);

  const handleClearChat = useCallback(() => {
    Alert.alert(
      'Очистить чат?',
      'Вся история сообщений будет удалена.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Очистить',
          style: 'destructive',
          onPress: () => clearHistory(),
        },
      ],
    );
  }, [clearHistory]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View style={styles.chatHeader}>
        <Text style={styles.chatTitle}>AI Чат</Text>
        <TouchableOpacity style={styles.clearBtn} onPress={handleClearChat} activeOpacity={0.7}>
          <Feather name="trash-2" size={20} color={c.textSecondary} />
        </TouchableOpacity>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        inverted
        contentContainerStyle={messages.length === 0 ? styles.emptyListContent : styles.listContent}
        ListEmptyComponent={<EmptyState onSuggestion={handleSuggestion} />}
        ListFooterComponent={
          isLoading && messages.length > 0 ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={c.primary} />
            </View>
          ) : null
        }
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.3}
        showsVerticalScrollIndicator={false}
      />

      {isLoading && messages.length > 0 && messages[0]?.role === 'user' && (
        <View style={styles.typingContainer}>
          <View style={styles.typingBubble}>
            <ActivityIndicator size="small" color={c.textSecondary} />
            <Text style={styles.typingText}>LifeOS думает...</Text>
          </View>
        </View>
      )}

      <View style={styles.inputArea}>
        <View style={styles.inputRow}>
          <TouchableOpacity
            style={[styles.micButton, isRecording && styles.micButtonActive]}
            activeOpacity={0.7}
            onPressIn={() => startRecording()}
            onPressOut={() => stopRecording()}
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color={c.primary} />
            ) : (
              <Feather name="mic" size={20} color={isRecording ? c.text : c.textSecondary} />
            )}
          </TouchableOpacity>
          <TextInput
            style={styles.textInput}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Напишите сообщение..."
            placeholderTextColor={c.textSecondary}
            multiline
            maxLength={2000}
            returnKeyType="default"
          />
          <TouchableOpacity
            style={[styles.sendButton, inputText.trim() ? styles.sendButtonActive : null]}
            onPress={handleSend}
            disabled={!inputText.trim() || isLoading}
            activeOpacity={0.7}
          >
            <Feather
              name="send"
              size={20}
              color={inputText.trim() ? c.text : c.textSecondary}
            />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}


type C = ReturnType<typeof useColors>;

function createStyles(c: C) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    listContent: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    emptyListContent: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
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
    avatarContainer: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.sm,
      marginTop: spacing.xs,
    },
    bubble: {
      padding: spacing.md,
      borderRadius: borderRadius.lg,
      flexShrink: 1,
    },
    bubbleUser: {
      backgroundColor: c.primary,
      borderBottomRightRadius: spacing.xs,
    },
    bubbleAssistant: {
      backgroundColor: c.surface,
      borderBottomLeftRadius: spacing.xs,
    },
    bubbleText: {
      fontSize: fontSize.md,
      lineHeight: 22,
    },
    bubbleTextUser: {
      color: c.text,
    },
    bubbleTextAssistant: {
      color: c.text,
    },
    timestamp: {
      fontSize: fontSize.xs,
      marginTop: spacing.xs,
    },
    timestampUser: {
      color: 'rgba(255,255,255,0.6)',
      textAlign: 'right',
    },
    timestampAssistant: {
      color: c.textSecondary,
    },
    actionsContainer: {
      marginTop: spacing.sm,
      gap: spacing.xs,
    },
    actionButton: {
      backgroundColor: c.surfaceLight,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: borderRadius.sm,
    },
    actionButtonText: {
      color: c.text,
      fontSize: fontSize.sm,
      fontWeight: '500',
    },
    loadingContainer: {
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    typingContainer: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
    },
    typingBubble: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surface,
      alignSelf: 'flex-start',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: borderRadius.md,
      gap: spacing.sm,
    },
    typingText: {
      color: c.textSecondary,
      fontSize: fontSize.sm,
      fontStyle: 'italic',
    },
    inputArea: {
      backgroundColor: c.surface,
      borderTopWidth: 1,
      borderTopColor: c.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      paddingBottom: Platform.OS === 'ios' ? spacing.lg : spacing.sm,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing.sm,
    },
    micButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.surfaceLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    micButtonActive: {
      backgroundColor: c.danger,
    },
    textInput: {
      flex: 1,
      backgroundColor: c.surfaceLight,
      borderRadius: borderRadius.lg,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      color: c.text,
      fontSize: fontSize.md,
      maxHeight: 100,
      minHeight: 40,
    },
    sendButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.surfaceLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendButtonActive: {
      backgroundColor: c.primary,
    },
    emptyContainer: {
      alignItems: 'center',
      paddingHorizontal: spacing.xl,
    },
    emptyIconContainer: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.lg,
    },
    emptyTitle: {
      fontSize: fontSize.xl,
      fontWeight: '700',
      color: c.text,
      marginBottom: spacing.sm,
    },
    emptyText: {
      fontSize: fontSize.md,
      color: c.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
      marginBottom: spacing.lg,
    },
    suggestionsContainer: {
      alignSelf: 'stretch',
      backgroundColor: c.surface,
      borderRadius: borderRadius.md,
      padding: spacing.md,
    },
    suggestionsTitle: {
      fontSize: fontSize.sm,
      fontWeight: '600',
      color: c.textSecondary,
      marginBottom: spacing.sm,
    },
    suggestionItem: {
      fontSize: fontSize.sm,
      color: c.text,
      paddingVertical: spacing.xs,
    },
    suggestionChip: {
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: borderRadius.sm,
    },
    chatHeader: {
      flexDirection: 'row' as const,
      justifyContent: 'space-between' as const,
      alignItems: 'center' as const,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    chatTitle: {
      fontSize: fontSize.xl,
      fontWeight: '700' as const,
      color: c.text,
    },
    clearBtn: {
      padding: spacing.sm,
    },
  });
}
