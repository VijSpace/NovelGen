; ==================== 自定义 NSIS 脚本 ====================
; 卸载前强制关闭正在运行的应用，解决"文件被占用删不掉"的问题

!macro customUnInstall
  ; 强制结束 NovelGen 进程
  nsExec::ExecToLog 'taskkill /f /im NovelGen.exe'
  ; 等待进程完全退出
  Sleep 1500
!macroend
