#include "sim/map.hpp"

#include "sim/csv.hpp"

#include <algorithm>
#include <cmath>
#include <fstream>
#include <stdexcept>

namespace sim {
namespace {

constexpr double kDefaultSpeed = 0.5;
constexpr double kDefaultTurnSpeed = 0.25;

double clampDistance(double distance, double length) {
  return std::max(0.0, std::min(distance, length));
}

}  // namespace

Point Segment::sample(double distance) const {
  const double r = clampDistance(distance, length);

  if (kind == SegmentKind::Line) {
    if (direction == "+Y") {
      return {origin.x, -r + origin.y};
    }
    if (direction == "-Y") {
      return {origin.x, r + origin.y};
    }
    if (direction == "+X") {
      return {-r + origin.x, origin.y};
    }
    if (direction == "-X") {
      return {r + origin.x, origin.y};
    }
    throw std::runtime_error("Unknown line direction for segment " + id + ": " + direction);
  }

  const double theta = ccw ? (r / radius) + angleStart : -(r / radius) + angleEnd;
  return {radius * std::cos(theta) + origin.x, radius * std::sin(theta) + origin.y};
}

void RoadMap::loadFromDirectory(const std::string& mapDirectory) {
  segments_.clear();
  loadLines(mapDirectory + "/NewLines.csv");
  loadArcs(mapDirectory + "/NewArcs.csv");
}

const Segment& RoadMap::segment(const std::string& id) const {
  const auto found = segments_.find(id);
  if (found == segments_.end()) {
    throw std::runtime_error("Map segment not found: " + id);
  }
  return found->second;
}

bool RoadMap::contains(const std::string& id) const {
  return segments_.find(id) != segments_.end();
}

std::vector<std::string> RoadMap::ids() const {
  std::vector<std::string> result;
  for (const auto& item : segments_) {
    result.push_back(item.first);
  }
  return result;
}

void RoadMap::loadLines(const std::string& path) {
  std::ifstream file(path);
  if (!file) {
    throw std::runtime_error("Could not open line map file: " + path);
  }

  std::string line;
  std::getline(file, line);
  while (std::getline(file, line)) {
    if (trim(line).empty()) {
      continue;
    }
    const auto row = splitCsvLine(line);
    if (row.size() < 5) {
      throw std::runtime_error("Malformed line segment row: " + line);
    }

    Segment segment;
    segment.id = row[0];
    segment.kind = SegmentKind::Line;
    segment.direction = row[1];
    segment.length = std::stod(row[2]);
    segment.origin = {std::stod(row[3]), std::stod(row[4])};
    segment.speedLimit = kDefaultSpeed;
    segments_[segment.id] = segment;
  }
}

void RoadMap::loadArcs(const std::string& path) {
  std::ifstream file(path);
  if (!file) {
    throw std::runtime_error("Could not open arc map file: " + path);
  }

  std::string line;
  std::getline(file, line);
  while (std::getline(file, line)) {
    if (trim(line).empty()) {
      continue;
    }
    const auto row = splitCsvLine(line);
    if (row.size() < 7) {
      throw std::runtime_error("Malformed arc segment row: " + line);
    }

    Segment segment;
    segment.id = row[0];
    segment.kind = SegmentKind::Arc;
    segment.origin = {std::stod(row[1]), std::stod(row[2])};
    segment.radius = std::stod(row[3]);
    segment.angleStart = std::stod(row[4]);
    segment.angleEnd = std::stod(row[5]);
    segment.ccw = trim(row[6]) == "CCW";
    segment.length = std::abs(segment.angleEnd - segment.angleStart) * segment.radius;
    segment.speedLimit = kDefaultTurnSpeed;
    segments_[segment.id] = segment;
  }
}

}  // namespace sim
