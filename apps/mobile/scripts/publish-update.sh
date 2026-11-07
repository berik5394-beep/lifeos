#!/usr/bin/env bash
# Обновление «по воздуху» (EAS Update) для всех, у кого стоит сборка с тем же
# нативным отпечатком. Только JS/экраны: новые разрешения и нативные модули —
# через обычную сборку (TestFlight / APK).
#
# Запуск: npm run ota -- "Канбан: срок на карточке"
#
# Почему не голый `eas update`: адрес сервера (EXPO_PUBLIC_API_URL) вшивается в
# код при публикации, а локальный .env указывает на машину разработчика — у всех
# пропала бы связь с сервером. Здесь адрес задан жёстко и проверяется в бандле.
set -euo pipefail
cd "$(dirname "$0")/.."

MSG="${1:-}"
if [ -z "$MSG" ]; then
  echo 'Напиши, что в обновлении: npm run ota -- "что поменялось"' >&2
  exit 1
fi

PROD_API="https://lifeos-api-production-736d.up.railway.app"
export EXPO_PUBLIC_API_URL="$PROD_API"   # переменные окружения главнее .env

rm -rf dist
# --clear: Metro кэширует код со ВШИТЫМ адресом — без очистки мог уйти старый (хоть localhost).
npx expo export --platform ios --platform android --output-dir dist --clear

# Байт-код Hermes бинарный: без -a grep его молча пропускает. Проверяем КАЖДУЮ платформу.
for bundle in dist/_expo/static/js/ios/*.hbc dist/_expo/static/js/android/*.hbc; do
  if [ ! -f "$bundle" ] || ! grep -qaF "$PROD_API" "$bundle" || grep -qaF "localhost:3000" "$bundle"; then
    echo "СТОП: в $bundle не тот адрес сервера (нужен $PROD_API, без localhost). Обновление не отправлено." >&2
    exit 1
  fi
done

npx eas-cli update --channel production --message "$MSG" --skip-bundler --non-interactive
