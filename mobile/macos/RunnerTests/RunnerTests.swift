import Cocoa
import FlutterMacOS
import XCTest
import WebKit
@testable import INNOGRID

class RunnerTests: XCTestCase {

  func testMacOSUsesSkiaUntilImpellerBackingStoreFixShips() {
    XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "FLTEnableImpeller") as? Bool, false)
  }

  func testPasteOnlyTargetsFocusedWebView() {
    let window = MainFlutterWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
                                   styleMask: [.titled], backing: .buffered, defer: false)
    let webView = WKWebView(frame: window.contentView!.bounds)
    let input = PasteTarget(frame: webView.bounds)
    window.contentView!.addSubview(webView)
    webView.addSubview(input)
    XCTAssertTrue(window.makeFirstResponder(input))
    func event(_ flags: NSEvent.ModifierFlags) -> NSEvent {
      NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: flags,
                      timestamp: 0, windowNumber: window.windowNumber, context: nil,
                      characters: "v", charactersIgnoringModifiers: "v", isARepeat: false, keyCode: 9)!
    }
    XCTAssertTrue(window.pasteIntoFocusedWebView(event(.command)))
    XCTAssertEqual(input.pastes, 1)
    XCTAssertFalse(window.pasteIntoFocusedWebView(event([.command, .option])))
    XCTAssertFalse(window.pasteIntoFocusedWebView(event([])))
    input.removeFromSuperview()
    window.contentView!.addSubview(input)
    XCTAssertTrue(window.makeFirstResponder(input))
    XCTAssertFalse(window.pasteIntoFocusedWebView(event(.command)))
    XCTAssertEqual(input.pastes, 1)
  }

}

private class PasteTarget: NSView {
  var pastes = 0
  override var acceptsFirstResponder: Bool { true }
  @objc func paste(_ sender: Any?) { pastes += 1 }
}
