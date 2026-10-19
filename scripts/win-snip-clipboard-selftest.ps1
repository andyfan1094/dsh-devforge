# win-snip-clipboard-selftest.ps1 —— 剪贴板历史（存储层 + 采集层）自测
#
# 用途：证明 0.62.0 新增的剪贴板历史能力"改动前失败、改动后通过"。
#   - 用 -NativeDir 指向改动前的 native 目录时，必需文件缺失，测试直接 FAIL（改动前失败）；
#   - 指向当前 src/win-snip/native 时全部用例通过（改动后通过）。
#
# 隔离：BaseDir 默认落在仓库 tmp/ 下，只清理自己生成的 clipboard 子目录，
# 绝不碰生产 HOME（C:\Users\<用户>\.dsh）。
#
# 真实剪贴板用例默认不跑（-IncludeClipboard 打开）：它会短暂改写系统剪贴板，
# 跑完恢复原文本；无文本时清空测试内容。

param(
    [string]$NativeDir = '',
    [string]$BaseDir = '',
    [switch]$IncludeClipboard
)

$ErrorActionPreference = 'Continue'
$script:Fail = 0
$script:Pass = 0

function Assert-True([bool]$Condition, [string]$Label) {
    if ($Condition) {
        Write-Host ('PASS  ' + $Label)
        $script:Pass++
    } else {
        Write-Host ('FAIL  ' + $Label)
        $script:Fail++
    }
}

$repo = Split-Path -Parent $PSScriptRoot
if ($NativeDir -eq '') { $NativeDir = Join-Path $repo 'src\win-snip\native' }
if ($BaseDir -eq '') { $BaseDir = Join-Path $repo 'tmp\win-snip-selftest' }

Write-Host ('native dir: ' + $NativeDir)
Write-Host ('base dir  : ' + $BaseDir)

# ---------- 0. 前置：必需文件齐全（改动前失败就失败在这一步） ----------
$required = @(
    'win-snip-common.ps1',
    'win-snip-clipboard-store.ps1',
    'win-snip-clipboard-watch.ps1',
    'win-snip-clipboard-read.cs',
    'win-snip-launcher.ps1',
    'win-snip-clipboard-panel.ps1'
)
$missing = @()
foreach ($name in $required) {
    if (-not (Test-Path (Join-Path $NativeDir $name))) { $missing += $name }
}
Assert-True ($missing.Count -eq 0) ('原生文件齐全（缺：' + ($missing -join ', ') + '）')
if ($missing.Count -gt 0) {
    Write-Host ''
    Write-Host ('RESULT pass=' + $script:Pass + ' fail=' + $script:Fail)
    exit 1
}

# ---------- 1. 准备隔离目录 ----------
$clipRoot = Join-Path $BaseDir 'clipboard'
foreach ($sub in @('clipboard', 'logs', 'commands')) {
    $target = Join-Path $BaseDir $sub
    if (Test-Path $target) { Remove-Item $target -Recurse -Force -ErrorAction SilentlyContinue }
}
New-Item -ItemType Directory -Force -Path $BaseDir | Out-Null

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
. (Join-Path $NativeDir 'win-snip-common.ps1')
$global:SnipStats.BaseDir = $BaseDir
Ensure-SnipDir $BaseDir
Ensure-SnipDir (Join-Path $BaseDir 'logs')
Ensure-SnipDir (Join-Path $BaseDir 'commands')
. (Join-Path $NativeDir 'win-snip-clipboard-store.ps1')
. (Join-Path $NativeDir 'win-snip-clipboard-watch.ps1')
Assert-True ($script:SnipClipboardReadReady -eq $true) '剪贴板读取 C# 类型编译成功'

# ---------- 2. 空库 ----------
Initialize-SnipClipboardStore -Days 15
$stats = Get-SnipClipboardStats -Days 15
Assert-True ([int]$stats.Items -eq 0) ('空库条数=0（实际 ' + $stats.Items + '）')

# ---------- 3. 追加与读取 ----------
$id1 = [Guid]::NewGuid().ToString('N')
$payload1 = Add-SnipClipboardEntry -Entry @{
    id = $id1; at = (Get-Date).ToString('o'); kind = 'text'
    hash = (Get-SnipHashHex -Text '第一条-剪贴板-历史'); text = '第一条-剪贴板-历史'; app = 'selftest'
}
Assert-True ($null -ne $payload1) '追加文本记录成功'
$entries = Get-SnipClipboardEntries -Days 15
Assert-True (@($entries).Count -eq 1) ('读取条数=1（实际 ' + @($entries).Count + '）')
Assert-True ([string]@($entries)[0].text -eq '第一条-剪贴板-历史') '记录内容一致'

# ---------- 4. 顺序：最新在前 ----------
Start-Sleep -Milliseconds 20
$id2 = [Guid]::NewGuid().ToString('N')
[void](Add-SnipClipboardEntry -Entry @{
        id = $id2; at = (Get-Date).ToString('o'); kind = 'text'
        hash = (Get-SnipHashHex -Text '第二条-带关键词-甲乙丙'); text = '第二条-带关键词-甲乙丙'; app = 'chrome'
    })
$entries = Get-SnipClipboardEntries -Days 15
Assert-True ([string]@($entries)[0].text -eq '第二条-带关键词-甲乙丙') '最新记录排在最前'

# ---------- 5. 搜索 ----------
$hit = Get-SnipClipboardEntries -Days 15 -Query '关键词'
Assert-True (@($hit).Count -eq 1 -and [string]@($hit)[0].id -eq $id2) '关键词只命中一条'
$hitByApp = Get-SnipClipboardEntries -Days 15 -Query 'chrome'
Assert-True (@($hitByApp).Count -eq 1) '按来源应用搜索命中'
$miss = Get-SnipClipboardEntries -Days 15 -Query '不存在的词'
Assert-True (@($miss).Count -eq 0) '无匹配时返回空'

# ---------- 6. 图片落盘 ----------
$bitmap = New-Object System.Drawing.Bitmap(160, 100)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
    $graphics.Clear([System.Drawing.Color]::FromArgb(38, 38, 42))
    $font = New-Object System.Drawing.Font('Microsoft YaHei UI', 12)
    try { $graphics.DrawString('自测图片 160x100', $font, [System.Drawing.Brushes]::White, 8, 8) } finally { $font.Dispose() }
} finally { $graphics.Dispose() }
$imageStream = New-Object System.IO.MemoryStream
$bitmap.Save($imageStream, [System.Drawing.Imaging.ImageFormat]::Png)
$imageBytes = $imageStream.ToArray()
$imageStream.Dispose()
$bitmap.Dispose()
$imageHash = Get-SnipHashBytes -Bytes $imageBytes
$imageSaved = Save-SnipClipboardSnapshot -Entry @{
    kind = 'image'; hash = $imageHash; at = (Get-Date).ToString('o')
    bytes = [int64]$imageBytes.Length; width = 160; height = 100; data = $imageBytes; app = 'selftest'
}
Assert-True ($null -ne $imageSaved) '图片记录落盘成功'
$imageEntries = @(Get-SnipClipboardEntries -Days 15 | Where-Object { $_.kind -eq 'image' })
Assert-True ($imageEntries.Count -eq 1) ('图片记录可读回（实际 ' + $imageEntries.Count + '）')
$imagePath = Join-Path $clipRoot (([string]@($imageEntries)[0].image) -replace '/', [System.IO.Path]::DirectorySeparatorChar)
Assert-True (Test-Path $imagePath) ('图片文件存在：' + $imagePath)

# ---------- 7. 过期清理（15 天） ----------
$oldDir = Join-Path $clipRoot 'days'
$oldDate = (Get-Date).Date.AddDays(-20)
$oldFile = Join-Path $oldDir ($oldDate.ToString('yyyy-MM-dd') + '.jsonl')
$orphanName = 'orphan-' + [Guid]::NewGuid().ToString('N') + '.png'
$orphanPath = Join-Path (Join-Path $clipRoot 'images') $orphanName
[System.IO.File]::WriteAllBytes($orphanPath, [byte[]](1, 2, 3))
$oldRecord = [ordered]@{
    id = [Guid]::NewGuid().ToString('N'); at = $oldDate.ToString('o'); kind = 'image'
    hash = 'deadbeef'; image = ('images/' + $orphanName); width = 1; height = 1
} | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText($oldFile, $oldRecord + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
Assert-True (Test-Path $oldFile) '构造 20 天前的历史文件'
Remove-SnipClipboardExpired -Days 15
Assert-True (-not (Test-Path $oldFile)) '20 天前的历史文件已删除'
Assert-True (-not (Test-Path $orphanPath)) '失去引用的图片已删除'
$keptImagePath = Join-Path $clipRoot (([string]@($imageEntries)[0].image) -replace '/', [System.IO.Path]::DirectorySeparatorChar)
Assert-True (Test-Path $keptImagePath) '仍被引用的图片保留'

# ---------- 8. 索引重建 ----------
$script:SnipClipboardState = @{
    Enabled = $true; Days = 15; LastSequence = 0
    Hashes = New-Object 'System.Collections.Generic.HashSet[string]'
    Count = 0; LastAt = $null; LastCleanup = [DateTime]::MinValue; LastError = $null
}
Reset-SnipClipboardIndex
Assert-True ([int]$script:SnipClipboardState.Count -eq 3) ('索引重建条数=3（实际 ' + $script:SnipClipboardState.Count + '）')
Assert-True ($script:SnipClipboardState.Hashes.Count -ge 3) ('去重集合已加载（' + $script:SnipClipboardState.Hashes.Count + ' 个 hash）')

# ---------- 9. 删除单条 ----------
$removed = Remove-SnipClipboardRecord -Entry @($entries)[0]
Assert-True ($removed -eq $true) '删除一条记录成功'
$afterDelete = @(Get-SnipClipboardEntries -Days 15)
Assert-True ($afterDelete.Count -eq 2) ('删除后剩 2 条（实际 ' + $afterDelete.Count + '）')
Assert-True (-not $script:SnipClipboardState.Hashes.Contains((Get-SnipHashHex -Text '第二条-带关键词-甲乙丙'))) '删除后去重 hash 一并移除（同内容可重新记录）'

# ---------- 10. 真实剪贴板采集（可选） ----------
if ($IncludeClipboard) {
    $originalText = $null
    try { $originalText = [SnipClipboardRead]::ReadText() } catch { $originalText = $null }
    $originalHadImage = $false
    try { $originalHadImage = [SnipClipboardRead]::HasImage() } catch { }

    $unique = '真实采集-' + [Guid]::NewGuid().ToString('N')
    $writeError = ''
    Assert-True ([SnipClipboardRead]::WriteText($unique, [ref]$writeError)) ('写入测试文本（' + $writeError + '）')
    Initialize-SnipClipboardWatcher -Days 15 -Enabled $true
    $live = @(Get-SnipClipboardEntries -Days 15 | Where-Object { [string]$_.text -eq $unique })
    Assert-True ($live.Count -eq 1) ('启动即采集当前剪贴板（实际 ' + $live.Count + ' 条）')

    # 再复制同一段文字：序列号会变，但 hash 相同，不应新增。
    $beforeCount = @(Get-SnipClipboardEntries -Days 15).Count
    [void][SnipClipboardRead]::WriteText($unique, [ref]$writeError)
    Update-SnipClipboardWatcher
    $afterCount = @(Get-SnipClipboardEntries -Days 15).Count
    Assert-True ($afterCount -eq $beforeCount) ('相同内容不重复记录（前 ' + $beforeCount + ' 后 ' + $afterCount + '）')

    # 换一段新内容：应新增一条。
    $unique2 = '真实采集二-' + [Guid]::NewGuid().ToString('N')
    [void][SnipClipboardRead]::WriteText($unique2, [ref]$writeError)
    Update-SnipClipboardWatcher
    $live2 = @(Get-SnipClipboardEntries -Days 15 | Where-Object { [string]$_.text -eq $unique2 })
    Assert-True ($live2.Count -eq 1) ('新内容被记录（实际 ' + $live2.Count + ' 条）')

    # 图片：走截图工具同款写入路径，再由采集器读回。
    $probe = New-Object System.Drawing.Bitmap(200, 120)
    $probeGraphics = [System.Drawing.Graphics]::FromImage($probe)
    try { $probeGraphics.Clear([System.Drawing.Color]::FromArgb(38, 38, 42)) } finally { $probeGraphics.Dispose() }
    $imageError = ''
    $wrote = Set-SnipClipboardImage -Bitmap $probe
    $probe.Dispose()
    Assert-True ($wrote -eq $true) ('写入剪贴板图片（' + $imageError + '）')
    Update-SnipClipboardWatcher
    $liveImages = @(Get-SnipClipboardEntries -Days 15 | Where-Object { $_.kind -eq 'image' })
    Assert-True ($liveImages.Count -ge 2) ('图片被记录（实际 ' + $liveImages.Count + ' 条）')

    if ($null -ne $originalText -and $originalText -ne '') {
        [void][SnipClipboardRead]::WriteText($originalText, [ref]$writeError)
    } elseif (-not $originalHadImage) {
        [void][SnipClipboardRead]::WriteText('', [ref]$writeError)
    }
    Write-Host '真实剪贴板测试完成（已恢复原文本）'
}

Write-Host ''
Write-Host ('RESULT pass=' + $script:Pass + ' fail=' + $script:Fail)
if ($script:Fail -gt 0) { exit 1 }
exit 0
