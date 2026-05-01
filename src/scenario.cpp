#include "sim/scenario.hpp"

#include "sim/csv.hpp"

#include <fstream>
#include <map>
#include <regex>
#include <sstream>
#include <stdexcept>

namespace sim {
namespace {

std::vector<std::string> splitSegments(const std::string& value) {
  std::vector<std::string> result;
  std::stringstream stream(value);
  std::string segment;
  while (std::getline(stream, segment, ',')) {
    segment = trim(segment);
    if (!segment.empty()) {
      result.push_back(segment);
    }
  }
  return result;
}

std::string stripComment(const std::string& line) {
  const auto pos = line.find('#');
  return pos == std::string::npos ? line : line.substr(0, pos);
}

std::string afterColon(const std::string& line) {
  const auto pos = line.find(':');
  if (pos == std::string::npos) {
    return "";
  }
  return trim(line.substr(pos + 1));
}

}  // namespace

Scenario loadScenarioFromCarsYaml(const std::string& carsYamlPath) {
  std::ifstream file(carsYamlPath);
  if (!file) {
    throw std::runtime_error("Could not open cars YAML file: " + carsYamlPath);
  }

  std::map<std::string, std::vector<std::string>> anchorRoutes;
  Scenario scenario;

  std::string currentAnchor;
  VehicleConfig currentVehicle;
  bool inVehicle = false;

  auto finishVehicle = [&]() {
    if (inVehicle) {
      if (currentVehicle.route.empty()) {
        throw std::runtime_error("Vehicle " + std::to_string(currentVehicle.id) + " has no parsed route");
      }
      scenario.vehicles.push_back(currentVehicle);
      currentVehicle = VehicleConfig{};
      inVehicle = false;
    }
  };

  std::string rawLine;
  while (std::getline(file, rawLine)) {
    const std::string line = stripComment(rawLine);
    const std::string trimmed = trim(line);
    if (trimmed.empty()) {
      continue;
    }

    std::smatch match;
    if (std::regex_search(trimmed, match, std::regex(R"(^[^:]+:\s*&([A-Za-z0-9_]+))"))) {
      finishVehicle();
      currentAnchor = match[1];
      continue;
    }

    if (std::regex_search(trimmed, match, std::regex(R"(^Vehicle[^\s:]*\s*:\s*([0-9]+))"))) {
      finishVehicle();
      inVehicle = true;
      currentVehicle = VehicleConfig{};
      currentVehicle.id = std::stoi(match[1]);
      currentAnchor.clear();
      continue;
    }

    if (trimmed.rfind("Segments", 0) == 0) {
      const auto route = splitSegments(afterColon(trimmed));
      if (!currentAnchor.empty()) {
        anchorRoutes[currentAnchor] = route;
      } else if (inVehicle) {
        currentVehicle.route = route;
      }
      continue;
    }

    if (inVehicle && trimmed.rfind("Path", 0) == 0) {
      const auto value = afterColon(trimmed);
      if (!value.empty() && value.front() == '*') {
        const auto anchorName = value.substr(1);
        const auto found = anchorRoutes.find(anchorName);
        if (found == anchorRoutes.end()) {
          throw std::runtime_error("Unknown YAML path anchor: " + anchorName);
        }
        currentVehicle.route = found->second;
      }
      continue;
    }

    if (inVehicle && trimmed.rfind("speed", 0) == 0) {
      currentVehicle.speed = std::stod(afterColon(trimmed));
      continue;
    }
  }

  finishVehicle();
  return scenario;
}

}  // namespace sim
