# 管理员统一配置

只需管理员配置一次。当前使用服务器定时同步，GitHub Actions 自动备用，见 [SERVER-SYNC.md](SERVER-SYNC.md)。普通成员不需要账号 API Key。只有支持同一查询锁协议的新版本才能同时启用；旧版发布程序必须先停用。

## 初次设置与更换密钥

1. 账号 API Key 必须由 Cotemu 签发。文档列出 `sk-ctm-…` 或 `ctm_…`；配置工具也允许输入普通 `sk-…`，是否有效以账号查询接口响应为准。它不是队伍码或 `ctm-team-…` 队伍令牌。
2. Windows 管理员电脑运行 `scripts/configure-key.ps1`，在遮掩窗口输入，保存到当前用户环境变量。此本地变量用于管理员上传，不会分发给成员。不要在聊天、命令行参数、源码或 Actions 日志中填写密钥。
3. 管理员需要 Python 和 PyNaCl（仅管理员配置工具需要），并通过 Git Credential Manager 或 GitHub CLI 登录有仓库 Secret 管理权限的 GitHub 账号。
4. 在仓库目录执行 `python scripts/configure-shared.py`。脚本读取本地用户环境变量，用 GitHub 仓库公钥进行 sealed-box 加密后保存为 `COTEMU_API_KEY` Actions Secret，再触发 `Sync shared quota`。不输出完整密钥、GitHub 凭证或上游错误正文。`--upload-only` 仅保存 Secret。
5. 确认同步工作流成功，并检查 `quota-data` 分支 `usage.json` 的 `state.error` 为 null。工作流成功仅表示快照发布成功，账号错误仍可能被记录在快照中。

也可直接在仓库 Settings → Secrets and variables → Actions 中设置同名 Secret，然后手动运行同步工作流。

## 运维

- 定时任务在每小时第 7、17、27、37、47、57 分钟计划运行。GitHub 可能延迟排队；依赖仓库 Actions 可用额度，不保证实时。
- 401/403 会暂停对账号接口的自动重试；更新服务器密钥与 Actions Secret 后，按 SERVER-SYNC.md 的手动恢复步骤操作。普通工作流运行和故障演练不会解除鉴权暂停。429 冷却和十五秒最短查询间隔不能绕过。
- 更换密钥须同时更新服务器与 Actions Secret，成员无需重新配置或安装。成员客户端会继续读取快照以发现恢复结果。
- 统一任务只写 `quota-data` 数据分支，源码和发布由另一工作流管理。分支中没有完整账号列表或账号标识。
- 私有仓库的读取权限是查看范围。插件无法自行授予 GitHub 权限；是否增加成员由仓库管理员决定。
- 不要将统一账号密钥填入普通成员电脑。旧版本遗留的同名环境变量不再被新版客户端读取；不会擅自删除用户原有变量。
