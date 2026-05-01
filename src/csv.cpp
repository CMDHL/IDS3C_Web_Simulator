#include "sim/csv.hpp"

#include <cctype>

namespace sim {

std::string trim(std::string value) {
  while (!value.empty() && std::isspace(static_cast<unsigned char>(value.front()))) {
    value.erase(value.begin());
  }
  while (!value.empty() && std::isspace(static_cast<unsigned char>(value.back()))) {
    value.pop_back();
  }
  return value;
}

std::vector<std::string> splitCsvLine(const std::string& line) {
  std::vector<std::string> values;
  std::string current;
  bool inQuotes = false;

  for (char ch : line) {
    if (ch == '"') {
      inQuotes = !inQuotes;
    } else if (ch == ',' && !inQuotes) {
      values.push_back(trim(current));
      current.clear();
    } else {
      current.push_back(ch);
    }
  }

  values.push_back(trim(current));
  return values;
}

}  // namespace sim
