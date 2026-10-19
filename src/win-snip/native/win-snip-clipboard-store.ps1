# win-snip-clipboard-store.ps1 —— 剪贴板历史存储层
#
# 设计取舍：
#   1) 一天一个 JSONL 文件（clipboard/days/yyyy-MM-dd.jsonl）：追加写只做一次 AppendAllText，
#      不需要读改写整个历史；查询时按日期文件从新到旧读，够快也能按天清理。
#   2) 图片单独落盘（clipboard/images/<id>.png），JSONL 里只存相对文件名：
#      整屏截图动辄几 MB，塞进 JSONL 会让读取和搜索都变慢。
#   3) 去重靠内容 hash（由采集层维护）：复制同一段文字两次只留第一条，
#      也顺便挡掉「从历史面板复制回剪贴板」造成的自我叠加。
#   4) 所有函数都不抛异常给主循环：存储坏了只在日志里记一笔，剪贴板工具照常用。
#
# 目录（均在 $global:SnipStats.BaseDir 下，随隔离 HOME 实例互不干扰）：
#   clipboard/days/2026-10-19.jsonl
#   clipboard/images/<id>.png

# 单条文本最多存 20 万字符：再长的内容展示与复制都没有意义，但要保留原长度给界面提示。
$script:SnipClipboardTextLimit = 200000
# 单条文件列表最多留 200 个路径（资源管理器一次复制整个文件夹时可能上千个）。
$script:SnipClipboardFileLimit = 200
# 单张图片上限 16MB：超过基本是超大截图或设计稿，存下来只会拖慢历史面板。
$script:SnipClipboardImageMaxBytes = 16 * 1024 * 1024

<#
.SYNOPSIS
    取剪贴板历史根目录；助手没初始化 BaseDir 时返回空串。
#>
function Get-SnipClipboardRoot {
    $baseDir = [string]$global:SnipStats.BaseDir
    if ($baseDir -eq '') { return '' }
    return (Join-Path $baseDir 'clipboard')
}

<#
.SYNOPSIS
    确保历史目录存在，并按保留天数清掉过期数据。
#>
function Initialize-SnipClipboardStore {
    param([int]$Days = 15)
    $root = Get-SnipClipboardRoot
    if ($root -eq '') { return }
    Ensure-SnipDir $root
    Ensure-SnipDir (Join-Path $root 'days')
    Ensure-SnipDir (Join-Path $root 'images')
    $script:SnipClipboardKeepDays = $Days
    Remove-SnipClipboardExpired -Days $Days
}

<#
.SYNOPSIS
    某一天的记录文件路径。
#>
function Get-SnipClipboardDayPath {
    param([Parameter(Mandatory = $true)][datetime]$Date)
    $root = Get-SnipClipboardRoot
    if ($root -eq '') { return '' }
    return (Join-Path (Join-Path $root 'days') ($Date.ToString('yyyy-MM-dd') + '.jsonl'))
}

<#
.SYNOPSIS
    列出保留范围内（从旧到新）的日期文件。
#>
function Get-SnipClipboardDayFiles {
    param([int]$Days = 15)
    $root = Get-SnipClipboardRoot
    $dir = Join-Path $root 'days'
    if (-not (Test-Path $dir)) { return @() }
    $cutoff = (Get-Date).Date.AddDays(-1 * [Math]::Max(0, $Days - 1))
    $files = @()
    foreach ($file in (Get-ChildItem -Path $dir -Filter '*.jsonl' -File -ErrorAction SilentlyContinue)) {
        $name = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
        $date = [datetime]::MinValue
        if (-not [datetime]::TryParseExact($name, 'yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::None, [ref]$date)) { continue }
        if ($date.Date -lt $cutoff) { continue }
        $files += [pscustomobject]@{ Date = $date.Date; Path = $file.FullName }
    }
    # 关键：读取顺序必须是最新在前（剪贴板历史先看最近复制的东西）。
    return @($files | Sort-Object -Property Date -Descending)
}

<#
.SYNOPSIS
    把一行 JSON 解析成记录对象；坏行返回 $null（历史文件可能被手工改坏，不能因此中断读取）。
#>
function ConvertFrom-SnipClipboardLine {
    param([string]$Line)
    if ([string]::IsNullOrWhiteSpace($Line)) { return $null }
    try {
        $obj = $Line | ConvertFrom-Json -ErrorAction Stop
        if ($null -eq $obj -or [string]$obj.id -eq '') { return $null }
        return $obj
    } catch {
        return $null
    }
}

<#
.SYNOPSIS
    读取一个日期文件里的全部记录（按文件内顺序，即写入顺序）。
.DESCRIPTION
    批量解析：把一个文件的若干行拼成一个 JSON 数组一次 ConvertFrom-Json，
    比逐行 ConvertFrom-Json 快一个数量级（实测 2000 行：批量约 60ms，逐行约 2s）。
    批量失败（文件被并发写截断）时回退逐行，保证仍能读出能读的那部分。
#>
function Read-SnipClipboardDayFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path $Path)) { return @() }
    try {
        $lines = @([System.IO.File]::ReadAllLines($Path, [System.Text.Encoding]::UTF8) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    } catch {
        return @()
    }
    if ($lines.Count -eq 0) { return @() }
    try {
        $json = '[' + ($lines -join ',') + ']'
        $items = $json | ConvertFrom-Json -ErrorAction Stop
        if ($null -eq $items) { return @() }
        return @($items)
    } catch {
        $result = @()
        foreach ($line in $lines) {
            $one = ConvertFrom-SnipClipboardLine -Line $line
            if ($null -ne $one) { $result += $one }
        }
        return @($result)
    }
}

<#
.SYNOPSIS
    查询最近若干天的记录（最新在前）。
.PARAMETER Days
    保留天数。
.PARAMETER Limit
    最多返回多少条；0 表示不限制。
.PARAMETER Query
    关键词过滤（大小写不敏感，匹配文本内容 / 文件名 / 来源应用）。
#>
function Get-SnipClipboardEntries {
    param(
        [int]$Days = 15,
        [int]$Limit = 5000,
        [string]$Query = ''
    )
    $files = Get-SnipClipboardDayFiles -Days $Days
    $result = New-Object System.Collections.ArrayList
    $keyword = $Query.Trim()
    foreach ($file in $files) {
        # 必须用 @() 包住：函数只返回一个对象时 PowerShell 会把它展开成标量，
        # 标量再按 [$i] 索引取不到（自测 2026-10-19 实测：只有 1 条记录时读回 0 条）。
        $items = @(Read-SnipClipboardDayFile -Path $file.Path)
        # 文件内是追加顺序（旧→新），倒序后才是"最近复制在前"。
        for ($i = $items.Count - 1; $i -ge 0; $i--) {
            $item = $items[$i]
            if ($null -eq $item) { continue }
            if ($keyword -ne '' -and -not (Test-SnipClipboardMatch -Entry $item -Keyword $keyword)) { continue }
            [void]$result.Add($item)
            if ($Limit -gt 0 -and $result.Count -ge $Limit) { break }
        }
        if ($Limit -gt 0 -and $result.Count -ge $Limit) { break }
    }
    # 统一按时间倒序：正常运行时文件内顺序等于时间顺序，但补写/导入/时钟回拨会造成乱序，
    # 列表必须永远是"最近复制的在前"。
    return @($result | Sort-Object -Property at -Descending)
}

<#
.SYNOPSIS
    判断一条记录是否命中搜索词。
#>
function Test-SnipClipboardMatch {
    param($Entry, [string]$Keyword)
    $kind = [string]$Entry.kind
    if ($kind -eq 'text') {
        if (([string]$Entry.text).IndexOf($Keyword, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
    } elseif ($kind -eq 'files') {
        foreach ($path in @($Entry.files)) {
            if (([string]$path).IndexOf($Keyword, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
        }
        if (([string]$Entry.text).IndexOf($Keyword, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
    } elseif ($kind -eq 'image') {
        if (([string]$Entry.width + 'x' + [string]$Entry.height).IndexOf($Keyword, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
    }
    if (([string]$Entry.app).IndexOf($Keyword, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
    return $false
}

<#
.SYNOPSIS
    追加一条记录到当天的 JSONL。
.DESCRIPTION
    调用方负责填好 id / at / kind / hash 等字段；这里只兜底类型与长度，
    并把图片相对路径按当天文件所在根目录换算。
#>
function Add-SnipClipboardEntry {
    param([Parameter(Mandatory = $true)]$Entry)

    $root = Get-SnipClipboardRoot
    if ($root -eq '') { return $null }
    $path = Get-SnipClipboardDayPath -Date (Get-Date)
    if ($path -eq '') { return $null }

    $kind = [string]$Entry.kind
    if ($kind -ne 'text' -and $kind -ne 'image' -and $kind -ne 'files') { $kind = 'text' }

    $payload = [ordered]@{
        id   = [string]$Entry.id
        at   = [string]$Entry.at
        kind = $kind
        hash = [string]$Entry.hash
    }
    if ($kind -eq 'text') {
        $text = [string]$Entry.text
        $chars = $text.Length
        if ($chars -gt $script:SnipClipboardTextLimit) {
            $text = $text.Substring(0, $script:SnipClipboardTextLimit)
            $payload['trunc'] = $true
        }
        $payload['text'] = $text
        $payload['chars'] = $chars
    } elseif ($kind -eq 'image') {
        $payload['image'] = [string]$Entry.image
        $payload['width'] = [int]$Entry.width
        $payload['height'] = [int]$Entry.height
        if ($null -ne $Entry.bytes) { $payload['bytes'] = [int64]$Entry.bytes }
    } else {
        $files = @($Entry.files | Select-Object -First $script:SnipClipboardFileLimit)
        $payload['files'] = @($files)
        # 文件复制常常同时带一份文本路径，存下来便于搜索与直接复制路径。
        if ($null -ne $Entry.text -and [string]$Entry.text -ne '') {
            $payload['text'] = ([string]$Entry.text).Substring(0, [Math]::Min(2000, ([string]$Entry.text).Length))
        }
    }
    if ($null -ne $Entry.app -and [string]$Entry.app -ne '') { $payload['app'] = [string]$Entry.app }

    try {
        Ensure-SnipDir ([System.IO.Path]::GetDirectoryName($path))
        $json = ($payload | ConvertTo-Json -Compress -Depth 5)
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::AppendAllText($path, $json + [Environment]::NewLine, $utf8)
        return $payload
    } catch {
        Write-SnipLog ('剪贴板记录写入失败：' + $_.Exception.Message)
        return $null
    }
}

<#
.SYNOPSIS
    删除一条记录（按 id 重写所属日期文件）。
#>
function Remove-SnipClipboardEntry {
    param([Parameter(Mandatory = $true)][string]$Id)
    $root = Get-SnipClipboardRoot
    if ($root -eq '') { return $false }
    $removed = $false
    foreach ($file in (Get-ChildItem -Path (Join-Path $root 'days') -Filter '*.jsonl' -File -ErrorAction SilentlyContinue)) {
        try {
            $lines = @([System.IO.File]::ReadAllLines($file.FullName, [System.Text.Encoding]::UTF8))
        } catch { continue }
        $kept = New-Object System.Collections.ArrayList
        $hit = $false
        foreach ($line in $lines) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            $obj = ConvertFrom-SnipClipboardLine -Line $line
            if ($null -ne $obj -and [string]$obj.id -eq $Id) { $hit = $true; continue }
            [void]$kept.Add($line)
        }
        if (-not $hit) { continue }
        try {
            $utf8 = New-Object System.Text.UTF8Encoding($false)
            [System.IO.File]::WriteAllText($file.FullName, (($kept -join [Environment]::NewLine) + [Environment]::NewLine), $utf8)
            $removed = $true
        } catch {
            Write-SnipLog ('剪贴板记录删除失败：' + $_.Exception.Message)
        }
    }
    return $removed
}

<#
.SYNOPSIS
    清空保留范围内的全部历史（含图片文件）。
#>
function Clear-SnipClipboardHistory {
    $root = Get-SnipClipboardRoot
    if ($root -eq '') { return }
    try {
        foreach ($file in (Get-ChildItem -Path (Join-Path $root 'days') -Filter '*.jsonl' -File -ErrorAction SilentlyContinue)) {
            Remove-Item $file.FullName -Force -ErrorAction SilentlyContinue
        }
        foreach ($file in (Get-ChildItem -Path (Join-Path $root 'images') -File -ErrorAction SilentlyContinue)) {
            Remove-Item $file.FullName -Force -ErrorAction SilentlyContinue
        }
        Write-SnipLog '已清空剪贴板历史'
    } catch {
        Write-SnipLog ('清空剪贴板历史失败：' + $_.Exception.Message)
    }
}

<#
.SYNOPSIS
    清理过期数据：超过保留天数的日期文件，以及不再被任何保留记录引用的图片。
.DESCRIPTION
    图片清理必须按"保留记录里引用到的文件名"做集合比对：
    只按日期删图片文件会误删仍被保留记录引用的图（跨天复制、跨天打开面板都会遇到）。
#>
function Remove-SnipClipboardExpired {
    param([int]$Days = 15)
    $root = Get-SnipClipboardRoot
    if ($root -eq '') { return }
    $daysDir = Join-Path $root 'days'
    $imagesDir = Join-Path $root 'images'
    $cutoff = (Get-Date).Date.AddDays(-1 * [Math]::Max(0, $Days - 1))
    try {
        foreach ($file in (Get-ChildItem -Path $daysDir -Filter '*.jsonl' -File -ErrorAction SilentlyContinue)) {
            $name = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
            $date = [datetime]::MinValue
            if (-not [datetime]::TryParseExact($name, 'yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::None, [ref]$date)) {
                continue
            }
            if ($date.Date -ge $cutoff) { continue }
            Remove-Item $file.FullName -Force -ErrorAction SilentlyContinue
            Write-SnipLog ('剪贴板历史过期文件已删除：' + $file.Name)
        }

        # 收集保留记录引用到的图片文件名。
        $keep = New-Object 'System.Collections.Generic.HashSet[string]'
        foreach ($file in (Get-ChildItem -Path $daysDir -Filter '*.jsonl' -File -ErrorAction SilentlyContinue)) {
            foreach ($item in @(Read-SnipClipboardDayFile -Path $file.FullName)) {
                $rel = [string]$item.image
                if ($rel -ne '') { [void]$keep.Add([System.IO.Path]::GetFileName($rel)) }
            }
        }
        foreach ($file in (Get-ChildItem -Path $imagesDir -File -ErrorAction SilentlyContinue)) {
            if (-not $keep.Contains($file.Name)) {
                Remove-Item $file.FullName -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {
        Write-SnipLog ('剪贴板历史清理失败：' + $_.Exception.Message)
    }
}

<#
.SYNOPSIS
    统计保留范围内的条数与最近一次记录时间。
#>
function Get-SnipClipboardStats {
    param([int]$Days = 15)
    $items = @(Get-SnipClipboardEntries -Days $Days -Limit 0)
    $last = $null
    if ($items.Count -gt 0) { $last = [string]$items[0].at }
    return @{ Items = [int]$items.Count; LastAt = $last }
}

<#
.SYNOPSIS
    读取保留范围内全部记录的内容 hash（供采集层启动时建去重集合）。
#>
function Get-SnipClipboardHashes {
    param([int]$Days = 15)
    $set = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($file in (Get-SnipClipboardDayFiles -Days $Days)) {
        foreach ($item in @(Read-SnipClipboardDayFile -Path $file.Path)) {
            $hash = [string]$item.hash
            if ($hash -ne '') { [void]$set.Add($hash) }
        }
    }
    # 前置逗号让 PowerShell 原样返回 HashSet：不包的话它会把集合展开成 object[]，
    # 赋值给 state.Hashes 后变成定长数组，Remove 会抛 "Collection was of a fixed size"。
    return ,$set
}
