import AppIntents
import Foundation

// Команда Siri «Поговорить с LifeOS» / «Привет, LifeOS»: открывает приложение
// сразу в режиме разговора без рук (ссылка lifeos://talk → services/talk-link.ts).
// В _shared — компилируется и в приложение, и в виджет (openAppWhenRun).

@available(iOS 18.0, *)
struct TalkToLifeOSIntent: AppIntent {
  static let title: LocalizedStringResource = "Поговорить с LifeOS"
  static let description = IntentDescription("Открыть разговор с роботом без рук.")
  static let openAppWhenRun: Bool = true

  @MainActor
  func perform() async throws -> some IntentResult & OpensIntent {
    .result(opensIntent: OpenURLIntent(URL(string: "lifeos://talk")!))
  }
}

@available(iOS 18.0, *)
struct LifeOSShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: TalkToLifeOSIntent(),
      phrases: [
        "Поговорить с \(.applicationName)",
        "Привет, \(.applicationName)",
        "\(.applicationName), слушай",
      ],
      shortTitle: "Поговорить",
      systemImageName: "waveform"
    )
  }
}
