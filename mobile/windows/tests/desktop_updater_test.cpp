#include "../runner/desktop_update_policy.h"
#include <cassert>
#include <iostream>

using namespace innocrew;
int main() {
  const auto signature = std::string(86, 'A') + "==";
  assert(ValidUpdateSignature(signature));
  assert(!ValidUpdateSignature(std::string(85, 'A') + "B=="));
  assert(!ValidUpdateSignature("\" injected=\"value"));
  UpdateRequest request{"https://innocrew.innogrid.com/api/desktop/update/appcast?platform=windows&version=1.7.8", "fixture-token", "1.7.8", "job-1", signature};
  assert(ValidateUpdateRequest(request, "1.7.7"));
  // Real Windows builds pass FLUTTER_VERSION with the pubspec build number.
  assert(ValidateUpdateRequest(request, "1.7.7+58"));
  assert(!ValidateUpdateRequest(request, "1.7.8+59"));
  assert(!ValidateUpdateRequest(request, "1.7.8"));
  assert(!ValidateUpdateRequest(request, "2.0.0"));
  assert(!ValidateUpdateRequest(request, "dev"));
  auto invalid = request; invalid.feed_url = "https://attacker.test/feed";
  assert(!ValidateUpdateRequest(invalid, "1.7.7"));
  invalid = request; invalid.feed_url += "&token=secret";
  assert(!ValidateUpdateRequest(invalid, "1.7.7"));
  invalid = request; invalid.version = "1.7.9";
  assert(!ValidateUpdateRequest(invalid, "1.7.7"));
  invalid = request; invalid.token = "x\r\nInjected: yes";
  assert(!ValidateUpdateRequest(invalid, "1.7.7"));
  invalid = request; invalid.version = "1.7.999999999999999999999999999";
  assert(!ValidateUpdateRequest(invalid, "1.7.7"));

  // Installer launch retries: only "briefly held" errors, never more than kLaunchAttempts tries.
  assert(TransientLaunchError(5) && TransientLaunchError(32) && TransientLaunchError(33));
  assert(!TransientLaunchError(0) && !TransientLaunchError(2) && !TransientLaunchError(225) && !TransientLaunchError(1223));
  assert(ShouldRetryLaunch(1, 32) && ShouldRetryLaunch(2, 32));
  assert(!ShouldRetryLaunch(kLaunchAttempts, 32));
  assert(!ShouldRetryLaunch(1, 0)); // readable file, wrong version: fail at once
  int tries = 1; while (ShouldRetryLaunch(tries, 5)) ++tries;
  assert(tries == kLaunchAttempts);
  assert(LaunchRetryDelayMs(1) == 2000 && LaunchRetryDelayMs(2) == 4000);

  UpdateLifecycle lifecycle;
  assert(lifecycle.Begin("job-1", "1.7.8"));
  assert(!lifecycle.Begin("job-2", "1.7.9"));
  assert(!lifecycle.ConsumeShutdown()); // never close the app before installer launch succeeds
  assert(lifecycle.CanInstall());
  assert(lifecycle.Cancel("job-1"));
  assert(!lifecycle.BeginInstall());
  assert(!lifecycle.ConsumeShutdown());
  lifecycle.Reset();
  assert(lifecycle.Begin("job-2", "1.7.8"));
  assert(!lifecycle.Cancel("job-1")); // stale cancellation
  assert(lifecycle.BeginInstall());
  assert(!lifecycle.BeginInstall()); // one installer only
  assert(!lifecycle.Cancel("job-2")); // commit boundary; cannot undo a launched OS operation
  lifecycle.InstallerResult(false);
  assert(!lifecycle.ConsumeShutdown()); // launch failure keeps existing process alive
  lifecycle.Reset();
  assert(lifecycle.Begin("job-3", "1.7.8"));
  assert(lifecycle.BeginInstall()); lifecycle.InstallerResult(true);
  assert(lifecycle.ConsumeShutdown());
  assert(!lifecycle.ConsumeShutdown()); // exactly one targeted graceful close

  const auto args = InstallerArguments(L"C:\\Users\\홍길동\\My Apps\\INNOGRID", 1234);
  assert(args.find(L"/INNOCREWAUTOUPDATE=1") != std::wstring::npos);
  assert(args.find(L"/INNOCREWPID=1234") != std::wstring::npos);
  assert(args.find(L"/DIR=\"C:\\Users\\홍길동\\My Apps\\INNOGRID\"") != std::wstring::npos);
  assert(args.find(L"/NORESTART ") != std::wstring::npos);
  assert(args.find(L"/SP- ") != std::wstring::npos);
  assert(args.find(L"/NOCLOSEAPPLICATIONS") != std::wstring::npos);
  assert(InstallerArguments(L"C:\\bad\" /taskkill", 1234).empty());
  assert(InstallerArguments(L"C:\\INNOGRID", 0).empty());
  std::cout << "PASS: update authorization, duplicate/cancel/launch ordering and Unicode installer arguments\n";
}
