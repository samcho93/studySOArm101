"""
SO-ARM101 모델 시각화 — 컨트롤러도 하드웨어도 필요 없습니다.

    ros2 launch so_arm101_description view_description.launch.py rviz:=true
"""
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.conditions import IfCondition
from launch.substitutions import Command, LaunchConfiguration, PathJoinSubstitution
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue
from launch_ros.substitutions import FindPackageShare


def generate_launch_description() -> LaunchDescription:
    pkg = FindPackageShare("so_arm101_description")

    args = [
        DeclareLaunchArgument("rviz", default_value="true",
                              description="RViz2 를 함께 띄울지 여부"),
        DeclareLaunchArgument("gui", default_value="true",
                              description="joint_state_publisher_gui 사용 여부"),
        DeclareLaunchArgument("prefix", default_value="",
                              description="링크/조인트 이름 접두사"),
    ]

    robot_description = ParameterValue(
        Command([
            "xacro ",
            PathJoinSubstitution([pkg, "urdf", "so_arm101.urdf.xacro"]),
            " hardware_type:=mock",
            " prefix:=", LaunchConfiguration("prefix"),
        ]),
        value_type=str,
    )

    nodes = [
        Node(
            package="robot_state_publisher",
            executable="robot_state_publisher",
            output="screen",
            parameters=[{"robot_description": robot_description}],
        ),
        Node(
            package="joint_state_publisher_gui",
            executable="joint_state_publisher_gui",
            condition=IfCondition(LaunchConfiguration("gui")),
        ),
        Node(
            package="rviz2",
            executable="rviz2",
            output="screen",
            condition=IfCondition(LaunchConfiguration("rviz")),
            arguments=["-d", PathJoinSubstitution([pkg, "rviz", "view.rviz"])],
        ),
    ]

    return LaunchDescription(args + nodes)
