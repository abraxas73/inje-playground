import Cocoa
import FlutterMacOS
import WebKit
import ObjectiveC
import UserNotifications
import webview_flutter_wkwebview

class MainFlutterWindow: NSWindow {
  private(set) var desktopUpdater: DesktopUpdater?
  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    // Flutter can consume Cmd+V before the Edit menu reaches a platform WebView.
    if pasteIntoFocusedWebView(event) { return true }
    return super.performKeyEquivalent(with: event)
  }

  func pasteIntoFocusedWebView(_ event: NSEvent) -> Bool {
    let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
    guard event.type == .keyDown, modifiers == .command,
          event.charactersIgnoringModifiers?.lowercased() == "v",
          let responder = firstResponder as? NSView else { return false }
    var ancestor: NSView? = responder
    while let view = ancestor {
      if view is WKWebView {
        return NSApp.sendAction(#selector(NSText.paste(_:)), to: responder, from: self)
      }
      ancestor = view.superview
    }
    return false
  }

  override func awakeFromNib() {
    let flutterViewController = FlutterViewController()
    let windowFrame = NSRect(x: self.frame.origin.x, y: self.frame.origin.y, width: 1100, height: 800)
    self.contentViewController = flutterViewController
    self.setFrame(windowFrame, display: true)
    self.minSize = NSSize(width: 420, height: 600)
    self.center()
    self.setFrameAutosaveName("INNOGRIDMainWindow")

    RegisterGeneratedPlugins(registry: flutterViewController)
    desktopUpdater = DesktopUpdater(messenger: flutterViewController.engine.binaryMessenger)
    let channel = FlutterMethodChannel(name: "com.innogrid.playground/webview",
                                       binaryMessenger: flutterViewController.engine.binaryMessenger)
    channel.setMethodCallHandler { [weak flutterViewController] call, result in
      guard call.method == "enableFilePicker" else {
        result(FlutterMethodNotImplemented)
        return
      }
      guard let controller = flutterViewController,
            let identifier = call.arguments as? NSNumber,
            let webView = FWFWebViewFlutterWKWebViewExternalAPI.webView(
              forIdentifier: identifier.int64Value, withPluginRegistry: controller) else {
        result(FlutterError(code: "webview_unavailable", message: "WebView unavailable", details: nil))
        return
      }
      if !(webView.uiDelegate is FilePickerUIDelegate) {
        let delegate = FilePickerUIDelegate(original: webView.uiDelegate)
        objc_setAssociatedObject(webView, &filePickerDelegateKey, delegate, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        webView.uiDelegate = delegate
      }
      result(nil)
    }

    // 앱 아이콘 배지(lib/notifications/app_badge.dart) — 알림 센터 안 읽은 수를 Dock 아이콘에
    let badge = FlutterMethodChannel(name: "com.innogrid.playground/badge",
                                     binaryMessenger: flutterViewController.engine.binaryMessenger)
    badge.setMethodCallHandler { call, result in
      guard call.method == "set" else {
        result(FlutterMethodNotImplemented)
        return
      }
      let n = (call.arguments as? NSNumber)?.intValue ?? 0
      let label = n > 0 ? (n > 99 ? "99+" : String(n)) : nil
      let apply = { DispatchQueue.main.async { NSApp.dockTile.badgeLabel = label } }
      if n > 0 {
        // Dock 배지는 알림 권한(배지)이 있어야 보인다 — 처음 숫자가 생길 때 한 번 묻는다(이미 정했으면 묻지 않음)
        UNUserNotificationCenter.current().requestAuthorization(options: [.badge]) { _, _ in apply() }
      } else {
        apply()
      }
      result(nil)
    }

    super.awakeFromNib()
  }
}

// Retain the proxy with its WebView; preserve all existing plugin UI callbacks.
private var filePickerDelegateKey: UInt8 = 0

private class FilePickerUIDelegate: NSObject, WKUIDelegate {
  private let original: WKUIDelegate?

  init(original: WKUIDelegate?) {
    self.original = original
    super.init()
  }

  override func responds(to selector: Selector!) -> Bool {
    return super.responds(to: selector) || (original?.responds(to: selector) ?? false)
  }

  override func forwardingTarget(for selector: Selector!) -> Any? {
    return original
  }

  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
               initiatedByFrame frame: WKFrameInfo,
               completionHandler: @escaping ([URL]?) -> Void) {
    guard let window = webView.window else {
      completionHandler(nil)
      return
    }
    let panel = NSOpenPanel()
    panel.canChooseFiles = true
    panel.canChooseDirectories = parameters.allowsDirectories
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.beginSheetModal(for: window) { response in
      completionHandler(response == .OK ? panel.urls : nil)
    }
  }
}
