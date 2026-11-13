<?php

namespace App\Services;

use App\Support\RiSerials;
use Illuminate\Validation\ValidationException;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Style\NumberFormat;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The Excel of an RI's serial numbers: one row per unit. Every row carries its own hidden "Row ID" (line + unit,
 * signed), so a sorted / moved row still lands on its own unit; "Line ID" is hidden too.
 */
class RiSerialExcel
{
    public const MAX_ROWS = 5000;

    private const HEADERS = ['Line ID', 'No', 'Item Code', 'Item Description', 'Unit', 'Unit No', 'Serial No', 'Row ID'];

    /** "12-3-1a2b3c4d": line 12, unit 3, signed with the app key (a typed or changed id is refused) */
    public static function rowId(int $key, int $unit): string
    {
        return "{$key}-{$unit}-".self::sign($key, $unit);
    }

    /** @return array{0:int,1:int}|null [line key, unit] of a valid row id */
    public static function readRowId(mixed $value): ?array
    {
        if (! is_string($value) || ! preg_match('/^(-?\d+)-(\d+)-([0-9a-f]{10})$/', trim($value), $m)) {
            return null;
        }

        return hash_equals(self::sign((int) $m[1], (int) $m[2]), $m[3]) ? [(int) $m[1], (int) $m[2]] : null;
    }

    private static function sign(int $key, int $unit): string
    {
        return substr(hash_hmac('sha256', "ri-serial:{$key}:{$unit}", (string) config('app.key')), 0, 10);
    }

    /** @param  iterable<array{key:int, kode?:?string, deskripsi?:?string, satuan?:?string, qty:int, serials?:?array}>  $lines */
    public function download(iterable $lines, string $filename): StreamedResponse
    {
        $book = new Spreadsheet;
        $sheet = $book->getActiveSheet();
        $sheet->setTitle('Serial No');
        foreach (self::HEADERS as $c => $h) {
            $sheet->setCellValue([$c + 1, 1], $h);
        }
        $sheet->getStyle('A1:G1')->getFont()->setBold(true);
        $sheet->getStyle('A1:G1')->getFill()->setFillType('solid')->getStartColor()->setRGB('F1F5F9');
        $sheet->freezePane('A2');

        $r = 2;
        foreach ($lines as $line) {
            for ($u = 1; $u <= $line['qty']; $u++) {
                $sheet->setCellValue([1, $r], (int) $line['key']);
                $sheet->setCellValue([2, $r], $r - 1);
                // text the browser sent or a vendor wrote is never a formula, and "089001" keeps its zero
                $sheet->setCellValueExplicit([3, $r], (string) ($line['kode'] ?? ''), DataType::TYPE_STRING);
                $sheet->setCellValueExplicit([4, $r], (string) ($line['deskripsi'] ?? ''), DataType::TYPE_STRING);
                $sheet->setCellValueExplicit([5, $r], (string) ($line['satuan'] ?? ''), DataType::TYPE_STRING);
                $sheet->setCellValue([6, $r], $u);
                $sheet->setCellValueExplicit([7, $r], (string) ($line['serials'][$u - 1] ?? ''), DataType::TYPE_STRING);
                $sheet->setCellValueExplicit([8, $r], self::rowId((int) $line['key'], $u), DataType::TYPE_STRING);
                $r++;
            }
        }
        if ($r > 2) {
            $sheet->getStyle('G2:G'.($r - 1))->getNumberFormat()->setFormatCode(NumberFormat::FORMAT_TEXT);
            $sheet->getStyle('G2:G'.($r - 1))->getFill()->setFillType('solid')->getStartColor()->setRGB('FEF9C3');
        }
        foreach (['A' => 9, 'B' => 6, 'C' => 16, 'D' => 48, 'E' => 8, 'F' => 8, 'G' => 32, 'H' => 18] as $col => $width) {
            $sheet->getColumnDimension($col)->setWidth($width);
        }
        // the ids tie each row to its unit: kept in the file, out of sight
        $sheet->getColumnDimension('A')->setVisible(false);
        $sheet->getColumnDimension('H')->setVisible(false);

        return response()->streamDownload(function () use ($book) {
            (new Xlsx($book))->save('php://output');
        }, $filename, ['Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
    }

    /** @return list<array{key:int, serials:list<string>}> per line, in the order they first appear */
    public function parse(string $path): array
    {
        try {
            $reader = IOFactory::createReaderForFile($path);
            $reader->setReadDataOnly(true);
            $sheet = $reader->load($path)->getActiveSheet();
        } catch (\Throwable) {
            throw ValidationException::withMessages(['file' => 'File Excel tidak bisa dibaca.']);
        }

        $last = $sheet->getHighestDataRow();
        if ($last - 1 > self::MAX_ROWS) {
            throw ValidationException::withMessages(['file' => 'Maksimal '.self::MAX_ROWS.' baris nomor seri per file.']);
        }
        $head = [];
        foreach (range(1, min(20, \PhpOffice\PhpSpreadsheet\Cell\Coordinate::columnIndexFromString($sheet->getHighestDataColumn()))) as $c) {
            $head[mb_strtolower(trim((string) $sheet->getCell([$c, 1])->getValue()))] = $c;
        }
        $keyCol = $head['line id'] ?? null;
        $serialCol = $head['serial no'] ?? null;
        $rowIdCol = $head['row id'] ?? null;
        if (! $serialCol || (! $keyCol && ! $rowIdCol)) {
            throw ValidationException::withMessages(['file' => 'Format file tidak dikenali. Pakai file dari tombol Export.']);
        }
        if ($rowIdCol) {
            return $this->parseByRowId($sheet, $last, $serialCol, $rowIdCol);
        }

        // older files (before Row ID): per line, in the order of the rows
        $lines = [];
        $firstRow = [];
        for ($r = 2; $r <= $last; $r++) {
            $serial = $this->text($sheet->getCell([$serialCol, $r])->getValue());
            if ($serial === '') {
                continue;
            }
            $key = $sheet->getCell([$keyCol, $r])->getValue();
            if (! is_numeric($key)) {
                throw ValidationException::withMessages(['file' => "Baris {$r}: Line ID kosong atau berubah. Pakai file dari tombol Export."]);
            }
            if (str_contains($serial, ';')) {
                throw ValidationException::withMessages(['file' => "Baris {$r}: nomor seri tidak boleh berisi tanda titik koma."]);
            }
            if (mb_strlen($serial) > 100) {
                throw ValidationException::withMessages(['file' => "Baris {$r}: nomor seri lebih dari 100 karakter."]);
            }
            $id = (int) $key;
            $at = mb_strtolower($serial);
            if (isset($firstRow[$id][$at])) {
                throw ValidationException::withMessages(['file' => "Nomor seri {$serial} dobel: baris {$firstRow[$id][$at]} dan {$r}."]);
            }
            $firstRow[$id][$at] = $r;
            $lines[$id][] = $serial;
        }
        if ($lines === []) {
            throw ValidationException::withMessages(['file' => 'Belum ada nomor seri yang diisi di file ini.']);
        }

        return array_map(fn ($id) => ['key' => $id, 'serials' => $lines[$id]], array_keys($lines));
    }

    /**
     * Each filled row lands on its own unit through its hidden Row ID, wherever it was moved or sorted to;
     * a row without a valid id (typed, changed) or one copied twice is refused.
     *
     * @return list<array{key:int, serials:list<string>}>
     */
    private function parseByRowId(\PhpOffice\PhpSpreadsheet\Worksheet\Worksheet $sheet, int $last, int $serialCol, int $rowIdCol): array
    {
        $units = [];
        $rowOfId = [];
        $rowOfSerial = [];
        for ($r = 2; $r <= $last; $r++) {
            $serial = $this->text($sheet->getCell([$serialCol, $r])->getValue());
            if ($serial === '') {
                continue;
            }
            $raw = $this->text($sheet->getCell([$rowIdCol, $r])->getValue());
            $id = self::readRowId($raw);
            if ($id === null) {
                throw ValidationException::withMessages(['file' => "Baris {$r}: ID baris ".($raw === '' ? 'kosong (baris tambahan?)' : 'tidak valid / berubah').'. Isi nomor seri di baris dari file Export.']);
            }
            [$key, $unit] = $id;
            if (isset($rowOfId[$raw])) {
                throw ValidationException::withMessages(['file' => "Baris {$rowOfId[$raw]} dan {$r} punya ID yang sama (baris disalin). Satu baris untuk satu unit."]);
            }
            $rowOfId[$raw] = $r;
            if (str_contains($serial, ';')) {
                throw ValidationException::withMessages(['file' => "Baris {$r}: nomor seri tidak boleh berisi tanda titik koma."]);
            }
            if (mb_strlen($serial) > 100) {
                throw ValidationException::withMessages(['file' => "Baris {$r}: nomor seri lebih dari 100 karakter."]);
            }
            $at = mb_strtolower($serial);
            if (isset($rowOfSerial[$key][$at])) {
                throw ValidationException::withMessages(['file' => "Nomor seri {$serial} dobel: baris {$rowOfSerial[$key][$at]} dan {$r}."]);
            }
            $rowOfSerial[$key][$at] = $r;
            $units[$key][$unit] = $serial;
        }
        if ($units === []) {
            throw ValidationException::withMessages(['file' => 'Belum ada nomor seri yang diisi di file ini.']);
        }

        // per line in the order of its units (Unit No); the form puts each list back by its line key
        ksort($units);

        return array_map(function ($key) use ($units) {
            $list = $units[$key];
            ksort($list);

            return ['key' => $key, 'serials' => array_values($list)];
        }, array_keys($units));
    }

    /** A cell as a serial; a number Excel stored as a number comes back without ".0" or an exponent. */
    private function text(mixed $value): string
    {
        if (is_float($value)) {
            return floor($value) === $value ? number_format($value, 0, '', '') : rtrim(rtrim(sprintf('%.6F', $value), '0'), '.');
        }
        if ($value instanceof \PhpOffice\PhpSpreadsheet\RichText\RichText) {
            return trim($value->getPlainText());
        }

        return trim((string) $value);
    }
}
