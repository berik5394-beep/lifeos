/**
 * Config-plugin: UIScene-жизненный цикл для iOS 27 SDK.
 *
 * С SDK iOS 27 (Xcode 27) приложение без UIScene падает на старте
 * (EXC_BREAKPOINT в _UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption).
 * Шаблон Expo SDK 54 создаёт окно в AppDelegate — переносим это в SceneDelegate:
 *  1) Info.plist: UIApplicationSceneManifest → $(PRODUCT_MODULE_NAME).SceneDelegate;
 *  2) AppDelegate.swift: убираем создание окна, добавляем класс SceneDelegate
 *     (окно + startReactNative, ссылки и universal links через сцену).
 * Плагин, а не ручная правка: ios/ генерируется `expo prebuild`. Если шаблон
 * AppDelegate изменится и якорь не найдётся — падаем громко, а не молча.
 */
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const MARKER = '// with-scene-lifecycle';

const WINDOW_BLOCK =
  /#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\(\n\s*withModuleName: "main",\n\s*in: window,\n\s*launchOptions: launchOptions\)\n#endif\n/;

const SCENE_DELEGATE = `
${MARKER}: окно и React Native живут в сцене (обязательно с iOS 27 SDK).
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window

    // Холодный старт по ссылке: Linking.getInitialURL читает launchOptions[.url].
    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]
    if let url = connectionOptions.urlContexts.first?.url {
      launchOptions[.url] = url
    }
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: launchOptions)

    if let activity = connectionOptions.userActivities.first {
      self.scene(scene, continue: activity)
    }
  }

  // Ссылки, пока приложение запущено (с UIScene они приходят сюда, а не в AppDelegate).
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      _ = UIApplication.shared.delegate?.application?(UIApplication.shared, open: context.url, options: [:])
    }
  }

  // Universal Links.
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = UIApplication.shared.delegate?.application?(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in }
    )
  }
}
`;

function applySceneDelegate(src) {
  if (src.includes(MARKER)) return src;
  if (!WINDOW_BLOCK.test(src)) {
    throw new Error(
      '[with-scene-lifecycle] не нашёл создание окна в AppDelegate.swift — шаблон Expo изменился, обнови плагин.',
    );
  }
  return (
    src.replace(WINDOW_BLOCK, `    ${MARKER}: окно создаёт SceneDelegate (ниже).\n`) + SCENE_DELEGATE
  );
}

function applySceneManifest(plist) {
  plist.UIApplicationSceneManifest = {
    UIApplicationSupportsMultipleScenes: false,
    UISceneConfigurations: {
      UIWindowSceneSessionRoleApplication: [
        {
          UISceneConfigurationName: 'Default Configuration',
          UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
        },
      ],
    },
  };
  return plist;
}

function withSceneLifecycle(config) {
  config = withInfoPlist(config, (cfg) => {
    applySceneManifest(cfg.modResults);
    return cfg;
  });
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error('[with-scene-lifecycle] ожидался AppDelegate.swift');
    }
    cfg.modResults.contents = applySceneDelegate(cfg.modResults.contents);
    return cfg;
  });
}

module.exports = withSceneLifecycle;
module.exports.applySceneDelegate = applySceneDelegate;
module.exports.applySceneManifest = applySceneManifest;
