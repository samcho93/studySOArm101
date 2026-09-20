"""
Gazebo(gz-sim) 시뮬레이션 실행.

    ros2 launch so_arm101_bringup gazebo.launch.py
    ros2 launch so_arm101_bringup gazebo.launch.py gazebo_gui:=false

실행 후 순서는 19장을 따르세요.
    1) 이 런치 실행
    2) forward_position_controller 비활성화 → joint_trajectory_controller spawn
    3) move_group.launch.py use_sim_time:=True
    4) moveit_rviz.launch.py
"""
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription
from launch.conditions import IfCondition, UnlessCondition
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import Command, LaunchConfiguration, PathJoinSubstitution
from launch_ros.actions import Node
from launch_ros.parameter_descriptions import ParameterValue
from launch_ros.substitutions import FindPackageShare


def generate_launch_description() -> LaunchDescription:
    desc_pkg = FindPackageShare("so_arm101_description")
    bringup_pkg = FindPackageShare("so_arm101_bringup")

    args = [
        DeclareLaunchArgument("gazebo_gui", default_value="true",
                              description="Gazebo GUI 표시 여부"),
        DeclareLaunchArgument("world", default_value="table_with_cube.sdf",
                              description="worlds/ 아래의 월드 파일 이름"),
    ]

    world_path = PathJoinSubstitution(
        [bringup_pkg, "worlds", LaunchConfiguration("world")])

    gz_launch = PathJoinSubstitution(
        [FindPackageShare("ros_gz_sim"), "launch", "gz_sim.launch.py"])

    gz_gui = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(gz_launch),
        condition=IfCondition(LaunchConfiguration("gazebo_gui")),
        launch_arguments={"gz_args": ["-r ", world_path]}.items(),
    )

    gz_headless = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(gz_launch),
        condition=UnlessCondition(LaunchConfiguration("gazebo_gui")),
        launch_arguments={"gz_args": ["-r -s --headless-rendering ", world_path]}.items(),
    )

    robot_description = ParameterValue(
        Command(["xacro ",
                 PathJoinSubstitution([desc_pkg, "urdf", "so_arm101.urdf.xacro"]),
                 " hardware_type:=gazebo"]),
        value_type=str,
    )

    rsp = Node(
        package="robot_state_publisher",
        executable="robot_state_publisher",
        output="screen",
        parameters=[{"robot_description": robot_description, "use_sim_time": True}],
    )

    spawn = Node(
        package="ros_gz_sim",
        executable="create",
        output="screen",
        arguments=["-topic", "robot_description", "-name", "so_arm101", "-z", "0.02"],
    )

    clock_bridge = Node(
        package="ros_gz_bridge",
        executable="parameter_bridge",
        output="screen",
        arguments=["/clock@rosgraph_msgs/msg/Clock[gz.msgs.Clock"],
    )

    jsb = Node(
        package="controller_manager",
        executable="spawner",
        arguments=["joint_state_broadcaster", "--controller-manager", "/controller_manager"],
    )

    return LaunchDescription(args + [gz_gui, gz_headless, rsp, spawn, clock_bridge, jsb])
