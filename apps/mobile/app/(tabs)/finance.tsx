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
  Dimensions,
} from 'react-native';
import { KbScrollView } from '@/components/shared/kb-scroll-view';
import { ScreenSafeArea } from '@/components/shared/screen-safe-area';
import { useFinanceStore } from '@/stores/finance-store';
import { useBudgetStore } from '@/stores/budget-store';
import { useDebtStore, parseDueDate, pickMoneyGoal, type Debt } from '@/stores/debt-store';
import { useGoalStore } from '@/stores/goal-store';
import { Card, Button, Input, Modal, SlideTabs, SwipeableRow, TapToAdd } from '@/components/ui';
import { spacing, fontSize, borderRadius } from '@/constants';
import { expenseCategories } from '@/constants/categories';
import { FadeInView } from '@/components/ui/fade-in-view';
import { formatDate, getMonthKey, getWeekDays, isToday, isSameDay } from '@/utils/dates';
import { useColors } from '@/hooks/use-colors';
import { hapticSelection } from '@/services/haptics';
import { useNavigation } from '@react-navigation/native';
import { goalPercent } from '@/utils/goal-progress';
import { useInTools } from '@/hooks/use-content-width';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
] as const;

const INCOME_SOURCES = [
  { key: 'salary', label: 'Зарплата', icon: '💼' },
  { key: 'freelance', label: 'Фриланс', icon: '💻' },
  { key: 'investments', label: 'Инвестиции', icon: '📈' },
  { key: 'other', label: 'Другое', icon: '📦' },
] as const;

const SLIDE_TABS = [
  { key: 'overview', title: 'Обзор', icon: '📊' },
  { key: 'tables', title: 'Таблицы', icon: '📋' },
  { key: 'journal', title: 'Журнал', icon: '📝' },
] as const;

type ModalType = 'expense' | 'income' | 'debt' | 'budget' | null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(amount: number): string {
  return amount.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' \u20B8';
}

function formatMoneyShort(amount: number): string {
  if (Math.abs(amount) >= 1_000_000) {
    return (amount / 1_000_000).toFixed(1).replace('.0', '') + 'M \u20B8';
  }
  if (Math.abs(amount) >= 1_000) {
    return (amount / 1_000).toFixed(1).replace('.0', '') + 'K \u20B8';
  }
  return amount.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' \u20B8';
}

function formatAmount(amount: number): string {
  return amount.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

function getDaysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function getDaysRemainingInMonth(date: Date): number {
  const total = getDaysInMonth(date);
  const today = new Date();
  if (
    today.getFullYear() === date.getFullYear() &&
    today.getMonth() === date.getMonth()
  ) {
    return Math.max(0, total - today.getDate());
  }
  return total;
}

function getBudgetStatusColor(
  spent: number,
  limit: number,
  c: ReturnType<typeof useColors>,
): string {
  if (limit <= 0) return c.textSecondary;
  const pct = spent / limit;
  if (pct >= 1) return c.danger;
  if (pct >= 0.8) return c.warning;
  return c.success;
}

// ---------------------------------------------------------------------------
// Memoized sub-components
// ---------------------------------------------------------------------------

// --- Category bar for overview ---

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
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const cat =
    expenseCategories[category as keyof typeof expenseCategories] ??
    expenseCategories.other;
  const percentage = total > 0 ? Math.round((amount / total) * 100) : 0;
  const barWidth = maxAmount > 0 ? Math.max((amount / maxAmount) * 100, 4) : 4;

  return (
    <View style={styles.barRow}>
      <View style={styles.barLabel}>
        <Text style={styles.barIcon}>{cat.icon}</Text>
        <Text style={styles.barText} numberOfLines={1}>
          {cat.label}
        </Text>
      </View>
      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            { width: `${barWidth}%`, backgroundColor: cat.color },
          ]}
        />
      </View>
      <View style={styles.barValue}>
        <Text style={styles.barAmount}>{formatAmount(amount)} ₸</Text>
        <Text style={styles.barPercent}>{percentage}%</Text>
      </View>
    </View>
  );
});

// --- Pie slice visual (simple colored blocks) ---

const PieSegment = React.memo(function PieSegment({
  color,
  label,
  icon,
  percentage,
  amount,
}: {
  color: string;
  label: string;
  icon: string;
  percentage: number;
  amount: number;
}) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);

  return (
    <View style={styles.pieSegmentRow}>
      <View style={[styles.pieSegmentDot, { backgroundColor: color }]} />
      <Text style={styles.pieSegmentIcon}>{icon}</Text>
      <Text style={styles.pieSegmentLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.pieSegmentPercent}>{percentage}%</Text>
      <Text style={styles.pieSegmentAmount}>{formatMoney(amount)}</Text>
    </View>
  );
});

// --- Table row for budget/income ---

interface TableRowProps {
  cells: string[];
  isHeader?: boolean;
  isTotal?: boolean;
  statusColor?: string;
}

const TableRow = React.memo(function TableRow({
  cells,
  isHeader = false,
  isTotal = false,
  statusColor,
}: TableRowProps) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);

  const rowStyle = [
    styles.tableRow,
    isHeader && styles.tableRowHeader,
    isTotal && styles.tableRowTotal,
    !isHeader && !isTotal && styles.tableRowBody,
  ];

  return (
    <View style={rowStyle}>
      {cells.map((cell, i) => {
        const isFirstCol = i === 0;
        const cellStyle = [
          styles.tableCell,
          isFirstCol && styles.tableCellFirst,
          isHeader && styles.tableCellHeader,
          isTotal && styles.tableCellTotal,
          !isFirstCol && styles.tableCellRight,
          statusColor && !isFirstCol && i === cells.length - 1
            ? { color: statusColor }
            : null,
        ];
        return (
          <Text key={i} style={cellStyle} numberOfLines={1}>
            {cell}
          </Text>
        );
      })}
    </View>
  );
});

// --- Expense journal row ---

interface ExpenseItemData {
  id: string;
  date: string;
  category: string;
  description: string;
  amount: number;
}

const JournalExpenseRow = React.memo(function JournalExpenseRow({
  item,
  index,
  onDelete,
}: {
  item: ExpenseItemData;
  index: number;
  onDelete: (id: string) => void;
}) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const cat =
    expenseCategories[item.category as keyof typeof expenseCategories] ??
    expenseCategories.other;
  const isEven = index % 2 === 0;

  // Сдвиг влево + красный минус — удаление без лишнего Alert.
  const handleDelete = useCallback(() => {
    onDelete(item.id);
  }, [item.id, onDelete]);

  return (
    <SwipeableRow onDelete={handleDelete} deleteLabel="Удалить расход">
      <View
        style={[
          styles.journalRow,
          isEven ? styles.journalRowEven : styles.journalRowOdd,
        ]}
      >
        <View style={styles.journalCellDesc}>
          <Text style={styles.journalCellIcon}>{cat.icon}</Text>
          <Text style={styles.journalCellText} numberOfLines={1}>
            {item.description || cat.label}
          </Text>
        </View>
        <Text style={styles.journalCellCat} numberOfLines={1}>
          {cat.label}
        </Text>
        <Text style={[styles.journalCellAmount, { color: c.danger }]}>
          -{formatAmount(item.amount)} ₸
        </Text>
      </View>
    </SwipeableRow>
  );
});

// --- Income journal row ---

interface IncomeItemData {
  id: string;
  date: string;
  source: string;
  amount: number;
}

const JournalIncomeRow = React.memo(function JournalIncomeRow({
  item,
  index,
  onDelete,
}: {
  item: IncomeItemData;
  index: number;
  onDelete: (id: string) => void;
}) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const isEven = index % 2 === 0;

  // Сдвиг влево + красный минус — удаление без лишнего Alert.
  const handleDelete = useCallback(() => {
    onDelete(item.id);
  }, [item.id, onDelete]);

  return (
    <SwipeableRow onDelete={handleDelete} deleteLabel="Удалить доход">
      <View
        style={[
          styles.journalRow,
          isEven ? styles.journalRowEven : styles.journalRowOdd,
        ]}
      >
        <View style={styles.journalCellDesc}>
          <Text style={styles.journalCellIcon}>💵</Text>
          <Text style={styles.journalCellText} numberOfLines={1}>
            {item.source}
          </Text>
        </View>
        <Text style={[styles.journalCellAmount, { color: c.success }]}>
          +{formatAmount(item.amount)} ₸
        </Text>
      </View>
    </SwipeableRow>
  );
});

// --- Debt row ---

const DebtRow = React.memo(function DebtRow({
  debt,
  onDelete,
  onSettle,
}: {
  debt: Debt;
  onDelete: (id: string) => void;
  onSettle: (id: string) => void;
}) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const iOwe = debt.direction === 'i_owe';
  const due = debt.dueDate ? debt.dueDate.slice(0, 10).split('-').reverse().join('.') : 'без срока';

  // Сдвиг влево + красный минус — убрать (ошибся); «Вернули/Отдал» — закрыть.
  const handleDelete = useCallback(() => onDelete(debt.id), [debt.id, onDelete]);
  const handleSettle = useCallback(() => onSettle(debt.id), [debt.id, onSettle]);

  return (
    <SwipeableRow onDelete={handleDelete} deleteLabel="Убрать долг">
      <View style={styles.debtRow}>
        <View style={styles.debtHeader}>
          <Text style={styles.debtCreditor} numberOfLines={1}>
            {iOwe ? `Я должен: ${debt.personName}` : `Мне должен: ${debt.personName}`}
          </Text>
          <Text style={styles.debtDeadline}>{due}</Text>
        </View>
        <View style={styles.debtAmounts}>
          <Text style={[styles.debtRemaining, { color: iOwe ? c.danger : c.success }]}>
            {debt.amount != null ? formatMoney(debt.amount) : '—'}
          </Text>
          <TouchableOpacity onPress={handleSettle} hitSlop={8} accessibilityRole="button" accessibilityLabel={iOwe ? 'Отдал долг' : 'Вернули долг'}>
            <Text style={styles.debtSettle}>{iOwe ? 'Отдал' : 'Вернули'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SwipeableRow>
  );
});

// --- Week day selector ---

interface WeekDaySelectorProps {
  selectedDate: Date;
  onSelect: (date: Date) => void;
}

const WeekDaySelector = React.memo(function WeekDaySelector({
  selectedDate,
  onSelect,
}: WeekDaySelectorProps) {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const weekDays = useMemo(() => getWeekDays(selectedDate), [selectedDate]);

  return (
    <View style={styles.weekRow}>
      {weekDays.map((wd) => {
        const selected = isSameDay(wd.date, selectedDate);
        const today = isToday(wd.date);
        return (
          <TouchableOpacity
            key={wd.date.toISOString()}
            style={[
              styles.weekDay,
              selected && styles.weekDaySelected,
              today && !selected && styles.weekDayToday,
            ]}
            onPress={() => { hapticSelection(); onSelect(wd.date); }}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.weekDayLabel,
                selected && styles.weekDayLabelSelected,
              ]}
            >
              {wd.label}
            </Text>
            <Text
              style={[
                styles.weekDayNum,
                selected && styles.weekDayNumSelected,
                today && !selected && styles.weekDayNumToday,
              ]}
            >
              {wd.dayNum}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function FinanceScreen() {
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);

  // --- Stores ---
  const {
    expenses,
    incomes,
    summary,
    isLoading,
    fetchSummary,
    fetchExpenses,
    fetchIncomes,
    createExpense,
    deleteExpense,
    createIncome,
    deleteIncome,
  } = useFinanceStore();

  const {
    budgets,
    advice,
    fetchBudgets,
    setBudget,
    fetchAdvice,
  } = useBudgetStore();

  // --- Date state ---
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [journalDate, setJournalDate] = useState(() => new Date());

  // --- Modal state ---
  const [modalType, setModalType] = useState<ModalType>(null);
  const [refreshing, setRefreshing] = useState(false);

  // --- Form state ---
  const [formAmount, setFormAmount] = useState('');
  const [formCategory, setFormCategory] = useState('food');
  const [formDescription, setFormDescription] = useState('');
  const [formSource, setFormSource] = useState('');
  const [formDate, setFormDate] = useState('');

  // --- Debt form ---
  const [formCreditor, setFormCreditor] = useState('');
  const [formDeadline, setFormDeadline] = useState('');
  const [formDirection, setFormDirection] = useState<Debt['direction']>('i_owe');

  // --- Budget form ---
  const [budgetCategory, setBudgetCategory] = useState('food');
  const [budgetLimit, setBudgetLimit] = useState('');

  // --- Долги — с сервера (те же, что голосом «Ахмет должен мне 500 000») ---
  const debts = useDebtStore((s) => s.debts);
  const fetchDebts = useDebtStore((s) => s.fetchDebts);
  const addDebt = useDebtStore((s) => s.addDebt);
  const settleDebt = useDebtStore((s) => s.settleDebt);
  const removeDebt = useDebtStore((s) => s.removeDebt);

  // --- Цель накоплений — годовая финансовая цель с суммой; нет — честно «не задана»
  //     (раньше здесь были зашитые 500 000 ₸) ---
  const yearlyGoals = useGoalStore((s) => s.yearlyGoals);
  const fetchYearlyGoals = useGoalStore((s) => s.fetchYearlyGoals);
  const moneyGoal = useMemo(() => pickMoneyGoal(yearlyGoals), [yearlyGoals]);

  // --- Derived values ---
  const monthKey = useMemo(() => getMonthKey(currentDate), [currentDate]);
  const monthLabel = useMemo(
    () => `${MONTHS_RU[currentDate.getMonth()]} ${currentDate.getFullYear()}`,
    [currentDate],
  );

  const totalExpenses = summary?.totalExpenses ?? 0;
  const totalIncomes = summary?.totalIncomes ?? 0;
  const balance = summary?.balance ?? 0;
  const savings = Math.max(0, balance);

  const daysInMonth = useMemo(() => getDaysInMonth(currentDate), [currentDate]);
  const daysRemaining = useMemo(
    () => getDaysRemainingInMonth(currentDate),
    [currentDate],
  );
  const daysPassed = daysInMonth - daysRemaining;
  const avgDailyExpense = daysPassed > 0 ? totalExpenses / daysPassed : 0;
  const recommendedDaily =
    daysRemaining > 0
      ? Math.max(0, (totalIncomes - totalExpenses)) / daysRemaining
      : 0;

  const topCategories = useMemo(
    () => (summary?.topCategories ?? []).slice(0, 5),
    [summary],
  );
  const maxCategoryAmount = useMemo(
    () => topCategories.reduce((max, cat) => Math.max(max, cat.amount), 0),
    [topCategories],
  );

  // Category breakdown for pie legend
  const allCategoryBreakdown = useMemo(() => {
    const catMap: Record<string, number> = {};
    for (const exp of expenses) {
      catMap[exp.category] = (catMap[exp.category] || 0) + exp.amount;
    }
    const entries = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
    return entries.map(([cat, amount]) => ({
      category: cat,
      amount,
      percentage:
        totalExpenses > 0 ? Math.round((amount / totalExpenses) * 100) : 0,
    }));
  }, [expenses, totalExpenses]);

  // Budget table data
  const budgetTableData = useMemo(() => {
    const catKeys = Object.keys(expenseCategories) as Array<
      keyof typeof expenseCategories
    >;
    const catExpenses: Record<string, number> = {};
    for (const exp of expenses) {
      catExpenses[exp.category] = (catExpenses[exp.category] || 0) + exp.amount;
    }
    return catKeys.map((key) => {
      const cat = expenseCategories[key];
      const limit =
        budgets.find((b) => b.category === key)?.monthlyLimit ?? 0;
      const spent = catExpenses[key] ?? 0;
      const remaining = limit > 0 ? limit - spent : 0;
      return { key, label: cat.label, icon: cat.icon, limit, spent, remaining };
    });
  }, [expenses, budgets]);

  const budgetTotals = useMemo(() => {
    const totalLimit = budgetTableData.reduce((s, r) => s + r.limit, 0);
    const totalSpent = budgetTableData.reduce((s, r) => s + r.spent, 0);
    const totalRemaining = totalLimit - totalSpent;
    return { totalLimit, totalSpent, totalRemaining };
  }, [budgetTableData]);

  // Income by source
  const incomeBySource = useMemo(() => {
    const srcMap: Record<string, number> = {};
    for (const inc of incomes) {
      const src = inc.source.toLowerCase();
      if (src.includes('зарплата') || src.includes('salary')) {
        srcMap['salary'] = (srcMap['salary'] || 0) + inc.amount;
      } else if (src.includes('фриланс') || src.includes('freelance')) {
        srcMap['freelance'] = (srcMap['freelance'] || 0) + inc.amount;
      } else if (
        src.includes('инвест') ||
        src.includes('invest') ||
        src.includes('дивиденд')
      ) {
        srcMap['investments'] = (srcMap['investments'] || 0) + inc.amount;
      } else {
        srcMap['other'] = (srcMap['other'] || 0) + inc.amount;
      }
    }
    return srcMap;
  }, [incomes]);


  // Journal: filter by selected date
  const journalDateStr = useMemo(() => formatDate(journalDate), [journalDate]);

  const dailyExpenses = useMemo(
    () =>
      expenses
        .filter((e) => e.date.startsWith(journalDateStr))
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
    [expenses, journalDateStr],
  );

  const dailyIncomes = useMemo(
    () =>
      incomes
        .filter((i) => i.date.startsWith(journalDateStr))
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
    [incomes, journalDateStr],
  );

  const dailyExpenseTotal = useMemo(
    () => dailyExpenses.reduce((s, e) => s + e.amount, 0),
    [dailyExpenses],
  );

  const dailyIncomeTotal = useMemo(
    () => dailyIncomes.reduce((s, i) => s + i.amount, 0),
    [dailyIncomes],
  );

  // --- Data loading ---
  const loadData = useCallback(async () => {
    await Promise.all([
      fetchSummary(monthKey),
      fetchExpenses(monthKey),
      fetchIncomes(monthKey),
      fetchBudgets(monthKey),
      fetchDebts().catch(() => {}),
      fetchYearlyGoals().catch(() => {}),
    ]);
  }, [monthKey, fetchSummary, fetchExpenses, fetchIncomes, fetchBudgets, fetchDebts, fetchYearlyGoals]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  // --- Navigation ---
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

  const goToPrevWeek = useCallback(() => {
    setJournalDate((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 7);
      return d;
    });
  }, []);

  const goToNextWeek = useCallback(() => {
    setJournalDate((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 7);
      return d;
    });
  }, []);

  const handleSelectJournalDate = useCallback((date: Date) => {
    setJournalDate(date);
  }, []);

  // --- Form handlers ---
  const resetForm = useCallback(() => {
    setFormAmount('');
    setFormCategory('food');
    setFormDescription('');
    setFormSource('');
    setFormDate('');
    setFormCreditor('');
    setFormDeadline('');
    setFormDirection('i_owe');
    setBudgetCategory('food');
    setBudgetLimit('');
  }, []);

  const openExpenseModal = useCallback(() => {
    resetForm();
    setModalType('expense');
  }, [resetForm]);

  const openIncomeModal = useCallback(() => {
    resetForm();
    setModalType('income');
  }, [resetForm]);

  const openDebtModal = useCallback(() => {
    resetForm();
    setModalType('debt');
  }, [resetForm]);

  const openBudgetModal = useCallback(() => {
    resetForm();
    setModalType('budget');
  }, [resetForm]);

  const handleCreateExpense = useCallback(async () => {
    const amount = parseFloat(formAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Ошибка', 'Введите корректную сумму');
      return;
    }
    try {
      await createExpense({
        date: formatDate(journalDate),
        category: formCategory,
        description:
          formDescription ||
          expenseCategories[formCategory as keyof typeof expenseCategories]
            ?.label ||
          '',
        amount,
      });
      setModalType(null);
      void loadData();
    } catch {
      Alert.alert('Ошибка', 'Не удалось добавить расход');
    }
  }, [
    formAmount,
    formCategory,
    formDescription,
    journalDate,
    createExpense,
    loadData,
  ]);

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
        date: formatDate(journalDate),
        source: formSource.trim(),
        amount,
      });
      setModalType(null);
      void loadData();
    } catch {
      Alert.alert('Ошибка', 'Не удалось добавить доход');
    }
  }, [formAmount, formSource, journalDate, createIncome, loadData]);

  const handleCreateDebt = useCallback(async () => {
    const amount = parseFloat(formAmount);
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Ошибка', 'Введите корректную сумму');
      return;
    }
    if (!formCreditor.trim()) {
      Alert.alert('Ошибка', formDirection === 'i_owe' ? 'Кому должен?' : 'Кто должен?');
      return;
    }
    const due = parseDueDate(formDeadline);
    if (!due.ok) {
      Alert.alert('Срок', due.error);
      return;
    }
    try {
      await addDebt({ personName: formCreditor.trim(), direction: formDirection, amount, dueDate: due.date });
      setModalType(null);
    } catch (err) {
      Alert.alert('Не сохранилось', err instanceof Error ? err.message : 'Попробуй ещё раз.');
    }
  }, [formAmount, formCreditor, formDeadline, formDirection, addDebt]);

  const handleDeleteDebt = useCallback(
    (id: string) => {
      removeDebt(id).catch((err) => Alert.alert('Не получилось', err instanceof Error ? err.message : 'Попробуй ещё раз.'));
    },
    [removeDebt],
  );

  const handleSettleDebt = useCallback(
    (id: string) => {
      settleDebt(id).catch((err) => Alert.alert('Не получилось', err instanceof Error ? err.message : 'Попробуй ещё раз.'));
    },
    [settleDebt],
  );

  const handleSetBudget = useCallback(async () => {
    const limit = parseFloat(budgetLimit);
    if (isNaN(limit) || limit <= 0) {
      Alert.alert('Ошибка', 'Введите корректный лимит');
      return;
    }
    try {
      await setBudget({
        category: budgetCategory,
        monthlyLimit: limit,
        month: currentDate.getMonth() + 1,
        year: currentDate.getFullYear(),
      });
      setModalType(null);
      void loadData();
    } catch {
      Alert.alert('Ошибка', 'Не удалось установить лимит');
    }
  }, [
    budgetLimit,
    budgetCategory,
    currentDate,
    setBudget,
    loadData,
  ]);

  const handleDeleteExpense = useCallback(
    async (id: string) => {
      try {
        await deleteExpense(id);
        void loadData();
      } catch {
        Alert.alert('Ошибка', 'Не удалось удалить расход');
      }
    },
    [deleteExpense, loadData],
  );

  const handleDeleteIncome = useCallback(
    async (id: string) => {
      try {
        await deleteIncome(id);
        void loadData();
      } catch {
        Alert.alert('Ошибка', 'Не удалось удалить доход');
      }
    },
    [deleteIncome, loadData],
  );

  const categoryKeys = useMemo(() => Object.keys(expenseCategories), []);

  // ---------------------------------------------------------------------------
  // Month header (shared between slides)
  // ---------------------------------------------------------------------------

  const MonthHeader = useMemo(
    () => (
      <View style={styles.monthSelector}>
        <TouchableOpacity onPress={goToPrevMonth} hitSlop={12}>
          <Text style={styles.monthArrow}>{'\u25C0'}</Text>
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{monthLabel}</Text>
        <TouchableOpacity onPress={goToNextMonth} hitSlop={12}>
          <Text style={styles.monthArrow}>{'\u25B6'}</Text>
        </TouchableOpacity>
      </View>
    ),
    [goToPrevMonth, goToNextMonth, monthLabel, styles],
  );

  // ---------------------------------------------------------------------------
  // SLIDE 1: Overview
  // ---------------------------------------------------------------------------

  const OverviewSlide = useMemo(
    () => (
      <KbScrollView
        style={styles.slideContainer}
        contentContainerStyle={styles.slideContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={c.primary}
          />
        }
      >
        {MonthHeader}

        {/* Summary card */}
        <Card style={styles.summaryCard}>
          {isLoading && !summary ? (
            <ActivityIndicator color={c.primary} />
          ) : (
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryIcon}>💰</Text>
                <Text style={styles.summaryLabel}>Накопление</Text>
                <Text
                  style={[
                    styles.summaryValue,
                    { color: balance >= 0 ? c.success : c.danger },
                  ]}
                >
                  {formatMoney(balance)}
                </Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryIcon}>📈</Text>
                <Text style={styles.summaryLabel}>Доход</Text>
                <Text style={[styles.summaryValue, { color: c.success }]}>
                  {formatMoney(totalIncomes)}
                </Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryIcon}>📉</Text>
                <Text style={styles.summaryLabel}>Расход</Text>
                <Text style={[styles.summaryValue, { color: c.danger }]}>
                  {formatMoney(totalExpenses)}
                </Text>
              </View>
            </View>
          )}
        </Card>

        {/* Metrics box */}
        <Card style={styles.metricsCard}>
          <Text style={styles.sectionTitle}>Обзор</Text>
          <View style={styles.metricsGrid}>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Средний расход в день</Text>
              <Text style={[styles.metricValue, { color: c.danger }]}>
                {formatMoney(Math.round(avgDailyExpense))}
              </Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Дней до конца месяца</Text>
              <Text style={[styles.metricValue, { color: c.primary }]}>
                {daysRemaining}
              </Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Рекомендуемый расход/день</Text>
              <Text style={[styles.metricValue, { color: c.success }]}>
                {formatMoney(Math.round(recommendedDaily))}
              </Text>
            </View>
          </View>
        </Card>

        {/* Top-5 expense categories */}
        {topCategories.length > 0 && (
          <Card style={styles.chartCard}>
            <Text style={styles.sectionTitle}>Топ-5 трат</Text>
            {topCategories.map((cat) => (
              <CategoryBar
                key={cat.category}
                category={cat.category}
                amount={cat.amount}
                total={totalExpenses}
                maxAmount={maxCategoryAmount}
              />
            ))}
          </Card>
        )}

        {/* Pie breakdown legend */}
        {allCategoryBreakdown.length > 0 && (
          <Card style={styles.chartCard}>
            <Text style={styles.sectionTitle}>Структура расходов</Text>

            {/* Visual pie (simplified colored bar) */}
            <View style={styles.pieBarContainer}>
              {allCategoryBreakdown.map((item) => {
                const cat =
                  expenseCategories[
                    item.category as keyof typeof expenseCategories
                  ] ?? expenseCategories.other;
                return (
                  <View
                    key={item.category}
                    style={[
                      styles.pieBarSegment,
                      {
                        flex: Math.max(item.percentage, 1),
                        backgroundColor: cat.color,
                      },
                    ]}
                  />
                );
              })}
            </View>

            {/* Legend */}
            {allCategoryBreakdown.map((item) => {
              const cat =
                expenseCategories[
                  item.category as keyof typeof expenseCategories
                ] ?? expenseCategories.other;
              return (
                <PieSegment
                  key={item.category}
                  color={cat.color}
                  label={cat.label}
                  icon={cat.icon}
                  percentage={item.percentage}
                  amount={item.amount}
                />
              );
            })}
          </Card>
        )}

        {/* Empty state */}
        {topCategories.length === 0 && !isLoading && (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyEmoji}>📊</Text>
            <Text style={styles.emptyTitle}>Нет данных</Text>
            <Text style={styles.emptyText}>
              Добавьте расходы и доходы, чтобы увидеть статистику
            </Text>
          </View>
        )}

        <View style={styles.bottomSpacer} />
      </KbScrollView>
    ),
    [
      MonthHeader,
      refreshing,
      handleRefresh,
      c,
      isLoading,
      summary,
      balance,
      totalIncomes,
      totalExpenses,
      avgDailyExpense,
      daysRemaining,
      recommendedDaily,
      topCategories,
      maxCategoryAmount,
      allCategoryBreakdown,
      styles,
    ],
  );

  // ---------------------------------------------------------------------------
  // SLIDE 2: Tables
  // ---------------------------------------------------------------------------

  const TablesSlide = useMemo(
    () => (
      <KbScrollView
        style={styles.slideContainer}
        contentContainerStyle={styles.slideContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={c.primary}
          />
        }
      >
        {MonthHeader}

        {/* INCOME TABLE */}
        <Card style={styles.tableCard}>
          <View style={styles.tableTitleRow}>
            <Text style={[styles.tableTitle, { color: c.success }]}>
              ДОХОДЫ
            </Text>
            <Text style={styles.tableTitleIcon}>📈</Text>
          </View>

          {/* Header */}
          <View style={styles.tableContainer}>
            {/* Колонка «Планируемый» убрана: план нигде не задавался и всегда был «—». */}
            <TableRow cells={['Категория', 'Получено']} isHeader />

            {/* Income rows */}
            {INCOME_SOURCES.map((src) => {
              const actual = incomeBySource[src.key] ?? 0;
              return (
                <TableRow
                  key={src.key}
                  cells={[`${src.icon} ${src.label}`, actual > 0 ? formatMoney(actual) : '—']}
                />
              );
            })}

            {/* Total */}
            <TableRow
              cells={['Итого', formatMoney(totalIncomes)]}
              isTotal
            />
          </View>
        </Card>

        {/* EXPENSE BUDGET TABLE */}
        <Card style={styles.tableCard}>
          <View style={styles.tableTitleRow}>
            <Text style={[styles.tableTitle, { color: c.danger }]}>
              РАСХОДЫ
            </Text>
            <TouchableOpacity onPress={openBudgetModal} hitSlop={8}>
              <Text style={styles.tableTitleAction}>Лимиты</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.tableContainer}>
            <TableRow
              cells={['Категория', 'Лимит', 'Потрачено', 'Остаток']}
              isHeader
            />

            {budgetTableData.map((row) => {
              const statusColor = getBudgetStatusColor(
                row.spent,
                row.limit,
                c,
              );
              return (
                <TableRow
                  key={row.key}
                  cells={[
                    `${row.icon} ${row.label}`,
                    row.limit > 0 ? formatMoney(row.limit) : '—',
                    row.spent > 0 ? formatMoney(row.spent) : '—',
                    row.limit > 0 ? formatMoney(row.remaining) : '—',
                  ]}
                  statusColor={statusColor}
                />
              );
            })}

            <TableRow
              cells={[
                'Итого',
                budgetTotals.totalLimit > 0
                  ? formatMoney(budgetTotals.totalLimit)
                  : '—',
                formatMoney(budgetTotals.totalSpent),
                budgetTotals.totalLimit > 0
                  ? formatMoney(budgetTotals.totalRemaining)
                  : '—',
              ]}
              isTotal
              statusColor={getBudgetStatusColor(
                budgetTotals.totalSpent,
                budgetTotals.totalLimit,
                c,
              )}
            />
          </View>
        </Card>

        {/* SAVINGS */}
        <Card style={styles.tableCard}>
          <View style={styles.tableTitleRow}>
            <Text style={[styles.tableTitle, { color: c.primary }]}>
              НАКОПЛЕНИЯ
            </Text>
            <Text style={styles.tableTitleIcon}>🏦</Text>
          </View>

          <View style={styles.savingsContainer}>
            {/* Только то, что знаем: остаток месяца и годовая цель с суммой.
                Раньше: зашитая цель 500 000 ₸ и «среднемесячное» из одного месяца. */}
            <View style={styles.savingsRow}>
              <Text style={styles.savingsLabel}>Отложено в этом месяце</Text>
              <Text style={[styles.savingsAmount, { color: balance >= 0 ? c.success : c.danger }]}>
                {formatMoney(balance)}
              </Text>
            </View>

            {moneyGoal ? (
              <>
                <View style={styles.savingsRow}>
                  <Text style={styles.savingsLabel} numberOfLines={2}>
                    Цель «{moneyGoal.goalText}»
                  </Text>
                  <Text style={[styles.savingsAmount, { color: c.primary }]}>
                    {formatMoney(moneyGoal.target ?? 0)}
                  </Text>
                </View>
                <View style={styles.savingsProgressTrack}>
                  <View
                    style={[
                      styles.savingsProgressFill,
                      {
                        width: `${goalPercent(moneyGoal.progress)}%`,
                        backgroundColor: goalPercent(moneyGoal.progress) >= 100 ? c.success : c.primary,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.savingsProgressText}>{goalPercent(moneyGoal.progress)}% от цели</Text>
              </>
            ) : (
              <Text style={styles.savingsProgressText}>
                Цели с суммой пока нет — задай её в «Целях», например «Накопить 1 000 000».
              </Text>
            )}
          </View>
        </Card>

        {/* DEBTS */}
        <Card style={styles.tableCard}>
          <View style={styles.tableTitleRow}>
            <Text style={[styles.tableTitle, { color: c.warning }]}>ДОЛГИ</Text>
          </View>

          {debts.length === 0 ? (
            <View style={styles.emptySmall}>
              <Text style={styles.emptySmallText}>
                Долгов нет — отлично! 🎉
              </Text>
            </View>
          ) : (
            debts.map((debt) => (
              <DebtRow
                key={debt.id}
                debt={debt}
                onDelete={handleDeleteDebt}
                onSettle={handleSettleDebt}
              />
            ))
          )}
          <TapToAdd hint="Новый долг" onPress={openDebtModal} />
        </Card>

        <View style={styles.bottomSpacer} />
      </KbScrollView>
    ),
    [
      MonthHeader,
      refreshing,
      handleRefresh,
      c,
      styles,
      incomeBySource,
      totalIncomes,
      budgetTableData,
      budgetTotals,
      moneyGoal,
      balance,
      debts,
      openBudgetModal,
      openDebtModal,
      handleDeleteDebt,
      handleSettleDebt,
    ],
  );

  // ---------------------------------------------------------------------------
  // SLIDE 3: Journal
  // ---------------------------------------------------------------------------

  const journalMonthLabel = useMemo(() => {
    const m = MONTHS_RU[journalDate.getMonth()];
    return `${journalDate.getDate()} ${m}`;
  }, [journalDate]);

  const JournalSlide = useMemo(
    () => (
      <KbScrollView
        style={styles.slideContainer}
        contentContainerStyle={styles.slideContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={c.primary}
          />
        }
      >
        {/* Week day selector */}
        <View style={styles.weekSelectorContainer}>
          <TouchableOpacity onPress={goToPrevWeek} hitSlop={12}>
            <Text style={styles.monthArrow}>{'\u25C0'}</Text>
          </TouchableOpacity>
          <View style={styles.weekSelectorCenter}>
            <WeekDaySelector
              selectedDate={journalDate}
              onSelect={handleSelectJournalDate}
            />
          </View>
          <TouchableOpacity onPress={goToNextWeek} hitSlop={12}>
            <Text style={styles.monthArrow}>{'\u25B6'}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.journalDateLabel}>{journalMonthLabel}</Text>

        {/* DAILY EXPENSES */}
        <Card style={styles.journalCard}>
          <View style={styles.journalTitleRow}>
            <Text style={[styles.journalTitle, { color: c.danger }]}>
              ЕЖЕДНЕВНЫЕ ТРАТЫ
            </Text>
            <Text style={styles.journalCount}>
              {dailyExpenses.length} записей
            </Text>
          </View>

          {dailyExpenses.length > 0 ? (
            <>
              {/* Table header */}
              <View style={styles.journalTableHeader}>
                <Text style={[styles.journalHeaderCell, styles.journalCellDescH]}>
                  Описание
                </Text>
                <Text style={styles.journalHeaderCell}>Категория</Text>
                <Text
                  style={[styles.journalHeaderCell, styles.journalCellAmountH]}
                >
                  Сумма
                </Text>
              </View>

              {/* Rows */}
              {dailyExpenses.map((item, idx) => (
                <FadeInView key={item.id} delay={idx * 30}>
                  <JournalExpenseRow
                    item={item}
                    index={idx}
                    onDelete={handleDeleteExpense}
                  />
                </FadeInView>
              ))}

              {/* Total */}
              <View style={styles.journalTotalRow}>
                <Text style={styles.journalTotalLabel}>Итого за день:</Text>
                <Text style={[styles.journalTotalValue, { color: c.danger }]}>
                  -{formatMoney(dailyExpenseTotal)}
                </Text>
              </View>
            </>
          ) : (
            <View style={styles.emptySmall}>
              <Text style={styles.emptySmallEmoji}>💸</Text>
              <Text style={styles.emptySmallText}>
                Нет расходов за этот день
              </Text>
            </View>
          )}
          <TapToAdd hint="Новый расход" onPress={openExpenseModal} />
        </Card>

        {/* DAILY INCOME */}
        <Card style={styles.journalCard}>
          <View style={styles.journalTitleRow}>
            <Text style={[styles.journalTitle, { color: c.success }]}>
              ЕЖЕДНЕВНЫЕ ПОСТУПЛЕНИЯ
            </Text>
            <Text style={styles.journalCount}>
              {dailyIncomes.length} записей
            </Text>
          </View>

          {dailyIncomes.length > 0 ? (
            <>
              {/* Table header */}
              <View style={styles.journalTableHeader}>
                <Text style={[styles.journalHeaderCell, styles.journalCellDescH]}>
                  Источник
                </Text>
                <Text
                  style={[styles.journalHeaderCell, styles.journalCellAmountH]}
                >
                  Сумма
                </Text>
              </View>

              {/* Rows */}
              {dailyIncomes.map((item, idx) => (
                <JournalIncomeRow
                  key={item.id}
                  item={item}
                  index={idx}
                  onDelete={handleDeleteIncome}
                />
              ))}

              {/* Total */}
              <View style={styles.journalTotalRow}>
                <Text style={styles.journalTotalLabel}>Итого за день:</Text>
                <Text
                  style={[styles.journalTotalValue, { color: c.success }]}
                >
                  +{formatMoney(dailyIncomeTotal)}
                </Text>
              </View>
            </>
          ) : (
            <View style={styles.emptySmall}>
              <Text style={styles.emptySmallEmoji}>💵</Text>
              <Text style={styles.emptySmallText}>
                Нет поступлений за этот день
              </Text>
            </View>
          )}
          <TapToAdd hint="Новый доход" onPress={openIncomeModal} />
        </Card>

        {/* Daily summary */}
        {(dailyExpenses.length > 0 || dailyIncomes.length > 0) && (
          <Card style={styles.journalSummaryCard}>
            <Text style={styles.journalSummaryTitle}>Итог дня</Text>
            <View style={styles.journalSummaryRow}>
              <View style={styles.journalSummaryItem}>
                <Text style={styles.journalSummaryLabel}>Доход</Text>
                <Text
                  style={[styles.journalSummaryValue, { color: c.success }]}
                >
                  +{formatMoney(dailyIncomeTotal)}
                </Text>
              </View>
              <View style={styles.journalSummaryDivider} />
              <View style={styles.journalSummaryItem}>
                <Text style={styles.journalSummaryLabel}>Расход</Text>
                <Text
                  style={[styles.journalSummaryValue, { color: c.danger }]}
                >
                  -{formatMoney(dailyExpenseTotal)}
                </Text>
              </View>
              <View style={styles.journalSummaryDivider} />
              <View style={styles.journalSummaryItem}>
                <Text style={styles.journalSummaryLabel}>Баланс</Text>
                <Text
                  style={[
                    styles.journalSummaryValue,
                    {
                      color:
                        dailyIncomeTotal - dailyExpenseTotal >= 0
                          ? c.success
                          : c.danger,
                    },
                  ]}
                >
                  {formatMoney(dailyIncomeTotal - dailyExpenseTotal)}
                </Text>
              </View>
            </View>
          </Card>
        )}

        <View style={styles.bottomSpacer} />
      </KbScrollView>
    ),
    [
      refreshing,
      handleRefresh,
      c,
      styles,
      journalDate,
      journalMonthLabel,
      handleSelectJournalDate,
      goToPrevWeek,
      goToNextWeek,
      dailyExpenses,
      dailyIncomes,
      dailyExpenseTotal,
      dailyIncomeTotal,
      handleDeleteExpense,
      handleDeleteIncome,
      openExpenseModal,
      openIncomeModal,
    ],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const navigation = useNavigation<any>();
  const inTools = useInTools();

  return (
    <ScreenSafeArea style={styles.container} edges={['top']}>
      <View style={styles.screenHeader}>
        {!inTools ? <Text style={styles.screenTitle}>Финансы</Text> : <View />}
        <TouchableOpacity
          style={[styles.aiPill, { backgroundColor: c.primary + '20' }]}
          onPress={() => navigation.navigate('LifeInsights')}
          activeOpacity={0.7}
        >
          <Text style={[styles.aiPillText, { color: c.primary }]}>
            {'🔍 AI-анализ'}
          </Text>
        </TouchableOpacity>
      </View>
      <SlideTabs tabs={SLIDE_TABS as unknown as Array<{ key: string; title: string; icon?: string }>}>
        {[OverviewSlide, TablesSlide, JournalSlide]}
      </SlideTabs>

      {/* ============================================================= */}
      {/* MODALS                                                        */}
      {/* ============================================================= */}

      {/* --- Expense modal --- */}
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
              const cat =
                expenseCategories[key as keyof typeof expenseCategories];
              const isSelected = formCategory === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.chip,
                    isSelected && {
                      backgroundColor: cat.color,
                      borderColor: cat.color,
                    },
                  ]}
                  onPress={() => setFormCategory(key)}
                >
                  <Text style={styles.chipIcon}>{cat.icon}</Text>
                  <Text
                    style={[
                      styles.chipText,
                      isSelected && styles.chipTextSelected,
                    ]}
                  >
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

      {/* --- Income modal --- */}
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

          <Text style={styles.fieldLabel}>Источник</Text>
          <View style={styles.chipRow}>
            {INCOME_SOURCES.map((src) => {
              const isSelected = formSource === src.label;
              return (
                <TouchableOpacity
                  key={src.key}
                  style={[
                    styles.chip,
                    isSelected && {
                      backgroundColor: c.success,
                      borderColor: c.success,
                    },
                  ]}
                  onPress={() => setFormSource(src.label)}
                >
                  <Text style={styles.chipIcon}>{src.icon}</Text>
                  <Text
                    style={[
                      styles.chipText,
                      isSelected && styles.chipTextSelected,
                    ]}
                  >
                    {src.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Input
            label="Или введите свой источник"
            placeholder="Название источника"
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

      {/* --- Debt modal --- */}
      <Modal
        visible={modalType === 'debt'}
        onClose={() => setModalType(null)}
        title="Новый долг"
      >
        <ScrollView keyboardShouldPersistTaps="handled">
          <View style={styles.debtDirRow}>
            {(['i_owe', 'owed_to_me'] as const).map((d) => {
              const on = formDirection === d;
              return (
                <TouchableOpacity
                  key={d}
                  style={[styles.debtDirChip, on && { backgroundColor: c.primary + '30', borderColor: c.primary }]}
                  onPress={() => setFormDirection(d)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.debtDirText, on && { color: c.primary }]}>{d === 'i_owe' ? 'Я должен' : 'Мне должны'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Input
            label={formDirection === 'i_owe' ? 'Кому' : 'Кто'}
            placeholder={formDirection === 'i_owe' ? 'Банк, Серик…' : 'Ахмет…'}
            value={formCreditor}
            onChangeText={setFormCreditor}
          />

          <Input
            label="Сумма (₸)"
            placeholder="0"
            keyboardType="numeric"
            value={formAmount}
            onChangeText={setFormAmount}
            style={styles.inputGap}
          />

          <Input
            label="Срок возврата (можно пусто)"
            placeholder="Например: 01.06.2026"
            value={formDeadline}
            onChangeText={setFormDeadline}
            style={styles.inputGap}
          />

          <Button
            title="Добавить долг"
            onPress={() => void handleCreateDebt()}
            style={styles.submitButton}
          />
        </ScrollView>
      </Modal>

      {/* --- Budget modal --- */}
      <Modal
        visible={modalType === 'budget'}
        onClose={() => setModalType(null)}
        title="Установить лимит"
      >
        <ScrollView keyboardShouldPersistTaps="handled">
          <Text style={styles.fieldLabel}>Категория</Text>
          <View style={styles.chipRow}>
            {categoryKeys.map((key) => {
              const cat =
                expenseCategories[key as keyof typeof expenseCategories];
              const isSelected = budgetCategory === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.chip,
                    isSelected && {
                      backgroundColor: cat.color,
                      borderColor: cat.color,
                    },
                  ]}
                  onPress={() => setBudgetCategory(key)}
                >
                  <Text style={styles.chipIcon}>{cat.icon}</Text>
                  <Text
                    style={[
                      styles.chipText,
                      isSelected && styles.chipTextSelected,
                    ]}
                  >
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Input
            label="Месячный лимит (\u20B8)"
            placeholder="0"
            keyboardType="numeric"
            value={budgetLimit}
            onChangeText={setBudgetLimit}
            style={styles.inputGap}
          />

          <Text style={styles.budgetHint}>
            Лимит будет установлен на {monthLabel}
          </Text>

          <Button
            title="Установить лимит"
            onPress={handleSetBudget}
            style={styles.submitButton}
          />
        </ScrollView>
      </Modal>
    </ScreenSafeArea>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

type C = ReturnType<typeof useColors>;

function createStyles(c: C) {
  const { width: SCREEN_WIDTH } = Dimensions.get('window');

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    screenHeader: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    screenTitle: {
      fontSize: fontSize.xl,
      fontWeight: '700' as const,
      color: c.text,
    },
    aiPill: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: borderRadius.xl,
    },
    aiPillText: {
      fontSize: fontSize.sm,
      fontWeight: '600' as const,
    },
    slideContainer: {
      flex: 1,
    },
    slideContent: {
      paddingHorizontal: spacing.md,
      paddingBottom: 100,
    },

    // ---------------------------------------------------------------
    // Month selector
    // ---------------------------------------------------------------
    monthSelector: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.md,
      gap: spacing.lg,
    },
    monthArrow: {
      color: c.primary,
      fontSize: fontSize.lg,
      fontWeight: '700',
    },
    monthLabel: {
      color: c.text,
      fontSize: fontSize.lg,
      fontWeight: '600',
      minWidth: 160,
      textAlign: 'center',
    },

    // ---------------------------------------------------------------
    // Summary card
    // ---------------------------------------------------------------
    summaryCard: {
      marginBottom: spacing.md,
      paddingVertical: spacing.md,
    },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    summaryItem: {
      flex: 1,
      alignItems: 'center',
      gap: 2,
    },
    summaryDivider: {
      width: 1,
      height: 50,
      backgroundColor: c.border,
    },
    summaryIcon: {
      fontSize: 18,
      marginBottom: 2,
    },
    summaryLabel: {
      color: c.textSecondary,
      fontSize: fontSize.xs,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    summaryValue: {
      fontSize: fontSize.sm,
      fontWeight: '700',
    },

    // ---------------------------------------------------------------
    // Metrics card
    // ---------------------------------------------------------------
    metricsCard: {
      marginBottom: spacing.md,
    },
    sectionTitle: {
      color: c.text,
      fontSize: fontSize.md,
      fontWeight: '700',
      marginBottom: spacing.sm,
    },
    metricsGrid: {
      gap: spacing.sm,
    },
    metricItem: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: spacing.xs,
    },
    metricDivider: {
      height: 1,
      backgroundColor: c.border,
    },
    metricLabel: {
      color: c.textSecondary,
      fontSize: fontSize.sm,
      flex: 1,
    },
    metricValue: {
      fontSize: fontSize.sm,
      fontWeight: '700',
    },

    // ---------------------------------------------------------------
    // Chart card (top-5 bars)
    // ---------------------------------------------------------------
    chartCard: {
      marginBottom: spacing.md,
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
      color: c.textSecondary,
      fontSize: fontSize.xs,
      flexShrink: 1,
    },
    barTrack: {
      flex: 1,
      height: 14,
      backgroundColor: c.surfaceLight,
      borderRadius: 7,
      overflow: 'hidden',
    },
    barFill: {
      height: '100%',
      borderRadius: 7,
    },
    barValue: {
      width: 85,
      alignItems: 'flex-end',
    },
    barAmount: {
      color: c.text,
      fontSize: fontSize.xs,
      fontWeight: '600',
    },
    barPercent: {
      color: c.textSecondary,
      fontSize: 10,
    },

    // ---------------------------------------------------------------
    // Pie bar & segments
    // ---------------------------------------------------------------
    pieBarContainer: {
      flexDirection: 'row',
      height: 20,
      borderRadius: 10,
      overflow: 'hidden',
      marginBottom: spacing.md,
    },
    pieBarSegment: {
      height: '100%',
    },
    pieSegmentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.xs,
      gap: spacing.sm,
    },
    pieSegmentDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    pieSegmentIcon: {
      fontSize: 14,
    },
    pieSegmentLabel: {
      color: c.text,
      fontSize: fontSize.xs,
      flex: 1,
    },
    pieSegmentPercent: {
      color: c.textSecondary,
      fontSize: fontSize.xs,
      fontWeight: '600',
      width: 35,
      textAlign: 'right',
    },
    pieSegmentAmount: {
      color: c.text,
      fontSize: fontSize.xs,
      fontWeight: '600',
      width: 90,
      textAlign: 'right',
    },

    // ---------------------------------------------------------------
    // Table components
    // ---------------------------------------------------------------
    tableCard: {
      marginBottom: spacing.md,
    },
    tableTitleRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.sm,
    },
    tableTitle: {
      fontSize: fontSize.md,
      fontWeight: '700',
      letterSpacing: 1,
    },
    tableTitleIcon: {
      fontSize: 18,
    },
    tableTitleAction: {
      color: c.primary,
      fontSize: fontSize.sm,
      fontWeight: '600',
    },
    tableContainer: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: borderRadius.sm,
      overflow: 'hidden',
    },
    tableRow: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
    },
    tableRowHeader: {
      backgroundColor: c.surfaceLight,
    },
    tableRowBody: {
      backgroundColor: c.surface,
    },
    tableRowTotal: {
      backgroundColor: c.surfaceLight,
      borderBottomWidth: 0,
    },
    tableCell: {
      flex: 1,
      color: c.text,
      fontSize: fontSize.xs,
    },
    tableCellFirst: {
      flex: 1.5,
    },
    tableCellHeader: {
      fontWeight: '700',
      color: c.textSecondary,
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    tableCellTotal: {
      fontWeight: '700',
      color: c.text,
    },
    tableCellRight: {
      textAlign: 'right',
    },

    // ---------------------------------------------------------------
    // Savings
    // ---------------------------------------------------------------
    savingsContainer: {
      gap: spacing.sm,
    },
    savingsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    savingsLabel: {
      color: c.textSecondary,
      fontSize: fontSize.sm,
    },
    savingsAmount: {
      fontSize: fontSize.sm,
      fontWeight: '700',
    },
    savingsProgressTrack: {
      height: 10,
      backgroundColor: c.surfaceLight,
      borderRadius: 5,
      overflow: 'hidden',
      marginTop: spacing.xs,
    },
    savingsProgressFill: {
      height: '100%',
      borderRadius: 5,
    },
    savingsProgressText: {
      color: c.textSecondary,
      fontSize: fontSize.xs,
      textAlign: 'center',
      marginTop: spacing.xs,
    },
    savingsTrend: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: c.border,
      marginTop: spacing.sm,
    },
    savingsTrendLabel: {
      color: c.textSecondary,
      fontSize: fontSize.xs,
    },
    savingsTrendValue: {
      fontSize: fontSize.sm,
      fontWeight: '700',
    },

    // ---------------------------------------------------------------
    // Debts
    // ---------------------------------------------------------------
    debtRow: {
      backgroundColor: c.surface,
      borderRadius: borderRadius.sm,
      padding: spacing.sm,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: c.border,
    },
    debtHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.xs,
    },
    debtCreditor: {
      color: c.text,
      fontSize: fontSize.sm,
      fontWeight: '600',
      flex: 1,
    },
    debtDeadline: {
      color: c.textSecondary,
      fontSize: fontSize.xs,
    },
    debtAmounts: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: spacing.xs,
    },
    debtSettle: { color: c.primary, fontSize: fontSize.sm, fontWeight: '600' },
    debtDirRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
    debtDirChip: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.xl,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceLight,
    },
    debtDirText: { color: c.textSecondary, fontSize: fontSize.sm, fontWeight: '600' },
    debtPaid: {
      color: c.success,
      fontSize: fontSize.xs,
    },
    debtRemaining: {
      color: c.danger,
      fontSize: fontSize.xs,
    },
    debtProgressTrack: {
      height: 6,
      backgroundColor: c.surfaceLight,
      borderRadius: 3,
      overflow: 'hidden',
    },
    debtProgressFill: {
      height: '100%',
      borderRadius: 3,
    },
    debtProgressText: {
      color: c.textSecondary,
      fontSize: 10,
      textAlign: 'center',
      marginTop: 2,
    },

    // ---------------------------------------------------------------
    // Week day selector
    // ---------------------------------------------------------------
    weekSelectorContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      gap: spacing.sm,
    },
    weekSelectorCenter: {
      flex: 1,
    },
    weekRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 4,
    },
    weekDay: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.sm,
      backgroundColor: c.surface,
    },
    weekDaySelected: {
      backgroundColor: c.primary,
    },
    weekDayToday: {
      borderWidth: 1,
      borderColor: c.primary,
    },
    weekDayLabel: {
      color: c.textSecondary,
      fontSize: 10,
      fontWeight: '500',
      marginBottom: 2,
    },
    weekDayLabelSelected: {
      color: c.text,
    },
    weekDayNum: {
      color: c.text,
      fontSize: fontSize.sm,
      fontWeight: '600',
    },
    weekDayNumSelected: {
      color: c.text,
      fontWeight: '700',
    },
    weekDayNumToday: {
      color: c.primary,
    },
    journalDateLabel: {
      color: c.text,
      fontSize: fontSize.md,
      fontWeight: '600',
      textAlign: 'center',
      marginBottom: spacing.sm,
    },

    // ---------------------------------------------------------------
    // Journal tables
    // ---------------------------------------------------------------
    journalCard: {
      marginBottom: spacing.md,
    },
    journalTitleRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.sm,
    },
    journalTitle: {
      fontSize: fontSize.sm,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    journalCount: {
      color: c.textSecondary,
      fontSize: fontSize.xs,
    },
    journalTableHeader: {
      flexDirection: 'row',
      backgroundColor: c.surfaceLight,
      paddingVertical: spacing.xs + 2,
      paddingHorizontal: spacing.sm,
      borderRadius: borderRadius.sm,
      marginBottom: 2,
    },
    journalHeaderCell: {
      color: c.textSecondary,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      flex: 1,
    },
    journalCellDescH: {
      flex: 2,
    },
    journalCellAmountH: {
      textAlign: 'right',
    },
    journalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
      borderRadius: 4,
    },
    journalRowEven: {
      backgroundColor: c.surface,
    },
    journalRowOdd: {
      backgroundColor: 'transparent',
    },
    journalCellDesc: {
      flex: 2,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    journalCellIcon: {
      fontSize: 14,
    },
    journalCellText: {
      color: c.text,
      fontSize: fontSize.xs,
      flex: 1,
    },
    journalCellCat: {
      flex: 1,
      color: c.textSecondary,
      fontSize: fontSize.xs,
    },
    journalCellAmount: {
      flex: 1,
      fontSize: fontSize.xs,
      fontWeight: '700',
      textAlign: 'right',
    },
    journalTotalRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: c.border,
      marginTop: spacing.xs,
    },
    journalTotalLabel: {
      color: c.text,
      fontSize: fontSize.sm,
      fontWeight: '700',
    },
    journalTotalValue: {
      fontSize: fontSize.sm,
      fontWeight: '700',
    },

    // Journal summary card
    journalSummaryCard: {
      marginBottom: spacing.md,
    },
    journalSummaryTitle: {
      color: c.text,
      fontSize: fontSize.sm,
      fontWeight: '700',
      marginBottom: spacing.sm,
      textAlign: 'center',
    },
    journalSummaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    journalSummaryItem: {
      flex: 1,
      alignItems: 'center',
    },
    journalSummaryDivider: {
      width: 1,
      height: 36,
      backgroundColor: c.border,
    },
    journalSummaryLabel: {
      color: c.textSecondary,
      fontSize: fontSize.xs,
      marginBottom: 2,
    },
    journalSummaryValue: {
      fontSize: fontSize.sm,
      fontWeight: '700',
    },

    // ---------------------------------------------------------------
    // Empty states
    // ---------------------------------------------------------------
    emptyContainer: {
      alignItems: 'center',
      paddingVertical: spacing.xl * 2,
    },
    emptyEmoji: {
      fontSize: 48,
      marginBottom: spacing.sm,
    },
    emptyTitle: {
      color: c.text,
      fontSize: fontSize.lg,
      fontWeight: '700',
      marginBottom: spacing.xs,
    },
    emptyText: {
      color: c.textSecondary,
      fontSize: fontSize.sm,
      textAlign: 'center',
      paddingHorizontal: spacing.xl,
    },
    emptySmall: {
      alignItems: 'center',
      paddingVertical: spacing.lg,
    },
    emptySmallEmoji: {
      fontSize: 28,
      marginBottom: spacing.xs,
    },
    emptySmallText: {
      color: c.textSecondary,
      fontSize: fontSize.sm,
    },

    // ---------------------------------------------------------------
    // Modal form
    // ---------------------------------------------------------------
    fieldLabel: {
      color: c.text,
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
      borderColor: c.border,
      gap: spacing.xs,
    },
    chipIcon: {
      fontSize: 14,
    },
    chipText: {
      color: c.textSecondary,
      fontSize: fontSize.xs,
    },
    chipTextSelected: {
      color: c.text,
      fontWeight: '600',
    },
    inputGap: {
      marginTop: spacing.md,
    },
    submitButton: {
      marginTop: spacing.lg,
    },
    budgetHint: {
      color: c.textSecondary,
      fontSize: fontSize.xs,
      marginTop: spacing.sm,
      textAlign: 'center',
      fontStyle: 'italic',
    },

    // ---------------------------------------------------------------
    // Spacing
    // ---------------------------------------------------------------
    bottomSpacer: {
      height: 80,
    },
  });
}
