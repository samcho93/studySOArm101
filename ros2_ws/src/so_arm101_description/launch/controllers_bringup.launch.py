"""
ros2_control 컨트롤러 스택 실행.

    # 가상 하드웨어 (하드웨어 불필요)
    ros2 launch so_arm101_description controllers_bringup.launch.py

    # 실물 SO-ARM101
    ros2 launch so_arm101_description controllers_bringup.launch.py \
        hardware_type:=real usb_port:=/dev/ttyACM0
"""
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, RegisterEventHandler
from launch.conditions import IfCondition
from launch.event_handlers import OnProcessExit
from launch.substitutions import Command, LaunchConfiguration, PathJoinSubstitution
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue
from launch_ros.substitutions import FindPackageShare


def generate_launch_description() -> LaunchDescription:
    pkg = FindPackageShare("so_arm101_description")

    args = [
        DeclareLaunchArgument("hardware_type", default_value="mock",
                              choices=["mock", "gazebo", "real"],
                              description="하드웨어 인터페이스 종류"),
        DeclareLaunchArgument("usb_port", default_value="/dev/ttyACM0",
                              description="실기 시리얼 포트"),
        DeclareLaunchArgument("baud_rate", default_value="1000000",
                              description="서보 보레이트"),
        DeclareLaunchArgument("rviz", default_value="false",
                              description="RViz2 동시 실행"),
    ]

    robot_description = ParameterValue(
        Command([
            "xacro ",
            PathJoinSubstitution([pkg, "urdf", "so_arm101.urdf.xacro"]),
            " hardware_type:=", LaunchConfiguration("hardware_type"),
            " usb_port:=", LaunchConfiguration("usb_port"),
            " baud_rate:=", LaunchConfiguration("baud_rate"),
        ]),
        value_type=str,
    )

    controllers_yaml = PathJoinSubstitution([pkg, "config", "controllers.yaml"])

    control_node = Node(
        package="controller_manager",
        executable="ros2_control_node",
        output="screen",
        parameters=[{"robot_description": robot_description}, controllers_yaml],
    )

    rsp_node = Node(
        package="robot_state_publisher",
        executable="robot_state_publisher",
        output="screen",
        parameters=[{"robot_description": robot_description}],
    )

    jsb_spawner = Node(
        package="controller_manager",
        executable="spawner",
        arguments=["joint_state_broadcaster",
                   "--controller-manager", "/controller_manager"],
    )

    jtc_spawner = Node(
        package="controller_manager",
        executable="spawner",
        arguments=["joint_trajectory_controller",
                   "--controller-manager", "/controller_manager"],
    )

    rviz_node = Node(
        package="rviz2",
        executable="rviz2",
        output="screen",
        condition=IfCondition(LaunchConfiguration("rviz")),
        arguments=["-d", PathJoinSubstitution([pkg, "rviz", "view.rviz"])],
    )

    # joint_state_broadcaster 가 올라온 뒤에 궤적 컨트롤러를 띄운다
    ordered = RegisterEventHandler(
        OnProcessExit(target_action=jsb_spawner, on_exit=[jtc_spawner])
    )

    return LaunchDescription(args + [control_node, rsp_node, jsb_spawner, ordered, rviz_node])
