import { useState, useRef, useEffect, useCallback, memo } from 'react';
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
  type ListRenderItemInfo,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useChatStore, type ChatMessage, type ChatAction } from '@/stores/chat-store';
import { colors, spacing, fontSize, borderRadius } from '@/constants/colors';

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
  const isUser = message.role === 'user';

  return (
    <View style={[styles.bubbleRow, isUser ? styles.bubbleRowUser : styles.bubbleRowAssistant]}>
      {!isUser && (
        <View style={styles.avatarContainer}>
          <Feather name="cpu" size={16} color={colors.primary} />
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

function EmptyState() {
  return (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconContainer}>
        <Feather name="message-circle" size={48} color={colors.primary} />
      </View>
      <Text style={styles.emptyTitle}>LifeOS AI-помощник</Text>
      <Text style={styles.emptyText}>
        Привет! Я LifeOS — ваш AI-помощник. Спросите меня о чём угодно!
      </Text>
      <View style={styles.suggestionsContainer}>
        <Text style={styles.suggestionsTitle}>Попробуйте:</Text>
        <Text style={styles.suggestionItem}>{'"\uD83D\uDCCB Какие у меня задачи на сегодня?"'}</Text>
        <Text style={styles.suggestionItem}>{'"\u2795 Создай задачу: купить продукты"'}</Text>
        <Text style={styles.suggestionItem}>{'"\uD83D\uDCB0 Сколько я потратил за неделю?"'}</Text>
        <Text style={styles.suggestionItem}>{'"\uD83D\uDCCA Покажи мою статистику"'}</Text>
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const { messages, isLoading, hasMore, sendMessage, fetchHistory, executeAction } = useChatStore();

  useEffect(() => {
    fetchHistory(0);
  }, [fetchHistory]);

  const handleSend = useCallback(() => {
    const trimmed = inputText.trim();
    if (!trimmed || isLoading) return;
    setInputText('');
    sendMessage(trimmed);
  }, [inputText, isLoading, sendMessage]);

  const handleAction = useCallback((action: ChatAction) => {
    executeAction(action);
  }, [executeAction]);

  const handleLoadMore = useCallback(() => {
    if (!isLoading && hasMore) {
      fetchHistory();
    }
  }, [isLoading, hasMore, fetchHistory]);

  const renderItem = useCallback(({ item }: ListRenderItemInfo<ChatMessage>) => (
    <ChatBubble message={item} onAction={handleAction} />
  ), [handleAction]);

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        inverted
        contentContainerStyle={messages.length === 0 ? styles.emptyListContent : styles.listContent}
        ListEmptyComponent={EmptyState}
        ListFooterComponent={
          isLoading && messages.length > 0 ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
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
            <ActivityIndicator size="small" color={colors.textSecondary} />
            <Text style={styles.typingText}>LifeOS думает...</Text>
          </View>
        </View>
      )}

      <View style={styles.inputArea}>
        <View style={styles.inputRow}>
          <TouchableOpacity style={styles.micButton} activeOpacity={0.7}>
            <Feather name="mic" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
          <TextInput
            style={styles.textInput}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Напишите сообщение..."
            placeholderTextColor={colors.textSecondary}
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
              color={inputText.trim() ? colors.text : colors.textSecondary}
            />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
    backgroundColor: colors.surface,
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
    backgroundColor: colors.primary,
    borderBottomRightRadius: spacing.xs,
  },
  bubbleAssistant: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: spacing.xs,
  },
  bubbleText: {
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  bubbleTextUser: {
    color: colors.text,
  },
  bubbleTextAssistant: {
    color: colors.text,
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
    color: colors.textSecondary,
  },
  actionsContainer: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  actionButton: {
    backgroundColor: colors.surfaceLight,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.sm,
  },
  actionButtonText: {
    color: colors.text,
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
    backgroundColor: colors.surface,
    alignSelf: 'flex-start',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
  typingText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontStyle: 'italic',
  },
  inputArea: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
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
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textInput: {
    flex: 1,
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: fontSize.md,
    maxHeight: 100,
    minHeight: 40,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonActive: {
    backgroundColor: colors.primary,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyText: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  suggestionsContainer: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  suggestionsTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  suggestionItem: {
    fontSize: fontSize.sm,
    color: colors.text,
    paddingVertical: spacing.xs,
  },
});
