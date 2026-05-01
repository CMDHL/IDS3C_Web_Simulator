#ifndef SIM_MAP_HPP
#define SIM_MAP_HPP

#include <map>
#include <string>
#include <vector>

namespace sim {

struct Point {
  double x = 0.0;
  double y = 0.0;
};

enum class SegmentKind {
  Line,
  Arc,
};

struct Segment {
  std::string id;
  SegmentKind kind = SegmentKind::Line;
  double length = 0.0;
  double speedLimit = 0.5;

  std::string direction;
  Point origin;

  double radius = 0.0;
  double angleStart = 0.0;
  double angleEnd = 0.0;
  bool ccw = false;

  Point sample(double distance) const;
};

class RoadMap {
 public:
  void loadFromDirectory(const std::string& mapDirectory);
  const Segment& segment(const std::string& id) const;
  bool contains(const std::string& id) const;
  std::vector<std::string> ids() const;

 private:
  void loadLines(const std::string& path);
  void loadArcs(const std::string& path);

  std::map<std::string, Segment> segments_;
};

}  // namespace sim

#endif
