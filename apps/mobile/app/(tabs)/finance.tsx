import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFinanceStore } from '@/stores/finance-store';
import { Card, Button, Input, Modal } from '@/components/ui';
import { colors, spacing, fontSize, borderRadius } from '@/constants/colors';
import { expenseCategories } from '@/constants/categories';
import { formatDate, getMonthKey } from '@/utils/dates';

const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
] as const;

type TabType = 'expenses' | 'incomes';
type ModalType = 'expense' | 'income' | null;

function formatAmount(amount: number): string {
  return amount.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

// --- Memoized list items ---

interface ExpenseItemData {
  id: string;
  date: string;
  category: string;
  description: string;
  amount: number;
}

const ExpenseItem = React.memo(function ExpenseItem({
  item,
  onDelete,
}: {
  item: ExpenseItemData;
  onDelete: (id: string) => void;
}) {
  const cat = expenseCategories[item.category as keyof typeof expenseCategories] ?? expenseCategories.other;
  const dateLabel = item.date.slice(8, 10) + '.' + item.date.slice(5, 7);

  const handleDelete = useCallback(() => {
    Alert.alert('Удалить расход?', `${item.description} — ${formatAmount(item.amount)} ₸`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => onDelete(item.id) },
    ]);
  }, [item.id, item.description, item.amount, onDelete]);

  return (
    <TouchableOpacity onLongPress={handleDelete} activeOpacity={0.7}>
      <Card style={styles.listItem}>
        <View style={styles.listItemLeft}>
          <View style={[styles.categoryDot, { backgroundColor: cat.color }]}>
            <Text style={styles.categoryIcon}>{cat.icon}</Text>
          </View>
          <View style={styles.listItemInfo}>
            <Text style={styles.listItemTitle} numberOfLines={1}>
              {item.description || cat.label}
            </Text>
            <Text style={styles.listItemDate}>{dateLabel} · {cat.label}</Text>
          </View>
        </View>
        <Text style={styles.expenseAmount}>-{formatAmount(item.amount)} ₸</Text>
      </Card>
    </TouchableOpacity>
  );
});

interface IncomeItemData {
  id: string;
  date: string;
  source: string;
  amount: number;
}

const IncomeItem = React.memo(function IncomeItem({
  item,
  onDelete,
}: {
  item: IncomeItemData;
  onDelete: (id: string) => void;
}) {
  const dateLabel = item.date.slice(8, 10) + '.' + item.date.slice(5, 7);

  const handleDelete = useCallback(() => {
    Alert.alert('Удалить доход?', `${item.source} — ${formatAmount(item.amount)} ₸`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => onDelete(item.id) },
    ]);
  }, [item.id, item.source, item.amount, onDelete]);

  return (
    <TouchableOpacity onLongPress={handleDelete} activeOpacity={0.7}>
      <Card style={styles.listItem}>
        <View style={styles.listItemLeft}>
          <View style={[styles.categoryDot, { backgroundColor: colors.success }]}>
            <Text style={styles.categoryIcon}>💵</Text>
          </View>
          <View style={styles.listItemInfo}>
            <Text style={styles.listItemTitle} numberOfLines={1}>
              {item.source}
            </Text>
            <Text style={styles.listItemDate}>{dateLabel}</Text>
          </View>
        </View>
        <Text style={styles.incomeAmount}>+{formatAmount(item.amount)} ₸</Text>
      </Card>
    </TouchableOpacity>
  );
});

// --- Category bar chart ---

interface CategoryBarProps {
  category: string;
  amount: number;
  total: number;
  maxAmount: number;
}

const CategoryBar = React.memo(function CategoryBar({
  category,
  amount,
  total,
  maxAmount,
}: CategoryBarProps) {
  const cat = expenseCategories[category as keyof typeof expenseCategories] ?? expenseCategories.other;
  const percentage = total > 0 ? Math.round((amount / total) * 100) : 0;
  const barWidth = maxAmount > 0 ? Math.max((amount / maxAmount) * 100, 4) : 4;

  return (
    <View style={styles.barRow}>
      <View style={styles.barLabel}>
        <Text style={styles.barIcon}>{cat.icon}</Text>
        <Text style={styles.barText} numberOfLines={1}>{cat.label}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${barWidth}%`, backgroundColor: cat.color }]} />
      </View>
      <View style={styles.barValue}>
        <Text style={styles.barAmount}>{formatAmount(amount)} ₸</Text>
        <Text style={styles.barPercent}>{percentage}%</Text>
      </View>
    </View>
  );
});

// --- Main screen ---

export default function FinanceScreen() {
  const {
    expenses, incomes, summary, isLoading,
    fetchSummary, fetchExpenses, fetchIncomes,
    createExpense, deleteExpense, createIncome, deleteIncome,
  } = useFinanceStore();

  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [activeTab, setActiveTab] = useState<TabType>('expenses');
  const [modalType, setModalType] = useState<ModalType>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Form state
  const [formAmount, setFormAmount] = useState('');
  const [formCategory, setFormCategory] = useState('food');
  const [formDescription, setFormDescription] = useState('');
  const [formSource, setFormSource] = useState('');

  const monthKey = useMemo(() => getMonthKey(currentDate), [currentDate]);
  const monthLabel = useMemo(
    () => `${MONTHS_RU[currentDate.getMonth()]} ${currentDate.getFullYear()}`,
    [currentDate],
  );

  const loadData = useCallback(async () => {
    await Promise.all([
      fetchSummary(monthKey),
      fetchExpenses(monthKey),
      fetchIncomes(monthKey),
    ]);
  }, [monthKey, fetchSummary, fetchExpenses, fetchIncomes]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const goToPrevMonth = useCallback(() => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() - 1);
      return d;
    });
  }, []);

  const goToNextMonth = useCallback(() => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + 1);
      return d;
    });
  }, []);

  const resetForm = useCallback(() => {
    setFormAmount('');
    setFormCategory('food');
    setFormDescription('');
    setFormSource('');
  }, []);

  const openExpenseModal = useCallback(() => {
    resetForm();
    setModalType('expense');
  }, [resetForm]);

  const openIncomeModal = useCallback(() => {
    resetForm();
    setModalType('income');
  }, [resetForm]);

  const handleCreateExpense = useCallback(async () => {
    const amount = parseFloat(formAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Ошибка', 'Введите корректную сумму');
      return;
    }
    try {
      await createExpense({
        date: formatDate(new Date()),
        category: formCategory,
        description: formDescription || expenseCategories[formCategory as keyof typeof expenseCategories]?.label || '',
        amount,
      });
      setModalType(null);
      void loadData();
    } catch {
      Alert.alert('Ошибка', 'Не удалось добавить расход');
    }
  }, [formAmount, formCategory, formDescription, createExpense, loadData]);

  const handleCreateIncome = useCallback(async () => {
    const amount = parseFloat(formAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Ошибка', 'Введите корректную сумму');
      return;
    }
    if (!formSource.trim()) {
      Alert.alert('Ошибка', 'Укажите источник дохода');
      return;
    }
    try {
      await createIncome({
        date: formatDate(new Date()),
        source: formSource.trim(),
        amount,
      });
      setModalType(null);
      void loadData();
    } catch {
      Alert.alert('Ошибка', 'Не удалось добавить доход');
    }
  }, [formAmount, formSource, createIncome, loadData]);

  const handleDeleteExpense = useCallback(async (id: string) => {
    try {
      await deleteExpense(id);
      void loadData();
    } catch {
      Alert.alert('Ошибка', 'Не удалось удалить расход');
    }
  }, [deleteExpense, loadData]);

  const handleDeleteIncome = useCallback(async (id: string) => {
    try {
      await deleteIncome(id);
      void loadData();
    } catch {
      Alert.alert('Ошибка', 'Не удалось удалить доход');
    }
  }, [deleteIncome, loadData]);

  const sortedExpenses = useMemo(
    () => [...expenses].sort((a, b) => b.date.localeCompare(a.date)),
    [expenses],
  );

  const sortedIncomes = useMemo(
    () => [...incomes].sort((a, b) => b.date.localeCompare(a.date)),
    [incomes],
  );

  const topCategories = useMemo(() => {
    return (summary?.topCategories ?? []).slice(0, 5);
  }, [summary]);

  const maxCategoryAmount = useMemo(
    () => topCategories.reduce((max, c) => Math.max(max, c.amount), 0),
    [topCategories],
  );

  const balanceColor = (summary?.balance ?? 0) >= 0 ? colors.success : colors.danger;

  const categoryKeys = useMemo(() => Object.keys(expenseCategories), []);

  // --- Render ---

  const renderExpenseItem = useCallback(
    ({ item }: { item: ExpenseItemData }) => (
      <ExpenseItem item={item} onDelete={handleDeleteExpense} />
    ),
    [handleDeleteExpense],
  );

  const renderIncomeItem = useCallback(
    ({ item }: { item: IncomeItemData }) => (
      <IncomeItem item={item} onDelete={handleDeleteIncome} />
    ),
    [handleDeleteIncome],
  );

  const keyExtractor = useCallback((item: { id: string }) => item.id, []);

  const ListHeader = useMemo(() => (
    <View>
      {/* Month selector */}
      <View style={styles.monthSelector}>
        <TouchableOpacity onPress={goToPrevMonth} hitSlop={12}>
          <Text style={styles.monthArrow}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{monthLabel}</Text>
        <TouchableOpacity onPress={goToNextMonth} hitSlop={12}>
          <Text style={styles.monthArrow}>{'>'}</Text>
        </TouchableOpacity>
      </View>

      {/* Summary card */}
      <Card style={styles.summaryCard}>
        {isLoading && !summary ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Доходы</Text>
                <Text style={[styles.summaryValue, { color: colors.success }]}>
                  {formatAmount(summary?.totalIncomes ?? 0)} ₸
                </Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Расходы</Text>
                <Text style={[styles.summaryValue, { color: colors.danger }]}>
                  {formatAmount(summary?.totalExpenses ?? 0)} ₸
                </Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Баланс</Text>
                <Text style={[styles.summaryValue, { color: balanceColor }]}>
                  {formatAmount(summary?.balance ?? 0)} ₸
                </Text>
              </View>
            </View>
          </>
        )}
      </Card>

      {/* Top categories bar chart */}
      {topCategories.length > 0 && (
        <Card style={styles.chartCard}>
          <Text style={styles.chartTitle}>Топ расходов</Text>
          {topCategories.map((c) => (
            <CategoryBar
              key={c.category}
              category={c.category}
              amount={c.amount}
              total={summary?.totalExpenses ?? 0}
              maxAmount={maxCategoryAmount}
            />
          ))}
        </Card>
      )}

      {/* Tab switcher */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'expenses' && styles.tabActive]}
          onPress={() => setActiveTab('expenses')}
        >
          <Text style={[styles.tabText, activeTab === 'expenses' && styles.tabTextActive]}>
            Расходы
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'incomes' && styles.tabActive]}
          onPress={() => setActiveTab('incomes')}
        >
          <Text style={[styles.tabText, activeTab === 'incomes' && styles.tabTextActive]}>
            Доходы
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  ), [
    goToPrevMonth, goToNextMonth, monthLabel, isLoading, summary,
    balanceColor, topCategories, maxCategoryAmount, activeTab,
  ]);

  const EmptyList = useMemo(() => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>
        {activeTab === 'expenses' ? 'Нет расходов за этот месяц' : 'Нет доходов за этот месяц'}
      </Text>
    </View>
  ), [activeTab]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {activeTab === 'expenses' ? (
        <FlatList
          data={sortedExpenses}
          renderItem={renderExpenseItem}
          keyExtractor={keyExtractor}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={EmptyList}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
        />
      ) : (
        <FlatList
          data={sortedIncomes}
          renderItem={renderIncomeItem}
          keyExtractor={keyExtractor}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={EmptyList}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.8}
        onPress={activeTab === 'expenses' ? openExpenseModal : openIncomeModal}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* Expense modal */}
      <Modal
        visible={modalType === 'expense'}
        onClose={() => setModalType(null)}
        title="Новый расход"
      >
        <ScrollView keyboardShouldPersistTaps="handled">
          <Input
            label="Сумма (₸)"
            placeholder="0"
            keyboardType="numeric"
            value={formAmount}
            onChangeText={setFormAmount}
          />

          <Text style={styles.fieldLabel}>Категория</Text>
          <View style={styles.chipRow}>
            {categoryKeys.map((key) => {
              const cat = expenseCategories[key as keyof typeof expenseCategories];
              const isSelected = formCategory === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.chip,
                    isSelected && { backgroundColor: cat.color, borderColor: cat.color },
                  ]}
                  onPress={() => setFormCategory(key)}
                >
                  <Text style={styles.chipIcon}>{cat.icon}</Text>
                  <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Input
            label="Описание"
            placeholder="Необязательно"
            value={formDescription}
            onChangeText={setFormDescription}
            style={styles.inputGap}
          />

          <Button
            title="Добавить расход"
            onPress={handleCreateExpense}
            style={styles.submitButton}
          />
        </ScrollView>
      </Modal>

      {/* Income modal */}
      <Modal
        visible={modalType === 'income'}
        onClose={() => setModalType(null)}
        title="Новый доход"
      >
        <ScrollView keyboardShouldPersistTaps="handled">
          <Input
            label="Сумма (₸)"
            placeholder="0"
            keyboardType="numeric"
            value={formAmount}
            onChangeText={setFormAmount}
          />

          <Input
            label="Источник"
            placeholder="Зарплата, фриланс..."
            value={formSource}
            onChangeText={setFormSource}
            style={styles.inputGap}
          />

          <Button
            title="Добавить доход"
            onPress={handleCreateIncome}
            style={styles.submitButton}
          />
        </ScrollView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: 100,
  },

  // Month selector
  monthSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    gap: spacing.lg,
  },
  monthArrow: {
    color: colors.primary,
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  monthLabel: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '600',
    minWidth: 160,
    textAlign: 'center',
  },

  // Summary
  summaryCard: {
    marginBottom: spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryDivider: {
    width: 1,
    height: 40,
    backgroundColor: colors.border,
  },
  summaryLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    marginBottom: spacing.xs,
  },
  summaryValue: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },

  // Chart
  chartCard: {
    marginBottom: spacing.md,
  },
  chartTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  barLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 90,
    gap: spacing.xs,
  },
  barIcon: {
    fontSize: 14,
  },
  barText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    flexShrink: 1,
  },
  barTrack: {
    flex: 1,
    height: 12,
    backgroundColor: colors.surfaceLight,
    borderRadius: 6,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 6,
  },
  barValue: {
    width: 80,
    alignItems: 'flex-end',
  },
  barAmount: {
    color: colors.text,
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  barPercent: {
    color: colors.textSecondary,
    fontSize: 10,
  },

  // Tabs
  tabRow: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.xs,
    marginBottom: spacing.md,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  tabText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  tabTextActive: {
    color: colors.text,
  },

  // List items
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  listItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
  },
  categoryDot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryIcon: {
    fontSize: 18,
  },
  listItemInfo: {
    flex: 1,
  },
  listItemTitle: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  listItemDate: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  expenseAmount: {
    color: colors.danger,
    fontSize: fontSize.sm,
    fontWeight: '700',
    marginLeft: spacing.sm,
  },
  incomeAmount: {
    color: colors.success,
    fontSize: fontSize.sm,
    fontWeight: '700',
    marginLeft: spacing.sm,
  },

  // Empty
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  fabText: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '300',
    marginTop: -2,
  },

  // Modal form
  fieldLabel: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '500',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  chipIcon: {
    fontSize: 14,
  },
  chipText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
  },
  chipTextSelected: {
    color: colors.text,
    fontWeight: '600',
  },
  inputGap: {
    marginTop: spacing.md,
  },
  submitButton: {
    marginTop: spacing.lg,
  },
});
