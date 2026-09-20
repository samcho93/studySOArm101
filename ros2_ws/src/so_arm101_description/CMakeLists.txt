cmake_minimum_required(VERSION 3.8)
project(so_arm101_description)

find_package(ament_cmake REQUIRED)

install(
  DIRECTORY urdf config launch meshes rviz
  DESTINATION share/${PROJECT_NAME}
)

ament_package()
