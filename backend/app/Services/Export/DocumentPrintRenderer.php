<?php

namespace App\Services\Export;

/**
 * Single-document print view (NPBG/PPB/PO/RI) for pre-printed stationery —
 * 1. Dashboard Input Data\Template\*.frf (FastReport forms exported from
 * Accurate; a proprietary binary format, not renderable directly, but every
 * component's name, exact Left/Top/Width/Height — in 1/96" units, confirmed
 * by cross-checking band widths against the page's own declared mm size —
 * and nearby label text were extracted byte-by-byte and hardcoded into each
 * controller's print() method).
 *
 * One HTML document, one `@media print` rule — not two separately-rendered
 * documents (brief: "jangan membuat dua layout yang dikelola secara manual
 * secara terpisah"). On screen (and anywhere @media print doesn't apply) every
 * element renders: logo, company letterhead, box borders, every static label,
 * the item table's header row, signature action/role labels and their lines —
 * so opening the page looks exactly like the real print preview. The moment
 * the browser actually prints (window.print(), the print dialog's own preview
 * pane, or Ctrl+P) — `@media print` kicks in and every element carrying the
 * `.static` class disappears, leaving ONLY the transaction data, at the exact
 * same coordinates — because the physical paper this prints onto already has
 * the logo/labels/lines pre-printed; printing them again would double them up.
 *
 * offsetXMm/offsetYMm: a global nudge applied to every positioned element, for
 * printer/tray calibration without touching the underlying layout or any
 * transaction data (brief: "kalibrasi ... dapat diuji tanpa mengubah data
 * transaksi").
 *
 * No auto-print script of any kind is emitted — not an inline one in this
 * document, not one the caller runs against a reference to this window.
 * Both were tried and both reliably force-closed Chrome on this printer setup
 * (custom 210×147mm page, zero margin). The user presses Ctrl+P themselves
 * once the tab is open; that's the only variant that didn't crash.
 */
class DocumentPrintRenderer
{
    private function logoDataUri(): ?string
    {
        $path = public_path('logo.png');

        return is_file($path) ? 'data:image/png;base64,'.base64_encode(file_get_contents($path)) : null;
    }

    public const A4_MARGIN_MM = 0;

    /** Plain paper: the item table always has this many rows (more only when there are more items). */
    public const FIXED_ROWS = 15;

    /**
     * The fixed-size item table of a full print. $grow (A4): FIXED_ROWS rows, whatever sits below the
     * table moves down and the page grows to hold it; otherwise the rows that fit above what sits below.
     *
     * @return int the table's body rows
     */
    private static function fixTable(float &$pageHeightMm, array &$texts, array $table, int $count, ?array &$signatures, bool $grow): int
    {
        $rh = $table['rowHeight'];
        $body = $table['y'] + $rh;
        $below = array_values(array_filter(array_column($texts, 'y'), fn ($y) => $y > $table['y']));
        if ($signatures) {
            $below[] = $signatures['y'];
        }
        $limit = $below ? min($below) - 1 : $pageHeightMm - 5;
        if (! $grow) {
            return max(1, (int) floor(($limit - $body) / $rh));
        }
        $rows = max(self::FIXED_ROWS, $count);
        $delta = round(max(0, $rows * $rh + 2 - ($limit - $body)), 2);
        $bottom = $body + $rows * $rh;
        foreach ($texts as &$t) {
            if ($t['y'] > $table['y']) {
                $t['y'] += $delta;
            }
            $bottom = max($bottom, $t['y'] + ($t['h'] ?? 5));
        }
        unset($t);
        if ($signatures) {
            $signatures['lineY'] = ($signatures['lineY'] ?? ($signatures['y'] + 15)) + $delta;
            $signatures['roleY'] = ($signatures['roleY'] ?? ($signatures['y'] + 15.5)) + $delta;
            $signatures['y'] += $delta;
            $bottom = max($bottom, $signatures['roleY'] + 5);
        }
        $pageHeightMm = max($pageHeightMm, round($bottom + 5, 1));

        return $rows;
    }

    /** @return array{0: array{w: float, h: float, orientation: string}, 1: float} the A4 portrait sheet and the scale of the page on it (top-aligned) */
    public static function a4Fit(float $widthMm, float $heightMm): array
    {
        $sheet = ['w' => 210.0, 'h' => 297.0, 'orientation' => 'portrait'];
        $m = 2 * self::A4_MARGIN_MM;

        // the template's own size (100%), smaller only when it would not fit the sheet
        return [$sheet, round(min(1, ($sheet['w'] - $m) / $widthMm, ($sheet['h'] - $m) / $heightMm), 4)];
    }

    /** CSS @page size: a standard sheet name when the page is (within 2mm) A4/A5, else exact mm. */
    public static function cssPageSize(float $widthMm, float $heightMm): string
    {
        foreach (['A4' => [210, 297], 'A5' => [148, 210]] as $name => [$short, $long]) {
            $near = fn (float $a, float $b) => abs($a - $b) <= 2;
            if ($near($widthMm, $short) && $near($heightMm, $long)) {
                return "{$name} portrait";
            }
            if ($near($widthMm, $long) && $near($heightMm, $short)) {
                return "{$name} landscape";
            }
        }

        return "{$widthMm}mm {$heightMm}mm";
    }

    /**
     * @param  list<array{x:float,y:float,w:float,h?:float,text:?string,size?:float,bold?:bool,align?:string,static?:bool}>  $texts
     * @param  array{y:float,rowHeight:float,columns:list<array{x:float,w:float,header:string,align?:string}>}|null  $table
     * @param  list<list<string|int|float|null>>  $tableRows
     * @param  array{y:float,lineY?:float,roleY?:float,columns:list<array{x:float,w:float,action:string,role:string}>}|null  $signatures
     * @param  array{x:float,y:float,w:float,h:float}|null  $logoBox
     */
    public function render(
        float $pageWidthMm,
        float $pageHeightMm,
        array $texts,
        ?array $table,
        array $tableRows,
        ?array $signatures,
        ?array $logoBox = null,
        float $offsetXMm = 0,
        float $offsetYMm = 0,
        bool $autoPageSize = false,
        bool $dataOnly = false,
        bool $full = false,
        bool $fitA4 = false,
    ): string {
        $esc = fn ($v) => htmlspecialchars((string) ($v ?? ''), ENT_QUOTES);
        $ox = fn (float $v) => round($v + $offsetXMm, 2);
        $oy = fn (float $v) => round($v + $offsetYMm, 2);
        // $dataOnly: for the downloadable PDF (DocumentPdfRenderer) — static
        // elements are left out of the markup entirely rather than merely
        // hidden by @media print, since the PDF engine isn't a browser and
        // "what it rendered" IS the print output, with no on-screen/print
        // distinction to rely on.
        $logo = $dataOnly ? null : $this->logoDataUri();
        $logoBox ??= ['x' => 7.4, 'y' => 5.3, 'w' => 16.9, 'h' => 16.9];
        $frameRows = $full && $table ? self::fixTable($pageHeightMm, $texts, $table, count($tableRows), $signatures, $fitA4) : 0;

        $html = '<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Cetak Dokumen</title><style>';
        // autoPageSize: skip the explicit `size:` — some printer drivers (dot-
        // matrix / continuous-form drivers common for pre-printed stationery)
        // get stuck "Spooling" forever when asked for an exact custom mm size
        // they have no matching Windows "form" for. Leaving size unset lets the
        // print dialog fall back to whatever paper/form is already selected on
        // that printer; the absolute mm coordinates below are unaffected either
        // way (they're measured from the page's own top-left corner).
        // A page within 2mm of a standard sheet asks for that sheet BY NAME
        // ("A5 landscape" for the 210x147mm NPBG/PPB/RI templates, "A4" for
        // PO), so the browser picks the driver's own A5/A4 form — exactly what
        // Accurate prints on. "210mm 147mm" is 1mm off A5 and became a CUSTOM
        // paper size, which made the HP LaserJet P1102 (host-based) driver
        // crash the whole browser on Print, in Chrome and Firefox alike.
        // $fitA4: plain A4 in the document's orientation, the page scaled up to fill it (A5 → A4 landscape)
        if ($fitA4) {
            [$sheet, $zoom] = self::a4Fit($pageWidthMm, $pageHeightMm);
            $html .= "@page{size:A4 {$sheet['orientation']};margin:".self::A4_MARGIN_MM.'mm}';
            $html .= "@media print{.page{zoom:{$zoom};margin:0 auto}}";
        } else {
            $html .= $autoPageSize ? '@page{margin:0}' : '@page{size:'.self::cssPageSize($pageWidthMm, $pageHeightMm).';margin:0}';
        }
        $html .= '*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#000}';
        $html .= ".page{position:relative;width:{$pageWidthMm}mm;height:{$pageHeightMm}mm;overflow:hidden;border:0.5pt dashed #ccc}";
        $html .= '.t{position:absolute;line-height:1.15;overflow:hidden;white-space:pre-wrap}';
        $html .= '.logo{position:absolute;object-fit:contain}';
        $html .= '.th,.td{position:absolute;overflow:hidden;white-space:nowrap}';
        $html .= '.th{font-weight:bold;border-top:0.5pt solid #000;border-bottom:0.5pt solid #000}';
        $html .= '.td{border-bottom:0.3pt solid #999}';
        $html .= '.sigline{position:absolute;border-top:0.5pt solid #000}';
        $html .= '.previewtag{position:fixed;right:4mm;top:2mm;font-size:7pt;color:#f59e0b;font-weight:bold;background:#fff;padding:1px 4px;border:0.5pt solid #f59e0b;border-radius:2px;z-index:9}';
        // The ONLY thing that differs between "on screen" and "actually
        // printed" — everything tagged .static (logo, labels, title, table
        // header, signature captions/lines, the preview banner, the dashed
        // page border) disappears under @media print; the browser's own print
        // preview pane already honors this, so it matches the paper exactly.
        // $full: plain paper — the kop, labels, table header and lines are printed too
        $html .= $full ? '@media print{.page{border:none}}' : '@media print{.static,.previewtag{display:none!important}.page{border:none}}';
        if ($full) {
            $html .= '.th,.td{border:none!important;padding:1.9mm 1mm 0}.ln{position:absolute}';
        }
        $html .= '</style></head><body><div class="page">';
        if (! $dataOnly && ! $full) {
            $html .= '<div class="static previewtag">PREVIEW — label &amp; kop tidak ikut tercetak (kertas sudah pre-printed)</div>';
        }

        if ($logo) {
            $html .= sprintf(
                '<img class="static logo" src="%s" style="left:%smm;top:%smm;width:%smm;height:%smm">',
                $logo, $ox($logoBox['x']), $oy($logoBox['y']), $logoBox['w'], $logoBox['h'],
            );
        }

        foreach ($texts as $t) {
            if ($dataOnly && ($t['static'] ?? false)) {
                continue;
            }
            $static = ($t['static'] ?? false) ? ' static' : '';
            $style = sprintf(
                'left:%smm;top:%smm;width:%smm;%sfont-size:%spt;text-align:%s;%s',
                $ox($t['x']), $oy($t['y']), $t['w'],
                isset($t['h']) ? "height:{$t['h']}mm;" : '',
                $t['size'] ?? 8,
                $t['align'] ?? 'left',
                ($t['bold'] ?? false) ? 'font-weight:bold;' : '',
            );
            $html .= '<div class="t'.$static.'" style="'.$style.'">'.nl2br($esc($t['text'])).'</div>';
        }

        if ($table) {
            if (! $dataOnly) {
                foreach ($table['columns'] as $c) {
                    $html .= sprintf(
                        '<div class="th static" style="left:%smm;top:%smm;width:%smm;font-size:7.5pt;text-align:%s">%s</div>',
                        $ox($c['x']), $oy($table['y']), $c['w'], $c['align'] ?? 'left', $esc($c['header']),
                    );
                }
            }
            if ($frameRows) {
                // the fixed table: frame, header line, empty row lines and column lines, whatever the number of items
                $rh = $table['rowHeight'];
                $x0 = $table['columns'][0]['x'];
                $last = end($table['columns']);
                $w = round($last['x'] + $last['w'] - $x0, 2);
                $h = round($rh * ($frameRows + 1), 2);
                $line = fn (float $x, float $y, string $css) => sprintf('<div class="ln static" style="left:%smm;top:%smm;%s"></div>', $ox($x), $oy($y), $css);
                $html .= $line($x0, $table['y'], "width:{$w}mm;height:{$h}mm;border:0.6pt solid #000");
                $html .= $line($x0, $table['y'] + $rh, "width:{$w}mm;border-top:0.6pt solid #000");
                for ($r = 2; $r <= $frameRows; $r++) {
                    $html .= $line($x0, $table['y'] + $rh * $r, "width:{$w}mm;border-top:0.3pt solid #999");
                }
                foreach (array_slice($table['columns'], 1) as $c) {
                    $html .= $line($c['x'], $table['y'], "height:{$h}mm;border-left:0.3pt solid #000");
                }
            }
            $y = $table['y'] + $table['rowHeight'];
            foreach ($tableRows as $row) {
                foreach ($table['columns'] as $i => $c) {
                    $html .= sprintf(
                        '<div class="td" style="left:%smm;top:%smm;width:%smm;font-size:7.5pt;text-align:%s">%s</div>',
                        $ox($c['x']), $oy($y), $c['w'], $c['align'] ?? 'left', $esc($row[$i] ?? null),
                    );
                }
                $y += $table['rowHeight'];
            }
        }

        if ($signatures && ! $dataOnly) {
            $lineY = $signatures['lineY'] ?? ($signatures['y'] + 15);
            $roleY = $signatures['roleY'] ?? ($signatures['y'] + 15.5);
            foreach ($signatures['columns'] as $c) {
                $html .= sprintf(
                    '<div class="t static" style="left:%smm;top:%smm;width:%smm;font-size:7.5pt;text-align:center">%s</div>',
                    $ox($c['x']), $oy($signatures['y']), $c['w'], $esc($c['action']),
                );
                $html .= sprintf(
                    '<div class="sigline static" style="left:%smm;top:%smm;width:%smm"></div>',
                    $ox($c['x'] + 1), $oy($lineY), $c['w'] - 2,
                );
                $html .= sprintf(
                    '<div class="t static" style="left:%smm;top:%smm;width:%smm;font-size:7.5pt;text-align:center">%s</div>',
                    $ox($c['x']), $oy($roleY), $c['w'], $esc($c['role']),
                );
            }
        }

        $html .= '</div></body></html>';

        return $html;
    }

    /**
     * The same document as a real PDF, data only (what actually goes onto the
     * pre-printed paper) — printed from a desktop PDF reader instead of the
     * browser; see DocumentPdfWriter. Takes render()'s arguments as-is.
     *
     * @param  list<array{x:float,y:float,w:float,h?:float,text:?string,size?:float,bold?:bool,align?:string,static?:bool}>  $texts
     * @param  array{y:float,rowHeight:float,columns:list<array{x:float,w:float,header:string,align?:string}>}|null  $table
     * @param  list<list<string|int|float|null>>  $tableRows
     */
    public function pdf(
        float $pageWidthMm,
        float $pageHeightMm,
        array $texts,
        ?array $table,
        array $tableRows,
        ?array $signatures,
        ?array $logoBox = null,
        float $offsetXMm = 0,
        float $offsetYMm = 0,
        bool $autoPageSize = false,
        bool $full = false,
        bool $fitA4 = false,
    ): string {
        $frameRows = $full && $table ? self::fixTable($pageHeightMm, $texts, $table, count($tableRows), $signatures, $fitA4) : 0;
        $sheet = null;
        if ($fitA4) {
            [$a4, $zoom] = self::a4Fit($pageWidthMm, $pageHeightMm);
            $sheet = ['w' => $a4['w'], 'h' => $a4['h'], 'scale' => $zoom, 'top' => self::A4_MARGIN_MM];
        }
        $pdf = new DocumentPdfWriter($pageWidthMm, $pageHeightMm, $sheet);
        $ox = $offsetXMm;
        $oy = $offsetYMm;
        foreach ($texts as $t) {
            if ($full || ! ($t['static'] ?? false)) {
                $pdf->text($t['x'] + $ox, $t['y'] + $oy, $t['w'], $t['h'] ?? null, $t['text'] ?? null,
                    (float) ($t['size'] ?? 8), (bool) ($t['bold'] ?? false), $t['align'] ?? 'left');
            }
        }
        if ($table) {
            $rh = $table['rowHeight'];
            // full: cells padded inside the fixed table's lines, like the HTML (.th/.td padding 1.9mm 1mm)
            [$px, $py] = $full ? [1.0, 1.9] : [0.0, 0.0];
            if ($full) {
                $x0 = $table['columns'][0]['x'] + $ox;
                $last = end($table['columns']);
                $w = $last['x'] + $last['w'] + $ox - $x0;
                $top = $table['y'] + $oy;
                $bottom = $top + $rh * ($frameRows + 1);
                $pdf->rule($x0, $top, $w, 0.6);
                $pdf->rule($x0, $top + $rh, $w, 0.6);
                for ($r = 2; $r <= $frameRows; $r++) {
                    $pdf->rule($x0, $top + $rh * $r, $w, 0.3, 0.6);
                }
                $pdf->rule($x0, $bottom, $w, 0.6);
                $pdf->vline($x0, $top, $bottom, 0.6);
                $pdf->vline($x0 + $w, $top, $bottom, 0.6);
                foreach ($table['columns'] as $i => $c) {
                    if ($i > 0) {
                        $pdf->vline($c['x'] + $ox, $top, $bottom, 0.3);
                    }
                    $pdf->text($c['x'] + $ox + $px, $top + $py, $c['w'] - 2 * $px, null, $c['header'], 7.5, true, $c['align'] ?? 'left');
                }
            }
            $y = $table['y'] + $rh;
            foreach ($tableRows as $row) {
                foreach ($table['columns'] as $i => $c) {
                    $v = $row[$i] ?? null;
                    $pdf->cell($c['x'] + $ox + $px, $y + $oy + $py, $c['w'] - 2 * $px, $v === null ? null : (string) $v, 7.5, $c['align'] ?? 'left');
                }
                $y += $rh;
            }
        }
        if ($full && $signatures) {
            $lineY = $signatures['lineY'] ?? ($signatures['y'] + 15);
            $roleY = $signatures['roleY'] ?? ($signatures['y'] + 15.5);
            foreach ($signatures['columns'] as $c) {
                $pdf->text($c['x'] + $ox, $signatures['y'] + $oy, $c['w'], null, $c['action'], 7.5, false, 'center');
                $pdf->rule($c['x'] + 1 + $ox, $lineY + $oy, $c['w'] - 2);
                $pdf->text($c['x'] + $ox, $roleY + $oy, $c['w'], null, $c['role'], 7.5, false, 'center');
            }
        }

        return $pdf->output();
    }
}
