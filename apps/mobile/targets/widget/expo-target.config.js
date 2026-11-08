/**
 * Виджет «Сегодня» + команда Siri «Поговорить с LifeOS» (сборка №15+).
 * App Group берётся из app.json (group.kz.lifeos.app) — через неё приложение
 * кладёт сводку дня (services/widget-sync.ts), а виджет её читает.
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = (config) => ({
  type: 'widget',
  name: 'LifeOSWidget',
  displayName: 'LifeOS',
  deploymentTarget: '17.0',
  bundleIdentifier: '.widget',
  colors: {
    $accent: '#8B6F4E',
    $widgetBackground: { color: '#F5EFE6', darkColor: '#1F1A15' },
    lifeosText: { color: '#2B2118', darkColor: '#F2EBE1' },
    lifeosMuted: { color: '#7A6A5A', darkColor: '#B5A797' },
  },
  frameworks: ['SwiftUI', 'WidgetKit', 'AppIntents'],
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
  },
});
