#include <winsock2.h>
#include <ws2tcpip.h>
#include "local_update_feed.h"
#include "desktop_update_policy.h"
#include <atomic>
#include <thread>

namespace innocrew {
namespace {
std::string Document(const std::string& version, const std::string& signature,
                     const std::string& artifact) {
  std::array<uint32_t, 3> parts{};
  if (!ParseUpdateVersion(version, parts) || !ValidUpdateSignature(signature) ||
      artifact.find_first_of("\"<>&\r\n") != std::string::npos) return {};
  return "<?xml version=\"1.0\"?><rss version=\"2.0\" xmlns:sparkle=\"http://www.andymatuschak.org/xml-namespaces/sparkle\"><channel><title>InnoCrew</title><item><enclosure url=\"" +
    artifact + "\" sparkle:version=\"" + version + "\" sparkle:edSignature=\"" + signature +
    "\" type=\"application/octet-stream\" /></item></channel></rss>";
}
}
struct LocalUpdateFeed::Impl {
  SOCKET listener = INVALID_SOCKET;
  std::atomic<bool> stopping{false};
  std::thread worker;
  std::string url;
  bool winsock = false;
};
LocalUpdateFeed::LocalUpdateFeed() : impl_(std::make_unique<Impl>()) {}
LocalUpdateFeed::~LocalUpdateFeed() { Stop(); }
std::string LocalUpdateFeed::URL() const { return impl_->url; }
bool LocalUpdateFeed::Start(const std::string& version, const std::string& signature) {
  return StartDocument(Document(version, signature,
    "https://innocrew.innogrid.com/api/desktop/update/artifact/windows/" + version));
}
#ifdef INNOCREW_UPDATE_TEST_HARNESS
bool LocalUpdateFeed::StartForTesting(const std::string& version, const std::string& signature,
                                    const std::string& artifact) {
  if (artifact.rfind("http://127.0.0.1:", 0) != 0) return false;
  return StartDocument(Document(version, signature, artifact));
}
#endif
bool LocalUpdateFeed::StartDocument(const std::string& document) {
  if (document.empty() || impl_->listener != INVALID_SOCKET) return false;
  WSADATA data{};
  if (WSAStartup(MAKEWORD(2, 2), &data) != 0) return false;
  impl_->winsock = true;
  impl_->listener = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  BOOL exclusive = TRUE;
  sockaddr_in address{}; address.sin_family = AF_INET; address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  int length = sizeof(address);
  if (impl_->listener == INVALID_SOCKET ||
      setsockopt(impl_->listener, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, reinterpret_cast<const char*>(&exclusive), sizeof(exclusive)) != 0 ||
      bind(impl_->listener, reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0 ||
      getsockname(impl_->listener, reinterpret_cast<sockaddr*>(&address), &length) != 0 || listen(impl_->listener, 4) != 0) {
    Stop(); return false;
  }
  impl_->url = "http://127.0.0.1:" + std::to_string(ntohs(address.sin_port)) + "/appcast";
  impl_->stopping = false;
  impl_->worker = std::thread([this, document] {
    while (!impl_->stopping) {
      fd_set readable; FD_ZERO(&readable); FD_SET(impl_->listener, &readable);
      timeval timeout{0, 200000};
      if (select(0, &readable, nullptr, nullptr, &timeout) <= 0) continue;
      const SOCKET client = accept(impl_->listener, nullptr, nullptr);
      if (client == INVALID_SOCKET) continue;
      DWORD io_timeout = 1000;
      setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char*>(&io_timeout), sizeof(io_timeout));
      setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, reinterpret_cast<const char*>(&io_timeout), sizeof(io_timeout));
      std::string request; char buffer[2048];
      while (!impl_->stopping && request.size() < 16384 && request.find("\r\n\r\n") == std::string::npos) {
        const int count = recv(client, buffer, sizeof(buffer), 0);
        if (count <= 0) break;
        request.append(buffer, static_cast<size_t>(count));
      }
      const bool valid = request.rfind("GET /appcast HTTP/1.", 0) == 0 && request.find("\r\n\r\n") != std::string::npos;
      const std::string body = valid ? document : "";
      const std::string response = std::string(valid ? "HTTP/1.1 200 OK\r\n" : "HTTP/1.1 404 Not Found\r\n") +
        "Connection: close\r\nCache-Control: no-store\r\nContent-Type: application/rss+xml\r\nContent-Length: " + std::to_string(body.size()) + "\r\n\r\n" + body;
      size_t sent = 0;
      while (!impl_->stopping && sent < response.size()) {
        const int count = send(client, response.data() + sent, static_cast<int>(response.size() - sent), 0);
        if (count <= 0) break;
        sent += static_cast<size_t>(count);
      }
      shutdown(client, SD_BOTH); closesocket(client);
    }
  });
  return true;
}
void LocalUpdateFeed::Stop() {
  impl_->stopping = true;
  if (impl_->worker.joinable()) impl_->worker.join();
  if (impl_->listener != INVALID_SOCKET) { closesocket(impl_->listener); impl_->listener = INVALID_SOCKET; }
  if (impl_->winsock) { WSACleanup(); impl_->winsock = false; }
  impl_->url.clear();
}
}
