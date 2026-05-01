#ifndef SIM_CSV_HPP
#define SIM_CSV_HPP

#include <string>
#include <vector>

namespace sim {

std::vector<std::string> splitCsvLine(const std::string& line);
std::string trim(std::string value);

}  // namespace sim

#endif
