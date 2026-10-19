# win-snip-clipboard-panel.ps1 —— 剪贴板历史面板
#
# 交互（2026-10-19 引入）：
#   左侧列表（时间倒序）→ 右侧预览 → Enter / 双击复制回剪贴板，Delete 删除，Ctrl+F 搜索，Esc 关闭。
#
# 为什么不只是"看一眼"：
#   辉哥要的是"最近 15 天复制的所有内容"，所以面板里必须能再次复制、能删掉敏感条目，
#   否则历史只会越积越多却用不上。
#
# 为什么面板里还要跑采集定时器：
#   ShowDialog 会占住助手主循环，但对话期间用户仍可能复制东西；
#   面板自带 800ms 定时器继续调 Update-SnipClipboardWatcher，历史不会漏记。
#
# 状态一律放 $script:SnipClipboardPanelState：
#   事件回调触发时函数局部变量可能已经取不到（2026-10-18 钉图窗崩溃的根因）。

<#
.SYNOPSIS
    把 ISO 时间转成列表里好读的短文案。
#>
function Format-SnipClipboardTime {
    param([string]$Iso)
    if ([string]::IsNullOrWhiteSpace($Iso)) { return '' }
    try {
        $dt = [datetime]::Parse($Iso, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind).ToLocalTime()
    } catch {
        return ''
    }
    $today = (Get-Date).Date
    if ($dt.Date -eq $today) { return $dt.ToString('HH:mm') }
    if ($dt.Date -eq $today.AddDays(-1)) { return '昨天 ' + $dt.ToString('HH:mm') }
    return $dt.ToString('MM-dd HH:mm')
}

<#
.SYNOPSIS
    生成列表里的一行摘要（单行、够长可辨认、不撑破布局）。
#>
function Get-SnipClipboardSummary {
    param($Entry)
    $kind = [string]$Entry.kind
    if ($kind -eq 'image') {
        return ('图片 ' + [string]$Entry.width + ' × ' + [string]$Entry.height)
    }
    if ($kind -eq 'files') {
        $files = @($Entry.files)
        $names = @()
        foreach ($path in ($files | Select-Object -First 2)) {
            $names += [System.IO.Path]::GetFileName([string]$path)
        }
        $tail = if ($files.Count -gt 2) { ' 等' } else { '' }
        return ([string]$files.Count + ' 个文件 · ' + ($names -join '、') + $tail)
    }
    $text = [string]$Entry.text
    $oneLine = ($text -replace "`r?`n", ' ').Trim()
    if ($oneLine.Length -gt 80) { $oneLine = $oneLine.Substring(0, 80) + '…' }
    if ($oneLine -eq '') { return '（空白文本）' }
    return $oneLine
}

<#
.SYNOPSIS
    取一条记录的类型中文名。
#>
function Get-SnipClipboardKindLabel {
    param($Entry)
    $kind = [string]$Entry.kind
    if ($kind -eq 'image') { return '图片' }
    if ($kind -eq 'files') { return '文件' }
    return '文本'
}

<#
.SYNOPSIS
    取一条记录的字数/尺寸等补充信息（预览区标题用）。
#>
function Get-SnipClipboardMetaLine {
    param($Entry)
    $parts = @()
    $kindLabel = Get-SnipClipboardKindLabel -Entry $Entry
    $parts += $kindLabel
    $timeText = Format-SnipClipboardTime -Iso ([string]$Entry.at)
    if ($timeText -ne '') { $parts += $timeText }
    $app = [string]$Entry.app
    if ($app -ne '') { $parts += ('来自 ' + $app) }
    if ([string]$Entry.kind -eq 'text') {
        $chars = 0
        if ($null -ne $Entry.chars) { $chars = [int]$Entry.chars } else { $chars = ([string]$Entry.text).Length }
        $parts += ([string]$chars + ' 字')
        if ($Entry.trunc -eq $true) { $parts += '已截断' }
    } elseif ([string]$Entry.kind -eq 'image') {
        $parts += ([string]$Entry.width + ' × ' + [string]$Entry.height)
        if ($null -ne $Entry.bytes) { $parts += ([Math]::Round(([double]$Entry.bytes / 1024), 1).ToString() + ' KB') }
    } elseif ([string]$Entry.kind -eq 'files') {
        $parts += ([string]@($Entry.files).Count + ' 个文件')
    }
    return ($parts -join ' · ')
}

<#
.SYNOPSIS
    弹出剪贴板历史面板。
.PARAMETER Days
    保留天数（面板底部文案与查询范围）。
#>
function Show-SnipClipboardPanel {
    param([int]$Days = 15)

    if (-not $script:SnipClipboardReadReady) {
        [System.Windows.Forms.MessageBox]::Show('剪贴板读取组件未就绪，请查看助手日志。', '剪贴板历史') | Out-Null
        return
    }

    # 两个文件各自编译：C# 的 using 必须位于所有类型声明之前，拼接会撞 CS1529。
    foreach ($pair in @(@('SnipTextView', 'win-snip-textview.cs'), @('SnipListView', 'win-snip-listview.cs'))) {
        if ($pair[0] -as [type]) { continue }
        $p = Join-Path $PSScriptRoot $pair[1]
        if (Test-Path $p) {
            $source = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
            Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition $source
        }
    }

    $state = @{
        Days        = $Days
        Entries     = @()
        Filtered    = @()
        SelectedId  = ''
        Query       = ''
        Suppress    = $false
        Form        = $null
        List        = $null
        Search      = $null
        ListPanel   = $null
        PreviewInfo = $null
        PreviewHost = $null
        PreviewImage = $null
        EmptyLabel  = $null
        Status      = $null
        NoticeUntil = [DateTime]::MinValue
        NoticeText  = ''
        LastCount   = -1
        PreviewView = $null
    }
    $script:SnipClipboardPanelState = $state

    $form = New-SnipDarkForm
    $form.Text = '剪贴板历史'
    $form.Width = 860
    $form.Height = 560
    $form.KeyPreview = $true
    $form.BackColor = (Get-SnipTheme 'Canvas')
    Set-SnipRoundedRegion -Form $form -Radius 12
    Enable-SnipWindowShadow -Form $form
    Add-SnipWindowBorder -Form $form -Radius 12
    $state.Form = $form

    # ---------- 标题栏 ----------
    $title = New-Object System.Windows.Forms.Label
    $title.Text = '剪贴板历史'
    $title.AutoSize = $false
    $title.Location = New-Object System.Drawing.Point(18, 14)
    $title.Size = New-Object System.Drawing.Size(220, 24)
    $title.ForeColor = (Get-SnipTheme 'Text')
    $title.BackColor = $form.BackColor
    $title.Font = New-SnipUiFont -Size 11.5 -Style Bold
    $form.Controls.Add($title)

    $closeButton = New-Object SnipToolButton
    $closeButton.IconId = 'close'
    $closeButton.Text = ''
    $closeButton.Width = 30
    $closeButton.Height = 30
    $closeButton.Location = New-Object System.Drawing.Point(812, 11)
    $closeButton.BackColor = $form.BackColor
    $form.Controls.Add($closeButton)

    # ---------- 搜索框 ----------
    # 原生 TextBox 的边框色改不了（FixedSingle 在深色底上是一条白线），
    # 所以用「无边框输入框 + 自绘描边容器」：观感统一，也不引入额外控件库。
    $searchHint = '搜索内容或来源应用…'
    $searchPanel = New-Object System.Windows.Forms.Panel
    $searchPanel.Location = New-Object System.Drawing.Point(18, 50)
    $searchPanel.Size = New-Object System.Drawing.Size(824, 32)
    $searchPanel.BackColor = (Get-SnipTheme 'Surface')
    $form.Controls.Add($searchPanel)
    $searchPanel.Add_Paint({
            param($sender, $e)
            try {
                $g = $e.Graphics
                $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
                $rect = New-Object System.Drawing.Rectangle(0, 0, ($sender.Width - 1), ($sender.Height - 1))
                $path = New-SnipRoundPath -Bounds $rect -Radius 8
                try {
                    $pen = New-Object System.Drawing.Pen((Get-SnipTheme 'Hairline'), 1)
                    try { $g.DrawPath($pen, $path) } finally { $pen.Dispose() }
                } finally { $path.Dispose() }
            } catch { }
        })
    $searchPanel.Add_Click({ try { $script:SnipClipboardPanelState.Search.Focus() } catch { } })

    $search = New-Object System.Windows.Forms.TextBox
    $search.BorderStyle = [System.Windows.Forms.BorderStyle]::None
    $search.Location = New-Object System.Drawing.Point(12, 7)
    $search.Size = New-Object System.Drawing.Size(800, 20)
    $search.Font = New-SnipUiFont -Size 9.5
    $search.BackColor = (Get-SnipTheme 'Surface')
    $search.ForeColor = (Get-SnipTheme 'Text2')
    $search.Text = $searchHint
    $searchPanel.Controls.Add($search)
    $form.Controls.Add($searchPanel)
    $state.Search = $search
    $state.SearchHint = $searchHint

    # ---------- 左侧列表容器 ----------
    $listPanel = New-Object System.Windows.Forms.Panel
    $listPanel.Location = New-Object System.Drawing.Point(18, 94)
    $listPanel.Size = New-Object System.Drawing.Size(336, 420)
    $listPanel.BackColor = (Get-SnipTheme 'Surface')
    $form.Controls.Add($listPanel)
    $state.ListPanel = $listPanel

    # 自绘列表：没有系统滚动条，行样式与滚动条都由控件自己画。
    $list = New-Object SnipListView
    $list.Dock = [System.Windows.Forms.DockStyle]::Fill
    $list.BackColor = (Get-SnipTheme 'Surface')
    $list.SurfaceColor = (Get-SnipTheme 'Surface')
    $list.RaisedColor = (Get-SnipTheme 'Raised')
    $list.KindColor = (Get-SnipTheme 'Text2')
    $list.KindSelectedColor = (Get-SnipTheme 'Text')
    $list.MainColor = [System.Drawing.Color]::FromArgb(214, 214, 220)
    $list.MainSelectedColor = (Get-SnipTheme 'Text')
    $list.MetaColor = (Get-SnipTheme 'Muted')
    $list.ThumbColor = [System.Drawing.Color]::FromArgb(74, 74, 82)
    $list.ThumbHoverColor = [System.Drawing.Color]::FromArgb(100, 100, 110)
    $list.ThumbActiveColor = [System.Drawing.Color]::FromArgb(124, 124, 136)
    $listPanel.Controls.Add($list)
    $state.List = $list

    # 空状态：列表区正中的引导文案（空态必须给出下一步，不能只写"没有记录"）。
    $emptyLabel = New-Object System.Windows.Forms.Label
    $emptyLabel.Dock = [System.Windows.Forms.DockStyle]::Fill
    $emptyLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
    $emptyLabel.Text = "还没有记录`r`n复制文本、图片或文件后会自动出现在这里（保留最近 $Days 天）"
    $emptyLabel.ForeColor = (Get-SnipTheme 'Muted')
    $emptyLabel.BackColor = (Get-SnipTheme 'Surface')
    $emptyLabel.Font = New-SnipUiFont -Size 9.5
    $emptyLabel.Visible = $false
    $listPanel.Controls.Add($emptyLabel)
    $emptyLabel.BringToFront()
    $state.EmptyLabel = $emptyLabel

    # ---------- 右侧预览 ----------
    $previewPanel = New-Object System.Windows.Forms.Panel
    $previewPanel.Location = New-Object System.Drawing.Point(366, 94)
    $previewPanel.Size = New-Object System.Drawing.Size(476, 420)
    $previewPanel.BackColor = (Get-SnipTheme 'Surface')
    $previewPanel.Padding = New-Object System.Windows.Forms.Padding(14)
    $form.Controls.Add($previewPanel)

    $previewInfo = New-Object System.Windows.Forms.Label
    $previewInfo.Dock = [System.Windows.Forms.DockStyle]::Top
    $previewInfo.Height = 24
    $previewInfo.Text = '选择左侧一条记录查看内容'
    $previewInfo.ForeColor = (Get-SnipTheme 'Muted')
    $previewInfo.BackColor = (Get-SnipTheme 'Surface')
    $previewInfo.Font = New-SnipUiFont -Size 8.5
    $previewPanel.Controls.Add($previewInfo)
    $state.PreviewInfo = $previewInfo

    $previewHost = New-Object System.Windows.Forms.Panel
    $previewHost.Dock = [System.Windows.Forms.DockStyle]::Fill
    $previewHost.BackColor = (Get-SnipTheme 'Surface')
    $previewPanel.Controls.Add($previewHost)
    $state.PreviewHost = $previewHost

    # ---------- 底部操作栏 ----------
    $statusLabel = New-Object System.Windows.Forms.Label
    $statusLabel.AutoSize = $false
    $statusLabel.Location = New-Object System.Drawing.Point(18, 528)
    $statusLabel.Size = New-Object System.Drawing.Size(460, 20)
    $statusLabel.ForeColor = (Get-SnipTheme 'Muted')
    $statusLabel.BackColor = $form.BackColor
    $statusLabel.Font = New-SnipUiFont -Size 8.5
    $statusLabel.Text = ''
    $form.Controls.Add($statusLabel)
    $state.Status = $statusLabel

    # 主操作（复制）用琥珀实心，其余是安静的文字按钮：一屏只有一个地方喊"点我"。
    $copyButton = New-Object SnipToolButton
    $copyButton.IconId = 'copy'
    $copyButton.Text = '复制'
    $copyButton.Active = $true
    $copyButton.Width = 92
    $copyButton.Location = New-Object System.Drawing.Point(648, 522)
    $copyButton.BackColor = $form.BackColor
    $form.Controls.Add($copyButton)

    $deleteButton = New-Object SnipToolButton
    $deleteButton.IconId = 'trash'
    $deleteButton.Text = '删除'
    $deleteButton.Width = 92
    $deleteButton.Location = New-Object System.Drawing.Point(748, 522)
    $deleteButton.BackColor = $form.BackColor
    $form.Controls.Add($deleteButton)

    # 清空历史是破坏性动作，放在底部并用明确文案；早先它挂在搜索框右边、文案只写「清空」，
    # 会被误读成"清空搜索词"，这条路径必须一眼看出作用域。
    $clearButton = New-Object SnipToolButton
    $clearButton.IconId = 'close'
    $clearButton.Text = '清空历史'
    $clearButton.Width = 92
    $clearButton.Location = New-Object System.Drawing.Point(548, 522)
    $clearButton.BackColor = $form.BackColor
    $form.Controls.Add($clearButton)


    # ---------- 行为函数（全部走 $script 状态，避免回调取不到局部变量） ----------

    $updatePreview = {
        param($entry)
        $st = $script:SnipClipboardPanelState
        if ($null -eq $st) { return }
        $hostPanel = $st.PreviewHost
        if ($null -eq $hostPanel) { return }
        # 先释放旧预览（图片必须 Dispose，否则文件句柄会一直被占用）。
        foreach ($child in @($hostPanel.Controls)) {
            try { $hostPanel.Controls.Remove($child); $child.Dispose() } catch { }
        }
        if ($null -ne $st.PreviewImage) {
            try { $st.PreviewImage.Dispose() } catch { }
            $st.PreviewImage = $null
        }
        $st.PreviewView = $null
        if ($null -eq $entry) {
            $st.PreviewInfo.Text = '选择左侧一条记录查看内容'
            $placeholder = New-Object System.Windows.Forms.Label
            $placeholder.Dock = [System.Windows.Forms.DockStyle]::Fill
            $placeholder.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
            $placeholder.Text = '左侧选择一条记录'
            $placeholder.ForeColor = [System.Drawing.Color]::FromArgb(111, 111, 120)
            $placeholder.BackColor = [System.Drawing.Color]::FromArgb(27, 27, 31)
            $placeholder.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9.5)
            $hostPanel.Controls.Add($placeholder)
            return
        }

        $st.PreviewInfo.Text = (Get-SnipClipboardMetaLine -Entry $entry)
        $kind = [string]$entry.kind
        if ($kind -eq 'image') {
            $root = Get-SnipClipboardRoot
            $rel = [string]$entry.image
            $path = Join-Path $root ($rel -replace '/', [System.IO.Path]::DirectorySeparatorChar)
            try {
                if (Test-Path $path) {
                    $bytes = [System.IO.File]::ReadAllBytes($path)
                    $stream = New-Object System.IO.MemoryStream(, $bytes)
                    try {
                        $image = [System.Drawing.Image]::FromStream($stream)
                        $bitmap = New-Object System.Drawing.Bitmap($image)
                        $image.Dispose()
                    } finally {
                        $stream.Dispose()
                    }
                    $st.PreviewImage = $bitmap
                    $picture = New-Object System.Windows.Forms.PictureBox
                    $picture.Dock = [System.Windows.Forms.DockStyle]::Fill
                    $picture.SizeMode = [System.Windows.Forms.PictureBoxSizeMode]::Zoom
                    $picture.BackColor = [System.Drawing.Color]::FromArgb(27, 27, 31)
                    $picture.Image = $bitmap
                    $hostPanel.Controls.Add($picture)
                } else {
                    $missing = New-Object System.Windows.Forms.Label
                    $missing.Dock = [System.Windows.Forms.DockStyle]::Fill
                    $missing.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
                    $missing.Text = '图片文件已被清理'
                    $missing.ForeColor = [System.Drawing.Color]::FromArgb(163, 163, 171)
                    $hostPanel.Controls.Add($missing)
                }
            } catch {
                Write-SnipLog ('剪贴板图片预览失败：' + $_.Exception.Message)
            }
            return
        }

        # 预览用自绘文本视图：自己换行、自己画滚动条，不依赖系统滚动条外观。
        $view = New-Object SnipTextView
        $view.Location = New-Object System.Drawing.Point(0, 0)
        $view.Size = New-Object System.Drawing.Size($hostPanel.ClientSize.Width, $hostPanel.ClientSize.Height)
        $view.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right -bor [System.Windows.Forms.AnchorStyles]::Bottom
        $view.BackColor = (Get-SnipTheme 'Surface')
        $view.TextColor = [System.Drawing.Color]::FromArgb(214, 214, 220)
        $view.ThumbColor = [System.Drawing.Color]::FromArgb(74, 74, 82)
        $view.ThumbHoverColor = [System.Drawing.Color]::FromArgb(100, 100, 110)
        $view.ThumbActiveColor = [System.Drawing.Color]::FromArgb(124, 124, 136)
        if ($kind -eq 'files') {
            $paths = @()
            foreach ($path in @($entry.files)) { $paths += [string]$path }
            $view.SetContent(($paths -join "`r`n"))
        } else {
            $view.SetContent([string]$entry.text)
        }
        $hostPanel.Controls.Add($view)
        $st.PreviewView = $view
    }

    $reload = {
        $st = $script:SnipClipboardPanelState
        if ($null -eq $st) { return }
        $st.Entries = Get-SnipClipboardEntries -Days ([int]$st.Days) -Limit 5000
        $st.LastCount = @($st.Entries).Count
        & $script:SnipClipboardPanelApplyFilter
    }

    $applyFilter = {
        $st = $script:SnipClipboardPanelState
        if ($null -eq $st) { return }
        $query = [string]$st.Query
        $filtered = @()
        if ($query -eq '') {
            $filtered = @($st.Entries)
        } else {
            foreach ($entry in @($st.Entries)) {
                if (Test-SnipClipboardMatch -Entry $entry -Keyword $query) { $filtered += $entry }
            }
        }
        $st.Filtered = $filtered
        $listBox = $st.List
        if ($null -eq $listBox) { return }
        $st.Suppress = $true
        try {
            $kindList = @()
            $summaryList = @()
            $metaList = @()
            foreach ($entry in $filtered) {
                $kindList += (Get-SnipClipboardKindLabel -Entry $entry)
                $summaryList += (Get-SnipClipboardSummary -Entry $entry)
                $metaText = Format-SnipClipboardTime -Iso ([string]$entry.at)
                $app = [string]$entry.app
                if ($app -ne '') { $metaText = $metaText + ' · ' + $app }
                $metaList += $metaText
            }
            $listBox.SetRows([string[]]$kindList, [string[]]$summaryList, [string[]]$metaList)
            $keepId = [string]$st.SelectedId
            $index = -1
            if ($keepId -ne '') {
                for ($i = 0; $i -lt $filtered.Count; $i++) {
                    if ([string]$filtered[$i].id -eq $keepId) { $index = $i; break }
                }
            }
            if ($index -lt 0 -and $filtered.Count -gt 0) { $index = 0 }
            if ($index -ge 0) {
                $listBox.SelectedIndex = $index
                $st.SelectedId = [string]$filtered[$index].id
                & $updatePreview $filtered[$index]
            } else {
                $listBox.SelectedIndex = -1
                $st.SelectedId = ''
                & $updatePreview $null
            }
            if ($null -ne $st.EmptyLabel) {
                if ($filtered.Count -eq 0) {
                    $st.EmptyLabel.Text = if ($query -eq '' -and @($st.Entries).Count -eq 0) {
                        "还没有记录`r`n复制文本、图片或文件后会自动出现在这里（保留最近 $([int]$st.Days) 天）"
                    } else {
                        "没有匹配「$query」的记录`r`n换个关键词试试，或按 Esc 关闭面板"
                    }
                    $st.EmptyLabel.Visible = $true
                    $st.EmptyLabel.BringToFront()
                } else {
                    $st.EmptyLabel.Visible = $false
                }
            }
        } finally {
            $st.Suppress = $false
        }
    }
    $script:SnipClipboardPanelApplyFilter = $applyFilter
    $script:SnipClipboardPanelReload = $reload
    $script:SnipClipboardPanelUpdatePreview = $updatePreview

    $updateStatus = {
        $st = $script:SnipClipboardPanelState
        if ($null -eq $st -or $null -eq $st.Status) { return }
        if ((Get-Date) -lt $st.NoticeUntil) {
            $st.Status.Text = $st.NoticeText
            return
        }
        $count = @($st.Entries).Count
        $shown = @($st.Filtered).Count
        if ([string]$st.Query -ne '') {
            $st.Status.Text = ('匹配 ' + $shown + ' 条 · 共 ' + $count + ' 条 · 保留最近 ' + [int]$st.Days + ' 天')
        } else {
            $st.Status.Text = ('共 ' + $count + ' 条 · 保留最近 ' + [int]$st.Days + ' 天 · 本地存储，不上传')
        }
    }
    $script:SnipClipboardPanelUpdateStatus = $updateStatus

    $copySelected = {
        $st = $script:SnipClipboardPanelState
        if ($null -eq $st) { return }
        $index = -1
        if ($null -ne $st.List) { $index = $st.List.SelectedIndex }
        if ($index -lt 0 -or $index -ge @($st.Filtered).Count) {
            $st.NoticeText = '先选一条记录再复制'
            $st.NoticeUntil = (Get-Date).AddSeconds(2)
            & $script:SnipClipboardPanelUpdateStatus
            return
        }
        $entry = @($st.Filtered)[$index]
        $kind = [string]$entry.kind
        $errorText = ''
        $ok = $false
        try {
            if ($kind -eq 'image') {
                $root = Get-SnipClipboardRoot
                $path = Join-Path $root (([string]$entry.image) -replace '/', [System.IO.Path]::DirectorySeparatorChar)
                $bytes = [System.IO.File]::ReadAllBytes($path)
                $stream = New-Object System.IO.MemoryStream(, $bytes)
                try {
                    $image = [System.Drawing.Image]::FromStream($stream)
                    $bitmap = New-Object System.Drawing.Bitmap($image)
                    $image.Dispose()
                } finally {
                    $stream.Dispose()
                }
                try {
                    $ok = Set-SnipClipboardImage -Bitmap $bitmap
                    if (-not $ok) { $errorText = '剪贴板可能被其它程序占用' }
                } finally {
                    $bitmap.Dispose()
                }
            } elseif ($kind -eq 'files' -and @($entry.files).Count -gt 0) {
                $ok = [SnipClipboardRead]::WriteFiles([string[]]@($entry.files), [ref]$errorText)
            } else {
                $ok = [SnipClipboardRead]::WriteText([string]$entry.text, [ref]$errorText)
            }
        } catch {
            $ok = $false
            $errorText = $_.Exception.Message
        }
        if ($ok) {
            $st.NoticeText = '已复制到剪贴板'
        } else {
            $st.NoticeText = '复制失败：' + $(if ($errorText -eq '') { '未知原因' } else { $errorText })
        }
        $st.NoticeUntil = (Get-Date).AddSeconds(2)
        & $script:SnipClipboardPanelUpdateStatus
    }
    $script:SnipClipboardPanelCopySelected = $copySelected

    $deleteSelected = {
        $st = $script:SnipClipboardPanelState
        if ($null -eq $st) { return }
        $index = -1
        if ($null -ne $st.List) { $index = $st.List.SelectedIndex }
        if ($index -lt 0 -or $index -ge @($st.Filtered).Count) { return }
        $entry = @($st.Filtered)[$index]
        $ok = Remove-SnipClipboardRecord -Entry $entry
        $st.NoticeText = if ($ok) { '已删除这一条' } else { '删除失败：记录可能已被清理' }
        $st.NoticeUntil = (Get-Date).AddSeconds(2)
        & $script:SnipClipboardPanelReload
        # 删完落到相邻一条，而不是跳回顶部。
        if ($null -ne $st.List -and @($st.Filtered).Count -gt 0) {
            $next = [Math]::Min($index, @($st.Filtered).Count - 1)
            $st.List.SelectedIndex = $next
        }
        & $script:SnipClipboardPanelUpdateStatus
    }
    $script:SnipClipboardPanelDeleteSelected = $deleteSelected

    # ---------- 事件 ----------
    $list.Add_SelectedIndexChanged({
            try {
                $st = $script:SnipClipboardPanelState
                if ($null -eq $st -or $st.Suppress) { return }
                $index = $st.List.SelectedIndex
                $filtered = @($st.Filtered)
                if ($index -lt 0 -or $index -ge $filtered.Count) { return }
                $st.SelectedId = [string]$filtered[$index].id
                & $script:SnipClipboardPanelUpdatePreview $filtered[$index]
            } catch {
                Write-SnipLog ('剪贴板选中项处理失败：' + $_.Exception.Message)
            }
        })

    $list.Add_KeyDown({
            param($sender, $e)
            try {
                if ($e.KeyCode -eq [System.Windows.Forms.Keys]::Enter) { & $script:SnipClipboardPanelCopySelected; $e.Handled = $true }
                if ($e.KeyCode -eq [System.Windows.Forms.Keys]::Delete) { & $script:SnipClipboardPanelDeleteSelected; $e.Handled = $true }
            } catch { }
        })

    $list.Add_DoubleClick({ try { & $script:SnipClipboardPanelCopySelected } catch { } })

    $search.Add_Enter({
            try {
                $st = $script:SnipClipboardPanelState
                if ($null -ne $st -and $st.Search.Text -eq $st.SearchHint) {
                    $st.Search.Text = ''
                    $st.Search.ForeColor = [System.Drawing.Color]::FromArgb(239, 239, 241)
                }
            } catch { }
        })
    $search.Add_Leave({
            try {
                $st = $script:SnipClipboardPanelState
                if ($null -ne $st -and $st.Search.Text -eq '') {
                    $st.Search.Text = $st.SearchHint
                    $st.Search.ForeColor = [System.Drawing.Color]::FromArgb(163, 163, 171)
                }
            } catch { }
        })
    $search.Add_TextChanged({
            try {
                $st = $script:SnipClipboardPanelState
                if ($null -eq $st) { return }
                if ($st.Search.Text -eq $st.SearchHint) { $st.Query = '' } else { $st.Query = $st.Search.Text.Trim() }
                & $script:SnipClipboardPanelApplyFilter
                & $script:SnipClipboardPanelUpdateStatus
            } catch { }
        })
    $search.Add_KeyDown({
            param($sender, $e)
            try {
                if ($e.KeyCode -eq [System.Windows.Forms.Keys]::Down) {
                    if (@($script:SnipClipboardPanelState.Filtered).Count -gt 0) { $script:SnipClipboardPanelState.List.Focus(); $e.Handled = $true }
                }
                if ($e.KeyCode -eq [System.Windows.Forms.Keys]::Enter) { & $script:SnipClipboardPanelCopySelected; $e.Handled = $true }
                if ($e.KeyCode -eq [System.Windows.Forms.Keys]::Escape) { $script:SnipClipboardPanelState.Form.Close(); $e.Handled = $true }
            } catch { }
        })

    $copyButton.Add_Click({ try { & $script:SnipClipboardPanelCopySelected } catch { } })
    $deleteButton.Add_Click({ try { & $script:SnipClipboardPanelDeleteSelected } catch { } })
    $closeButton.Add_Click({ try { $script:SnipClipboardPanelState.Form.Close() } catch { } })
    $clearButton.Add_Click({
            try {
                $st = $script:SnipClipboardPanelState
                if ($null -eq $st) { return }
                # 清空是破坏性动作，必须二次确认；历史里可能有用户还没来得及取走的内容。
                $answer = [System.Windows.Forms.MessageBox]::Show(
                    '确定清空最近 ' + [int]$st.Days + ' 天的全部剪贴板历史吗？此操作不可撤销。',
                    '清空剪贴板历史',
                    [System.Windows.Forms.MessageBoxButtons]::YesNo,
                    [System.Windows.Forms.MessageBoxIcon]::Warning)
                if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { return }
                Clear-SnipClipboardHistory
                Reset-SnipClipboardIndex
                & $script:SnipClipboardPanelReload
                $st.NoticeText = '已清空历史'
                $st.NoticeUntil = (Get-Date).AddSeconds(2)
                & $script:SnipClipboardPanelUpdateStatus
            } catch {
                Write-SnipLog ('清空剪贴板历史失败：' + $_.Exception.Message)
            }
        })

    $form.Add_KeyDown({
            param($sender, $e)
            try {
                if ($e.KeyCode -eq [System.Windows.Forms.Keys]::Escape) { $sender.Close(); return }
                if ($e.Control -and $e.KeyCode -eq [System.Windows.Forms.Keys]::F) {
                    $script:SnipClipboardPanelState.Search.Focus()
                    $script:SnipClipboardPanelState.Search.SelectAll()
                    $e.Handled = $true
                    return
                }
                if ($e.KeyCode -eq [System.Windows.Forms.Keys]::F5) {
                & $script:SnipClipboardPanelReload
                    $e.Handled = $true
                }
            } catch { }
        })

    # 标题栏拖动：无边框窗口不给拖动的话只能点关闭，位置也没法挪。
    $drag = @{ Active = $false; Offset = [System.Drawing.Point]::Empty }
    $script:SnipClipboardPanelDrag = $drag
    $beginDrag = {
        param($sender, $e)
        try {
            if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
                $script:SnipClipboardPanelDrag.Active = $true
                $script:SnipClipboardPanelDrag.Offset = $e.Location
                $script:SnipClipboardPanelState.Form.Activate()
            }
        } catch { }
    }
    $moveDrag = {
        param($sender, $e)
        try {
            $d = $script:SnipClipboardPanelDrag
            if (-not $d.Active) { return }
            $point = $script:SnipClipboardPanelState.Form.PointToScreen($e.Location)
            $script:SnipClipboardPanelState.Form.Location = New-Object System.Drawing.Point(($point.X - $d.Offset.X), ($point.Y - $d.Offset.Y))
        } catch { }
    }
    $endDrag = { try { $script:SnipClipboardPanelDrag.Active = $false } catch { } }
    $form.Add_MouseDown($beginDrag)
    $form.Add_MouseMove($moveDrag)
    $form.Add_MouseUp($endDrag)
    $title.Add_MouseDown($beginDrag)
    $title.Add_MouseMove($moveDrag)
    $title.Add_MouseUp($endDrag)

    # 采集定时器：面板打开期间继续记录新复制的内容，数量变化就刷新列表。
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 800
    $timer.Add_Tick({
            try {
                $st = $script:SnipClipboardPanelState
                if ($null -eq $st) { return }
                Update-SnipClipboardWatcher
                $watcher = $script:SnipClipboardState
                if ($null -ne $watcher -and [int]$watcher.Count -ne [int]$st.LastCount) {
                & $script:SnipClipboardPanelReload
                }
                & $script:SnipClipboardPanelUpdateStatus
            } catch { }
        })
    $script:SnipClipboardPanelTimer = $timer

    # 居中并显示。
    $work = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position).WorkingArea
    $x = $work.X + [int](($work.Width - $form.Width) / 2)
    $y = $work.Y + [int](($work.Height - $form.Height) / 2)
    $form.Location = New-Object System.Drawing.Point([Math]::Max($work.Left, $x), [Math]::Max($work.Top, $y))

    $form.Add_Shown({
            try {
                & $script:SnipClipboardPanelReload
                & $script:SnipClipboardPanelUpdateStatus
                $script:SnipClipboardPanelTimer.Start()
                if (@($script:SnipClipboardPanelState.Filtered).Count -gt 0) {
                    $script:SnipClipboardPanelState.List.Focus()
                } else {
                    $script:SnipClipboardPanelState.Search.Focus()
                }
            } catch {
                Write-SnipLog ('剪贴板面板初始化失败：' + $_.Exception.Message)
            }
        })
    $form.Add_FormClosed({
            try {
                $timer = $script:SnipClipboardPanelTimer
                if ($null -ne $timer) { $timer.Stop(); $timer.Dispose() }
            } catch { }
        })

    [void]$form.ShowDialog()

    # 收尾：释放预览图与状态引用，避免下次打开带着旧对象。
    try {
        $st = $script:SnipClipboardPanelState
        if ($null -ne $st -and $null -ne $st.PreviewImage) { $st.PreviewImage.Dispose() }
    } catch { }
    $script:SnipClipboardPanelState = $null
    $script:SnipClipboardPanelApplyFilter = $null
    $script:SnipClipboardPanelReload = $null
    $script:SnipClipboardPanelUpdatePreview = $null
    $script:SnipClipboardPanelUpdateStatus = $null
    $script:SnipClipboardPanelCopySelected = $null
    $script:SnipClipboardPanelDeleteSelected = $null
    $script:SnipClipboardPanelTimer = $null
    $script:SnipClipboardPanelDrag = $null
    $form.Dispose()
    Write-SnipLog '剪贴板历史面板已关闭'
}