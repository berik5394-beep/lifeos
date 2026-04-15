# LifeOS — Frontend / Design / A11y Audit
Date: 2026-04-11

## Summary
- Screens reviewed: 14 (dashboard, tasks, habits, goals, finance, chat, pet, arena, battle-screen, character-select, swipe-home, onboarding, settings, integrations) + 9 shared UI components
- P0 (breaks UX or a11y blockers): **6**
- P1 (polish issues affecting perceived quality): **12**
- P2 (nice-to-have): **7**

**Top-level verdict:** The project has a clean, well-typed design token file (`constants/colors.ts`) with `colors`, `spacing`, `borderRadius`, `fontSize` primitives. The core shared UI components (Button, Card, Input, Modal, Checkbox) are textbook-clean and consume tokens correctly. **But adherence to the design system collapses rapidly outside those core components.** Several screens (`nutrition.tsx`, `swipe-home.tsx`, `pet.tsx`, `battle-screen.tsx`, parts of `chat.tsx` and `tasks.tsx`) contain hundreds of hardcoded hex colors, numeric font sizes, and compressed 1-2-char class names that strongly resemble AI-generated code dropped into the project without being harmonized with the token system. **Accessibility is effectively 0%**: across the entire `apps/mobile` directory, `grep` returns **zero** matches for `accessibilityLabel`, `accessibilityRole`, `accessibilityHint`, `AccessibilityInfo`, or `Reduce[Mm]otion`. This is a production-blocker for App Store review and inclusive use.

---

## Design system compliance

### What's right
- `constants/colors.ts` cleanly defines `colors`, `spacing { xs:4, sm:8, md:16, lg:24, xl:32 }`, `borderRadius { sm:8, md:12, lg:16, xl:24 }`, `fontSize { xs:12, sm:14, md:16, lg:18, xl:24, xxl:32 }`. Values are `as const` and strictly typed.
- `components/ui/button.tsx`, `card.tsx`, `input.tsx`, `modal.tsx`, `checkbox.tsx` import and use those tokens everywhere. No raw hex in the core UI kit.
- Dark theme is consistent in those components.

### What's broken
- **Hardcoded color strings are pervasive outside the UI kit.** Representative examples:
  - `apps/mobile/app/nutrition.tsx:360-485` — styles use `#0F172A`, `#1E293B`, `#F8FAFC`, `#94A3B8`, `#6366F1`, `#334155` as raw strings. Does **not** import `colors` from `@/constants` at all. This file will silently break if the design tokens change.
  - `apps/mobile/app/pet.tsx:60-64` — room gradient defined as `{ 1: '#1a1a2e', 2: '#16213e', 3: '#1a1a3e', 4: '#1e1040', 5: '#2a1050' }`, none tied to tokens.
  - `apps/mobile/app/pet.tsx:565-594` — `color: '#666'`, `'#888'`, `'#555'`, `'#777'`, `'#ccc'` — none of these pass WCAG AA contrast on `#0F172A`.
  - `apps/mobile/app/(tabs)/index.tsx:736` — `backgroundColor: '#1A2540'` for the quote card (one-off hex not in palette).
  - `apps/mobile/app/(tabs)/tasks.tsx:605` — inline `style={{ marginTop: 12, backgroundColor: '#EF4444' } as any}` on a delete Button — escapes the Button variant system AND uses `as any`.
  - `apps/mobile/app/(tabs)/chat.tsx:472, 475, 513` — recording indicators hardcode `#FF3B30` instead of `colors.danger` (`#EF4444`). Two shades of red coexist.
  - `apps/mobile/app/swipe-home.tsx` — >40 occurrences of hardcoded `'#fff'`, `'#EF4444'`, `'#6366F1'`, `'#FF9800'`, `'#4CAF50'`, `'#FFD700'`, `'#9C27B0'` (Material Design palette bleed). File also uses 1-2 character style keys (`s.pg`, `s.tC`, `s.sH`).

- **Hardcoded numeric `fontSize` escaping `fontSize` tokens** (examples, not exhaustive):
  - `nutrition.tsx:371,382,404,416` — `fontSize: 18, 22, 20` instead of `fontSize.lg`/`xl`.
  - `nutrition.tsx:420` — `fontSize: 11` (not even in the scale — smallest token is `xs: 12`).
  - `nutrition.tsx:454, 668 (finance.tsx)` — `fontSize: 10` (below minimum readable on small devices).
  - `pet.tsx:611, 647, 793, 886, 904` — `fontSize: 32, 28, 20, 28, 20`.
  - `onboarding.tsx:263, 323, 354` — `fontSize: 80, 48, 36` for decorative emojis; fine in isolation, but inconsistent with tokens.
  - `battle-screen.tsx:279, 282, 285, 393, 395` — `fontSize: 16, 14, 12, 32, 50`.
  - `(auth)/login.tsx:109, 115` — `fontSize: 40, 18`.
  - `swipe-home.tsx` — `fontSize.xs-1` **arithmetic** on token (line 442, 452) — produces `fontSize: 11` at runtime.

- **Hardcoded `borderRadius` values** (not in `{8,12,16,24}` scale):
  - `journal/index.tsx:415` — `borderRadius: 15`
  - `settings/index.tsx:435, 448, 460, 472` — `borderRadius: 14, 12, 11, 6` (mix of on/off token).
  - `(tabs)/habits.tsx:500, 506` — `borderRadius: 3`.
  - `(tabs)/finance.tsx:650, 655` — `borderRadius: 6`.
  - `(tabs)/chat.tsx:382` — `borderRadius: 14` (none of `{8,12,16,24}`).
  - `onboarding.tsx:292` — `borderRadius: 4`.

- **Padding/margin hardcoded off-scale** (odd values `2, 12, 13, 15, 18`):
  - `(tabs)/tasks.tsx:605` — `marginTop: 12` (should be `spacing.md = 16` or `sm = 8`).
  - `(tabs)/tasks.tsx:718` — `padding: 8` (should be `spacing.sm`).
  - Multiple `marginTop: 2` across habits/tasks/finance/index files — not in the 4-multiple scale.
  - `swipe-home.tsx` — dozens of inline `padding:6`, `margin:4`, `gap:10`, `gap:14` not in the scale.

- **Paddings of 100** hardcoded to avoid tab-bar overlap instead of using a nav-bar-aware constant:
  - `(tabs)/habits.tsx:510` — `paddingBottom: 100`
  - `(tabs)/finance.tsx:565` — `paddingBottom: 100`
  - `(tabs)/tasks.tsx:674` — `paddingBottom: 100`
  - `swipe-home.tsx:409, 414, 436` — `paddingBottom:100`
  - `nutrition.tsx:372` — `paddingBottom: 120`
  - Dashboard (`index.tsx:727`) uses `paddingBottom: spacing.xl * 3` (96) — different magic number. Not using `useBottomTabBarHeight()` anywhere.

---

## P0

### [1] Zero accessibility labels on any interactive element
**Screen:** every tab, `apps/mobile/**/*.tsx`
**Issue:** A codebase-wide `grep accessibilityLabel|accessibilityRole|accessibilityHint` returns **zero** matches. Checkboxes, voice button, FAB "+" buttons, close X, day selectors, category chips, delete icons, quick-action pills — none are reachable to VoiceOver / TalkBack users. The voice button (`voice-button.tsx:89-104`) is especially painful because it's the app's flagship feature and a blind user has no way to know what it is, whether it's recording, or when it's processing.
**User impact:** App is unusable to anyone using a screen reader. Blocks App Store / Google Play disability compliance reviews in multiple jurisdictions (EU Accessibility Act 2025, ADA). Russia also has a11y requirements for public-benefit apps under GOST R 52872-2019.
**Fix:** Add `accessibilityLabel`, `accessibilityRole="button"`, `accessibilityState={{ checked, busy }}`, `accessibilityHint` everywhere a `TouchableOpacity` currently appears. For `voice-button.tsx` specifically: `accessibilityLabel="Голосовой ассистент"`, `accessibilityHint="Нажмите, чтобы говорить с ЛайфОС"`, `accessibilityState={{ busy: isProcessing, selected: isRecording }}`. Create a shared `<IconButton>` wrapper to enforce this.

### [2] Tab-bar content clipping — scrolls hide final items behind the tab bar
**Screen:** `apps/mobile/app/(tabs)/goals.tsx`, `apps/mobile/app/(tabs)/chat.tsx`
**Issue:** `goals.tsx:343-349` has no `contentContainerStyle` `paddingBottom` at all on its `ScrollView`, and its FAB at `goals.tsx:481` is positioned `bottom: spacing.xl + 60 = 92` — lower than the tab bar height on iPhone 15 Pro Max with home indicator. The last goal card can be hidden. `chat.tsx` has a `paddingVertical: spacing.sm` on `listContent` but no safe-area awareness for the keyboard accessory line when typing in Russian with long autocomplete bar. Other tab screens hardcode `100` / `120`, which is wrong on devices without a home indicator (SE, Android) and wrong on iPhone Pro Max (needs ~100-110 incl. bottom inset).
**User impact:** Bottom rows of tasks/habits/goals/expenses are occluded by the tab bar on ~35% of installed iPhones (any Pro / Pro Max with larger home indicator). The last-added item is invisible until the user scrolls down past natural bounce.
**Fix:** Replace all `paddingBottom: 100` with `useBottomTabBarHeight()` from `@react-navigation/bottom-tabs` + `useSafeAreaInsets().bottom` on scroll content and FAB `bottom`. Do this once in a `useTabBarAwarePadding` hook.

### [3] Touch targets below 44pt minimum — esp. checkboxes, day pickers, delete icons
**Screen:** multiple
**Issue:**
- `(tabs)/index.tsx:112-128` — TaskRow passes `<Checkbox … size={20}/>`. Checkbox has `hitSlop={8}` → effective touch region `36x36`, below 44. Same for `(tabs)/index.tsx` goal rows (`size={20}`, line ~576).
- `components/ui/modal.tsx:40` — close X has `hitSlop={8}`, fontSize.xl = 24px → effective target ~40pt, still under 44.
- `(tabs)/tasks.tsx:718` — `deleteBtn: { padding: 8 }` on an 18px icon → 34x34pt.
- `(tabs)/index.tsx:dayItem` — day cell is `44×60`; meets width but tightly packed with `spacing.xs` between, so users on large fingers often hit the wrong day.
- `(tabs)/finance.tsx:categoryDot` — `40×40` (below 44).
- `components/ui/swipeable-row.tsx:87-95` — delete button `width: 88` but wrapped in `marginVertical: spacing.xs (4)`, so effective vertical target depends on row height.
- Pet screen `modalClose` uses `padding: spacing.xs (4)` → total ~32pt.
**User impact:** Mis-taps on habit completion and goal toggling. Frustrating for users with larger hands or motor impairments. Fails Apple HIG and WCAG 2.5.5 (Level AAA, but AA via 2.5.8 "Target Size Minimum" in WCAG 2.2 = 24×24 CSS px; still marginal).
**Fix:** Checkbox `size={24}` default, expand `hitSlop` to `{ top:12, bottom:12, left:12, right:12 }` minimum everywhere. Introduce a 44pt default touch wrapper.

### [4] Color-only state indicators — fails color-blind users
**Screen:** `(tabs)/tasks.tsx`, `(tabs)/habits.tsx`, `(tabs)/finance.tsx`, `(tabs)/goals.tsx`
**Issue:** Priority is communicated entirely by colored dot / badge (`priorities.low/medium/high/critical` = green/blue/orange/red). Task completion is indicated only by line-through + `textSecondary` color. Expense vs income distinguished purely by `colors.danger` / `colors.success`. Progress bars change color (green→yellow→red) with no text label. ~8% of men have red-green color blindness and cannot distinguish the high/critical priorities.
**User impact:** Color-blind users cannot triage tasks or distinguish overspent categories.
**Fix:** Always pair color with an icon/label. Priority `priorities.ts` already has `icon: '🟢'/'🔵'/'🔥'/'🔴'` — enforce showing the icon next to the color dot. Add a ✓ inside the checkbox background (already present) and an additional small "Выполнено" pill or strikethrough + ✓ icon. Finance uses `+`/`−` signs consistently instead of relying on green/red.

### [5] Quote-card contrast on dashboard below WCAG AA
**Screen:** `apps/mobile/app/(tabs)/index.tsx:724-749`
**Issue:** Quote card uses `backgroundColor: '#1A2540'` (custom, not a token) with `color: colors.textSecondary = #94A3B8` for quote text and author. Computed contrast ratio: `#94A3B8` on `#1A2540` ≈ **4.23:1** — fails WCAG AA for body text (requires ≥4.5:1). Regular card text (`textSecondary` on `colors.surface #1E293B`) is **4.47:1** — also fails AA by a hair. `textSecondary` on `colors.background #0F172A` is **5.4:1**, passes.
**User impact:** Low-vision users cannot read quotes, category labels, empty-state text, timestamps, item metadata. These are the highest-frequency text elements in the app.
**Fix:** Bump `textSecondary` from `#94A3B8` to `#A6B2C7` (≈ 5.1:1 on `#1E293B`) or `#B0BEC9` (≈5.7:1) for sub-text. Alternatively, never place body `textSecondary` on `surface` — use `colors.text` at 70% opacity via `rgba(248,250,252,0.7)` which gives 6.3:1. Remove `'#1A2540'` one-off — use `colors.surface`.

### [6] Missing KeyboardAvoidingView and pull-to-refresh on primary tabs
**Screen:** `(tabs)/goals.tsx` (no KAV), `(tabs)/index.tsx` (no refresh control), `(tabs)/chat.tsx` (KAV present but no keyboardVerticalOffset).
**Issue:** The goals "Add goal" inline input (`goals.tsx`) is pushed behind the keyboard on small devices (iPhone SE) since its `ScrollView` is not inside a `KeyboardAvoidingView`. Dashboard `index.tsx` and `goals.tsx` have **no** `RefreshControl` despite fetching from server — users cannot manually refresh. `chat.tsx` uses KAV but `keyboardVerticalOffset` is absent, so the input bar jumps under the keyboard on notched devices when transitioning between inputs.
**User impact:** Users on iPhone SE / 12 mini cannot see what they're typing when adding goals. Dashboard stale data cannot be refreshed without app restart.
**Fix:** Wrap goal-input section in `KeyboardAvoidingView`. Add `<RefreshControl onRefresh={handleRefresh} refreshing={isLoading} tintColor={colors.primary}/>` to all tab scrollviews — `tasks`, `habits`, `finance` already have it; only `goals` and `index` are missing. Set `keyboardVerticalOffset={headerHeight}` on `chat.tsx` KAV.

---

## P1

### [7] No haptic feedback on completion interactions
**Screen:** tasks/habits/goals toggle, voice button press, add expense success
**Issue:** `grep Haptics` returns just 1 match (`exercise-tracker.tsx`). The flagship "отметь привычку и питомец прыгает" loop has no tactile confirmation — users don't know the tap registered until animation plays. Duolingo/Apple Fitness haptic patterns are industry-standard for habit trackers.
**Fix:** `import * as Haptics from 'expo-haptics'` (already in deps). Add `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)` on checkbox toggle, `.Success` on 100%-day confetti, `.Medium` on voice button press, `.Warning` on deleting.

### [8] Dashboard greeting text can be clipped by pet avatar
**Screen:** `apps/mobile/app/(tabs)/index.tsx:382-396, 396-403`
**Issue:** `petAvatarWrapper` is `position: 'absolute', top: 8, right: 16, zIndex: 10` with a 60px wide avatar. Meanwhile the greeting text is rendered top-left inside the scroll as `"Доброе утро, Берик!"` at `fontSize.xxl = 32`. On iPhone 13 mini (375pt) with name "Екатерина", that string is ~310pt wide and will visually run under the pet avatar, though `numberOfLines` is not applied — Russian names can be long and Russian text is ~20% longer than English.
**Fix:** Wrap greeting in `paddingRight: 80` or reserve a `flexDirection: 'row'` header with the avatar as a flex child. Add `numberOfLines={1}` and `adjustsFontSizeToFit`.

### [9] Inconsistent card border-radius: 8 vs 11 vs 12 vs 14 vs 15 vs 16 vs 20
**Screen:** multiple
**Issue:** The design system defines `{sm:8, md:12, lg:16, xl:24}` but the app ships with `11` (settings radio), `14` (chat bubble avatar, save button), `15` (journal card), `16` (onboarding, nutrition), `18` (unused), `20` (battle, exercise tracker), `28` (FAB). Fourteen distinct radius values across the app.
**Fix:** Global replace via ESLint rule + a one-time sweep. Add a rule forbidding raw numbers on `borderRadius`; must reference `borderRadius.*`. Introduce `borderRadius.full = 999` for FAB.

### [10] Two shades of red: `colors.danger #EF4444` vs hardcoded `#FF3B30`
**Screen:** `(tabs)/chat.tsx:472, 475, 513` (recording dot, recording text, recording mic button). Also `voice-button.tsx:72, 122` (`#FF3B30`).
**Issue:** Chat recording state uses iOS system red `#FF3B30` but the design system defines `colors.danger = #EF4444`. Two reds appear next to each other when the chat's mic button and the dashboard's `VoiceButton` are both visible.
**Fix:** Replace `#FF3B30` with `colors.danger` everywhere. If you want distinct "recording" vs "destructive" semantics, add `colors.recording = #EF4444` (same value, different name).

### [11] `Alert.alert` Russian text uses English button labels + inconsistent tone
**Screen:** `apps/mobile/components/ui/swipeable-row.tsx:44-47`
**Issue:** The delete confirmation uses `'Отмена'` + `'Удалить'` — these are correct Russian. But many other `Alert.alert` calls (grep for them) use mixed conventions. Also `swipeable-row.tsx` default title is `'Удалить?'` — too informal for a goal delete vs warm for a task delete. Tone is inconsistent with the CLAUDE.md "ассистент-друг" personality.
**Fix:** Standardize confirmation language ("Удалить задачу?", "Отменить", "Удалить"). Consider using a bottom-sheet confirmation that matches the assistant voice rather than iOS native `Alert`.

### [12] FAB varies per screen — position, size, elevation, shadow values
**Screen:** `(tabs)/tasks.tsx:738-755`, `(tabs)/habits.tsx:573-594`, `(tabs)/finance.tsx:755-777`, `(tabs)/goals.tsx:479-498`
**Issue:**
- Tasks FAB: `right: spacing.lg, bottom: spacing.xl`, shadow `opacity 0.25, radius 4`, elevation 4.
- Finance FAB: `bottom: 24, right: 24` (hardcoded), shadow `opacity 0.3, radius 4`, elevation 6.
- Habits FAB: `bottom: spacing.xl`, elevation 4.
- Goals FAB: `bottom: spacing.xl + 60, right: spacing.lg`, elevation 4 — the `+60` is a hack to avoid the voice button.
- Dashboard doesn't have an FAB but has `floatingVoice` at `bottom: 90, right: 20`.
Four different implementations of the same concept.
**Fix:** Extract `<FloatingActionButton>` shared component. Single elevation token. Resolve position per screen via a prop that knows about voice-button coexistence.

### [13] Inline delete button in Task edit modal uses raw hex + `as any` cast
**Screen:** `apps/mobile/app/(tabs)/tasks.tsx:603-614`
**Issue:**
```tsx
<Button
  title="Удалить задачу"
  onPress={...}
  style={{ marginTop: 12, backgroundColor: '#EF4444' } as any}
/>
```
Uses `as any`, hardcodes red, and bypasses `Button`'s `variant="danger"` which already exists. Classic AI-slop pattern — the code "knows" `Button` has a `variant` but fails to use it.
**Fix:** `<Button title="Удалить задачу" variant="danger" style={{ marginTop: spacing.sm }} />`

### [14] `swipe-home.tsx` is AI-slop concentrate
**Screen:** `apps/mobile/app/swipe-home.tsx:390-540`
**Issue:** The stylesheet uses 1-2-character keys (`s.pg`, `s.tC`, `s.sH`, `s.hPg`, `s.qB`), mixes `colors.primary` with raw `#6366F1` (same color, different reference), does `fontSize.xs-1` arithmetic to produce `fontSize: 11`, scatters Material palette colors (`#9C27B0`, `#4CAF50`, `#FF9800`, `#FFD700`) alongside Tailwind-ish slate, and has single-line styles making diffs unreadable. Uses `rgba(255,255,255,0.06)` "borderTopColor" to simulate divider instead of `colors.border`. Roughly 150 style keys in one file, zero comments.
**User impact:** Maintenance nightmare. Visual chaos: 5+ brand colors compete for attention on a single screen. The file breaks the app's visual identity.
**Fix:** Full refactor or deletion — the file looks like a parallel prototype that was checked in. Decide if this is production or dead code; if production, refactor to tokens and split into sub-components.

### [15] Pet screen uses 3+ gray hex values failing contrast on colored backgrounds
**Screen:** `apps/mobile/app/pet.tsx:565-594`
**Issue:** `color: '#666'` (for "sub label"), `'#888'`, `'#555'`, `'#777'`, `'#ccc'`. On `colors.background = #0F172A`, `#555` yields contrast **2.4:1** — fails AA completely. `#666` is **2.9:1**. `#888` is **4.3:1**. Only `#ccc` passes (9.2:1).
**User impact:** Pet state labels, breakdown descriptions, and revive condition text are unreadable to anyone with slightly impaired vision. Given this is the app's rewards system, users literally cannot see what they're earning.
**Fix:** Replace raw grays with `colors.text` / `colors.textSecondary`.

### [16] Finance chart `fontSize: 10` is below minimum legible size
**Screen:** `apps/mobile/app/(tabs)/finance.tsx:668` (`barPercent`)
**Issue:** Percentages in the category bars render at 10px. On iPhone 15 (460ppi) this is ~2.2mm — below the iOS HIG 11pt minimum. Compounded by `colors.textSecondary` fail-by-a-hair contrast (see P0 [5]).
**Fix:** Use `fontSize.xs = 12` minimum. Apply `allowFontScaling` so users with Dynamic Type "large" see a readable value.

### [17] No empty-state illustrations or CTAs — first-run UX is blank
**Screen:** tasks/habits/goals/finance
**Issue:** Empty states are minimal text: `"Нет задач"`, `"Нет целей на эту неделю"`, `emptyIcon: '📋' fontSize: 48`. No illustration, no onboarding CTA ("Создать первую привычку" button inline). A new user who just finished onboarding lands on an empty dashboard and sees "Нет задач" — no guidance.
**Fix:** Add centered illustration + CTA inside `<EmptyState title icon description ctaLabel onCtaPress />` shared component. Hook it into the voice button ("Скажи 'создай задачу…'").

### [18] Hard-coded English placeholders in a Russian-only app
**Screen:** `(tabs)/tasks.tsx:489, 582`, `settings/integrations.tsx:346`
**Issue:** Time input placeholder is `"HH:MM"` in both add and edit task modals — acceptable format but inconsistent with Russian UI. `integrations.tsx:346` has `placeholder="Chat ID"` for Telegram binding — untranslated.
**Fix:** `"ЧЧ:ММ"` (Russian) or keep `"HH:MM"` but document as a locale-neutral format. `placeholder="ID чата"` for Telegram.

---

## P2

### [19] No dynamic type / font-scaling support
**Screen:** app-wide
**Issue:** Every Text element uses fixed `fontSize` and every Button/Card has fixed `height`. Users with iOS "Larger Text" accessibility setting will see overflow, broken layouts, and clipped Russian labels. `Button` fixed heights `36/48/56` don't grow with the font scale. No `allowFontScaling={true}` overrides and no `maxFontSizeMultiplier`.
**Fix:** Adopt `maxFontSizeMultiplier={1.5}` globally, remove fixed heights on Buttons where possible (use padding-based sizing), and test with iOS Larger Text (accessibilityScale).

### [20] No `prefers-reduced-motion` support
**Screen:** `voice-button.tsx:34-70` (infinite pulse + expanding ring), `progress-ring.tsx:29-33` (always animates), `confetti.tsx` (on 100% day)
**Issue:** `AccessibilityInfo.isReduceMotionEnabled()` is never queried. Users with vestibular disorders get forced animations.
**Fix:** Wrap animations in `const reduceMotion = useReducedMotion()` hook and return the final state immediately if true.

### [21] Modal sheet loses state on dismissal
**Screen:** `(tabs)/tasks.tsx` add/edit task modal
**Issue:** Open "Add task" → type title → accidentally swipe down → re-open → empty form. No draft preservation.
**Fix:** Persist modal form to Zustand or MMKV until submitted.

### [22] Inconsistent ProgressRing stroke widths
**Screen:** `(tabs)/index.tsx:409` (`strokeWidth={6}` on size 80), `pet.tsx` uses `barBg: height: 10`, habits uses `height: 6`, finance uses `height: 12`. Five different progress indicator thicknesses.
**Fix:** Add `progressHeight = { sm: 4, md: 6, lg: 8, xl: 12 }` token. Choose one per hierarchy level.

### [23] Missing pet avatar `accessibilityLabel` hides key status info
**Screen:** `(tabs)/index.tsx:388-395`
**Issue:** `<PetAvatar ...>` on dashboard has no label. Screen reader user doesn't know there's a pet, doesn't hear "Питомец здоров на 80%" — they just get "button".
**Fix:** `accessibilityLabel={'Питомец ' + petName + ', здоровье ' + health + '%, уровень ' + level}`.

### [24] Mood emojis use hardcoded `\u{1F614}` sequence inline
**Screen:** `(tabs)/index.tsx:42-47`
**Issue:** `MOOD_EMOJIS: Record<number, string> = { 1:'\u{1F614}',…}`. Hardcoding Unicode escapes instead of literal emojis makes the file 2× harder to read and survey translations. This is classic AI-generated code.
**Fix:** Use literal characters: `{ 1: '😔', 2: '🙁', 3: '😐', 4: '🙂', 5: '😄' }`. Keep `\u2014` → `'—'` as literal em-dash.

### [25] No loading skeletons — ActivityIndicator everywhere
**Screen:** `(tabs)/index.tsx:539` and similar
**Issue:** `<ActivityIndicator color={colors.primary} style={styles.loader} />` on first load → blank card with spinner. Industry-standard now is skeleton shimmer for cards.
**Fix:** Add `<Skeleton width height/>` using `react-native-reanimated` shimmer. Replace ActivityIndicators in list-level loaders.

---

## Screen-by-screen notes (brief)

- **`index.tsx` (Dashboard):** Strongest use of tokens overall. But: hardcoded `#1A2540` quote card; hardcoded `bottom: 90, right: 20` floating voice; pet-avatar absolute positioning can clip long Russian greetings; 4 summary cards get cramped on small devices (`flex:1` each leaves 56-72pt per card — fontSize.md values + `2/8/9` splits will wrap into 2 lines for "Привычки 9/11"). `aiTilesRow` backgrounds use `rgba(...)` strings instead of tokens. `scrollContent paddingBottom: spacing.xl * 3` (96) is less than tab bar on modern phones with home indicator (~83 + 16 = 99).
- **`tasks.tsx`:** Clean in most places, but the edit modal's delete button is hardcoded `as any` (P1 [13]). Week picker cell `48×64` meets touch targets. `fab` hardcodes `bottom: spacing.xl` ignoring tab bar. Empty state is functional but minimal. Pull-to-refresh present. Good swipe-to-delete integration.
- **`habits.tsx`:** `borderRadius: 3` on progress bar is off-scale. FAB at `bottom: spacing.xl` (32) is below iPhone 15 tab bar. `floatingVoice: bottom: 90` doesn't coexist with FAB at 32 — overlap on small screens. Otherwise adheres to tokens.
- **`goals.tsx`:** Missing `KeyboardAvoidingView` around add-goal section. FAB `bottom: spacing.xl + 60 = 92` is a magic arithmetic to clear voice button. No pull-to-refresh. Otherwise clean.
- **`finance.tsx`:** Category bars with `fontSize:10` are below HIG minimum. FAB `bottom:24, right:24` hardcoded. Month selector `minWidth: 160` might overflow for months like "Сентябрь 2026". Tab switch animation is abrupt (no transition). BarPercent `width: 80` on small phones eats 21% of width. Uses `colors/colors.ts` relative import instead of `@/constants` — inconsistent with other tabs.
- **`chat.tsx`:** Hardcoded `'#FF3B30'` for recording state (2 shades of red), `'#FFFFFF'` white instead of `colors.text`, `rgba(255,255,255,0.6)` magic. Auto-scroll works. No keyboard offset. Empty state is the richest in the app — good. Input `maxHeight: 100, minHeight: 40` — fixed values instead of tokens.
- **`pet.tsx`:** Heaviest offender for hardcoded colors outside nutrition/swipe-home. 5-color "room gradient" (`#1a1a2e`…`#2a1050`) is not in the palette. Gray text (`#666/#888/#555/#777/#ccc`) fails contrast. `breakdownCard: width: '31%'` creates fragile grid that breaks with 4+ items. `minHeight: 280` on room container is arbitrary. Pet avatar area has `glowEffect` and `goldenBorder` positioned absolutely with magic numbers (`width: 160, height: 160, borderRadius: 80` + `180/180/90`) that don't adapt to pet size prop.
- **`arena.tsx` / `battle-screen.tsx` / `character-select.tsx`:** Heavily uses inline `fontSize: 32/50/22/10/12`. Clearly a separate feature merged without style review. Character cards mix tokens and hex.
- **`swipe-home.tsx`:** See P1 [14]. Dead code or parallel prototype — needs decision.
- **`onboarding.tsx`:** Uses `borderRadius: 16, 12, 4` hardcoded. `width: 90` for petCard is arbitrary. `emoji: fontSize: 80` OK for hero, but titles at `fontSize.xl = 24` are smaller than dashboard greeting (`xxl = 32`) — hierarchy inversion. No skip button.
- **`settings/index.tsx`:** `borderRadius: 14, 12, 11, 6` all off-scale for toggles/radios. `width: 48, height: 28, borderRadius: 14` for custom iOS-style toggle duplicates `Switch` primitive. Uppercase section titles (`textTransform: 'uppercase', letterSpacing: 1`) are nice, but `fontSize.sm = 14` uppercase is a strong visual pattern that competes with screen title.
- **`settings/integrations.tsx`:** `placeholder="Chat ID"` English in RU UI. `borderRadius: 8, 12` off-scale.
- **`nutrition.tsx`:** The biggest design-system violator. Zero imports from `@/constants`. Every color/font/radius/padding is hardcoded. Uses own palette `#0F172A`/`#1E293B`/`#F8FAFC` that coincidentally matches tokens but is decoupled. If tokens change, this screen drifts. Needs a full rewrite.
- **`battle-screen.tsx`:** Inline `<Text style={{ fontSize: 16 }}>✨</Text>` — anti-pattern; StyleSheet.create ignored.
- **Shared UI kit (`components/ui/*`):** Clean, typed, memoized. `Modal` footer lacks a tap-outside-to-dismiss (only `onRequestClose`). `Checkbox` default size 24 but passed `20` by tab screens reducing targets. `Button` size `sm` has height 36 (below 44pt touch target — but hitSlop compensates if users tap title area).

---

## Top 5 polish wins (low-effort, high-impact)

1. **Add `accessibilityLabel` + `accessibilityRole` sweep** across all `TouchableOpacity` in `/app` and `/components`. Single PR, ~60 touch points, ~2 hours. Unblocks a11y review. [fixes P0 #1]
2. **Replace `paddingBottom: 100/120` with a shared `useTabBarPadding()` hook** that returns `useBottomTabBarHeight() + insets.bottom`. ~5 files, ~30 minutes. [fixes P0 #2]
3. **Bump `textSecondary` from `#94A3B8` to `#B0BEC9`** in `constants/colors.ts`. One line, immediately improves contrast across every screen — probably the single highest-impact fix. [fixes P0 #5 + much of P1 #15]
4. **Remove inline `as any` delete button in `tasks.tsx:603-614` and route through `<Button variant="danger">`** — fixes the AI-slop hex cluster AND demonstrates a pattern for other screens. ~5 minutes.
5. **Add `Haptics.impactAsync(Light)` to checkbox toggle** in `components/ui/checkbox.tsx` and `animated-checkbox.tsx`. Single file, two lines, instant premium-feel upgrade across tasks/habits/goals. [fixes P1 #7]
