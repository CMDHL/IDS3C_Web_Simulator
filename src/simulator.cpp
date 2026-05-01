#include "sim/simulator.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <map>
#include <set>
#include <stdexcept>
#include <utility>

namespace sim {
namespace {

constexpr double kCarLength = 0.2;
constexpr double kCarWidth = 0.1;
constexpr double kCarOriginRearwardOffset = 0.02;
constexpr double kCollisionCellSize = 0.35;

struct Vector2 {
  double x = 0.0;
  double y = 0.0;
};

struct VehicleRect {
  int id = 0;
  std::array<Point, 4> corners;
  std::array<Vector2, 2> axes;
  double minX = 0.0;
  double maxX = 0.0;
  double minY = 0.0;
  double maxY = 0.0;
};

Vector2 tangentFor(const Segment& segment, double distance) {
  if (segment.kind == SegmentKind::Line) {
    if (segment.direction == "+Y") return {0.0, -1.0};
    if (segment.direction == "-Y") return {0.0, 1.0};
    if (segment.direction == "+X") return {-1.0, 0.0};
    if (segment.direction == "-X") return {1.0, 0.0};
    throw std::runtime_error("Unknown line direction for segment " + segment.id + ": " + segment.direction);
  }

  const double r = std::max(0.0, std::min(distance, segment.length));
  const double theta = segment.ccw ? (r / segment.radius) + segment.angleStart : -(r / segment.radius) + segment.angleEnd;
  if (segment.ccw) {
    return {-std::sin(theta), std::cos(theta)};
  }
  return {std::sin(theta), -std::cos(theta)};
}

VehicleRect vehicleRect(const RoadMap& roadMap, const VehicleState& vehicle) {
  const auto& segment = roadMap.segment(vehicle.route.at(vehicle.segmentIndex));
  const Point origin = segment.sample(vehicle.distanceOnSegment);
  const Vector2 forward = tangentFor(segment, vehicle.distanceOnSegment);
  const Vector2 side{-forward.y, forward.x};
  const double front = std::min(kCarOriginRearwardOffset, kCarLength);
  const double rear = front - kCarLength;
  const double halfWidth = kCarWidth * 0.5;

  const auto makeCorner = [&](double longitudinal, double lateral) {
    return Point{
      origin.x + forward.x * longitudinal + side.x * lateral,
      origin.y + forward.y * longitudinal + side.y * lateral,
    };
  };

  VehicleRect rect;
  rect.id = vehicle.id;
  rect.corners = {
    makeCorner(front, -halfWidth),
    makeCorner(front, halfWidth),
    makeCorner(rear, halfWidth),
    makeCorner(rear, -halfWidth),
  };
  rect.axes = {forward, side};
  rect.minX = rect.maxX = rect.corners[0].x;
  rect.minY = rect.maxY = rect.corners[0].y;
  for (const auto& corner : rect.corners) {
    rect.minX = std::min(rect.minX, corner.x);
    rect.maxX = std::max(rect.maxX, corner.x);
    rect.minY = std::min(rect.minY, corner.y);
    rect.maxY = std::max(rect.maxY, corner.y);
  }
  return rect;
}

bool rectsOverlap(const VehicleRect& a, const VehicleRect& b) {
  std::array<Vector2, 4> axes = {a.axes[0], a.axes[1], b.axes[0], b.axes[1]};
  for (const auto& axis : axes) {
    double minA = std::numeric_limits<double>::infinity();
    double maxA = -std::numeric_limits<double>::infinity();
    double minB = std::numeric_limits<double>::infinity();
    double maxB = -std::numeric_limits<double>::infinity();
    for (const auto& corner : a.corners) {
      const double projection = corner.x * axis.x + corner.y * axis.y;
      minA = std::min(minA, projection);
      maxA = std::max(maxA, projection);
    }
    for (const auto& corner : b.corners) {
      const double projection = corner.x * axis.x + corner.y * axis.y;
      minB = std::min(minB, projection);
      maxB = std::max(maxB, projection);
    }
    if (maxA <= minB || maxB <= minA) {
      return false;
    }
  }
  return true;
}

std::vector<int> detectCollisionVehicleIds(const RoadMap& roadMap, const std::vector<VehicleState>& vehicles) {
  std::vector<VehicleRect> rects;
  rects.reserve(vehicles.size());
  for (const auto& vehicle : vehicles) {
    rects.push_back(vehicleRect(roadMap, vehicle));
  }

  std::map<std::pair<int, int>, std::vector<std::size_t>> grid;
  std::set<std::pair<int, int>> tested;
  std::vector<int> collidedIds;

  for (std::size_t i = 0; i < rects.size(); ++i) {
    const auto& rect = rects[i];
    const int minCellX = static_cast<int>(std::floor(rect.minX / kCollisionCellSize));
    const int maxCellX = static_cast<int>(std::floor(rect.maxX / kCollisionCellSize));
    const int minCellY = static_cast<int>(std::floor(rect.minY / kCollisionCellSize));
    const int maxCellY = static_cast<int>(std::floor(rect.maxY / kCollisionCellSize));

    for (int cellX = minCellX; cellX <= maxCellX; ++cellX) {
      for (int cellY = minCellY; cellY <= maxCellY; ++cellY) {
        auto& occupants = grid[{cellX, cellY}];
        for (const std::size_t otherIndex : occupants) {
          const int low = std::min(rect.id, rects[otherIndex].id);
          const int high = std::max(rect.id, rects[otherIndex].id);
          if (!tested.insert({low, high}).second) {
            continue;
          }
          if (rectsOverlap(rect, rects[otherIndex])) {
            if (std::find(collidedIds.begin(), collidedIds.end(), low) == collidedIds.end()) {
              collidedIds.push_back(low);
            }
            if (std::find(collidedIds.begin(), collidedIds.end(), high) == collidedIds.end()) {
              collidedIds.push_back(high);
            }
          }
        }
        occupants.push_back(i);
      }
    }
  }

  return collidedIds;
}

bool containsId(const std::vector<int>& ids, int id) {
  return std::find(ids.begin(), ids.end(), id) != ids.end();
}

}  // namespace

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

  collisionVehicleIds_ = detectCollisionVehicleIds(roadMap_, vehicles_);
  collided_ = !collisionVehicleIds_.empty();
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
      containsId(collisionVehicleIds_, vehicle.id),
    });
  }

  return frame;
}

void Simulator::step(double dtSeconds) {
  if (dtSeconds <= 0.0) {
    throw std::runtime_error("Simulation dt must be positive");
  }
  if (collided_) {
    return;
  }

  auto nextVehicles = vehicles_;
  for (auto& vehicle : nextVehicles) {
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

  vehicles_ = std::move(nextVehicles);
  timeSeconds_ += dtSeconds;
  collisionVehicleIds_ = detectCollisionVehicleIds(roadMap_, vehicles_);
  collided_ = !collisionVehicleIds_.empty();
}

}  // namespace sim
