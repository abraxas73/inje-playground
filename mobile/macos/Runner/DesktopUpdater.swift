import Cocoa
import FlutterMacOS
import Sparkle

enum DesktopUpdateFailure: Error { case invalidRequest, unavailable, busy, canceled }

/// One explicit strip click, bound to an exact feed/version. No credentials in
/// UserDefaults or the feed URL; cancel permanently revokes this instance.
@MainActor
final class DesktopUpdateSession {
  let id: String
  let version: String
  let feedURL: URL
  let artifactURL: URL
  private(set) var token: String
  private(set) var authorized = true

  init(arguments: [String: Any]) throws {
    guard let id = arguments["sessionId"] as? String,
          id.range(of: "^[A-Za-z0-9-]{1,128}$", options: .regularExpression) != nil,
          let version = arguments["expectedVersion"] as? String,
          version.range(of: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$", options: .regularExpression) != nil,
          let token = arguments["accessToken"] as? String, !token.isEmpty, token.utf8.count < 8192,
          token.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
          let feed = arguments["feedUrl"] as? String, let url = URL(string: feed),
          let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
          parts.scheme == "https", parts.host == "innocrew.innogrid.com", parts.port == nil,
          parts.user == nil, parts.password == nil, parts.fragment == nil,
          parts.percentEncodedPath == "/api/desktop/update/appcast",
          parts.queryItems?.count == 2,
          parts.queryItems?.filter({ $0.name == "platform" && $0.value == "macos" }).count == 1,
          parts.queryItems?.filter({ $0.name == "version" && $0.value == version }).count == 1
    else { throw DesktopUpdateFailure.invalidRequest }
    self.id = id; self.version = version; self.token = token; self.feedURL = url
    artifactURL = URL(string: "https://innocrew.innogrid.com/api/desktop/update/artifact/macos/\(version)")!
  }

  func cancel() { authorized = false; token = "" }
  func accepts(_ item: SUAppcastItem) -> Bool {
    authorized && !item.isInformationOnlyUpdate && item.displayVersionString == version && item.fileURL == artifactURL
  }
}

@MainActor
final class DesktopUpdater: NSObject, SPUUpdaterDelegate {
  private let channel: FlutterMethodChannel
  private var updater: SPUUpdater?
  private var driver: UpdaterUserDriver?
  private var session: DesktopUpdateSession?
  private var cancelReplies: [FlutterResult] = []
  private var quitPending = false

  init(messenger: FlutterBinaryMessenger) {
    channel = FlutterMethodChannel(name: "com.innogrid.playground/updater", binaryMessenger: messenger)
    super.init()
    channel.setMethodCallHandler { [weak self] call, result in
      guard let self = self else { result(FlutterError(code: "unavailable", message: nil, details: nil)); return }
      if call.method == "install" {
        do {
          guard let args = call.arguments as? [String: Any] else { throw DesktopUpdateFailure.invalidRequest }
          try self.install(arguments: args)
          result(nil)
        } catch {
          result(FlutterError(code: "update_unavailable", message: "업데이트를 시작하지 못했습니다.", details: nil))
        }
      } else if call.method == "cancel" {
        guard let args = call.arguments as? [String: Any], let id = args["sessionId"] as? String,
              id == self.session?.id else { result(nil); return }
        self.cancelReplies.append(result)
        self.updater?.httpHeaders = nil
        self.driver?.cancel()
        if self.updater?.sessionInProgress != true { self.finish(id) }
      } else { result(FlutterMethodNotImplemented) }
    }
  }

  func checkForUpdates() {
    NSApp.activate(ignoringOtherApps: true)
    channel.invokeMethod("checkForUpdates", arguments: nil)
  }

  private func install(arguments: [String: Any]) throws {
    guard session == nil else { throw DesktopUpdateFailure.busy }
    let job = try DesktopUpdateSession(arguments: arguments)
    // An unconfigured development binary must fail closed, never install unsigned.
    guard let key = Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String,
          let keyBytes = Data(base64Encoded: key), keyBytes.count == 32,
          keyBytes.base64EncodedString() == key else { throw DesktopUpdateFailure.unavailable }
    let ui = UpdaterUserDriver(session: job, status: { [weak self] phase, progress in
      guard let self = self, self.session?.id == job.id else { return }
      var event: [String: Any] = ["phase": phase, "version": job.version, "sessionId": job.id]
      if let progress = progress { event["progress"] = progress }
      self.channel.invokeMethod("status", arguments: event)
    }, finished: { [weak self] in self?.finish(job.id) })
    session = job; driver = ui
    let engine = SPUUpdater(hostBundle: .main, applicationBundle: .main, userDriver: ui, delegate: self)
    updater = engine
    engine.httpHeaders = ["Authorization": "Bearer \(job.token)"]
    do {
      try engine.start()
      engine.checkForUpdates()
    } catch {
      job.cancel(); engine.httpHeaders = nil; session = nil; driver = nil; updater = nil
      throw DesktopUpdateFailure.unavailable
    }
  }

  private func finish(_ id: String) {
    guard session?.id == id else { return }
    session?.cancel(); updater?.httpHeaders = nil
    // Release Sparkle after its current callback unwinds.
    DispatchQueue.main.async { [weak self] in
      guard let self = self, self.session?.id == id else { return }
      self.session = nil; self.driver = nil; self.updater = nil
      let replies = self.cancelReplies; self.cancelReplies.removeAll()
      replies.forEach { $0(nil) }
      if self.quitPending { self.quitPending = false; NSApp.reply(toApplicationShouldTerminate: true) }
    }
  }

  /// A canceled, already-extracting update must receive .skip before app exit;
  /// .dismiss or early termination could otherwise install it on quit.
  func prepareForTermination() -> NSApplication.TerminateReply {
    if let job = session, !job.authorized, updater?.sessionInProgress == true {
      quitPending = true; return .terminateLater
    }
    return .terminateNow
  }

  func feedURLString(for updater: SPUUpdater) -> String? { session?.feedURL.absoluteString }
  func updater(_ updater: SPUUpdater, mayPerform updateCheck: SPUUpdateCheck) throws {
    guard session?.authorized == true else { throw DesktopUpdateFailure.canceled }
  }
  func updater(_ updater: SPUUpdater, shouldProceedWithUpdate item: SUAppcastItem, updateCheck: SPUUpdateCheck) throws {
    guard session?.accepts(item) == true else { throw DesktopUpdateFailure.invalidRequest }
  }
  func updater(_ updater: SPUUpdater, shouldDownloadReleaseNotesForUpdate item: SUAppcastItem) -> Bool { false }
  func updater(_ updater: SPUUpdater, willDownloadUpdate item: SUAppcastItem, with request: NSMutableURLRequest) {
    guard let job = session, job.accepts(item), request.url == job.artifactURL else {
      request.setValue(nil, forHTTPHeaderField: "Authorization"); driver?.cancel(); return
    }
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.setValue("Bearer \(job.token)", forHTTPHeaderField: "Authorization")
  }
  func updater(_ updater: SPUUpdater, didFinishUpdateCycleFor updateCheck: SPUUpdateCheck, error: Error?) {
    if let id = session?.id { finish(id) }
  }
}
