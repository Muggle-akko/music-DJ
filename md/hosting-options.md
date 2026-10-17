# 托管选项与适配记录

用户当前没有服务器，希望沿用 Vercel 的部署习惯及 `*.vercel.app` 地址。无需先购买 VPS。已经完成的私人登录、远程 MCP、设备队列、电台共享和 Docker 包作为通用服务基础保留；已新增 Vercel 专用容器与 PostgreSQL 适配，操作步骤见 [Vercel 部署说明](vercel-deployment.md)；尚未完成公网部署。

## 已核实的平台能力（2026-10-16）

- Vercel 支持 [Container Runtime（Beta）](https://vercel.com/docs/functions/runtimes/container)，可以用 `Dockerfile.vercel` 部署 Node 等 OCI 镜像，也提供多个服务的路由。文档标明适用于所有套餐，但具体账号可用性与费用须在部署前确认。容器会随流量缩容，函数的限制仍适用，不等同于一台永不退出的服务器。
- Vercel 的[普通函数运行时](https://vercel.com/docs/functions/runtimes)文件系统只读，`/tmp` 是临时空间，不能把它当成永久保存电台或 Cookie 的数据盘。当前实现的本地 JSON 写入和进程内会话不能据此认定可在多实例中共享。
- [R2](https://developers.cloudflare.com/r2/) 是对象存储，可存解说音频、导出文件及私有备份。它本身不执行 Node 后端，也不提供现有队列更新所需的多记录数据库事务。不要把整份 state.json 同步到 R2 就声称解决了并发覆盖。
- [Cloudflare Containers](https://developers.cloudflare.com/containers/) 可作为另一条容器托管路径，要求 Workers 付费计划；[磁盘默认临时](https://developers.cloudflare.com/containers/faq/#is-disk-persistent-what-happens-to-my-disk-when-my-container-sleeps)，快照不是每次写入的自动持久化，因此也需适配存储。

## Vercel 路径与验证边界

1. 网页和同来源 API 使用一个固定的生产 `*.vercel.app` 地址；保持 Cookie 同来源，避免 iOS 第三方 Cookie 问题。不要直接放开任意 Origin 或改为浏览器明文保存全权限 token。
2. 已提供 `Dockerfile.vercel` 和内置私有网易云适配器。当前仍需公网部署确认账号能启用、Host / Origin 传递及真实上游访问。Compose 是另一条主机部署路径。
3. 已用 PostgreSQL 事务保存账号、浏览器会话、设备队列、Agent 会话/检索凭据/控制租约、操作幂等记录、电台与反馈。保留现有 revision、operationId 与执行回执语义，已验证两个实例并发和冷启动。
4. 第一版将解说音频也存入数据库，通过受保护接口读取，暂不要求额外开通 R2。之后可按容量需要迁移到对象存储。不批量搬运网易云歌曲。
5. 云端已使用短轮询与数据库里的共享运行状态，不依赖某个进程中的 SSE 连接集合。超时与重连不补执行过期播放命令。
6. 独立验证音频 Range、长曲、播放地址刷新与平台流量/时长限制，再验证 iPad / iPhone 真机。Vercel 的外部 rewrite 不应被默认当成无限时长音频代理。

如暂不使用 Beta 容器，可选择支持持久卷的托管容器平台运行现有服务，再让 Vercel 提供入口；这仍需同来源代理和音频通路验证，当前未接入。域名问题与执行后端问题分开处理，使用 Vercel 地址不意味着所有计算与文件必须在 Vercel 内完成。

## 本轮交付与验证

当前结果与使用边界以 [Vercel 部署说明](vercel-deployment.md) 为准。115 项回归通过，包含真实 PostgreSQL 双实例、冷启动、失败回滚与资料迁移；Vercel 镜像和本地容器入口已启动验证。尚无公网部署结果，也没有开通付费资源或改动其他 Vercel 项目。
