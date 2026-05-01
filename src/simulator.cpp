#include "sim/simulator.hpp"

#include <stdexcept>

namespace sim {

Simulator::Simulator(const RoadMap& roadMap, const Scenario& scenario) : roadMap_(roadMap) {
  for (const auto& vehicle : scenario.vehicles) {
    if (vehicle.route.empty()) {
      throw std::runtime_error("Vehicle " + std::to_string(vehicle.id) + " has an empty route");
    }
    for (const auto& segmentId : vehicle.route) {
      if (!roadMap_.contains(segmentId)) {
        throw std::runtime_error("Vehicle " + std::to_string(vehicle.id) + " references missing segment " + segmentId);
      }
    }

    VehicleState state;
    state.id = vehicle.id;
    state.speed = vehicle.speed;
    state.route = vehicle.route;
    vehicles_.push_back(state);
  }
}

FrameSnapshot Simulator::snapshot() const {
  FrameSnapshot frame;
  frame.timeSeconds = timeSeconds_;

  for (const auto& vehicle : vehicles_) {
    const auto& segmentId = vehicle.route.at(vehicle.segmentIndex);
    const auto& segment = roadMap_.segment(segmentId);
    const Point point = segment.sample(vehicle.distanceOnSegment);

    frame.vehicles.push_back({
      vehicle.id,
      point.x,
      point.y,
      vehicle.speed,
      segmentId,
    });
  }

  return frame;
}

void Simulator::step(double dtSeconds) {
  if (dtSeconds <= 0.0) {
    throw std::runtime_error("Simulation dt must be positive");
  }

  for (auto& vehicle : vehicles_) {
    double remaining = vehicle.speed * dtSeconds;
    while (remaining > 0.0) {
      const auto& segment = roadMap_.segment(vehicle.route.at(vehicle.segmentIndex));
      const double room = segment.length - vehicle.distanceOnSegment;
      if (remaining < room) {
        vehicle.distanceOnSegment += remaining;
        remaining = 0.0;
      } else {
        remaining -= room;
        vehicle.segmentIndex = (vehicle.segmentIndex + 1) % vehicle.route.size();
        vehicle.distanceOnSegment = 0.0;
      }
    }
  }

  timeSeconds_ += dtSeconds;
}

}  // namespace sim
