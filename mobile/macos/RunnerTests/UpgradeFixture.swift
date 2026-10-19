import Cocoa
import Sparkle

// Test-only session model for controlled loopback transport. Production's
// official-origin validator is tested separately and is NOT weakened for QA.
@MainActor final class DesktopUpdateSession {
  let version = "9.0.2"
  let artifactURL: URL
  private(set) var authorized = true
  init(base: URL) { artifactURL = base.appendingPathComponent("artifact.dmg") }
  func cancel() { authorized = false }
  func accepts(_ item: SUAppcastItem) -> Bool {
    authorized && item.displayVersionString == version && item.fileURL == artifactURL && !item.isInformationOnlyUpdate
  }
}

@main @MainActor final class UpgradeFixture: NSObject, NSApplicationDelegate, SPUUpdaterDelegate {
  private var window: NSWindow?
  private var updater: SPUUpdater?
  private var driver: UpdaterUserDriver?
  private var job: DesktopUpdateSession?
  private let base = URL(string: Bundle.main.object(forInfoDictionaryKey: "FixtureBaseURL") as! String)!
  static func main() {
    let app = NSApplication.shared
    let delegate = UpgradeFixture()
    app.delegate = delegate
    withExtendedLifetime(delegate) { app.run() }
  }
  func report(_ event: String, _ details: [String: Any] = [:]) {
    var request = URLRequest(url: base.appendingPathComponent("event"))
    request.httpMethod = "POST"
    request.httpBody = try? JSONSerialization.data(withJSONObject: details.merging(["event": event, "pid": ProcessInfo.processInfo.processIdentifier]) { old, _ in old })
    URLSession.shared.dataTask(with: request).resume()
  }
  func applicationDidFinishLaunching(_ notification: Notification) {
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as! String
    if version == "1" {
      UserDefaults.standard.set("fixture-account", forKey: "testSession")
      UserDefaults.standard.set("fixture-preference", forKey: "testPreference")
    }
    report("launch", ["version": version, "path": Bundle.main.bundlePath,
      "runningPath": NSRunningApplication.current.bundleURL?.path ?? "missing",
      "runningIdentifier": NSRunningApplication.current.bundleIdentifier ?? "missing",
      "matchingProcesses": NSRunningApplication.runningApplications(withBundleIdentifier: Bundle.main.bundleIdentifier!).map { $0.processIdentifier },
      "session": UserDefaults.standard.string(forKey: "testSession") ?? "missing",
      "preference": UserDefaults.standard.string(forKey: "testPreference") ?? "missing"])
    window = NSWindow(contentRect: NSRect(x: 120, y: 120, width: 360, height: 100), styleMask: [.titled, .closable], backing: .buffered, defer: false)
    window?.title = "Isolated InnoCrew updater test"
    window?.makeKeyAndOrderFront(nil)
    guard version == "1" else { return }
    let session = DesktopUpdateSession(base: base); job = session
    let ui = UpdaterUserDriver(session: session, status: { [weak self] phase, _ in self?.report("status", ["phase": phase]) }, finished: { [weak self] in self?.report("finished") })
    driver = ui
    let engine = SPUUpdater(hostBundle: .main, applicationBundle: .main, userDriver: ui, delegate: self)
    updater = engine; engine.httpHeaders = ["Authorization": "Bearer isolated-upgrade-fixture"]
    do { try engine.start(); engine.checkForUpdates() }
    catch { report("error", ["message": error.localizedDescription]) }
  }
  func feedURLString(for updater: SPUUpdater) -> String? { base.appendingPathComponent("feed").absoluteString }
  func updater(_ updater: SPUUpdater, shouldDownloadReleaseNotesForUpdate item: SUAppcastItem) -> Bool { false }
  func updater(_ updater: SPUUpdater, didFinishUpdateCycleFor updateCheck: SPUUpdateCheck, error: Error?) {
    if let error = error { report("error", ["message": error.localizedDescription]) }
  }
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply { report("termination-request"); return .terminateNow }
}
