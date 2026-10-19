// Standalone transport regression probe. Sparkle 2.10.0's SPUDownloader uses
// defaultSessionConfiguration without a redirection delegate. Test that exact
// Foundation transport configuration; the local harness records header presence.
import Foundation

@main
struct RedirectCredentialProbe {
  static func main() async throws {
    guard CommandLine.arguments.count == 2, let url = URL(string: CommandLine.arguments[1]),
          url.host == "127.0.0.1", url.scheme == "http" else { exit(2) }
    var request = URLRequest(url: url)
    request.setValue("Bearer updater-test-fixture", forHTTPHeaderField: "Authorization")
    let session = URLSession(configuration: .default)
    defer { session.invalidateAndCancel() }
    let (_, response) = try await session.data(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 200 else { exit(3) }
  }
}
