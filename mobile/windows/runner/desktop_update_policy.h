#ifndef INNOCREW_DESKTOP_UPDATE_POLICY_H_
#define INNOCREW_DESKTOP_UPDATE_POLICY_H_

#include <array>
#include <cstdint>
#include <mutex>
#include <string>
#include <utility>

namespace innocrew {
struct UpdateRequest {
  std::string feed_url, token, version, session_id, signature;
};

inline bool ValidUpdateSignature(const std::string& signature) {
  if (signature.size() != 88 || signature.substr(86) != "==") return false;
  for (size_t i = 0; i < 86; ++i) {
    const char c = signature[i];
    if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
          (c >= '0' && c <= '9') || c == '+' || c == '/')) return false;
  }
  return std::string("AQgw").find(signature[85]) != std::string::npos;
}

inline bool ParseUpdateVersion(const std::string& value, std::array<uint32_t, 3>& parts) {
  size_t start = 0;
  for (size_t i = 0; i < 3; ++i) {
    const size_t end = value.find('.', start);
    if ((i < 2 && end == std::string::npos) || (i == 2 && end != std::string::npos)) return false;
    const size_t stop = end == std::string::npos ? value.size() : end;
    if (stop <= start || stop - start > 9 || (stop - start > 1 && value[start] == '0')) return false;
    uint32_t component = 0;
    for (size_t j = start; j < stop; ++j) {
      if (value[j] < '0' || value[j] > '9') return false;
      component = component * 10 + static_cast<uint32_t>(value[j] - '0');
    }
    parts[i] = component; start = stop + 1;
  }
  return true;
}

inline bool ValidateUpdateRequest(const UpdateRequest& r, const std::string& current) {
  if (!ValidUpdateSignature(r.signature)) return false;
  std::array<uint32_t, 3> wanted{}, installed{};
  if (!ParseUpdateVersion(r.version, wanted) || !ParseUpdateVersion(current, installed) || wanted <= installed) return false;
  if (r.feed_url != "https://innocrew.innogrid.com/api/desktop/update/appcast?platform=windows&version=" + r.version) return false;
  if (r.token.empty() || r.token.size() >= 8192 || r.session_id.empty() || r.session_id.size() > 128) return false;
  for (unsigned char c : r.token) if (c <= 32 || c >= 127) return false;
  for (unsigned char c : r.session_id) {
    if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-')) return false;
  }
  return true;
}

/// Shared between Flutter's UI thread and WinSparkle worker callbacks. The
/// launching transition is the irreversible OS handoff boundary. No reset is
/// permitted until WinSparkle cleanup has joined its old callback threads.
class UpdateLifecycle {
 public:
  bool Begin(const std::string& id, const std::string& version) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (phase_ != Phase::idle) return false;
    id_ = id; version_ = version; phase_ = Phase::authorized; return true;
  }
  bool Cancel(const std::string& id) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (id != id_ || phase_ == Phase::launching || phase_ == Phase::launched || phase_ == Phase::closing) return false;
    phase_ = Phase::canceled; return true;
  }
  bool CanInstall() const { std::lock_guard<std::mutex> lock(mutex_); return phase_ == Phase::authorized; }
  bool BeginInstall() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (phase_ != Phase::authorized) return false;
    phase_ = Phase::launching; return true;
  }
  void InstallerResult(bool success) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (phase_ == Phase::launching) phase_ = success ? Phase::launched : Phase::failed;
  }
  bool ConsumeShutdown() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (phase_ != Phase::launched) return false;
    phase_ = Phase::closing; return true;
  }
  bool Committed() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return phase_ == Phase::launching || phase_ == Phase::launched || phase_ == Phase::closing;
  }
  std::pair<std::string, std::string> Identity() const {
    std::lock_guard<std::mutex> lock(mutex_); return {id_, version_};
  }
  void Reset() { std::lock_guard<std::mutex> lock(mutex_); phase_ = Phase::idle; id_.clear(); version_.clear(); }
 private:
  enum class Phase { idle, authorized, launching, launched, closing, canceled, failed };
  mutable std::mutex mutex_;
  Phase phase_ = Phase::idle;
  std::string id_, version_;
};

inline std::wstring InstallerArguments(const std::wstring& directory, uint32_t process_id) {
  if (!process_id || directory.empty() || directory.back() == L'\\' ||
      directory.find_first_of(L"\"\r\n") != std::wstring::npos || directory.find(L'\0') != std::wstring::npos) return {};
  return L"/SP- /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /NOCLOSEAPPLICATIONS /NORESTARTAPPLICATIONS /INNOCREWAUTOUPDATE=1 /INNOCREWPID=" +
    std::to_wstring(process_id) + L" /DIR=\"" + directory + L"\"";
}
}  // namespace innocrew
#endif
