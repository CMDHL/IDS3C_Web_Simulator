cmake_minimum_required(VERSION 3.16)
project(scaledcity_simulator LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(sim_core
  src/csv.cpp
  src/map.cpp
  src/scenario.cpp
  src/simulator.cpp
  src/snapshot.cpp
)

target_include_directories(sim_core PUBLIC include)

add_executable(scaledcity_sim src/main.cpp)
target_link_libraries(scaledcity_sim PRIVATE sim_core)
