"""
MoveIt 용 RViz2 실행 (MotionPlanning 패널 포함).

    ros2 launch so_arm101_moveit_config moveit_rviz.launch.py
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
    moveit_pkg = FindPackageShare("so_arm101_moveit_config")

    args = [DeclareLaunchArgument("use_sim_time", default_value="false")]

    robot_description = ParameterValue(
        Command(["xacro ",
                 PathJoinSubstitution([desc_pkg, "urdf", "so_arm101.urdf.xacro"]),
                 " hardware_type:=mock"]),
        value_type=str,
    )

    rviz_node = Node(
        package="rviz2",
        executable="rviz2",
        output="screen",
        arguments=["-d", PathJoinSubstitution([moveit_pkg, "config", "moveit.rviz"])],
        parameters=[
            {"robot_description": robot_description},
            {"robot_description_semantic":
                load_file("so_arm101_moveit_config", "config/so_arm101.srdf")},
            {"robot_description_kinematics":
                load_yaml("so_arm101_moveit_config", "config/kinematics.yaml")},
            {"robot_description_planning":
                load_yaml("so_arm101_description", "config/joint_limits.yaml")},
            load_yaml("so_arm101_moveit_config", "config/ompl_planning.yaml"),
            {"use_sim_time": LaunchConfiguration("use_sim_time")},
        ],
    )

    return LaunchDescription(args + [rviz_node])
