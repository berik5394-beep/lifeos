/**
 * Config-plugin: минимальная iOS для ВСЕХ подов.
 *
 * Xcode 26+ (у Berik Xcode 27) отвергает таргеты с IPHONEOS_DEPLOYMENT_TARGET
 * ниже 15.0, а у части подов (resource-bundle таргеты AsyncStorage и др.)
 * зашиты 11.0/13.4 → сборка падает. Поднимаем всем подам до MIN_IOS в
 * post_install. Плагин, а не ручная правка Podfile: ios/ генерируется
 * (`expo prebuild`) и ручные правки там теряются.
 */
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MIN_IOS = '15.1';
const MARKER = '# with-pods-min-ios';

module.exports = function withPodsMinIos(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let src = fs.readFileSync(podfile, 'utf8');
      if (!src.includes(MARKER)) {
        src = src.replace(
          /post_install do \|installer\|\n/,
          `post_install do |installer|\n    ${MARKER}\n    installer.pods_project.targets.each do |t|\n      t.build_configurations.each do |c|\n        if Gem::Version.new(c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] || '0') < Gem::Version.new('${MIN_IOS}')\n          c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${MIN_IOS}'\n        end\n      end\n    end\n`,
        );
        fs.writeFileSync(podfile, src);
      }
      return cfg;
    },
  ]);
};
