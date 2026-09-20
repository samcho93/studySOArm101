"""
MoveIt 2 통합 데모 — 컨트롤러 스택 + move_group + RViz 를 한 번에 띄웁니다.

    # 가상 하드웨어
    ros2 launch so_arm101_moveit_config demo.launch.py

    # 실물
    ros2 launch so_arm101_moveit_config demo.launch.py \
        hardware_type:=real usb_port:=/dev/ttyACM0

주의: controllers_bringup.launch.py 를 이미 실행 중이라면 먼저 종료하세요.
      컨트롤러 매니저가 둘이 되면 충돌합니다.
"""
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription, TimerAction
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration, PathJoinSubstitution
from launch_ros.substitutions import FindPackageShare


def generate_launch_description() -> LaunchDescription:
    desc_pkg = FindPackageShare("so_arm101_description")
    moveit_pkg = FindPackageShare("so_arm101_moveit_config")

    args = [
        DeclareLaunchArgument("hardware_type", default_value="mock",
                              choices=["mock", "gazebo", "real"]),
        DeclareLaunchArgument("usb_port", default_value="/dev/ttyACM0"),
        DeclareLaunchArgument("use_sim_time", default_value="false"),
    ]

    controllers = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            PathJoinSubstitution([desc_pkg, "launch", "controllers_bringup.launch.py"])),
        launch_arguments={
            "hardware_type": LaunchConfiguration("hardware_type"),
            "usb_port": LaunchConfiguration("usb_port"),
            "rviz": "false",
        }.items(),
    )

    move_group = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            PathJoinSubstitution([moveit_pkg, "launch", "move_group.launch.py"])),
        launch_arguments={
            "use_sim_time": LaunchConfiguration("use_sim_time"),
            "hardware_type": LaunchConfiguration("hardware_type"),
        }.items(),
    )

    rviz = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            PathJoinSubstitution([moveit_pkg, "launch", "moveit_rviz.launch.py"])),
        launch_arguments={
            "use_sim_time": LaunchConfiguration("use_sim_time"),
        }.items(),
    )

    # 컨트롤러가 올라올 시간을 준 뒤 move_group / RViz 를 띄운다
    return LaunchDescription(args + [
        controllers,
        TimerAction(period=3.0, actions=[move_group]),
        TimerAction(period=6.0, actions=[rviz]),
    ])
