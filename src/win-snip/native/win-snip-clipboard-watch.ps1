# win-snip-clipboard-watch.ps1 —— 剪贴板采集层
#
# 为什么用「序列号轮询」而不是剪贴板监听窗口（AddClipboardFormatListener）：
#   助手主循环是手写 PeekMessage 的（见 win-snip-assistant.ps1 里 DoEvents 会吞
#   WM_HOTKEY 的教训），再挂一个剪贴板监听窗口等于在同一个线程里开第二套消息分发，
#   容易和遮罩编辑器的 ShowDialog 互相干扰。GetClipboardSequenceNumber 是纯读取，
#   每次不到 1 微秒，30ms 轮询一次对 CPU 没有可感知影响。
#
# 记录优先级：文件 > 图片 > 文本。
#   资源管理器复制文件时剪贴板同时带路径文本、截图工具复制图片时也常带 URL 文本，
#   如果先读文本，历史里就只剩一串路径，看不出"这是一次文件/图片复制"。

<#
.SYNOPSIS
    编译并加载剪贴板读取类型（SnipClipboardRead）。
.DESCRIPTION
    与 SnipClipboard 一致：无命名空间的静态类不能用 '-as [type]' 判断（每次都会重新编译），
    必须到 AppDomain 里按全名查。.cs 文件由 postbuild 原样复制到 lib/native。
#>
function Initialize-SnipClipboardReadType {
    $existing = [AppDomain]::CurrentDomain.GetAssemblies() |
        ForEach-Object { $_.GetType('SnipClipboardRead', $false) } |
        Where-Object { $null -ne $_ } |
        Select-Object -First 1
    if ($null -ne $existing) { return $true }
    $sourcePath = Join-Path $PSScriptRoot 'win-snip-clipboard-read.cs'
    if (-not (Test-Path $sourcePath)) {
        Write-SnipLog ('剪贴板读取源码缺失：' + $sourcePath)
        return $false
    }
    Add-Type -TypeDefinition ([System.IO.File]::ReadAllText($sourcePath, [System.Text.Encoding]::UTF8)) `
        -ReferencedAssemblies System.Drawing, System.Drawing.Primitives, System.Runtime.InteropServices
    return $true
}

$script:SnipClipboardReadReady = $false
try {
    $script:SnipClipboardReadReady = Initialize-SnipClipboardReadType
} catch {
    Write-SnipLog ('剪贴板读取类型加载失败：' + $_.Exception.Message)
}

<#
.SYNOPSIS
    初始化采集器：建目录、加载去重集合、记录当前剪贴板。
.PARAMETER Days
    保留天数（面板配置，1–90）。
.PARAMETER Enabled
    是否记录；关闭时只初始化状态，不读剪贴板。
#>
function Initialize-SnipClipboardWatcher {
    param(
        [int]$Days = 15,
        [bool]$Enabled = $true
    )
    $script:SnipClipboardState = @{
        Enabled     = $Enabled
        Days        = $Days
        LastSequence = 0
        Hashes      = New-Object 'System.Collections.Generic.HashSet[string]'
        Count       = 0
        LastAt      = $null
        LastCleanup = [DateTime]::MinValue
        LastError   = $null
    }
    if (-not $Enabled) { return }

    Initialize-SnipClipboardStore -Days $Days
    Reset-SnipClipboardIndex
    try {
        # 先对齐当前序列号，再主动记录一次：用户可能刚复制完就启动助手，
        # 此时内容还没被记过，等下一次变化就漏了。
        $script:SnipClipboardState.LastSequence = [SnipClipboardRead]::SequenceNumber()
    } catch {
        $script:SnipClipboardState.LastSequence = 0
    }
    Update-SnipClipboardWatcher -Force
    Write-SnipLog ('剪贴板采集已启动：保留 ' + $Days + ' 天，现有 ' + $script:SnipClipboardState.Count + ' 条')
}

<#
.SYNOPSIS
    重建内存索引（条数与去重集合）；启动和清理过期数据后调用。
#>
function Reset-SnipClipboardIndex {
    if ($null -eq $script:SnipClipboardState) { return }
    if (-not $script:SnipClipboardState.Enabled) { return }
    $days = [int]$script:SnipClipboardState.Days
    $state = $script:SnipClipboardState
    $state.Hashes = Get-SnipClipboardHashes -Days $days
    $state.Count = 0
    $state.LastAt = $null
    foreach ($file in (Get-SnipClipboardDayFiles -Days $days)) {
        # @() 包住：单条记录时函数返回会退化成标量，遍历行为不再可控（同 store 的教训）。
        foreach ($item in @(Read-SnipClipboardDayFile -Path $file.Path)) {
            $state.Count = [int]$state.Count + 1
            if ($null -eq $state.LastAt) { $state.LastAt = [string]$item.at }
        }
    }
    $global:SnipStats.ClipboardItems = [int]$state.Count
    if ($null -ne $state.LastAt) { $global:SnipStats.LastClipboardAt = [string]$state.LastAt }
}

<#
.SYNOPSIS
    采集一轮：剪贴板序列号变了就读内容、去重并落盘。
.DESCRIPTION
    主循环每 30ms 调一次；序列号没变时只做一次 P/Invoke 就返回。
.PARAMETER Force
    忽略序列号，强制读一次（启动时用）。
#>
function Update-SnipClipboardWatcher {
    param([switch]$Force)
    $state = $script:SnipClipboardState
    if ($null -eq $state -or -not $state.Enabled) { return }
    try {
        $sequence = [SnipClipboardRead]::SequenceNumber()
        if (-not $Force -and $sequence -eq $state.LastSequence) { return }
        $state.LastSequence = $sequence

        $entry = Read-SnipClipboardSnapshot
        if ($null -eq $entry) { return }
        if ($state.Hashes.Contains([string]$entry.hash)) { return }

        $saved = Save-SnipClipboardSnapshot -Entry $entry
        if ($null -eq $saved) { return }
        [void]$state.Hashes.Add([string]$entry.hash)
        $state.Count = [int]$state.Count + 1
        $state.LastAt = [string]$entry.at
        $global:SnipStats.ClipboardItems = [int]$state.Count
        $global:SnipStats.LastClipboardAt = [string]$entry.at
        Write-SnipLog ('剪贴板已记录：' + [string]$entry.kind + ' 来源=' + [string]$entry.app)

        # 过期清理按 6 小时节流：每次复制都全量扫目录没有必要。
        if ((Get-Date) - $state.LastCleanup -gt (New-Object System.TimeSpan(6, 0, 0))) {
            $state.LastCleanup = Get-Date
            Remove-SnipClipboardExpired -Days ([int]$state.Days)
            Reset-SnipClipboardIndex
        }
    } catch {
        $state.LastError = '读取剪贴板失败：' + $_.Exception.Message
        # 同一条错误只记一次日志，避免剪贴板长期被占用时日志被刷满。
        if ($global:SnipStats.Error -ne $state.LastError) {
            $global:SnipStats.Error = $state.LastError
            Write-SnipLog $state.LastError
        }
    }
}

<#
.SYNOPSIS
    读取当前剪贴板，返回待落盘的记录（不做去重、不写盘）。
.OUTPUTS
    hashtable：kind / hash / at / text / files / image / width / height / bytes / app
#>
function Read-SnipClipboardSnapshot {
    $at = (Get-Date).ToString('o')

    # 1) 文件列表
    if ([SnipClipboardRead]::HasFiles()) {
        $files = [SnipClipboardRead]::ReadFiles()
        if ($null -ne $files -and $files.Count -gt 0) {
            $text = $null
            if ([SnipClipboardRead]::HasText()) { $text = [SnipClipboardRead]::ReadText() }
            return @{
                kind  = 'files'
                hash  = (Get-SnipHashHex -Text ($files -join "`n"))
                at    = $at
                files = @($files)
                text  = $text
                app   = (Get-SnipClipboardApp)
            }
        }
    }

    # 2) 图片
    if ([SnipClipboardRead]::HasImage()) {
        $imageError = ''
        $bitmap = $null
        $stream = $null
        try {
            $bitmap = [SnipClipboardRead]::ReadImage([ref]$imageError)
            if ($null -ne $bitmap) {
                $stream = New-Object System.IO.MemoryStream
                $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
                $bytes = $stream.ToArray()
                if ($bytes.Length -le $script:SnipClipboardImageMaxBytes) {
                    return @{
                        kind   = 'image'
                        hash   = (Get-SnipHashBytes -Bytes $bytes)
                        at     = $at
                        bytes  = [int64]$bytes.Length
                        width  = [int]$bitmap.Width
                        height = [int]$bitmap.Height
                        data   = $bytes
                        app    = (Get-SnipClipboardApp)
                    }
                }
                Write-SnipLog ('剪贴板图片超过上限（' + $bytes.Length + ' 字节），已跳过')
            } elseif ($imageError -ne '') {
                Write-SnipLog ('读取剪贴板图片失败：' + $imageError)
            }
        } finally {
            if ($null -ne $stream) { $stream.Dispose() }
            if ($null -ne $bitmap) { $bitmap.Dispose() }
        }
    }

    # 3) 文本
    if ([SnipClipboardRead]::HasText()) {
        $text = [SnipClipboardRead]::ReadText()
        # 空文本是「复制了空选区」，记下来只会让历史里多一条空行。
        if ($null -ne $text -and $text -ne '') {
            return @{
                kind = 'text'
                hash = (Get-SnipHashHex -Text $text)
                at   = $at
                text = $text
                app  = (Get-SnipClipboardApp)
            }
        }
    }
    return $null
}

<#
.SYNOPSIS
    把一条记录写进历史（图片先落盘再写 JSONL）。
#>
function Save-SnipClipboardSnapshot {
    param([Parameter(Mandatory = $true)]$Entry)
    $id = [Guid]::NewGuid().ToString('N')
    $root = Get-SnipClipboardRoot
    if ($root -eq '') { return $null }

    $record = @{
        id   = $id
        at   = [string]$Entry.at
        kind = [string]$Entry.kind
        hash = [string]$Entry.hash
        app  = [string]$Entry.app
    }
    if ($Entry.kind -eq 'text') {
        $record['text'] = [string]$Entry.text
    } elseif ($Entry.kind -eq 'image') {
        $imagePath = Join-Path (Join-Path $root 'images') ($id + '.png')
        try {
            Ensure-SnipDir ([System.IO.Path]::GetDirectoryName($imagePath))
            [System.IO.File]::WriteAllBytes($imagePath, [byte[]]$Entry.data)
        } catch {
            Write-SnipLog ('剪贴板图片落盘失败：' + $_.Exception.Message)
            return $null
        }
        $record['image'] = 'images/' + $id + '.png'
        $record['width'] = [int]$Entry.width
        $record['height'] = [int]$Entry.height
        $record['bytes'] = [int64]$Entry.bytes
    } else {
        $record['files'] = @($Entry.files)
        if ($null -ne $Entry.text) { $record['text'] = [string]$Entry.text }
    }
    $saved = Add-SnipClipboardEntry -Entry $record
    if ($null -eq $saved) {
        if ($Entry.kind -eq 'image') {
            try { Remove-Item (Join-Path (Join-Path $root 'images') ($id + '.png')) -Force -ErrorAction SilentlyContinue } catch { }
        }
        return $null
    }
    return $saved
}

<#
.SYNOPSIS
    删除一条历史记录：JSONL 行、图片文件与去重 hash 一起处理。
.DESCRIPTION
    只删行不删图片会让 images/ 慢慢涨；不把 hash 从集合里移除，
    用户删掉一条后再次复制同样内容就永远不会重新出现（看起来像坏掉了）。
#>
function Remove-SnipClipboardRecord {
    param([Parameter(Mandatory = $true)]$Entry)
    $id = [string]$Entry.id
    $hash = [string]$Entry.hash
    if ($id -eq '') { return $false }
    $removed = Remove-SnipClipboardEntry -Id $id
    if ($removed) {
        $root = Get-SnipClipboardRoot
        $rel = [string]$Entry.image
        if ($rel -ne '') {
            try {
                $path = Join-Path $root ($rel -replace '/', [System.IO.Path]::DirectorySeparatorChar)
                if (Test-Path $path) { Remove-Item $path -Force -ErrorAction SilentlyContinue }
            } catch { }
        }
        $state = $script:SnipClipboardState
        if ($null -ne $state) {
            if ($hash -ne '') { [void]$state.Hashes.Remove($hash) }
            if ([int]$state.Count -gt 0) {
                $state.Count = [int]$state.Count - 1
                $global:SnipStats.ClipboardItems = [int]$state.Count
            }
        }
    }
    return $removed
}

<#
.SYNOPSIS
    取剪贴板来源进程名（取不到返回空串）。
#>
function Get-SnipClipboardApp {
    try { return [string][SnipClipboardRead]::OwnerProcessName() } catch { return '' }
}

<#
.SYNOPSIS
    文本 / 路径列表的内容指纹（SHA1 十六进制小写）。
#>
function Get-SnipHashHex {
    param([string]$Text)
    $sha = [System.Security.Cryptography.SHA1]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$Text)
        return ([System.BitConverter]::ToString($sha.ComputeHash($bytes)) -replace '-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

<#
.SYNOPSIS
    字节内容指纹（图片用）。
#>
function Get-SnipHashBytes {
    param([byte[]]$Bytes)
    $sha = [System.Security.Cryptography.SHA1]::Create()
    try {
        return ([System.BitConverter]::ToString($sha.ComputeHash($Bytes)) -replace '-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}
