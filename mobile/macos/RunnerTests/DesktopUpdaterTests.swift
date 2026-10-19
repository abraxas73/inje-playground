import Cocoa
import XCTest
import Sparkle
@testable import INNOGRID

@MainActor
final class DesktopUpdaterTests: XCTestCase {
  func testApplicationMenuOffersCheckImmediatelyAfterAbout() throws {
    let menu = try XCTUnwrap(NSApp.mainMenu?.items.first?.submenu)
    let about = try XCTUnwrap(menu.items.firstIndex(where: { $0.title == "About 이노크루" }))
    XCTAssertGreaterThan(menu.items.count, about + 1)
    XCTAssertEqual(menu.items[about + 1].title, "업데이트 확인…")
    XCTAssertEqual(menu.items[about + 1].action, #selector(AppDelegate.checkForUpdates(_:)))
    XCTAssertTrue(menu.items[about + 1].target is AppDelegate)
    XCTAssertNotNil(NSApp.target(forAction: #selector(AppDelegate.checkForUpdates(_:))))
  }

  private func args(_ url: String = "https://innocrew.innogrid.com/api/desktop/update/appcast?platform=macos&version=1.7.8") -> [String: Any] {
    ["feedUrl": url, "expectedVersion": "1.7.8", "sessionId": "test-1", "accessToken": "private-token"]
  }

  func testOnlyExactOfficialVersionPinnedFeedIsAccepted() throws {
    let job = try DesktopUpdateSession(arguments: args())
    XCTAssertTrue(job.authorized)
    XCTAssertEqual(job.artifactURL.absoluteString, "https://innocrew.innogrid.com/api/desktop/update/artifact/macos/1.7.8")
    for url in [
      "https://attacker.test/api/desktop/update/appcast?platform=macos&version=1.7.8",
      "http://innocrew.innogrid.com/api/desktop/update/appcast?platform=macos&version=1.7.8",
      "https://innocrew.innogrid.com/api/desktop/update/appcast?platform=windows&version=1.7.8",
      "https://innocrew.innogrid.com/api/desktop/update/appcast?platform=macos&version=1.7.9",
      "https://innocrew.innogrid.com/api/desktop/update/appcast?platform=macos&version=1.7.8&token=secret",
      "https://user@innocrew.innogrid.com/api/desktop/update/appcast?platform=macos&version=1.7.8",
    ] { XCTAssertThrowsError(try DesktopUpdateSession(arguments: args(url)), url) }
  }

  func testReadyStageAutomaticallyInstallsWithoutAnotherConfirmation() throws {
    let job = try DesktopUpdateSession(arguments: args())
    let driver = UpdaterUserDriver(session: job, status: { _, _ in }, finished: {})
    var choice: SPUUserUpdateChoice?
    driver.showReady { choice = $0 }
    XCTAssertEqual(choice, .install)
  }

  func testAppcastEnclosureCannotChangeOriginOrVersion() throws {
    let job = try DesktopUpdateSession(arguments: args())
    func item(_ url: String, version: String = "1.7.8") throws -> SUAppcastItem {
      // This public fixture initializer does not evaluate OS requirements; this
      // test only checks exact enclosure binding, not Sparkle's OS filtering.
      try XCTUnwrap(SUAppcastItem(dictionary: ["enclosure": ["url": url, "sparkle:version": "59", "sparkle:shortVersionString": version]]))
    }
    XCTAssertTrue(job.accepts(try item(job.artifactURL.absoluteString)))
    XCTAssertFalse(job.accepts(try item("https://attacker.test/update.dmg")))
    XCTAssertFalse(job.accepts(try item(job.artifactURL.absoluteString, version: "1.7.9")))
    job.cancel()
    XCTAssertFalse(job.accepts(try item(job.artifactURL.absoluteString)))
  }

  func testCanceledAuthorizationSkipsInsteadOfDeferringInstallUntilQuit() throws {
    let job = try DesktopUpdateSession(arguments: args())
    let driver = UpdaterUserDriver(session: job, status: { _, _ in }, finished: {})
    var cancellations = 0
    driver.showDownloadInitiated { cancellations += 1 }
    driver.cancel()
    driver.cancel()
    XCTAssertEqual(cancellations, 1)
    XCTAssertFalse(job.authorized)
    var choice: SPUUserUpdateChoice?
    driver.showReady { choice = $0 }
    XCTAssertEqual(choice, .skip) // .dismiss would still install on termination
  }

  func testErrorRevokesAuthorizationAndEmitsOnlySanitizedStatus() throws {
    let job = try DesktopUpdateSession(arguments: args())
    var statuses: [String] = []
    let driver = UpdaterUserDriver(session: job, status: { phase, _ in statuses.append(phase) }, finished: {})
    var acknowledged = false
    driver.showUpdaterError(NSError(domain: "Bearer secret", code: 1)) { acknowledged = true }
    XCTAssertTrue(acknowledged)
    XCTAssertFalse(job.authorized)
    XCTAssertEqual(statuses, ["error"])
    var choice: SPUUserUpdateChoice?
    driver.showReady { choice = $0 }
    XCTAssertEqual(choice, .skip)
  }
}
