#include "sim/map.hpp"
#include "sim/scenario.hpp"
#include "sim/simulator.hpp"
#include "sim/snapshot.hpp"

#include <fstream>
#include <iostream>
#include <cmath>
#include <stdexcept>
#include <string>

namespace {

struct Options {
  std::string mapDirectory;
  std::string carsYaml;
  std::string outputPath;
  double durationSeconds = 20.0;
  double dtSeconds = 0.05;
};

std::string requireValue(int& index, int argc, char* argv[], const std::string& flag) {
  if (index + 1 >= argc) {
    throw std::runtime_error("Missing value for " + flag);
  }
  ++index;
  return argv[index];
}

Options parseOptions(int argc, char* argv[]) {
  Options options;
  for (int i = 1; i < argc; ++i) {
    const std::string arg = argv[i];
    if (arg == "--map") {
      options.mapDirectory = requireValue(i, argc, argv, arg);
    } else if (arg == "--cars") {
      options.carsYaml = requireValue(i, argc, argv, arg);
    } else if (arg == "--out") {
      options.outputPath = requireValue(i, argc, argv, arg);
    } else if (arg == "--duration") {
      options.durationSeconds = std::stod(requireValue(i, argc, argv, arg));
    } else if (arg == "--dt") {
      options.dtSeconds = std::stod(requireValue(i, argc, argv, arg));
    } else if (arg == "--help" || arg == "-h") {
      throw std::runtime_error(
        "Usage: scaledcity_sim --map MAP_DIR --cars Cars.yaml [--duration 20] [--dt 0.05] [--out frames.jsonl]");
    } else {
      throw std::runtime_error("Unknown argument: " + arg);
    }
  }

  if (options.mapDirectory.empty()) {
    throw std::runtime_error("--map is required");
  }
  if (options.carsYaml.empty()) {
    throw std::runtime_error("--cars is required");
  }

  return options;
}

}  // namespace

int main(int argc, char* argv[]) {
  try {
    const Options options = parseOptions(argc, argv);

    sim::RoadMap roadMap;
    roadMap.loadFromDirectory(options.mapDirectory);
    const sim::Scenario scenario = sim::loadScenarioFromCarsYaml(options.carsYaml);
    sim::Simulator simulator(roadMap, scenario);

    std::ofstream outputFile;
    std::ostream* output = &std::cout;
    if (!options.outputPath.empty()) {
      outputFile.open(options.outputPath);
      if (!outputFile) {
        throw std::runtime_error("Could not open output file: " + options.outputPath);
      }
      output = &outputFile;
    }

    sim::JsonLinesSnapshotSink sink(*output);
    const int steps = static_cast<int>(std::floor(options.durationSeconds / options.dtSeconds + 1e-9));
    sink.write(simulator.snapshot());
    for (int step = 0; step < steps; ++step) {
      simulator.step(options.dtSeconds);
      sink.write(simulator.snapshot());
    }

    return 0;
  } catch (const std::exception& error) {
    std::cerr << "scaledcity_sim: " << error.what() << "\n";
    return 1;
  }
}
