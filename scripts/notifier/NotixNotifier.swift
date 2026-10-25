// Notix notification helper.
//
// Posts one UNUserNotificationCenter notification and exits. The banner shows
// this app bundle's icon, which is the DeepSeek whale shipped with Notix.
//
// macOS only grants notification authorization to code-signed applications.
// Build and sign the bundle with `scripts/build-notifier-app.sh` using a real
// signing identity; an ad-hoc signature is rejected by the system before any
// permission prompt appears.
//
// Usage: NotixNotifier <title> <body> [sound|silent] [logPath]
import Cocoa
import UserNotifications

let logURL = URL(fileURLWithPath: CommandLine.arguments.count > 4 ? CommandLine.arguments[4] : "/tmp/notix-notifier.log")
func log(_ text: String) {
    let line = "\(Date()): \(text)\n"
    if let handle = try? FileHandle(forWritingTo: logURL) {
        handle.seekToEndOfFile()
        handle.write(line.data(using: .utf8)!)
        try? handle.close()
    } else {
        try? line.write(to: logURL, atomically: true, encoding: .utf8)
    }
}

let args = CommandLine.arguments
let title = args.count > 1 ? args[1] : "Notix"
let body = args.count > 2 ? args[2] : ""
let sound = args.count > 3 ? args[3] != "silent" : true

log("start bundle=\(Bundle.main.bundleIdentifier ?? "nil") path=\(Bundle.main.bundlePath)")

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let center = UNUserNotificationCenter.current()
center.getNotificationSettings { settings in
    log("settings status=\(settings.authorizationStatus.rawValue)")
    center.requestAuthorization(options: [.alert, .sound]) { granted, error in
        log("requestAuthorization granted=\(granted) error=\(error?.localizedDescription ?? "none")")
        guard granted else { exit(2) }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        if sound { content.sound = .default }
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        center.add(request) { error in
            log("add error=\(error?.localizedDescription ?? "none")")
            exit(error == nil ? 0 : 1)
        }
    }
}
RunLoop.main.run(until: Date().addingTimeInterval(5))
