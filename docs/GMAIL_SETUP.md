# 连接 Gmail

Matthew Planner 直接从本机连接 Gmail，没有服务器。首次需要为这个应用配置 Google 桌面 OAuth 客户端。

1. 在 [Google Cloud Console](https://console.cloud.google.com/) 创建或选择一个项目。
2. 在 API 库启用 Gmail API。
3. 在 Google Auth Platform 配置应用名称和授权界面。个人测试使用时，将自己的 Gmail 账号添加为测试用户。
4. 添加 `https://www.googleapis.com/auth/gmail.readonly` 只读范围。
5. 创建类型为 **Desktop app / 桌面应用** 的 OAuth 客户端。不要选择 Web application。
6. 将 Client ID 和该配置的 Client secret 填入 Matthew Planner 的设置并保存。不要把 Client secret 或授权文件提交到 Git，也不要发到聊天里。
7. 点击“连接 Gmail”，在系统浏览器选择账号并授权，完成后返回程序。
8. 点击“检查求职邮件”。可以先展开查看内容，再选择最多 10 封交给 AI 整理。

默认筛选最近 30 天含面试、招聘、申请等词的邮件。设置中可以改为例如 `label:"Job Applications" newer_than:30d`。筛选限制的是程序处理的邮件；Google 授予的只读权限仍覆盖邮箱。

程序不能发送、删除或标记邮件。授权凭据保存在 Windows 加密存储里；读取列表不调用 AI，只有选中的内容会送去分析。任务和本地固定安排通过校验后直接加入计划，并可撤销。

如果看到授权被拒绝，检查账号是否加入测试用户、Gmail API 是否启用，以及客户端类型是否为桌面应用。测试状态下授权可能过期，届时重新连接。公开分发给其他用户可能需要 Google 验证。

官方参考：[桌面 OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)、[Gmail 权限](https://developers.google.com/workspace/gmail/api/auth/scopes)、[Gmail 起步配置](https://developers.google.com/workspace/gmail/api/quickstart/nodejs)。
