import Cocoa
import Sparkle

/// Flutter's persistent strip is the visible UI. Only the original explicit
/// click authorizes download AND installation; no second application prompt.
@MainActor
final class UpdaterUserDriver: NSObject, SPUUserDriver {
  private let session: DesktopUpdateSession
  private let status: (String, Double?) -> Void
  private let finished: () -> Void
  private var cancellation: (() -> Void)?
  private var expected: UInt64 = 0
  private var received: UInt64 = 0
  private var dismissed = false

  init(session: DesktopUpdateSession, status: @escaping (String, Double?) -> Void, finished: @escaping () -> Void) {
    self.session = session; self.status = status; self.finished = finished
  }
  func cancel() {
    session.cancel()
    let callback = cancellation; cancellation = nil; callback?()
  }
  func show(_ request: SPUUpdatePermissionRequest, reply: @escaping (SUUpdatePermissionResponse) -> Void) {
    // Flutter owns discovery. Do not enable an independent background scheduler.
    reply(SUUpdatePermissionResponse(automaticUpdateChecks: false, sendSystemProfile: false))
  }
  func showUserInitiatedUpdateCheck(cancellation: @escaping () -> Void) {
    if session.authorized { self.cancellation = cancellation } else { cancellation() }
  }
  func showUpdateFound(with appcastItem: SUAppcastItem, state: SPUUserUpdateState, reply: @escaping (SPUUserUpdateChoice) -> Void) {
    cancellation = nil
    guard session.accepts(appcastItem) else { status("error", nil); session.cancel(); reply(.skip); return }
    reply(.install)
  }
  func showUpdateReleaseNotes(with downloadData: SPUDownloadData) {}
  func showUpdateReleaseNotesFailedToDownloadWithError(_ error: Error) {}
  func showUpdateNotFoundWithError(_ error: Error, acknowledgement: @escaping () -> Void) {
    cancellation = nil; session.cancel(); status("error", nil); acknowledgement()
  }
  func showUpdaterError(_ error: Error, acknowledgement: @escaping () -> Void) {
    cancellation = nil; session.cancel(); status("error", nil); acknowledgement()
  }
  func showDownloadInitiated(cancellation: @escaping () -> Void) {
    if session.authorized { self.cancellation = cancellation; status("downloading", nil) } else { cancellation() }
  }
  func showDownloadDidReceiveExpectedContentLength(_ expectedContentLength: UInt64) { expected = expectedContentLength }
  func showDownloadDidReceiveData(ofLength length: UInt64) {
    received = received.addingReportingOverflow(length).partialValue
    if session.authorized { status("downloading", expected > 0 ? min(1, Double(received) / Double(expected)) : nil) }
  }
  func showDownloadDidStartExtractingUpdate() { cancellation = nil; if session.authorized { status("verifying", nil) } }
  func showExtractionReceivedProgress(_ progress: Double) { if session.authorized { status("verifying", progress) } }
  func showReady(toInstallAndRelaunch reply: @escaping (SPUUserUpdateChoice) -> Void) {
    cancellation = nil
    if session.authorized { status("installing", nil); reply(.install) } else { reply(.skip) }
  }
  func showInstallingUpdate(withApplicationTerminated applicationTerminated: Bool, retryTerminatingApplication: @escaping () -> Void) {
    if session.authorized { status("installing", nil) }
    // Sparkle sends graceful termination itself. Never force-kill unrelated PIDs.
  }
  func showUpdateInstalledAndRelaunched(_ relaunched: Bool, acknowledgement: @escaping () -> Void) { acknowledgement() }
  func dismissUpdateInstallation() {
    if dismissed { return }; dismissed = true; cancellation = nil; session.cancel(); finished()
  }
  func showUpdateInFocus() { NSApp.activate(ignoringOtherApps: true) }
}
