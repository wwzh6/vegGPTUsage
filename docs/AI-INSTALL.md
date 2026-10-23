# AI 安装工作流

普通成员不需要 COTEMU_API_KEY。统一密钥仅由管理员保存到 GitHub Actions Secret。

## 提示词

> 请安装 https://github.com/wwzh6/vegGPTUsage 的“植被组额度查询”。按 AGENTS.md 和 docs/AI-INSTALL.md 使用预构建文件安装，复用本机 GitHub 登录验证仓库读取权限，不要索取或配置 COTEMU_API_KEY。

## 执行步骤

1. 检查 Windows、Node.js ≥22.19 和 Git；缺少时按用户授权安装官方工具。普通成员不需要 npm、Python 或构建依赖。
2. 用有仓库读取权限的 GitHub 账号克隆仓库到新的可写目录，建议 `git clone --single-branch --branch main https://github.com/wwzh6/vegGPTUsage.git`。已有 checkout 先检查修改，不能强制覆盖。也可下载 Release ZIP 并核对同发布页 `.sha256`。
3. 通过 Git Credential Manager 或 `gh auth login` 在电脑本地完成 GitHub 登录。SSH 克隆成功不等于 HTTPS API 已登录。不要在聊天中索取令牌，也不要更改仓库可见性或为普通成员配置账号 API Key。
4. 在仓库目录运行 `node dist/check-access.mjs`。脚本只检查仓库读取权限，不输出凭证。失败时先处理本地登录、仓库权限或网络，不得宣称部署后已经能查看。
5. 运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1 -CheckOnly`，通过后去掉 `-CheckOnly` 安装。安装器自动寻找 Codex CLI，必要时传 `-CodexPath`。新安装保存到 `%LOCALAPPDATA%/VegetationQuota/marketplace`；升级复用原 marketplace 并保留其他插件。
6. 运行 `node scripts/verify-install.mjs "<实际 codex.exe 路径>"` 检查工具发现。此检查不查询真实用量。工具发现成功不等于 GitHub 数据已同步。
7. 重新打开 Codex，在全局侧边栏或会话侧面板的插件入口选择“植被组额度查询”，或调用 `open_usage_ball`。入口直接调用工具，无需每次发送对话；打开后点击圆环即可刷新。全局入口不保证圆环嵌在左侧导航栏或跨重启常驻。不要强制结束正在工作的会话。核对是否显示真实数据；没有权限、同步延迟和原生面板无法操作须分别报告。

## 运行边界

- 客户端只读取 `quota-data/usage.json`；每十分钟自动检查，点击手动读取，十五秒内合并重复请求。不会调用 Cotemu，也不会通过点击触发 Actions。
- GitHub 集中任务按十分钟计划运行，排队可能延迟；旧数据会被标记。它独立于客户端运行，关闭所有圆环也不会停止统一同步。
- Windows 优先使用显式 `VEGETATION_HTTPS_PROXY` 或系统已启用的静态代理；无系统静态代理时读取 HTTPS_PROXY/HTTP_PROXY。PAC 网络可设置前述显式变量。
- 安装后若 GitHub 登录失效，在本机重新登录并点击圆环。统一密钥错误由管理员按 `docs/ADMIN-SETUP.md` 处理。
