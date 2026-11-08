import SwiftUI
import WidgetKit

// Виджет «Сегодня» (LifeOS). Данные кладёт приложение в общую App Group
// (ключ "today", JSON), виджет только читает. Нет данных — просит открыть
// приложение, ничего не выдумывает.

private let appGroup = "group.kz.lifeos.app"

struct TodayData: Codable {
  let date: String
  let tasksDone: Int
  let tasksTotal: Int
  let habitsDone: Int
  let habitsTotal: Int
  let nextTime: String?
  let nextTitle: String?
  let topTask: String?
}

struct TodayEntry: TimelineEntry {
  let date: Date
  let data: TodayData?
}

private func loadToday() -> TodayData? {
  guard
    let raw = UserDefaults(suiteName: appGroup)?.string(forKey: "today"),
    let json = raw.data(using: .utf8)
  else { return nil }
  return try? JSONDecoder().decode(TodayData.self, from: json)
}

struct TodayProvider: TimelineProvider {
  func placeholder(in context: Context) -> TodayEntry {
    TodayEntry(
      date: Date(),
      data: TodayData(
        date: "", tasksDone: 2, tasksTotal: 5, habitsDone: 1, habitsTotal: 3,
        nextTime: "14:00", nextTitle: "Встреча", topTask: "Главное дело"))
  }

  func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
    completion(TodayEntry(date: Date(), data: loadToday() ?? placeholder(in: context).data))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
    // Приложение само перезагружает виджет при изменениях; это — запасной таймер.
    let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date()
    completion(Timeline(entries: [TodayEntry(date: Date(), data: loadToday())], policy: .after(next)))
  }
}

private struct CountRow: View {
  let icon: String
  let label: String
  let done: Int
  let total: Int
  var body: some View {
    HStack(spacing: 6) {
      Image(systemName: icon).font(.caption).foregroundStyle(Color("$accent"))
      Text(label).font(.caption).foregroundStyle(Color("lifeosMuted"))
      Spacer(minLength: 2)
      Text(total > 0 ? "\(done)/\(total)" : "—")
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(Color("lifeosText"))
    }
  }
}

struct TodayView: View {
  @Environment(\.widgetFamily) var family
  let entry: TodayEntry

  var body: some View {
    Group {
      if let d = entry.data {
        VStack(alignment: .leading, spacing: 6) {
          Text("Сегодня").font(.headline).foregroundStyle(Color("lifeosText"))
          CountRow(icon: "checkmark.circle", label: "Задачи", done: d.tasksDone, total: d.tasksTotal)
          CountRow(icon: "repeat", label: "Привычки", done: d.habitsDone, total: d.habitsTotal)
          Spacer(minLength: 0)
          if let t = d.nextTime, let title = d.nextTitle {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
              Text(t).font(.caption.weight(.bold)).foregroundStyle(Color("$accent"))
              Text(title).font(.caption).foregroundStyle(Color("lifeosText")).lineLimit(family == .systemSmall ? 1 : 2)
            }
          } else {
            Text("Встреч больше нет").font(.caption).foregroundStyle(Color("lifeosMuted"))
          }
          if family != .systemSmall, let top = d.topTask {
            Text("Главное: \(top)").font(.caption).foregroundStyle(Color("lifeosMuted")).lineLimit(1)
          }
        }
      } else {
        VStack(alignment: .leading, spacing: 6) {
          Text("Сегодня").font(.headline).foregroundStyle(Color("lifeosText"))
          Text("Открой LifeOS — покажу день").font(.caption).foregroundStyle(Color("lifeosMuted"))
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .containerBackground(for: .widget) { Color("$widgetBackground") }
    .widgetURL(URL(string: "lifeos://today"))
  }
}

struct TodayWidget: Widget {
  let kind = "LifeOSToday"
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: TodayProvider()) { entry in
      TodayView(entry: entry)
    }
    .configurationDisplayName("Сегодня")
    .description("Задачи, привычки и ближайшая встреча.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

@main
struct LifeOSWidgets: WidgetBundle {
  var body: some Widget {
    TodayWidget()
  }
}
