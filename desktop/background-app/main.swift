import AppKit
import Darwin

// One macOS background item owns the unchanged Cantus programs and transports.
final class CantusBackground: NSObject, NSApplicationDelegate {
    var children: [String: Process] = [:]
    var signals: [DispatchSourceSignal] = []
    var stopping = false
    var log: FileHandle?
    var lockFD: Int32 = -1
    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            lockFD = open("/tmp/tw.evitina.cantus.background.\(getuid()).lock", O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
            guard lockFD >= 0, flock(lockFD, LOCK_EX | LOCK_NB) == 0 else { NSApp.terminate(nil); return }
            let file = Bundle.main.url(forResource: "services", withExtension: "json")!
            let specs = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [[String: Any]]
            guard let logPath = Bundle.main.object(forInfoDictionaryKey: "CantusLogPath") as? String, logPath.hasPrefix("/") else { throw CocoaError(.fileReadCorruptFile) }
            let logURL = URL(fileURLWithPath: logPath)
            if !FileManager.default.fileExists(atPath: logURL.path) {
                guard FileManager.default.createFile(atPath: logURL.path, contents: nil, attributes: [.posixPermissions: 0o600]) else { throw CocoaError(.fileWriteNoPermission) }
            }
            log = try FileHandle(forWritingTo: logURL)
            try log?.seekToEnd()
            for s in [SIGTERM, SIGINT] {
                signal(s, SIG_IGN)
                let source = DispatchSource.makeSignalSource(signal: s, queue: .main)
                source.setEventHandler { self.stop() }
                source.resume(); signals.append(source)
            }
            for spec in specs { start(spec) }
        } catch {
            NSLog("Cantus background startup failed: %@", String(describing: error))
            let alert = NSAlert(); alert.messageText = "Cantus 背景連線尚未啟動"
            alert.informativeText = "請確認 AI-WORK 已掛載，並允許 Cantus 背景連線存取外接磁碟。未改存其他位置。"
            alert.runModal(); NSApp.terminate(nil)
        }
    }
    func start(_ spec: [String: Any]) {
        guard !stopping, let name = spec["name"] as? String, let args = spec["args"] as? [String], !args.isEmpty else { return }
        let p = Process(); p.executableURL = URL(fileURLWithPath: args[0]); p.arguments = Array(args.dropFirst())
        p.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser
        p.standardOutput = log; p.standardError = log
        p.terminationHandler = { child in
            DispatchQueue.main.async {
                self.children.removeValue(forKey: name)
                NSLog("Cantus %@ stopped (%d)", name, child.terminationStatus)
                if !self.stopping { DispatchQueue.main.asyncAfter(deadline: .now() + 30) { self.start(spec) } }
            }
        }
        do { try p.run(); children[name] = p }
        catch { NSLog("Cantus %@ failed to start", name); DispatchQueue.main.asyncAfter(deadline: .now() + 30) { self.start(spec) } }
    }
    func stop() {
        guard !stopping else { return }; stopping = true
        for p in children.values where p.isRunning { p.terminate() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { NSApp.terminate(nil) }
    }
    func applicationWillTerminate(_ notification: Notification) {
        stopping = true
        for p in children.values where p.isRunning { p.terminate() }
        if lockFD >= 0 { close(lockFD) }
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = CantusBackground()
app.delegate = delegate
app.run()
