import fs from 'fs';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require('../../plugins/with-scene-lifecycle') as {
  applySceneDelegate: (src: string) => string;
  applySceneManifest: (plist: Record<string, unknown>) => Record<string, unknown>;
};

const TEMPLATE = `  public override func application() -> Bool {
    bindReactNativeFactory(factory)

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
`;

describe('with-scene-lifecycle — iOS 27 SDK требует UIScene', () => {
  it('переносит окно из AppDelegate в SceneDelegate', () => {
    const out = plugin.applySceneDelegate(TEMPLATE);
    expect(out).not.toContain('UIWindow(frame: UIScreen.main.bounds)');
    expect(out).toContain('class SceneDelegate: UIResponder, UIWindowSceneDelegate');
    expect(out).toContain('UIWindow(windowScene: windowScene)');
    expect(out).toContain('factory.startReactNative(withModuleName: "main", in: window');
  });
  it('идемпотентен (повторный prebuild не дублирует)', () => {
    const once = plugin.applySceneDelegate(TEMPLATE);
    expect(plugin.applySceneDelegate(once)).toBe(once);
  });
  it('шаблон изменился → громкая ошибка, а не тихий пропуск', () => {
    expect(() => plugin.applySceneDelegate('class AppDelegate {}')).toThrow(/шаблон Expo изменился/);
  });
  it('манифест сцены указывает на SceneDelegate модуля', () => {
    const plist = plugin.applySceneManifest({});
    expect(JSON.stringify(plist)).toContain('$(PRODUCT_MODULE_NAME).SceneDelegate');
  });
  it('плагин подключён в app.json', () => {
    const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../../app.json'), 'utf8'));
    expect(app.expo.plugins).toContain('./plugins/with-scene-lifecycle');
  });
});
