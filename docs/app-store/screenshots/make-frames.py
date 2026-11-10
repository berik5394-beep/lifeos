# Подписи к скриншотам App Store 6.9": raw/*.png (симулятор, 1320x2868) → 01..07-*.png. Нужен rsvg-convert (brew install librsvg). Запуск: cd в scratch-папку, python3 -I <путь>/make-frames.py
import base64, subprocess, sys, os
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '6.9')
SHOTS = [
  ('raw-memory',           'Друг, который помнит',      'Цели, люди, важные даты —\nбез напоминаний с твоей стороны'),
  ('raw-support',          'Рядом, когда тревожно',     'Слышит и поддерживает,\nа не читает лекции'),
  ('raw-money-goal',       'Честно про деньги',         'Каждую трату сверяет\nс твоей целью'),
  ('raw-dashboard-friend', 'Замечает, как ты',          'Видит по дневнику, что неделя\nтяжёлая, — и не грузит делами'),
  ('raw-portrait',         'Каким я тебя вижу',         'Портрет из твоих привычек,\nцелей и решений'),
  ('raw-greeting',         'Утро с планом',             'Главное на сегодня —\nв паре фраз'),
  ('raw-room',             'Ваш общий дом',             'Комната робота растёт\nвместе с вашей дружбой'),
]
W, H = 1320, 2868
SW = 1040; SH = round(SW * 2868 / 1320)
X = (W - SW) // 2; Y = H - SH - 70
def esc(s): return s.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')
for i, (name, title, sub) in enumerate(SHOTS, 1):
    b64 = base64.b64encode(open(f'{SRC}/raw/{name[4:]}.png','rb').read()).decode()
    subs = ''.join(f'<tspan x="{W//2}" dy="{0 if j==0 else 66}">{esc(l)}</tspan>' for j,l in enumerate(sub.split('\n')))
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{W}" height="{H}">
<defs><clipPath id="c"><rect x="{X}" y="{Y}" width="{SW}" height="{SH}" rx="72"/></clipPath>
<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6A61F0"/><stop offset="1" stop-color="#4A42C8"/></linearGradient></defs>
<rect width="{W}" height="{H}" fill="url(#g)"/>
<text x="{W//2}" y="190" text-anchor="middle" font-family="Helvetica Neue" font-weight="bold" font-size="100" fill="#FFFFFF">{esc(title)}</text>
<text x="{W//2}" y="300" text-anchor="middle" font-family="Helvetica Neue" font-size="54" fill="#E6E3FF">{subs}</text>
<rect x="{X-6}" y="{Y-6}" width="{SW+12}" height="{SH+12}" rx="78" fill="#2A2560" opacity="0.35"/>
<image x="{X}" y="{Y}" width="{SW}" height="{SH}" clip-path="url(#c)" xlink:href="data:image/png;base64,{b64}"/>
</svg>'''
    open('t.svg','w').write(svg)
    out = f'{SRC}/{i:02d}-{name[4:]}.png'
    subprocess.run(['rsvg-convert','-w',str(W),'-h',str(H),'t.svg','-o','t.png'], check=True)
    subprocess.run(['sips','-s','format','jpeg','-s','formatOptions','95','t.png','--out','t.jpg'], check=True, capture_output=True)
    subprocess.run(['sips','-s','format','png','t.jpg','--out',out], check=True, capture_output=True)
    print(out)
