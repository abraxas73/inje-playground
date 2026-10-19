#ifndef INNOCREW_LOCAL_UPDATE_FEED_H_
#define INNOCREW_LOCAL_UPDATE_FEED_H_
#include <memory>
#include <string>

namespace innocrew {
// WinSparkle has no pre-download enclosure veto. Never let it parse a remote
// appcast: construct the sole enclosure locally from authenticated discovery.
// The listening socket remains exclusively owned until SDK cleanup completes.
class LocalUpdateFeed {
 public:
  LocalUpdateFeed();
  ~LocalUpdateFeed();
  bool Start(const std::string& version, const std::string& signature);
  void Stop();
  std::string URL() const;
#ifdef INNOCREW_UPDATE_TEST_HARNESS
  bool StartForTesting(const std::string& version, const std::string& signature,
                       const std::string& artifact);
#endif
 private:
  bool StartDocument(const std::string& document);
  struct Impl;
  std::unique_ptr<Impl> impl_;
};
}
#endif
