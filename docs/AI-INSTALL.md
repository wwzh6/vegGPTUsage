# AI 安装工作流

在 Windows 电脑上给 AI 发送：

> 请安装 https://github.com/wwzh6/vegGPTUsage 的“植被组额度查询”。先读取仓库 AGENTS.md 和 docs/AI-INSTALL.md，使用预构建版本完成检查与安装。需要密钥时打开本地遮掩输入窗口，不要让我把密钥发到聊天中。保留我现有的模型和插件配置，最后验证工具发现；没有真实查询结果时明确说明。

## 执行步骤

1. 将仓库克隆到用户可写的新目录；已有 checkout 时先检查本地修改，不能强制覆盖。若使用 Release ZIP，先核对同发布页 `.sha256`，再解压。
2. 检查 Windows、Node.js ≥22 和 Codex 桌面端。缺少 Node 时可按用户授权安装官方 Node.js LTS；安装后重新解析 PATH。不要安装构建依赖。非 Windows 停止并说明安装脚本尚不支持。
3. 在仓库目录运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1 -CheckOnly`。脚本自动寻找 Codex CLI；如有多个版本，以当前桌面应用对应版本为准，可传 `-CodexPath`。
4. 运行同一命令，去掉 `-CheckOnly`。安装器校验预构建文件，注册本地 marketplace，并安装/升级插件。新安装默认目录为 `%LOCALAPPDATA%\VegetationQuota\marketplace`；已有安装复用其原目录并保留其他插件条目。技术 ID 保持 `cotemu-usage-ball@cotemu-local`，用于兼容旧安装。
5. 只检查 `COTEMU_API_KEY` 是否存在，不输出其值。缺少时执行下方命令，用户在独立窗口粘贴自己的账号 API 密钥。不要自动读取剪贴板或其他配置中的凭证。窗口关闭后再检查变量是否存在；取消不等于配置成功。

   ```powershell
   Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',('"' + (Join-Path $PWD 'scripts/configure-key.ps1') + '"')
   ```

6. 密钥写入当前 Windows 用户的环境变量，不写仓库。它不是加密密钥库；同一用户的程序可读取。完全退出并重新打开 Codex 以继承新环境。不要强制结束正在工作的 Codex。
7. 从会话入口选择“植被组额度查询”，或发送“打开植被组额度查询”。可在重新启动后的 AI 会话调用插件工具验证。缺少密钥或原生 UI 不可操作时，报告相应项目未验证。

## 验证与恢复

- `install.ps1 -CheckOnly` 不安装、不写密钥。安装命令可重复运行。
- 需要检查工具发现时，在仓库创建 `artifacts` 后运行：

  ```powershell
  New-Item -ItemType Directory artifacts -Force | Out-Null
  node scripts/verify-install.mjs "<实际 codex.exe 路径>" "$env:LOCALAPPDATA/VegetationQuota/marketplace/.agents/plugins/marketplace.json"
  ```

- 成功标准：插件已启用，工具 `open_usage_ball` 和 `get_usage` 存在，`toolsError` 为 null。工具发现不等同于真实账号或原生界面已通过验证。
- 连接异常时重新运行密钥窗口，再重启应用。多台电脑若填写同一个密钥，会查看同一个绑定账号；不同密钥则依各自绑定账号显示。
- 十分钟自动刷新；点击圆环刷新，十五秒内不重复请求；隐藏暂停，恢复时按需补查。用面板原生关闭按钮关闭；圆环聚焦后 Esc 可请求关闭，宿主保留界面时点击圆环重开。
