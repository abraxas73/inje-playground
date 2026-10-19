import Cocoa
import FlutterMacOS

@main
class AppDelegate: FlutterAppDelegate {
  @MainActor @objc func checkForUpdates(_ sender: Any?) {
    if mainFlutterWindow?.isMiniaturized == true { mainFlutterWindow?.deminiaturize(sender) }
    mainFlutterWindow?.makeKeyAndOrderFront(sender)
    (mainFlutterWindow as? MainFlutterWindow)?.desktopUpdater?.checkForUpdates()
  }
  override func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    (mainFlutterWindow as? MainFlutterWindow)?.desktopUpdater?.prepareForTermination() ?? .terminateNow
  }
  override func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    return true
  }

  override func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
    return true
  }
}
