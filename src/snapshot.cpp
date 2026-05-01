#include "sim/snapshot.hpp"

#include <iomanip>
#include <ostream>

namespace sim {

JsonLinesSnapshotSink::JsonLinesSnapshotSink(std::ostream& out) : out_(out) {}

void JsonLinesSnapshotSink::write(const FrameSnapshot& frame) {
  out_ << "{\"time\":" << std::fixed << std::setprecision(3) << frame.timeSeconds << ",\"vehicles\":[";
  for (std::size_t i = 0; i < frame.vehicles.size(); ++i) {
    const auto& vehicle = frame.vehicles[i];
    if (i > 0) {
      out_ << ",";
    }
    out_ << "{\"id\":" << vehicle.id
         << ",\"x\":" << std::setprecision(6) << vehicle.x
         << ",\"y\":" << vehicle.y
         << ",\"speed\":" << vehicle.speed
         << ",\"segment\":\"" << vehicle.segmentId << "\"}";
  }
  out_ << "]}\n";
}

}  // namespace sim
