# meshes/

기본 모델은 STL 없이 동작하는 **프리미티브(박스) 근사**입니다.
실제 CAD 메시를 쓰려면 워크스페이스 루트에서 다음을 실행하세요.

```bash
python fetch_meshes.py
```

TheRobotStudio/SO-ARM100 저장소에서 STL 13개를 이 디렉터리로 내려받고,
`urdf/so101_meshes.urdf` 를 생성합니다.
