#ifndef SIM_SCENARIO_HPP
#define SIM_SCENARIO_HPP

#include <string>
#include <vector>

namespace sim {

struct VehicleConfig {
  int id = 0;
  double speed = 0.4;
  std::vector<std::string> route;
};

struct Scenario {
  std::vector<VehicleConfig> vehicles;
};

Scenario loadScenarioFromCarsYaml(const std::string& carsYamlPath);

}  // namespace sim

#endif
