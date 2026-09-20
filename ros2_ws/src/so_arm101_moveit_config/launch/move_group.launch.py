"""
move_group 노드 단독 실행.

    ros2 launch so_arm101_moveit_config move_group.launch.py
    ros2 launch so_arm101_moveit_config move_group.launch.py use_sim_time:=True   # Gazebo
"""
import os

import yaml
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import Command, LaunchConfiguration, PathJoinSubstitution
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue
from launch_ros.substitutions import FindPackageShare


def load_yaml(package: str, relative: str):
    path = os.path.join(get_package_share_directory(package), relative)
    with open(path, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def load_file(package: str, relative: str) -> str:
    path = os.path.join(get_package_share_directory(package), relative)
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


def generate_launch_description() -> LaunchDescription:
    desc_pkg = FindPackageShare("so_arm101_description")

    args = [
        DeclareLaunchArgument("use_sim_time", default_value="false"),
        DeclareLaunchArgument("hardware_type", default_value="mock",
                              choices=["mock", "gazebo", "real"]),
    ]

    robot_description = ParameterValue(
        Command([
            "xacro ",
            PathJoinSubstitution([desc_pkg, "urdf", "so_arm101.urdf.xacro"]),
            " hardware_type:=", LaunchConfiguration("hardware_type"),
        ]),
        value_type=str,
    )

    params = [
        {"robot_description": robot_description},
        {"robot_description_semantic":
            load_file("so_arm101_moveit_config", "config/so_arm101.srdf")},
        {"robot_description_kinematics":
            load_yaml("so_arm101_moveit_config", "config/kinematics.yaml")},
        {"robot_description_planning":
            load_yaml("so_arm101_description", "config/joint_limits.yaml")},
        load_yaml("so_arm101_moveit_config", "config/ompl_planning.yaml"),
        load_yaml("so_arm101_moveit_config", "config/moveit_controllers.yaml"),
        {"use_sim_time": LaunchConfiguration("use_sim_time")},
        {"publish_robot_description_semantic": True},
    ]

    move_group_node = Node(
        package="moveit_ros_move_group",
        executable="move_group",
        output="screen",
        parameters=params,
    )

    return LaunchDescription(args + [move_group_node])
