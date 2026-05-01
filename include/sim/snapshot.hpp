#ifndef SIM_SNAPSHOT_HPP
#define SIM_SNAPSHOT_HPP

#include <iosfwd>
#include <string>
#include <vector>

namespace sim {

struct VehicleSnapshot {
  int id = 0;
  double x = 0.0;
  double y = 0.0;
  double speed = 0.0;
  std::string segmentId;
};

struct FrameSnapshot {
  double timeSeconds = 0.0;
  std::vector<VehicleSnapshot> vehicles;
};

class SnapshotSink {
 public:
  virtual ~SnapshotSink() = default;
  virtual void write(const FrameSnapshot& frame) = 0;
};

class JsonLinesSnapshotSink : public SnapshotSink {
 public:
  explicit JsonLinesSnapshotSink(std::ostream& out);
  void write(const FrameSnapshot& frame) override;

 private:
  std::ostream& out_;
};

}  // namespace sim

#endif
