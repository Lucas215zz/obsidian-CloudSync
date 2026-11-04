@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title Tencent COS Sync - Installer

set "DIR=%~dp0"

echo ================================================
echo    Tencent COS Sync 一键安装器（小白版）
echo ================================================
echo.

rem ---- 1. 检查必要文件 ----
set "MISS=0"
if not exist "%DIR%main.js"       set "MISS=1"
if not exist "%DIR%manifest.json" set "MISS=1"
if not exist "%DIR%styles.css"    set "MISS=1"

if "!MISS!"=="1" (
    echo    [错误] 缺少必要文件。
    echo           请确保 main.js、manifest.json、styles.css
    echo           和本脚本在同一文件夹里。
    goto END
)

rem ---- 2. 自动扫描 Obsidian 仓库 ----
echo    正在扫描你的 Obsidian 仓库...
echo.

set "COUNT=0"
for /f "usebackq delims=" %%V in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=Join-Path $env:APPDATA 'obsidian\obsidian.json';$j=ConvertFrom-Json ([IO.File]::ReadAllText($c,[System.Text.Encoding]::UTF8));foreach($v in $j.vaults.PSObject.Properties){$v.Value.path}"`) do (
    if not "%%V"=="" (
        set /a COUNT+=1
        set "VAULT_!COUNT!=%%V"
        echo     找到仓库: %%V
    )
)

if !COUNT! EQU 0 (
    echo.
    echo    [错误] 没有找到任何 Obsidian 仓库。
    echo           请先打开一次 Obsidian，再重新双击本脚本。
    goto END
)

rem ---- 3. 逐个安装 ----
echo.
echo    开始安装...
echo.

set "OK=0"
for /L %%i in (1,1,!COUNT!) do (
    set "V=!VAULT_%%i!"
    if exist "!V!\" (
        set "TARGET=!V!\.obsidian\plugins\obsidian-cos-sync"
        if not exist "!TARGET!" mkdir "!TARGET!"
        copy /Y "%DIR%main.js"       "!TARGET!\" >nul
        copy /Y "%DIR%manifest.json" "!TARGET!\" >nul
        copy /Y "%DIR%styles.css"    "!TARGET!\" >nul
        rem ---- 启用插件：把插件 ID 加进 community-plugins.json ----
        powershell -NoProfile -ExecutionPolicy Bypass -Command ^
            "$cp=Join-Path '!V!' '.obsidian\community-plugins.json'; $plugins=@(); if (Test-Path $cp) { try { $raw=[IO.File]::ReadAllText($cp,[System.Text.Encoding]::UTF8); $obj=ConvertFrom-Json $raw; if ($obj -is [System.Array]) { foreach($p in $obj){ $plugins+=$p } } } catch {} }; if (-not ($plugins -contains 'obsidian-cos-sync')) { $plugins += 'obsidian-cos-sync'; [IO.File]::WriteAllText($cp, (ConvertTo-Json $plugins), (New-Object System.Text.UTF8Encoding $false)) }"
        echo    [成功] 已安装到 !V!
        set /a OK+=1
    ) else (
        echo    [跳过] 目录不存在: !V!
    )
)

rem ---- 4. 结果提示 ----
echo.
echo ================================================
if !OK! GTR 0 (
    echo    安装完成！共安装 !OK! 个仓库
    echo.
    echo    接下来请这样操作：
    echo     1. 完全退出 Obsidian（Ctrl+Q 或右上角关闭）
    echo     2. 重新打开 Obsidian
    echo     3. 设置 → 第三方插件
    echo        找到 Tencent COS Sync 并打开开关
    echo     4. 在插件设置里填入腾讯云 COS 信息：
    echo        SecretId / SecretKey / Bucket / Region
) else (
    echo    [失败] 没有成功安装到任何仓库，请看上方提示。
)
echo ================================================

:END
echo.
pause
