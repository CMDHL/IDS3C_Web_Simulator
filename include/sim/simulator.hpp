#ifndef SIM_SIMULATOR_HPP
#define SIM_SIMULATOR_HPP

#include "sim/map.hpp"
#include "sim/scenario.hpp"
#include "sim/snapshot.hpp"

#include <vector>

namespace sim {

struct VehicleState {
  int id = 0;
  double speed = 0.0;
  std::vector<std::string> route;
  std::size_t segmentIndex = 0;
  double distanceOnSegment = 0.0;
};

class Simulator {
 public:
  Simulator(const RoadMap& roadMap, const Scenario& scenario);

  FrameSnapshot snapshot() const;
  void step(double dtSeconds);
  double time() const { return timeSeconds_; }
  bool collided() const { return collided_; }

 private:
  const RoadMap& roadMap_;
  double timeSeconds_ = 0.0;
  std::vector<VehicleState> vehicles_;
  std::vector<int> collisionVehicleIds_;
  bool collided_ = false;
};

}  // namespace sim

#endif
