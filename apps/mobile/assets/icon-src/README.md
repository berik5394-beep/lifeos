# Значок LifeOS — робот-друг

Тот же робот, что в приложении (`services/robot-emotion.ts` → `ROBOT_COLORS`): светлая
голова-капсула, тёмный экран, бирюзовые улыбающиеся глаза, жёлтый огонёк антенны,
фон — фиолетовый, как тело робота. Превью — `preview.png`.

Исходники — SVG здесь. Пересобрать (нужен `rsvg-convert`, `brew install librsvg`):

```bash
cd apps/mobile/assets/icon-src
rsvg-convert -w 1024 -h 1024 icon.svg -o /tmp/icon-rgba.png
sips -s format jpeg -s formatOptions 100 /tmp/icon-rgba.png --out /tmp/icon.jpg && sips -s format png /tmp/icon.jpg --out ../icon.png   # iOS: без прозрачности
rsvg-convert -w 1024 -h 1024 adaptive.svg -o ../adaptive-icon.png   # Android, фон — app.json adaptiveIcon.backgroundColor
rsvg-convert -w 1024 -h 1024 splash.svg -o ../splash-icon.png
rsvg-convert -w 96 -h 96 notif.svg -o ../notification-icon.png    # белый силуэт
rsvg-convert -w 48 -h 48 icon.svg -o ../favicon.png
```

`icon.svg`/`adaptive.svg`/`splash.svg` собраны из `robot.part` (общий робот). Значок и
заставка — нативные: попадают в приложение только с новой сборкой (EAS), не через OTA.
