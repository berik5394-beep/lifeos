import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useColors } from '@/hooks/use-colors';
import { spacing, fontSize, borderRadius } from '@/constants';
import { FadeInView } from '@/components/ui/fade-in-view';

type Tab = 'privacy' | 'terms';

interface SectionProps {
  title: string;
  children: string;
  defaultOpen?: boolean;
  styles: ReturnType<typeof createStyles>;
  c: ReturnType<typeof useColors>;
}

function CollapsibleSection({ title, children, defaultOpen = false, styles, c }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View style={styles.section}>
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => setOpen(!open)}
        activeOpacity={0.7}
      >
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.chevron}>{open ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {open && (
        <Text style={styles.sectionBody}>{children}</Text>
      )}
    </View>
  );
}

function createStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    content: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.xl * 2,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
    },
    backButton: {
      padding: spacing.sm,
      marginRight: spacing.sm,
    },
    backText: {
      fontSize: fontSize.xl,
      color: c.text,
    },
    headerTitle: {
      fontSize: fontSize.xl,
      fontWeight: '700',
      color: c.text,
    },
    tabRow: {
      flexDirection: 'row',
      backgroundColor: c.surface,
      borderRadius: borderRadius.md,
      padding: 4,
      marginBottom: spacing.lg,
    },
    tab: {
      flex: 1,
      paddingVertical: spacing.sm + 2,
      alignItems: 'center',
      borderRadius: borderRadius.sm,
    },
    tabActive: {
      backgroundColor: c.primary,
    },
    tabText: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      fontWeight: '500',
    },
    tabTextActive: {
      color: '#FFFFFF',
      fontWeight: '600',
    },
    lastUpdated: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      textAlign: 'center',
      marginBottom: spacing.lg,
    },
    section: {
      backgroundColor: c.surface,
      borderRadius: borderRadius.md,
      marginBottom: spacing.md,
      overflow: 'hidden',
    },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: spacing.md,
    },
    sectionTitle: {
      fontSize: fontSize.md,
      fontWeight: '600',
      color: c.text,
      flex: 1,
    },
    chevron: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      marginLeft: spacing.sm,
    },
    sectionBody: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      lineHeight: 22,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.md,
    },
    contactCard: {
      backgroundColor: c.surface,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      marginTop: spacing.md,
      alignItems: 'center',
    },
    contactTitle: {
      fontSize: fontSize.md,
      fontWeight: '600',
      color: c.text,
      marginBottom: spacing.xs,
    },
    contactEmail: {
      fontSize: fontSize.sm,
      color: c.primary,
    },
  });
}

export default function LegalScreen() {
  const navigation = useNavigation();
  const c = useColors();
  const styles = useMemo(() => createStyles(c), [c]);
  const [activeTab, setActiveTab] = useState<Tab>('privacy');

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Text style={styles.backText}>{'←'}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Правовая информация</Text>
        </View>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <FadeInView delay={0}>
          <View style={styles.tabRow}>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'privacy' && styles.tabActive]}
              onPress={() => setActiveTab('privacy')}
            >
              <Text style={[styles.tabText, activeTab === 'privacy' && styles.tabTextActive]}>
                Конфиденциальность
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'terms' && styles.tabActive]}
              onPress={() => setActiveTab('terms')}
            >
              <Text style={[styles.tabText, activeTab === 'terms' && styles.tabTextActive]}>
                Условия использования
              </Text>
            </TouchableOpacity>
          </View>
        </FadeInView>

        {activeTab === 'privacy' ? (
          <PrivacyContent styles={styles} c={c} />
        ) : (
          <TermsContent styles={styles} c={c} />
        )}
      </ScrollView>
    </View>
  );
}

function PrivacyContent({ styles, c }: { styles: ReturnType<typeof createStyles>; c: ReturnType<typeof useColors> }) {
  return (
    <FadeInView delay={80}>
      <Text style={styles.lastUpdated}>Дата последнего обновления: 14 апреля 2026 г.</Text>

      <CollapsibleSection
        title="1. Какие данные мы собираем"
        defaultOpen
        styles={styles}
        c={c}
      >
{`LifeOS собирает следующие категории данных для обеспечения работы приложения:

- Данные аккаунта: имя, адрес электронной почты, пароль (хранится в зашифрованном виде).

- Привычки и задачи: названия привычек, статус выполнения, задачи, приоритеты, категории, даты.

- Финансовые данные: суммы доходов и расходов, категории трат, лимиты бюджета, описания операций.

- Данные о самочувствии: сон, настроение и энергия (дневник).

- Дневник: записи о настроении, уровне энергии, продолжительности сна, личные заметки.

- Голосовые данные: аудиозаписи голосовых команд (передаются на сервер для распознавания и удаляются после обработки).

- Цели: годовые и недельные цели, прогресс выполнения.

- События календаря: встречи, время, место, описание, источник (ручной ввод, импорт, голос).

- Импортированные файлы: содержимое загруженных файлов (xlsx, csv, ics) для извлечения данных.`}
      </CollapsibleSection>

      <CollapsibleSection
        title="2. Как мы используем данные"
        styles={styles}
        c={c}
      >
{`Собранные данные используются исключительно для:

- Персонализации приложения: отображение прогресса, статистики, рекомендаций на основе ваших привычек и целей.

- AI-анализа: голосовой ассистент LifeOS анализирует ваши задачи, привычки и финансы для предоставления персонализированных советов и напоминаний.

- Уведомлений: отправка push-уведомлений о задачах, встречах, достижениях и мотивационных сообщений.

- Синхронизации: хранение данных на сервере для доступа с разных устройств и восстановления при потере данных.

Мы НЕ используем ваши данные для рекламы и НЕ продаём их третьим лицам.`}
      </CollapsibleSection>

      <CollapsibleSection
        title="3. Хранение и защита данных"
        styles={styles}
        c={c}
      >
{`- Серверная часть размещена на платформе Railway (railway.app) с шифрованием данных при передаче (TLS/SSL).

- Пароли хранятся в виде необратимых хешей (bcrypt). Мы не имеем доступа к вашему паролю в открытом виде.

- Аутентификация осуществляется через JWT-токены с механизмом refresh-токенов.

- Голосовые записи обрабатываются в реальном времени и не сохраняются на сервере после распознавания.

- Локальные данные на устройстве хранятся с использованием MMKV — высокопроизводительного зашифрованного хранилища.

- Доступ к API защищён авторизацией — данные одного пользователя недоступны другим.`}
      </CollapsibleSection>

      <CollapsibleSection
        title="4. Третьи стороны"
        styles={styles}
        c={c}
      >
{`Для работы некоторых функций LifeOS передаёт данные следующим сервисам:

- Anthropic (Claude API): текстовые данные (задачи, привычки, финансы) передаются для генерации AI-ответов ассистента. Anthropic не использует данные пользователей для обучения моделей. Политика конфиденциальности: anthropic.com/privacy.

- Groq: голосовые записи передаются для распознавания речи (Speech-to-Text). Аудио обрабатывается и не сохраняется. Политика конфиденциальности: groq.com/privacy.

- Expo (expo.dev): используется для доставки push-уведомлений. Передаётся токен устройства и содержимое уведомления.

- Railway (railway.app): хостинг серверной части приложения. Данные хранятся в базе данных PostgreSQL.

Мы не передаём ваши данные рекламным сетям, аналитическим платформам и другим третьим лицам.`}
      </CollapsibleSection>

      <CollapsibleSection
        title="5. Ваши права"
        styles={styles}
        c={c}
      >
{`Вы имеете право:

- Просматривать все свои данные в приложении в любое время.

- Экспортировать данные в формате CSV (финансы, привычки, задачи) через раздел «Настройки → Экспорт».

- Удалить свой аккаунт и все связанные данные безвозвратно через «Настройки → Удалить аккаунт». После удаления все данные стираются с сервера в течение 30 дней.

- Отозвать разрешения на доступ к уведомлениям через настройки устройства.

- Обратиться к нам с запросом о своих данных по адресу support@lifeos.kz.`}
      </CollapsibleSection>

      <CollapsibleSection
        title="6. Данные детей"
        styles={styles}
        c={c}
      >
{`LifeOS не предназначен для использования лицами младше 16 лет. Мы сознательно не собираем данные несовершеннолетних. Если вы считаете, что ребёнок предоставил нам свои данные, свяжитесь с нами по адресу support@lifeos.kz — мы незамедлительно удалим такие данные.`}
      </CollapsibleSection>

      <CollapsibleSection
        title="7. Изменения политики"
        styles={styles}
        c={c}
      >
{`Мы можем обновлять данную политику конфиденциальности. При существенных изменениях мы уведомим вас через push-уведомление в приложении или по электронной почте. Продолжение использования приложения после уведомления означает согласие с обновлённой политикой.`}
      </CollapsibleSection>

      <View style={styles.contactCard}>
        <Text style={styles.contactTitle}>Связаться с нами</Text>
        <Text style={styles.contactEmail}>support@lifeos.kz</Text>
      </View>
    </FadeInView>
  );
}

function TermsContent({ styles, c }: { styles: ReturnType<typeof createStyles>; c: ReturnType<typeof useColors> }) {
  return (
    <FadeInView delay={80}>
      <Text style={styles.lastUpdated}>Дата последнего обновления: 14 апреля 2026 г.</Text>

      <CollapsibleSection
        title="1. Общие положения"
        defaultOpen
        styles={styles}
        c={c}
      >
{`Настоящие Условия использования регулируют отношения между вами (Пользователь) и LifeOS (Компания) при использовании мобильного приложения LifeOS.

Используя приложение, вы подтверждаете, что ознакомились с данными условиями и принимаете их в полном объёме. Если вы не согласны с условиями, прекратите использование приложения.`}
      </CollapsibleSection>

      <CollapsibleSection
        title="2. Описание сервиса"
        styles={styles}
        c={c}
      >
{`LifeOS — мобильное приложение для управления жизнью, включающее:

- Трекер привычек и задач
- Недельный и годовой планер целей
- Финансовый планер (расходы, доходы, бюджет)
- Дневник самочувствия (настроение, сон, энергия)
- AI-голосовой ассистент
- Импорт данных из файлов
- Система достижений и виртуальный питомец

Приложение предназначено исключительно для личного некоммерческого использования.`}
      </CollapsibleSection>

      <CollapsibleSection
        title="3. Учётная запись"
        styles={styles}
        c={c}
      >
{`- Для использования приложения необходимо создать учётную запись с действительным адресом электронной почты.

- Вы несёте ответственность за сохранность своего пароля и за все действия, совершённые под вашей учётной записью.

- Запрещено передавать доступ к аккаунту третьим лицам.

- Мы оставляем за собой право заблокировать учётные записи, нарушающие данные условия.`}
      </CollapsibleSection>

      <CollapsibleSection
        title="4. Подписка и оплата"
        styles={styles}
        c={c}
      >
{`- LifeOS может предлагать платную подписку (PRO) с расширенным функционалом.

- Условия подписки, её стоимость и порядок оплаты указываются на экране подписки в приложении.

- Подписка продлевается автоматически, если не отменена минимум за 24 часа до окончания текущего периода.

- Управление подпиской и её отмена осуществляются через App Store или Google Play.

- Возврат средств осуществляется в соответствии с политикой соответствующего магазина приложений.`}
      </CollapsibleSection>

      <CollapsibleSection
        title="5. AI-ассистент и рекомендации"
        styles={styles}
        c={c}
      >
{`ВАЖНО: AI-ассистент LifeOS НЕ является:

- Финансовым консультантом. Советы по бюджету и расходам носят информационный характер и не являются профессиональной финансовой консультацией.

- Медицинским специалистом. Данные о здоровье, сне и активности предназначены для самоконтроля. При проблемах со здоровьем обращайтесь к врачу.

- Психологом или психотерапевтом. Дневник самочувствия и мотивационные сообщения не заменяют профессиональную психологическую помощь.

Пользователь самостоятельно принимает решения на основе информации из приложения и несёт за них полную ответственность.

Режим «Токсичный мотиватор» — это игровой стиль общения. Все высказывания ассистента в этом режиме носят шуточный характер и не направлены на оскорбление пользователя.`}
      </CollapsibleSection>

      <CollapsibleSection
        title="6. Ограничения использования"
        styles={styles}
        c={c}
      >
{`Запрещается:

- Использовать приложение для незаконных целей.
- Пытаться получить несанкционированный доступ к серверам или данным других пользователей.
- Распространять вредоносное ПО через функции импорта.
- Использовать автоматизированные средства для взаимодействия с приложением.
- Копировать, модифицировать или распространять приложение или его части.`}
      </CollapsibleSection>

      <CollapsibleSection
        title="7. Ограничение ответственности"
        styles={styles}
        c={c}
      >
{`- Приложение предоставляется «как есть» (as is). Мы не гарантируем бесперебойную работу сервиса.

- LifeOS не несёт ответственности за убытки, возникшие в результате использования рекомендаций AI-ассистента.

- Мы не несём ответственности за потерю данных вследствие действий пользователя (удаление аккаунта) или форс-мажорных обстоятельств.

- Максимальная ответственность LifeOS ограничена суммой, уплаченной пользователем за подписку за последние 12 месяцев.`}
      </CollapsibleSection>

      <CollapsibleSection
        title="8. Изменение условий"
        styles={styles}
        c={c}
      >
{`Мы оставляем за собой право изменять данные Условия использования. При существенных изменениях:

- Вы получите уведомление через push-уведомление или электронную почту не менее чем за 14 дней до вступления изменений в силу.

- Продолжение использования приложения после уведомления означает принятие обновлённых условий.

- Если вы не согласны с изменениями, вы можете удалить свой аккаунт и прекратить использование.`}
      </CollapsibleSection>

      <CollapsibleSection
        title="9. Применимое право"
        styles={styles}
        c={c}
      >
{`Настоящие Условия регулируются и толкуются в соответствии с законодательством Республики Казахстан. Споры разрешаются в судах по месту нахождения Компании.`}
      </CollapsibleSection>

      <View style={styles.contactCard}>
        <Text style={styles.contactTitle}>Связаться с нами</Text>
        <Text style={styles.contactEmail}>support@lifeos.kz</Text>
      </View>
    </FadeInView>
  );
}
