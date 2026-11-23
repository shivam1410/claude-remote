// A menubar status for the laptop bridge. One file, no dependencies, built with
// `swiftc` — no Xcode project, no Electron. It is a read-only glance at the
// bridge plus one control: pause notifications while you are at the laptop.
//
// Data source: ~/.claude-bridge/status.json, which the bridge rewrites every
// tick with { at, uid, sessions, paused }. Nothing secret lives there — the
// same uid and session count the phone already holds. The pause control just
// creates or removes ~/.claude-bridge/paused, which the bridge reads to decide
// whether to send the FCM push. No network, no credentials, no session text.
import Cocoa

private let dir = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent(".claude-bridge")
private let statusURL = dir.appendingPathComponent("status.json")
private let pausedURL = dir.appendingPathComponent("paused")

// The bridge ticks every 2s and writes status each tick, so a status older than
// this means the service is not running.
private let STALE_SECONDS = 15

private struct Status {
    var running = false
    var paired = false
    var sessions = 0
    var paused = false
    var ageSec = Int.max
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private var timer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        item.button?.imagePosition = .imageLeading
        refresh()
        // Poll the file rather than watch it: it is one tiny read every 3s, far
        // cheaper to reason about than an fs event stream for a status glance.
        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            self?.refresh()
        }
    }

    private func readStatus() -> Status {
        var status = Status()
        guard let data = try? Data(contentsOf: statusURL),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            // No file yet, or unreadable: treat as stopped. The pause flag is
            // still read from disk so the menu is correct before the first tick.
            status.paused = FileManager.default.fileExists(atPath: pausedURL.path)
            return status
        }
        let atMs = (obj["at"] as? Double) ?? 0
        status.ageSec = Int((Date().timeIntervalSince1970 * 1000 - atMs) / 1000)
        status.running = status.ageSec >= 0 && status.ageSec <= STALE_SECONDS
        status.paired = (obj["uid"] as? String).map { !$0.isEmpty } ?? false
        status.sessions = (obj["sessions"] as? Int) ?? 0
        status.paused = (obj["paused"] as? Bool)
            ?? FileManager.default.fileExists(atPath: pausedURL.path)
        return status
    }

    private func refresh() {
        let status = readStatus()
        let symbol = !status.running ? "bolt.slash"
            : (status.paused ? "bell.slash" : "bolt.horizontal.circle.fill")
        let image = NSImage(systemSymbolName: symbol, accessibilityDescription: "claude bridge")
        image?.isTemplate = true
        item.button?.image = image
        item.button?.title = status.running ? " \(status.sessions)" : ""
        item.button?.contentTintColor = !status.running ? .systemRed
            : (status.paused ? .systemOrange : .systemGreen)
        item.menu = buildMenu(status)
    }

    private func buildMenu(_ status: Status) -> NSMenu {
        let menu = NSMenu()
        menu.addItem(info("Bridge: \(status.running ? "running" : "stopped")"))
        menu.addItem(info("Paired: \(status.paired ? "yes" : "no")"))
        menu.addItem(info("Sessions: \(status.sessions)"))
        if status.running { menu.addItem(info("Last tick: \(status.ageSec)s ago")) }
        menu.addItem(.separator())
        let pause = NSMenuItem(title: "Pause notifications",
                               action: #selector(togglePause), keyEquivalent: "")
        pause.target = self
        pause.state = status.paused ? .on : .off
        menu.addItem(pause)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit",
                                action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        return menu
    }

    private func info(_ text: String) -> NSMenuItem {
        let menuItem = NSMenuItem(title: text, action: nil, keyEquivalent: "")
        menuItem.isEnabled = false
        return menuItem
    }

    @objc private func togglePause() {
        let fileManager = FileManager.default
        if fileManager.fileExists(atPath: pausedURL.path) {
            try? fileManager.removeItem(at: pausedURL)
        } else {
            try? fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
            fileManager.createFile(atPath: pausedURL.path, contents: nil)
        }
        refresh()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
// Accessory: a menubar-only agent, no Dock icon and no main window.
app.setActivationPolicy(.accessory)
app.run()
