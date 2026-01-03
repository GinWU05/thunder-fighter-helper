下载页: https://mumu.163.com/games/29454.html
APK 下载链接: https://store-api.mumu.163.com/api/website/pkg/downlink/121929.apk

## MuMu 导出热更新资源（Windows + adb）

目的：游戏的关卡/掉落等配置不在 APK 明文里，主要通过热更新资源下发。导出热更新资源是为了拿到关卡信息并进行解析。

环境说明：
- adb 运行在 Windows 主机上。
- MuMu 模拟器同样运行在这台 Windows 主机上。
- 需要在 MuMu 设置里开启 root 权限。

1) 列出设备并确认 MuMu 设备号。
```
adb devices
adb -s 127.0.0.1:7555 shell getprop ro.product.model
```

2) 查看应用沙盒文件（需要 root）。
```
adb -s 127.0.0.1:7555 shell "su 0 sh -c 'ls /data/data/com.a5game.ltzj.jj/files'"
```
重点关注 `hot-assets-a`、`hot-assets-b`、`innerVer`。

3) 打包并拉取热更新资源（存在 `hot-assets-b` 就一起带上）。
```
adb -s 127.0.0.1:7555 shell "su 0 sh -c 'toybox tar -czf /sdcard/ltzj_files.tgz -C /data/data/com.a5game.ltzj.jj files/hot-assets-a files/innerVer'"
adb -s 127.0.0.1:7555 pull /sdcard/ltzj_files.tgz
```
如果存在 `hot-assets-b`：
```
adb -s 127.0.0.1:7555 shell "su 0 sh -c 'toybox tar -czf /sdcard/ltzj_files.tgz -C /data/data/com.a5game.ltzj.jj files/hot-assets-a files/hot-assets-b files/innerVer'"
```

4) 压缩包默认生成在模拟器的 `/sdcard/ltzj_files.tgz`，`adb pull` 后会出现在你执行命令的 Windows 当前目录中。

5) 把压缩包放到项目目录（任选其一，按你的环境修改盘符）。
```
# Windows（CMD/PowerShell）
move ltzj_files.tgz D:\software\thunder-fighter-helper\_apk\

# WSL
mv ltzj_files.tgz /mnt/d/software/thunder-fighter-helper/_apk/
```

6) 解压热更新资源（任选其一）。
```
# WSL
tar -xzf _apk/ltzj_files.tgz -C _apk/
```
Windows 可用 7-Zip 解压到 `_apk/`，最终得到 `_apk/files/hot-assets-a`、`_apk/files/innerVer` 等目录。

备注：
- 包不是 debug 版，`run-as` 不可用，需使用 `su 0 sh -c`。
- 如果没有 `toybox`，可尝试 `busybox tar -czf ...` 同样参数。
- 游戏更新后需要重复导出，刷新热更新资源。

## 关卡信息源文件与格式（已验证）

来源文件（热更新资源）：
- `_apk/files/hot-assets-a/assets/resources/native/a3/a3a0dac2-619a-454f-a2e3-aad339de98ce.5c19f.bin`

容器格式（big-endian）：
- `[u32 name_len][u32 data_len][name][data]` 循环，name 为 UTF-8 字符串。
- 普通关卡条目在 `stage_normal_0_stage-info_data`。

`stage_normal_0_stage-info_data` 内部结构要点：
- 前半是记录区（二进制）。
- 末尾是字符串表 + 字符串区：
  - 表项 6 字节：`u16 flag + u16 offset + u16 length`
  - 字符串区为 UTF-8 拼接块。
- 表内包含 `stage-<n>_data`、关卡名、关卡介绍文本。

字段定位（已与前两关核对）：
- 战力 `enemyPower`：float BE，位于标记 `00 01 76 01` 前 16 字节。
- 体力消耗 `staminaCost`：int32 BE，位于标记前 56 字节。
- 今日次数 `dailyLimit`：int32 BE，位于标记前 48 字节（`-1` 表示无限制）。

已提取到项目（本次包）：
- `data/raw/stage-info/index.json`：容器目录。
- `data/raw/stage-info/stage_normal_0_stage-info_data.bin`：普通关卡原始条目。
- `data/raw/stage-info/stage_normal_0.json`：解析后的 1–8 关（含名称、介绍、战力、体力、次数）。

## 关卡掉落信息（可复用方案）

目标：把“特殊掉落（消耗品/进阶材料）”从热更新资源提取成可追溯的 JSON，后续游戏更新时可重复使用。

来源文件（热更新资源）：
- `_apk/files/hot-assets-a/assets/resources/native/1b/1bac6736-a930-4dfe-b683-82e9235c5094.ac67c.bin`
- 该容器内关键条目：
  - `stage_loot_data`：关卡掉落表（核心）。
  - `cfg_item_material`：进阶材料与关卡列表（含三/四/五星、战神材料）。
  - `cfg_item_extra`：消耗品与经验材料（含残骸/经验道具）。

容器格式同上（big-endian）：
- `[u32 name_len][u32 data_len][name][data]` 循环，name 为 UTF-8 字符串。

### 解析与存档结构（两层）

1) 原始层（只还原，不猜含义）
- 目标：把 `stage_loot_data` 解析成“可读 key-value + rawArray”。
- 解析要点（通用定位，不硬编码偏移）：
  - `stage_loot_data` 首 4 字节是 `headerOffset`（u32 BE）。
  - 表区记录为 7 个 u32 BE（record size = 28）。
  - 通过扫描表区找到连续记录满足：
    - `unk4 == 0`、`unk5 == 0`、`const10 == 10`
    - `stageId` 连续（0、1、2...）即可定位表起点。
  - 记录结构（按索引解释，仅为字段名，不代表语义）：
    - `f0`、`stageId`、`linkedRecordOffset`、`groupId`、`unk4`、`unk5`、`const10`
- 输出建议：
  - `data/raw/stage-loot/records.json`：每条记录对象化（含 `rawArray` 便于回溯）。
  - `data/raw/stage-loot/schema.json`：记录 `fieldIndexMap` 与字段备注。

2) 解释层（基于样本推断，可持续更新）
- 目标：用少量关卡截图/样本建立映射关系，并保留证据。
- 输出建议：
  - `data/raw/stage-loot/samples.json`：记录样本关卡 + 特殊掉落 + 截图来源。
  - `data/raw/stage-loot/inference.json`：记录当前推断（如 `f0`/`groupId` 对应的掉落类型），标注 `status: inferred/verified`。
  - `data/parsed/stage_loot_sample.json`：仅把已验证样本关卡输出为“特殊掉落列表”。

### 更新复用流程（游戏版本更新时）

1) 用 adb 重新导出热更新资源（见上文步骤），替换 `_apk/ltzj_files.tgz` 并解压到 `_apk/`。
2) 重新从 `1bac6736-...ac67c.bin` 抽取：
   - `stage_loot_data`、`cfg_item_material`、`cfg_item_extra` 写入 `data/raw/`。
3) 重新生成原始层 JSON（`records.json`、`schema.json`）。
4) 不动或仅补充 `samples.json` / `inference.json`（样本是可复用资产）。
5) 重新导出解析结果（样本/批量）。
