# Android 推送通知配置

本文档描述 Android 推送通知的完整配置流程。推送链路为：

```
App (expo-notifications) → Expo Push Service → FCM V1 → Android 设备
```

## 前置条件

- Firebase Console 账号
- EAS CLI (`eas-cli`) 已安装并登录
- Expo 项目已配置 (`eas.json` + `app.config.js`)

## 架构概览

| 组件 | 文件 | 职责 |
|------|------|------|
| Token 注册 | `happy-app/sources/sync/sync.ts` | App 启动时请求通知权限，获取 Expo Push Token |
| Token 上报 | `happy-app/sources/sync/apiPush.ts` | 将 token 注册到 Server |
| Token 存储 | `happy-server/sources/app/api/routes/pushRoutes.ts` | Server 存储/管理 push token |
| 通知发送 | `happy-server/sources/modules/pushSend.ts` | 通过 Expo Push SDK 发送通知 |
| 通知渠道 | `happy-app/sources/app/_layout.tsx` | Android notification channel 配置 |

## 配置步骤

### 1. Firebase 项目设置

1. 登录 [Firebase Console](https://console.firebase.google.com)
2. 创建或选择项目（当前使用 `happy-coder-421f7`）
3. 在 **Project Settings → General → Your apps** 下添加 Android apps：
   - `com.ex3ndr.happy`（production）
   - `com.kmmao.happy`
   - `com.slopus.happy.dev`（development）
   - `com.slopus.happy.preview`（preview）
4. 下载 `google-services.json`，放到 `packages/happy-app/google-services.json`

### 2. 生成 FCM V1 Service Account Key

1. Firebase Console → 选择项目 → **Project Settings → Service accounts**
2. 点击 **Generate new private key**
3. 下载 JSON 文件（如 `happy-coder-421f7-firebase-adminsdk-*.json`）

> **重要**：Service Account Key 必须来自与 `google-services.json` **同一个** Firebase 项目。
> 否则会出现 `SENDER_ID_MISMATCH` 错误。

### 3. 上传 FCM Key 到 EAS

对**每个** build profile 都需要上传：

```bash
cd packages/happy-app

# 对 development profile 上传
eas credentials -p android
# 选择 development → Push Notifications → Set up FCM V1 → 输入 JSON 文件路径

# 对 preview profile 也上传同一个 Key
eas credentials -p android
# 选择 preview → Push Notifications → Set up FCM V1 → 输入 JSON 文件路径
```

> **注意**：`eas credentials` 的文件路径需要使用**绝对路径**，`~` 不会被展开。
> 例如：`/Users/username/Documents/firebase-adminsdk.json`

### 4. 构建并安装 APK

```bash
# 本地构建（推荐，速度快）
cd packages/happy-app
eas build --local -p android --profile preview

# 安装到已连接的设备
adb install -r build-*.apk
```

### 5. 验证推送链路

```bash
# 查询已注册的 push token
docker exec happy-postgres-1 psql -U postgres -d handy \
  -c "SELECT token, \"createdAt\" FROM \"AccountPushToken\" ORDER BY \"createdAt\" DESC LIMIT 5;"

# 通过 Expo Push API 发送测试通知
curl -X POST https://exp.host/--/api/v2/push/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "ExponentPushToken[YOUR_TOKEN_HERE]",
    "title": "测试通知",
    "body": "推送配置成功！",
    "sound": "default"
  }'

# 查询投递回执（等几秒后执行）
curl -X POST https://exp.host/--/api/v2/push/getReceipts \
  -H "Content-Type: application/json" \
  -d '{"ids":["TICKET_ID_HERE"]}'
```

回执 `status: "ok"` 表示 FCM 已成功接收并投递。

## 常见错误

### InvalidCredentials

```json
{"status":"error","message":"Unable to retrieve the FCM server key..."}
```

**原因**：EAS 上没有配置 FCM V1 Service Account Key。
**解决**：按步骤 3 上传 Key。注意要对正确的 build profile（与 App 包名匹配）上传。

### SENDER_ID_MISMATCH

```json
{"errorCode":"SENDER_ID_MISMATCH"}
```

**原因**：App 内嵌的 `google-services.json` 的 `project_number`（sender ID）与 EAS 上 Service Account Key 的 Firebase 项目不一致。

**解决**：确保三者统一到同一个 Firebase 项目：
1. `packages/happy-app/google-services.json` 中的 `project_id`
2. EAS 上传的 Service Account Key 的 `project_id`
3. App 的 APK 需要用匹配的 `google-services.json` 重新构建

### DeviceNotRegistered

**原因**：设备 token 已失效（App 被卸载或重装）。
**解决**：无需手动处理，`pushSend.ts` 会自动清理失效 token。

## 关键文件

| 文件 | 说明 |
|------|------|
| `packages/happy-app/google-services.json` | Firebase Android 配置（包含 project_number/sender ID） |
| `packages/happy-app/app.config.js` | Expo 配置（引用 google-services.json） |
| `packages/happy-app/sources/sync/sync.ts:2332-2365` | Push token 注册逻辑 |
| `packages/happy-app/sources/sync/apiPush.ts` | Token 上报 API |
| `packages/happy-server/sources/modules/pushSend.ts` | Server 端推送发送 |
| `packages/happy-server/sources/app/api/routes/pushRoutes.ts` | Push token CRUD API |

## 触发推送的业务场景

Server 在以下场景调用 `pushSend`：
- **Inbox 通知**：`inboxCreate.ts`
- **Supervisor 分析完成/错误/修复**：`supervisorFixStatusHandler.ts`、`supervisorRunStatusHandler.ts`、`supervisorFixWatchdog.ts`
- **手动测试**：`POST /v1/push/send` API
